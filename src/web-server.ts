import express, { Request, Response, NextFunction } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  exchangeTemporaryToken,
  verifyToken,
  generateTemporaryToken,
  getAllTokens,
  revokeToken,
} from './auth.js';
import { ASSISTANT_NAME, GROUPS_DIR } from './config.js';
import { getLimits, saveLimits, getMemoryContextContent } from './memory/generate-context.js';
import { feedExchange, getProcessingStatus, resetContextAgent } from './memory/context-agent.js';
import { readTraces } from './memory/trace-logger.js';
import { logger } from './logger.js';
import {
  createPWAConversation,
  getAllPWAConversations,
  getPWAConversation,
  getPWAMessages,
  renamePWAConversation,
  deletePWAConversation,
  sendToPWAAgent,
  containerManager,
} from './pwa-channel.js';
import {
  savePushSubscription,
  removePushSubscription,
  generatePWAMessageId,
  addPWAMessage,
  setPWAAutoRename,
} from './db.js';
import { transcribeAudio } from './tts-stt.js';
import { maybeEvaluateTitle } from './title-agent.js';
import crypto from 'crypto';
import os from 'os';

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

export function startWebServer(port: number): http.Server {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  app.use(express.json());

  // Serve static files from pwa/dist/ with SPA fallback
  const pwaDistDir = path.join(__dirname, '..', 'pwa', 'dist');

  // SW and HTML must never be browser-cached so updates propagate immediately
  app.get(['/sw.js', '/index.html', '/manifest.json'], (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    if (_req.path === '/sw.js') res.setHeader('Service-Worker-Allowed', '/');
    next();
  });

  app.use(express.static(pwaDistDir));

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Login endpoint - exchanges temporary token for permanent token,
  // or accepts an existing permanent token directly
  app.post('/api/login', (req, res) => {
    const { token: inputToken, deviceName } = req.body;

    if (!inputToken) {
      return res.status(400).json({ error: 'Token required' });
    }

    // If the token is already a valid permanent token, return it directly
    if (verifyToken(inputToken)) {
      return res.json({ token: inputToken });
    }

    // Otherwise try to exchange as temporary token
    const permanentToken = exchangeTemporaryToken(
      inputToken,
      deviceName || 'Unknown Device',
    );

    if (!permanentToken) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    res.json({ token: permanentToken });
  });

  // List all conversations
  app.get('/api/conversations', authMiddleware, (_req, res) => {
    const conversations = getAllPWAConversations();
    conversations.sort(
      (a, b) =>
        new Date(b.lastActivity).getTime() -
        new Date(a.lastActivity).getTime(),
    );
    res.json({ conversations });
  });

  // Create a new PWA conversation
  app.post('/api/conversations', authMiddleware, (req, res) => {
    const { name } = req.body;
    const conversation = createPWAConversation(name);

    broadcastToClients({
      type: 'conversation_created',
      data: {
        jid: conversation.jid,
        name: conversation.name,
        lastActivity: conversation.lastActivity,
        type: 'pwa',
      },
    });

    res.json(conversation);
  });

  // Get messages for a conversation
  app.get(
    '/api/conversations/:id/messages',
    authMiddleware,
    (req: AuthRequest, res) => {
      const { id } = req.params;
      const { since } = req.query;

      const conversation = getPWAConversation(id);
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      const sinceStr = typeof since === 'string' ? since : undefined;
      const messages = getPWAMessages(id, sinceStr);
      res.json({ messages });
    },
  );

  // Send a message
  app.post(
    '/api/conversations/:id/messages',
    authMiddleware,
    async (req: AuthRequest, res) => {
      const { id } = req.params;
      const { content, audioMode } = req.body;

      if (!content || typeof content !== 'string') {
        return res.status(400).json({ error: 'Content is required' });
      }

      try {
        const conversation = getPWAConversation(id);
        if (!conversation) {
          return res.status(404).json({ error: 'Conversation not found' });
        }

        const userMsgId = generatePWAMessageId();

        // Return immediately, agent response arrives via WebSocket
        res.json({ success: true, messageId: userMsgId });

        // Run agent in background
        runAgentAndBroadcast(id, content, !!audioMode);
      } catch (err) {
        logger.error({ err, id }, 'Failed to send message via web API');
        res.status(500).json({ error: 'Internal server error' });
      }
    },
  );

  // Update a conversation (rename and/or toggle auto-rename)
  app.patch(
    '/api/conversations/:id',
    authMiddleware,
    (req: AuthRequest, res) => {
      const { id } = req.params;
      const { name, autoRename } = req.body;

      if (!name && autoRename === undefined) {
        return res.status(400).json({ error: 'Name or autoRename is required' });
      }

      // Manual rename → also disable auto-rename
      if (name && typeof name === 'string') {
        const success = renamePWAConversation(id, name);
        if (!success) {
          return res.status(404).json({ error: 'Conversation not found' });
        }
        setPWAAutoRename(id, false);

        broadcastToClients({
          type: 'conversation_renamed',
          data: { jid: id, name },
        });
      }

      // Toggle auto-rename
      if (autoRename !== undefined) {
        setPWAAutoRename(id, !!autoRename);
      }

      res.json({ success: true });
    },
  );

  // Delete a conversation
  app.delete(
    '/api/conversations/:id',
    authMiddleware,
    (req: AuthRequest, res) => {
      const { id } = req.params;

      const success = deletePWAConversation(id);
      if (!success) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      broadcastToClients({
        type: 'conversation_deleted',
        data: { jid: id },
      });

      res.json({ success: true });
    },
  );

  // Batch delete conversations
  app.delete('/api/conversations', authMiddleware, (req: AuthRequest, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }

    const deleted: string[] = [];
    for (const id of ids) {
      if (typeof id === 'string' && deletePWAConversation(id)) {
        broadcastToClients({
          type: 'conversation_deleted',
          data: { jid: id },
        });
        deleted.push(id);
      }
    }

    res.json({ deleted });
  });

  // Interrupt the agent for a conversation
  app.post(
    '/api/conversations/:id/interrupt',
    authMiddleware,
    (req: AuthRequest, res) => {
      const { id } = req.params;

      containerManager.interruptContainer(id);

      broadcastToClients({
        type: 'agent_status',
        data: {
          conversation_id: id,
          status: 'interrupted',
          timestamp: new Date().toISOString(),
        },
      });

      res.json({ success: true });
    },
  );

  // Get file from conversation (supports ?token= query param for <img src> usage)
  app.get(
    '/api/conversations/:id/files/*',
    (req: AuthRequest, res, next) => {
      // Accept token from query param (for inline <img>, <video>, <audio> src)
      const queryToken = req.query.token as string | undefined;
      if (queryToken && verifyToken(queryToken)) {
        req.token = queryToken;
        return next();
      }
      return authMiddleware(req, res, next);
    },
    (req: AuthRequest, res) => {
      const { id } = req.params;
      const filepath = (req.params as any)[0] as string;

      if (!filepath || filepath.includes('..') || filepath.startsWith('/')) {
        return res.status(403).json({ error: 'Path traversal not allowed' });
      }

      const conversation = getPWAConversation(id);
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      const fullPath = path.resolve(
        GROUPS_DIR,
        conversation.folder,
        filepath,
      );
      const groupDir = path.resolve(GROUPS_DIR, conversation.folder);

      // Double-check path traversal after resolution
      if (!fullPath.startsWith(groupDir + path.sep)) {
        return res.status(403).json({ error: 'Path traversal not allowed' });
      }

      if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ error: 'File not found' });
      }

      res.sendFile(fullPath);
    },
  );

  // --- Helper: run agent and broadcast results (text + audio messages) ---
  function runAgentAndBroadcast(conversationId: string, content: string, audioMode: boolean, skipUserMessage?: boolean) {
    sendToPWAAgent(
      conversationId,
      content,
      ASSISTANT_NAME,
      (convId, status) => {
        broadcastToClients({
          type: 'agent_status',
          data: {
            conversation_id: convId,
            status,
            timestamp: new Date().toISOString(),
          },
        });
      },
      audioMode,
      skipUserMessage,
      // Real-time reply callback
      (reply) => {
        broadcastToClients({
          type: 'message',
          data: {
            chat_jid: conversationId,
            sender_name: ASSISTANT_NAME,
            content: `${ASSISTANT_NAME}: ${reply.text}`,
            timestamp: new Date().toISOString(),
            ...(reply.audioSegments && { audio_segments: reply.audioSegments }),
          },
        });
      },
    )
      .then(({ response, renamedTo, audioSegments }) => {
        if (renamedTo) {
          broadcastToClients({
            type: 'conversation_renamed',
            data: { jid: conversationId, name: renamedTo },
          });
        }
        if (!response) {
          broadcastToClients({
            type: 'agent_status',
            data: {
              conversation_id: conversationId,
              status: 'done',
              timestamp: new Date().toISOString(),
            },
          });
          maybeEvaluateTitle(conversationId, (id, name) => {
            broadcastToClients({ type: 'conversation_renamed', data: { jid: id, name } });
          }).catch((err) => logger.error({ err, conversationId }, 'Title agent error'));
          return;
        }

        broadcastToClients({
          type: 'message',
          data: {
            chat_jid: conversationId,
            sender_name: ASSISTANT_NAME,
            content: `${ASSISTANT_NAME}: ${response}`,
            timestamp: new Date().toISOString(),
            ...(audioSegments && { audio_segments: audioSegments }),
          },
        });
        broadcastToClients({
          type: 'agent_status',
          data: {
            conversation_id: conversationId,
            status: 'done',
            timestamp: new Date().toISOString(),
          },
        });

        maybeEvaluateTitle(conversationId, (id, name) => {
          broadcastToClients({ type: 'conversation_renamed', data: { jid: id, name } });
        }).catch((err) => logger.error({ err, conversationId }, 'Title agent error'));
      })
      .catch((err) => {
        logger.error({ err, conversationId }, 'PWA agent error');

        const errorText = 'Désolé, une erreur est survenue. Réessayez.';
        const errorMsgId = generatePWAMessageId();
        addPWAMessage(errorMsgId, conversationId, 'assistant', errorText);
        broadcastToClients({
          type: 'message',
          data: {
            chat_jid: conversationId,
            sender_name: ASSISTANT_NAME,
            content: `${ASSISTANT_NAME}: ${errorText}`,
            timestamp: new Date().toISOString(),
          },
        });

        broadcastToClients({
          type: 'agent_status',
          data: {
            conversation_id: conversationId,
            status: 'error',
            timestamp: new Date().toISOString(),
          },
        });
      });
  }

  // --- Audio message upload endpoint ---
  app.post(
    '/api/conversations/:id/audio',
    express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '10mb' }),
    (req: AuthRequest, res, next) => {
      const queryToken = req.query.token as string | undefined;
      if (queryToken && verifyToken(queryToken)) {
        req.token = queryToken;
        return next();
      }
      return authMiddleware(req, res, next);
    },
    async (req: AuthRequest, res) => {
      const { id } = req.params;

      if (!id.startsWith('pwa-')) {
        return res.status(400).json({ error: 'Audio messages only supported for PWA conversations' });
      }

      const conversation = getPWAConversation(id);
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      if (!req.body || !(req.body instanceof Buffer) || req.body.length === 0) {
        return res.status(400).json({ error: 'Audio data required' });
      }

      try {
        const tmpFile = path.join(os.tmpdir(), `novabot-audio-${crypto.randomBytes(6).toString('hex')}.webm`);
        fs.writeFileSync(tmpFile, req.body);

        logger.info({ conversationId: id, size: req.body.length }, 'Transcribing audio message');
        const transcription = await transcribeAudio(tmpFile);
        logger.info({ conversationId: id, textLength: transcription.length }, 'Audio transcribed');

        const audioFilename = `user-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.webm`;
        const groupAudioDir = path.join(GROUPS_DIR, conversation.folder, 'audio');
        fs.mkdirSync(groupAudioDir, { recursive: true });
        fs.copyFileSync(tmpFile, path.join(groupAudioDir, audioFilename));
        fs.unlinkSync(tmpFile);

        const audioUrl = `audio/${audioFilename}`;

        const userMsgId = generatePWAMessageId();
        addPWAMessage(userMsgId, id, 'user', transcription, audioUrl);

        res.json({ success: true, messageId: userMsgId, transcription, audioUrl });

        broadcastToClients({
          type: 'message',
          data: {
            chat_jid: id,
            sender_name: 'You',
            content: transcription,
            audio_url: audioUrl,
            timestamp: new Date().toISOString(),
            is_from_me: true,
          },
        });

        runAgentAndBroadcast(id, transcription, true, true);
      } catch (err) {
        logger.error({ err, conversationId: id }, 'Audio message processing failed');
        res.status(500).json({ error: 'Failed to process audio message' });
      }
    },
  );

  // Memory settings endpoints
  app.get('/api/memory/settings', authMiddleware, (_req, res) => {
    res.json({ limits: getLimits() });
  });

  app.get('/api/memory/context', authMiddleware, (_req, res) => {
    const content = getMemoryContextContent();
    res.json({ content: content || '' });
  });

  app.put('/api/memory/settings', authMiddleware, (req, res) => {
    const { limits } = req.body;
    if (!limits || typeof limits !== 'object') {
      return res.status(400).json({ error: 'limits object required' });
    }
    const merged = saveLimits(limits);
    res.json({ ok: true, limits: merged });
  });

  // Memory testing/debugging endpoints
  app.get('/api/memory/status', authMiddleware, (_req, res) => {
    res.json(getProcessingStatus());
  });

  app.post('/api/memory/feed', authMiddleware, (req, res) => {
    const { channel, conversation, user_message, assistant_response } = req.body;
    if (!user_message || !assistant_response) {
      return res.status(400).json({ error: 'user_message and assistant_response required' });
    }
    feedExchange({
      channel: channel || 'test',
      conversation_name: conversation || 'Test',
      user_message,
      assistant_response,
      timestamp: new Date().toISOString(),
    });
    res.json({ ok: true, status: getProcessingStatus() });
  });

  app.post('/api/memory/wipe', authMiddleware, async (_req, res) => {
    try {
      await resetContextAgent();
      res.json({ ok: true, message: 'Memory wiped — clean state' });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/memory/traces', authMiddleware, (req, res) => {
    const limit = Math.min(parseInt(String(req.query.limit || '50'), 10), 500);
    const conversation = req.query.conversation ? String(req.query.conversation) : undefined;
    const traces = readTraces({ limit, conversation });
    res.json({ traces, count: traces.length });
  });

  // Device management endpoints
  app.get('/api/devices', authMiddleware, (_req, res) => {
    const devices = getAllTokens();
    res.json({ devices });
  });

  app.delete(
    '/api/devices/:token',
    authMiddleware,
    (req: AuthRequest, res) => {
      const { token } = req.params;
      const success = revokeToken(token);
      if (!success) {
        return res.status(404).json({ error: 'Device not found' });
      }
      res.json({ success: true });
    },
  );

  app.post('/api/devices/generate', authMiddleware, (_req, res) => {
    const token = generateTemporaryToken();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    res.json({ token, expiresAt });
  });

  // Push subscription endpoints
  app.post('/api/push/subscribe', authMiddleware, (req: AuthRequest, res) => {
    const { endpoint, keys } = req.body;

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    savePushSubscription(endpoint, keys.p256dh, keys.auth, req.token);
    res.json({ success: true });
  });

  app.delete('/api/push/subscribe', authMiddleware, (req, res) => {
    const { endpoint } = req.body;

    if (!endpoint) {
      return res.status(400).json({ error: 'Endpoint is required' });
    }

    removePushSubscription(endpoint);
    res.json({ success: true });
  });

  // WebSocket connection handling
  wss.on('connection', (ws: WebSocket, req) => {
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

    ws.send(
      JSON.stringify({
        type: 'connected',
        data: { timestamp: new Date().toISOString() },
      }),
    );
  });

  // SPA fallback - serve index.html for non-API, non-WS routes
  app.get('*', (_req, res) => {
    const indexPath = path.join(pwaDistDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.sendFile(indexPath);
    } else {
      res.status(404).json({ error: 'Not found' });
    }
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error({ port }, `Port ${port} already in use — kill the old process or change WEB_PORT`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(port, '0.0.0.0', () => {
    logger.info({ port }, 'Web server started');
    console.log(`\nPWA Web Interface: http://0.0.0.0:${port}\n`);
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
