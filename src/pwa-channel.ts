import fs from 'fs';
import path from 'path';
import { runContainerAgent, writeTasksSnapshot, writeGroupsSnapshot } from './container-runner.js';
import {
  createPWAConversationDB,
  getPWAConversationDB,
  getAllPWAConversationsDB,
  renamePWAConversation as renamePWAConversationDB,
  deletePWAConversation as deletePWAConversationDB,
  addPWAMessage,
  getPWAMessages as getPWAMessagesDB,
  getPWARecentMessages,
  generatePWAConversationId,
  generatePWAMessageId,
  PWAConversationRow,
  PWAMessageRow,
} from './db.js';
import { ASSISTANT_NAME, DATA_DIR, GROUPS_DIR } from './config.js';
import { RegisteredGroup } from './types.js';
import { logger } from './logger.js';
import { generateSpeech } from './tts-stt.js';

// Session IDs for active conversations (not persisted — agent sessions are ephemeral per process lifecycle)
const pwaSessions = new Map<string, string>();

export interface PWAConversationInfo {
  jid: string;
  name: string;
  folder: string;
  lastActivity: string;
  type: 'pwa';
}

function toConversationInfo(row: PWAConversationRow): PWAConversationInfo {
  return {
    jid: row.id,
    name: row.name,
    folder: `pwa-${row.id}`,
    lastActivity: row.last_activity,
    type: 'pwa',
  };
}

export interface AudioSegment {
  url: string;
  title?: string;
}

export interface PWAMessageInfo {
  id: string;
  chat_jid: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me: boolean;
  audio_url?: string;
  audio_segments?: AudioSegment[];
}

function toMessageInfo(row: PWAMessageRow): PWAMessageInfo {
  return {
    id: row.id,
    chat_jid: row.conversation_id,
    sender_name: row.sender === 'user' ? 'You' : ASSISTANT_NAME,
    content: row.sender === 'assistant' ? `${ASSISTANT_NAME}: ${row.content}` : row.content,
    timestamp: row.timestamp,
    is_from_me: row.sender === 'user',
    audio_url: row.audio_url || undefined,
    audio_segments: row.audio_segments ? JSON.parse(row.audio_segments) : undefined,
  };
}

export function createPWAConversation(name?: string): PWAConversationInfo {
  const id = generatePWAConversationId();
  const convName = name || 'New conversation';
  createPWAConversationDB(id, convName);

  const row = getPWAConversationDB(id)!;
  logger.info({ conversationId: id }, 'PWA conversation created');
  return toConversationInfo(row);
}

export function getAllPWAConversations(): PWAConversationInfo[] {
  return getAllPWAConversationsDB().map(toConversationInfo);
}

export function getPWAConversation(id: string): PWAConversationInfo | null {
  const row = getPWAConversationDB(id);
  return row ? toConversationInfo(row) : null;
}

export function renamePWAConversation(id: string, name: string): boolean {
  return renamePWAConversationDB(id, name);
}

export function deletePWAConversation(id: string): boolean {
  pwaSessions.delete(id);
  return deletePWAConversationDB(id);
}

export function getPWAMessages(conversationId: string, since?: string): PWAMessageInfo[] {
  const rows = since
    ? getPWAMessagesDB(conversationId, since)
    : getPWARecentMessages(conversationId, 50);
  return rows.map(toMessageInfo);
}

export type OnStatusCallback = (conversationId: string, status: string) => void;

interface SpeakIpcFile {
  type: 'speak';
  text: string;
  title: string | null;
  chatJid: string;
  groupFolder: string;
  timestamp: string;
}

interface ReplyIpcFile {
  type: 'reply';
  text: string;
  audio_text: string | null;
  audio_title: string | null;
  chatJid: string;
  groupFolder: string;
  timestamp: string;
}

export interface ReplyMessage {
  text: string;
  audioSegments?: AudioSegment[];
}

/**
 * Read and process IPC reply files written by the agent.
 * Each reply becomes a separate message bubble.
 * If audio_text is provided, generates TTS for the reply.
 */
async function processReplyIpc(
  conversationId: string,
  groupFolder: string,
): Promise<ReplyMessage[]> {
  const messagesIpcDir = path.join(DATA_DIR, 'ipc', groupFolder, 'messages');
  if (!fs.existsSync(messagesIpcDir)) return [];

  const files = fs.readdirSync(messagesIpcDir)
    .filter((f) => f.endsWith('.json'))
    .sort();

  if (files.length === 0) return [];

  const replies: ReplyMessage[] = [];
  const audioOutputDir = path.join(GROUPS_DIR, groupFolder, 'audio');

  for (const file of files) {
    const filePath = path.join(messagesIpcDir, file);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      if (data.type !== 'reply') {
        // Skip non-reply IPC files (e.g. send_message)
        continue;
      }

      const reply = data as ReplyIpcFile;
      const replyMsg: ReplyMessage = { text: reply.text };

      // Generate TTS if audio_text provided
      if (reply.audio_text) {
        const audioFilename = `tts-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.mp3`;
        const outputPath = path.join(audioOutputDir, audioFilename);

        logger.info({ title: reply.audio_title, textLength: reply.audio_text.length }, 'Generating TTS for reply');
        await generateSpeech(reply.audio_text, outputPath);

        replyMsg.audioSegments = [{
          url: `audio/${audioFilename}`,
          title: reply.audio_title || undefined,
        }];
      }

      replies.push(replyMsg);

      // Clean up IPC file
      fs.unlinkSync(filePath);
    } catch (err) {
      logger.error({ file, err }, 'Failed to process reply IPC file');
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    }
  }

  return replies;
}

/**
 * Read and process IPC audio (speak) files written by the agent.
 * Generates TTS for each, saves MP3 to the group directory, returns audio segment data.
 * Does NOT create separate DB messages — segments are attached to the text message.
 */
async function processAudioIpc(
  conversationId: string,
  groupFolder: string,
): Promise<AudioSegment[]> {
  const audioIpcDir = path.join(DATA_DIR, 'ipc', groupFolder, 'audio');
  if (!fs.existsSync(audioIpcDir)) return [];

  const files = fs.readdirSync(audioIpcDir)
    .filter((f) => f.endsWith('.json'))
    .sort(); // Sort by filename (timestamp-based) to preserve order

  if (files.length === 0) return [];

  const segments: AudioSegment[] = [];
  const audioOutputDir = path.join(GROUPS_DIR, groupFolder, 'audio');

  for (const file of files) {
    const filePath = path.join(audioIpcDir, file);
    try {
      const data: SpeakIpcFile = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      // Generate TTS
      const audioFilename = `tts-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.mp3`;
      const outputPath = path.join(audioOutputDir, audioFilename);

      logger.info({ title: data.title, textLength: data.text.length }, 'Generating TTS for speak request');
      await generateSpeech(data.text, outputPath);

      segments.push({
        url: `audio/${audioFilename}`,
        title: data.title || undefined,
      });

      // Clean up IPC file
      fs.unlinkSync(filePath);
    } catch (err) {
      logger.error({ file, err }, 'Failed to process speak IPC file');
      // Clean up even on error
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    }
  }

  return segments;
}

export async function sendToPWAAgent(
  conversationId: string,
  userMessage: string,
  assistantName: string,
  onStatus?: OnStatusCallback,
  audioMode?: boolean,
  skipUserMessage?: boolean,
): Promise<{ response: string; messageId: string; renamedTo?: string; audioSegments?: AudioSegment[]; replyMessages?: ReplyMessage[] }> {
  const conversation = getPWAConversationDB(conversationId);
  if (!conversation) {
    throw new Error('Conversation not found');
  }

  // Store the user message (skip when audio endpoint already created it)
  if (!skipUserMessage) {
    const userMsgId = generatePWAMessageId();
    addPWAMessage(userMsgId, conversationId, 'user', userMessage);
  }

  // Auto-rename if still default name and this is the first user message
  let renamedTo: string | undefined;
  if (conversation.name === 'New conversation') {
    const msgCount = getPWARecentMessages(conversationId, 2).filter(m => m.sender === 'user').length;
    if (msgCount === 1) {
      const newName = userMessage.length > 40 ? userMessage.slice(0, 37) + '...' : userMessage;
      renamePWAConversationDB(conversationId, newName);
      renamedTo = newName;
    }
  }

  // Build context for the agent (last 10 messages)
  const recentMessages = getPWARecentMessages(conversationId, 10);
  const escapeXml = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const messagesXml = recentMessages
    .map((msg) => {
      const sender = msg.sender === 'user' ? 'User' : assistantName;
      return `<message sender="${escapeXml(sender)}" time="${msg.timestamp}">${escapeXml(msg.content)}</message>`;
    })
    .join('\n');

  let prompt = `<messages>\n${messagesXml}\n</messages>`;

  // Add audio mode instruction
  if (audioMode) {
    prompt += `\n\n<audio_mode>
L'utilisateur communique en mode vocal. En plus de ta réponse texte habituelle (qui peut contenir du markdown, tableaux, code, schémas — tout ce qui est utile visuellement), utilise l'outil speak pour créer des messages audio conversationnels.

Règles :
- Utilise speak pour les explications orales, les résumés, les réponses conversationnelles
- Mets le contenu structuré (code, tableaux, listes détaillées) dans ta réponse texte
- L'audio et le texte sont complémentaires, pas des doublons
- Parle naturellement, comme dans une conversation
- Tu peux appeler speak plusieurs fois pour créer plusieurs segments audio
</audio_mode>`;
  }

  // Virtual group for this PWA conversation
  const virtualGroup: RegisteredGroup = {
    name: conversation.name,
    folder: `pwa-${conversationId}`,
    trigger: '',
    added_at: conversation.created_at,
  };

  const sessionId = pwaSessions.get(conversationId);

  // Prepare snapshots
  writeTasksSnapshot(virtualGroup.folder, false, []);
  writeGroupsSnapshot(virtualGroup.folder, false, [], new Set());

  try {
    logger.info({ conversationId, audioMode }, 'Calling PWA agent');

    const output = await runContainerAgent(virtualGroup, {
      prompt,
      sessionId,
      groupFolder: virtualGroup.folder,
      chatJid: conversationId,
      isMain: false,
    }, onStatus ? (status: string) => onStatus(conversationId, status) : undefined);

    if (output.newSessionId) {
      pwaSessions.set(conversationId, output.newSessionId);
    }

    if (output.status === 'error') {
      logger.error({ conversationId, error: output.error }, 'PWA agent error');
      const errorMsg = 'Desole, une erreur est survenue.';
      const errorMsgId = generatePWAMessageId();
      addPWAMessage(errorMsgId, conversationId, 'assistant', errorMsg);
      return { response: errorMsg, messageId: errorMsgId };
    }

    // Process audio IPC files (speak tool calls) → generate TTS
    let audioSegments: AudioSegment[] | undefined;
    if (audioMode) {
      try {
        if (onStatus) onStatus(conversationId, 'Génération audio...');
        const segments = await processAudioIpc(conversationId, virtualGroup.folder);
        if (segments.length > 0) {
          audioSegments = segments;
          logger.info({ conversationId, count: segments.length }, 'Audio messages generated');
        }
      } catch (err) {
        logger.error({ conversationId, err }, 'Failed to process audio IPC');
      }
    }

    // Process reply IPC files → separate message bubbles
    let replyMessages: ReplyMessage[] | undefined;
    try {
      const replies = await processReplyIpc(conversationId, virtualGroup.folder);
      if (replies.length > 0) {
        replyMessages = replies;
        // Store each reply as a separate DB message
        for (const reply of replies) {
          const replyMsgId = generatePWAMessageId();
          addPWAMessage(replyMsgId, conversationId, 'assistant', reply.text, undefined, reply.audioSegments);
        }
        logger.info({ conversationId, count: replies.length }, 'Reply messages processed');
      }
    } catch (err) {
      logger.error({ conversationId, err }, 'Failed to process reply IPC');
    }

    const response = output.result || 'Pas de reponse';
    const assistantMsgId = generatePWAMessageId();
    addPWAMessage(assistantMsgId, conversationId, 'assistant', response, undefined, audioSegments);

    return { response, messageId: assistantMsgId, renamedTo, audioSegments, replyMessages };
  } catch (err) {
    logger.error({ conversationId, err }, 'Failed to call PWA agent');
    throw err;
  }
}
