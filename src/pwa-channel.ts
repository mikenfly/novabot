import { runContainerAgent, writeTasksSnapshot, writeGroupsSnapshot } from './container-runner.js';
import { getAllTasks } from './db.js';
import { RegisteredGroup, Session } from './types.js';
import { logger } from './logger.js';

interface PWAConversation {
  id: string;
  name: string;
  messages: PWAMessage[];
  createdAt: string;
  lastActivity: string;
}

interface PWAMessage {
  id: string;
  sender: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

// In-memory storage for PWA conversations
const pwaConversations = new Map<string, PWAConversation>();
const pwaSessions = new Map<string, string>(); // conversationId -> sessionId

/**
 * Créer une nouvelle conversation PWA
 */
export function createPWAConversation(name?: string): PWAConversation {
  const id = `pwa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const conversation: PWAConversation = {
    id,
    name: name || `Conversation ${new Date().toLocaleString('fr-FR')}`,
    messages: [],
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
  };

  pwaConversations.set(id, conversation);
  logger.info({ conversationId: id }, 'PWA conversation created');

  return conversation;
}

/**
 * Récupérer toutes les conversations PWA
 */
export function getAllPWAConversations(): PWAConversation[] {
  return Array.from(pwaConversations.values()).sort(
    (a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
  );
}

/**
 * Récupérer une conversation PWA par ID
 */
export function getPWAConversation(id: string): PWAConversation | null {
  return pwaConversations.get(id) || null;
}

/**
 * Ajouter un message à une conversation PWA
 */
function addMessageToConversation(
  conversationId: string,
  sender: 'user' | 'assistant',
  content: string
): PWAMessage {
  const conversation = pwaConversations.get(conversationId);
  if (!conversation) {
    throw new Error('Conversation not found');
  }

  const message: PWAMessage = {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sender,
    content,
    timestamp: new Date().toISOString(),
  };

  conversation.messages.push(message);
  conversation.lastActivity = message.timestamp;

  return message;
}

/**
 * Envoyer un message à l'agent et obtenir une réponse (mode standalone PWA)
 */
export async function sendToPWAAgent(
  conversationId: string,
  userMessage: string,
  assistantName: string
): Promise<string> {
  const conversation = pwaConversations.get(conversationId);
  if (!conversation) {
    throw new Error('Conversation not found');
  }

  // Ajouter le message de l'utilisateur
  addMessageToConversation(conversationId, 'user', userMessage);

  // Construire le contexte pour l'agent
  const recentMessages = conversation.messages.slice(-10); // Derniers 10 messages
  const messagesXml = recentMessages.map(msg => {
    const sender = msg.sender === 'user' ? 'User' : assistantName;
    const escapeXml = (s: string) =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    return `<message sender="${escapeXml(sender)}" time="${msg.timestamp}">${escapeXml(msg.content)}</message>`;
  }).join('\n');

  const prompt = `<messages>\n${messagesXml}\n</messages>`;

  // Créer un groupe virtuel pour cette conversation PWA
  const virtualGroup: RegisteredGroup = {
    name: conversation.name,
    folder: `pwa-${conversationId}`,
    trigger: '', // Pas de trigger en mode standalone
    added_at: conversation.createdAt,
  };

  // Session ID pour cette conversation
  const sessionId = pwaSessions.get(conversationId);

  // Préparer les snapshots
  const tasks = getAllTasks();
  writeTasksSnapshot(virtualGroup.folder, false, []);
  writeGroupsSnapshot(virtualGroup.folder, false, [], new Set());

  try {
    logger.info({ conversationId }, 'Calling PWA agent');

    const output = await runContainerAgent(virtualGroup, {
      prompt,
      sessionId,
      groupFolder: virtualGroup.folder,
      chatJid: conversationId,
      isMain: false,
    });

    if (output.newSessionId) {
      pwaSessions.set(conversationId, output.newSessionId);
    }

    if (output.status === 'error') {
      logger.error({ conversationId, error: output.error }, 'PWA agent error');
      return 'Désolé, une erreur est survenue.';
    }

    // Ajouter la réponse de l'assistant
    const response = output.result || 'Pas de réponse';
    addMessageToConversation(conversationId, 'assistant', response);

    return response;
  } catch (err) {
    logger.error({ conversationId, err }, 'Failed to call PWA agent');
    throw err;
  }
}
