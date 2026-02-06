import express, { Request, Response, NextFunction } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getAllChats, getMessagesSince } from './db.js';
import {
  createAuthToken,
  verifyToken,
  initializeAuth,
  getAllTokens,
  revokeToken,
} from './auth.js';
import { ASSISTANT_NAME, DATA_DIR } from './config.js';
import { logger } from './logger.js';
import { loadChannelsConfig } from './channels-config.js';
import {
  createPWAConversation,
  getAllPWAConversations,
  getPWAConversation,
  sendToPWAAgent,
} from './pwa-channel.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface AuthRequest extends Request {
  token?: string;
}

interface WebMessage {
  type: string;
  data?: any;
}

const connectedClients = new Set<WebSocket>();

// Authentication middleware
function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token || !verifyToken(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  req.token = token;
  next();
}

export function startWebServer(
  port: number,
  registeredGroups: () => Record<string, any>,
  sendMessageCallback: (jid: string, text: string) => Promise<void>
): http.Server {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Login endpoint
  app.post('/api/login', (req, res) => {
    const { password, deviceName } = req.body;

    if (!password) {
      return res.status(400).json({ error: 'Password required' });
    }

    const token = createAuthToken(password, deviceName);

    if (!token) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    res.json({ token, expiresIn: '30d' });
  });

  // Get all conversations/groups
  app.get('/api/conversations', authMiddleware, (req, res) => {
    const config = loadChannelsConfig();
    const conversations: any[] = [];

    // Mode standalone PWA : conversations PWA uniquement
    if (config.channels.pwa?.standalone) {
      const pwaConvs = getAllPWAConversations();
      conversations.push(...pwaConvs.map(conv => ({
        jid: conv.id,
        name: conv.name,
        folder: `pwa-${conv.id}`,
        lastActivity: conv.lastActivity,
        type: 'pwa',
      })));
    } else {
      // Mode WhatsApp : groupes WhatsApp
      const groups = registeredGroups();
      const chats = getAllChats();

      conversations.push(...Object.entries(groups).map(([jid, group]: [string, any]) => {
        const chat = chats.find((c) => c.jid === jid);
        return {
          jid,
          name: group.name,
          folder: group.folder,
          lastActivity: chat?.last_message_time || group.added_at,
          type: 'whatsapp',
        };
      }));
    }

    // Sort by last activity
    conversations.sort((a, b) =>
      new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
    );

    res.json({ conversations });
  });

  // Get messages for a conversation
  app.get('/api/conversations/:jid/messages', authMiddleware, (req, res) => {
    const { jid } = req.params;
    const { since } = req.query;
    const config = loadChannelsConfig();

    // Mode standalone PWA
    if (config.channels.pwa?.standalone && jid.startsWith('pwa-')) {
      const conversation = getPWAConversation(jid);
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      const sinceTimestamp = typeof since === 'string' ? since : '';
      const filteredMessages = conversation.messages.filter(
        msg => !sinceTimestamp || msg.timestamp > sinceTimestamp
      );

      res.json({
        messages: filteredMessages.map(msg => ({
          id: msg.id,
          chat_jid: jid,
          sender_name: msg.sender === 'user' ? 'You' : ASSISTANT_NAME,
          content: msg.sender === 'assistant' ? `${ASSISTANT_NAME}: ${msg.content}` : msg.content,
          timestamp: msg.timestamp,
          is_from_me: msg.sender === 'user',
        }))
      });
      return;
    }

    // Mode WhatsApp
    const groups = registeredGroups();
    if (!groups[jid]) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const sinceTimestamp = typeof since === 'string' ? since : '';
    const messages = getMessagesSince(jid, sinceTimestamp, ASSISTANT_NAME);

    res.json({ messages });
  });

  // Send a message
  app.post('/api/conversations/:jid/messages', authMiddleware, async (req, res) => {
    const { jid } = req.params;
    let { content } = req.body;

    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'Content required' });
    }

    const config = loadChannelsConfig();

    try {
      // Mode standalone PWA
      if (config.channels.pwa?.standalone && jid.startsWith('pwa-')) {
        const conversation = getPWAConversation(jid);
        if (!conversation) {
          return res.status(404).json({ error: 'Conversation not found' });
        }

        // Envoyer directement à l'agent
        const response = await sendToPWAAgent(jid, content, ASSISTANT_NAME);

        // Broadcast to all connected WebSocket clients
        broadcastToClients({
          type: 'message',
          data: {
            chat_jid: jid,
            sender_name: ASSISTANT_NAME,
            content: `${ASSISTANT_NAME}: ${response}`,
            timestamp: new Date().toISOString(),
          },
        });

        res.json({ success: true });
        return;
      }

      // Mode WhatsApp
      const groups = registeredGroups();
      const group = groups[jid];
      if (!group) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      // For PWA: auto-trigger the assistant by adding trigger pattern
      // (unless it's the main group which responds to everything)
      const triggerPattern = new RegExp(`^@${ASSISTANT_NAME}\\b`, 'i');
      if (group.folder !== 'main' && !triggerPattern.test(content)) {
        content = `@${ASSISTANT_NAME} ${content}`;
      }

      // Send via WhatsApp
      await sendMessageCallback(jid, content);

      // Broadcast to all connected WebSocket clients
      broadcastToClients({
        type: 'message',
        data: {
          chat_jid: jid,
          sender_name: 'You',
          content,
          timestamp: new Date().toISOString(),
        },
      });

      res.json({ success: true });
    } catch (err) {
      logger.error({ err, jid }, 'Failed to send message via web API');
      res.status(500).json({ error: 'Failed to send message' });
    }
  });

  // Create a new PWA conversation
  app.post('/api/conversations', authMiddleware, (req, res) => {
    const { name } = req.body;
    const config = loadChannelsConfig();

    if (!config.channels.pwa?.standalone) {
      return res.status(400).json({ error: 'PWA standalone mode not enabled' });
    }

    const conversation = createPWAConversation(name);
    res.json({
      jid: conversation.id,
      name: conversation.name,
      folder: `pwa-${conversation.id}`,
      lastActivity: conversation.lastActivity,
      type: 'pwa',
    });
  });

  // Token management endpoints
  app.get('/api/tokens', authMiddleware, (req, res) => {
    const tokens = getAllTokens();
    res.json({ tokens });
  });

  app.delete('/api/tokens/:token', authMiddleware, (req, res) => {
    const { token } = req.params;
    revokeToken(token);
    res.json({ success: true });
  });

  // WebSocket connection handling
  wss.on('connection', (ws: WebSocket, req) => {
    // Verify token from query parameter
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token || !verifyToken(token)) {
      ws.close(1008, 'Unauthorized');
      return;
    }

    connectedClients.add(ws);
    logger.info('WebSocket client connected');

    ws.on('message', async (data: Buffer) => {
      try {
        const message: WebMessage = JSON.parse(data.toString());

        // Handle ping/pong for keep-alive
        if (message.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (err) {
        logger.error({ err }, 'Error handling WebSocket message');
      }
    });

    ws.on('close', () => {
      connectedClients.delete(ws);
      logger.info('WebSocket client disconnected');
    });

    ws.on('error', (err) => {
      logger.error({ err }, 'WebSocket error');
      connectedClients.delete(ws);
    });

    // Send initial connection success
    ws.send(JSON.stringify({ type: 'connected', data: { timestamp: new Date().toISOString() } }));
  });

  server.listen(port, () => {
    logger.info({ port }, 'Web server started');
    console.log(`\n🌐 PWA Web Interface: http://localhost:${port}\n`);
  });

  return server;
}

// Broadcast message to all connected WebSocket clients
export function broadcastToClients(message: WebMessage): void {
  const data = JSON.stringify(message);
  connectedClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

// Called when a new message arrives (to notify web clients)
export function notifyNewMessage(message: any): void {
  broadcastToClients({
    type: 'message',
    data: message,
  });
}
