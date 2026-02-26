import fs from 'fs';
import path from 'path';
import { runContainerAgent, writeTasksSnapshot, writeGroupsSnapshot, ContainerManager } from './container-runner.js';
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
import { ASSISTANT_NAME, DATA_DIR, GROUPS_DIR, PRE_SEARCH_ENABLED } from './config.js';
import { feedExchange } from './memory/context-agent.js';
import { runPreSearch, writePreSearchFile, writePendingMarker, clearPendingMarker } from './memory/pre-search.js';
import { RegisteredGroup } from './types.js';
import { logger } from './logger.js';
import { generateSpeech } from './tts-stt.js';

// Singleton container manager for persistent PWA containers
export const containerManager = new ContainerManager();

// Session IDs for active conversations (fallback for one-shot mode)
const pwaSessions = new Map<string, string>();

export interface PWAConversationInfo {
  jid: string;
  name: string;
  folder: string;
  lastActivity: string;
  type: 'pwa';
  autoRename: boolean;
}

function toConversationInfo(row: PWAConversationRow): PWAConversationInfo {
  return {
    jid: row.id,
    name: row.name,
    folder: `pwa-${row.id}`,
    lastActivity: row.last_activity,
    type: 'pwa',
    autoRename: row.auto_rename !== 0,
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
  containerManager.shutdownContainer(id);
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

/**
 * Real-time watcher that polls reply IPC files during container execution
 * and broadcasts them immediately via callback.
 */
interface RealtimeWatcher {
  stop: () => void;
}

function startRealtimeIpcWatcher(
  conversationId: string,
  groupFolder: string,
  onReply: (reply: ReplyMessage) => void,
): RealtimeWatcher {
  const messagesIpcDir = path.join(DATA_DIR, 'ipc', groupFolder, 'messages');
  const audioIpcDir = path.join(DATA_DIR, 'ipc', groupFolder, 'audio');
  const audioOutputDir = path.join(GROUPS_DIR, groupFolder, 'audio');
  let running = true;

  const poll = async () => {
    while (running) {
      try {
        // ── Collect all IPC files from both directories ──
        interface IpcEntry {
          filePath: string;
          filename: string;
          source: 'message' | 'audio';
        }
        const entries: IpcEntry[] = [];

        if (fs.existsSync(messagesIpcDir)) {
          for (const f of fs.readdirSync(messagesIpcDir).filter((f) => f.endsWith('.json'))) {
            entries.push({ filePath: path.join(messagesIpcDir, f), filename: f, source: 'message' });
          }
        }
        if (fs.existsSync(audioIpcDir)) {
          for (const f of fs.readdirSync(audioIpcDir).filter((f) => f.endsWith('.json'))) {
            entries.push({ filePath: path.join(audioIpcDir, f), filename: f, source: 'audio' });
          }
        }

        // Sort by filename (timestamp-based) to preserve agent's intended order
        entries.sort((a, b) => a.filename.localeCompare(b.filename));

        for (const entry of entries) {
          if (!running) break;
          try {
            const raw = fs.readFileSync(entry.filePath, 'utf-8');
            const data = JSON.parse(raw);

            if (entry.source === 'message') {
              if (data.type !== 'reply') continue; // Skip non-reply IPC files
              const reply = data as ReplyIpcFile;
              const replyMsg: ReplyMessage = { text: reply.text };

              if (reply.audio_text) {
                fs.mkdirSync(audioOutputDir, { recursive: true });
                const audioFilename = `tts-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.mp3`;
                const outputPath = path.join(audioOutputDir, audioFilename);
                logger.info({ title: reply.audio_title, textLength: reply.audio_text.length }, 'RT: Generating TTS for reply');
                await generateSpeech(reply.audio_text, outputPath);
                replyMsg.audioSegments = [{
                  url: `audio/${audioFilename}`,
                  title: reply.audio_title || undefined,
                }];
              }

              const replyMsgId = generatePWAMessageId();
              addPWAMessage(replyMsgId, conversationId, 'assistant', reply.text, undefined, replyMsg.audioSegments);
              onReply(replyMsg);
            } else {
              // Speak audio file
              const speakData = data as SpeakIpcFile;
              fs.mkdirSync(audioOutputDir, { recursive: true });
              const audioFilename = `tts-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.mp3`;
              const outputPath = path.join(audioOutputDir, audioFilename);
              logger.info({ title: speakData.title, textLength: speakData.text.length }, 'RT: Generating TTS for speak');
              await generateSpeech(speakData.text, outputPath);

              const replyMsg: ReplyMessage = {
                text: speakData.title || '',
                audioSegments: [{
                  url: `audio/${audioFilename}`,
                  title: speakData.title || undefined,
                }],
              };

              const msgId = generatePWAMessageId();
              addPWAMessage(msgId, conversationId, 'assistant', replyMsg.text, undefined, replyMsg.audioSegments);
              onReply(replyMsg);
            }

            fs.unlinkSync(entry.filePath);
            logger.info({ conversationId, file: entry.filename, source: entry.source }, 'Real-time IPC broadcast');
          } catch (err) {
            logger.error({ file: entry.filename, err }, 'Failed to process real-time IPC');
            try { fs.unlinkSync(entry.filePath); } catch { /* ignore */ }
          }
        }
      } catch (err) {
        logger.error({ err }, 'Real-time watcher poll error');
      }
      if (running) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  };

  poll();

  return { stop: () => { running = false; } };
}

export async function sendToPWAAgent(
  conversationId: string,
  userMessage: string,
  assistantName: string,
  onStatus?: OnStatusCallback,
  audioMode?: boolean,
  skipUserMessage?: boolean,
  onRealtimeReply?: (reply: ReplyMessage) => void,
): Promise<{ response: string; messageId: string; renamedTo?: string; audioSegments?: AudioSegment[] }> {
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
    added_at: conversation.created_at,
  };

  // Prepare snapshots
  writeTasksSnapshot(virtualGroup.folder, false, []);
  writeGroupsSnapshot(virtualGroup.folder, false, [], new Set());

  // Start real-time reply watcher if callback provided
  // Track reply count to avoid duplicating the main output.result when
  // the agent already sent its answer via the reply tool.
  let replyCount = 0;
  const trackingReplyCallback = onRealtimeReply
    ? (reply: ReplyMessage) => { replyCount++; onRealtimeReply(reply); }
    : undefined;
  const watcher = trackingReplyCallback
    ? startRealtimeIpcWatcher(conversationId, virtualGroup.folder, trackingReplyCallback)
    : null;

  // Fire pre-search in parallel with container startup (don't await)
  // The container hook will wait for the result file when it sees the pending marker
  if (PRE_SEARCH_ENABLED) {
    writePendingMarker(conversationId);
    runPreSearch(userMessage)
      .then(result => {
        if (result) {
          writePreSearchFile(conversationId, result);
          logger.info({ conversationId }, 'Pre-search results written');
        }
      })
      .catch(err => {
        logger.error({ conversationId, err }, 'Pre-search failed');
      })
      .finally(() => {
        clearPendingMarker(conversationId);
      });
  }

  try {
    logger.info({ conversationId, audioMode }, 'Calling PWA agent');

    const output = await containerManager.sendMessageAndWait(
      conversationId,
      virtualGroup,
      { prompt, audioMode },
      onStatus ? (status: string) => onStatus(conversationId, status) : undefined,
    );

    // Stop real-time watcher now that container has exited
    watcher?.stop();

    // Interrupted by a new user message — don't save anything, the next
    // queued message will resume the conversation with full session context.
    if (output.status === 'interrupted') {
      logger.info({ conversationId }, 'Query interrupted by user message, skipping response save');
      return { response: '', messageId: '', renamedTo };
    }

    if (output.status === 'error') {
      logger.error({ conversationId, error: output.error }, 'PWA agent error');
      const errorMsg = 'Desole, une erreur est survenue.';
      const errorMsgId = generatePWAMessageId();
      addPWAMessage(errorMsgId, conversationId, 'assistant', errorMsg);
      return { response: errorMsg, messageId: errorMsgId };
    }

    // Process remaining audio IPC files (speak tool calls not caught by real-time watcher)
    let audioSegments: AudioSegment[] | undefined;
    try {
      const segments = await processAudioIpc(conversationId, virtualGroup.folder);
      if (segments.length > 0) {
        audioSegments = segments;
        logger.info({ conversationId, count: segments.length }, 'Remaining audio messages generated (fallback)');
      }
    } catch (err) {
      logger.error({ conversationId, err }, 'Failed to process audio IPC');
    }

    // Process remaining reply IPC files (ones the real-time watcher didn't catch)
    try {
      const replies = await processReplyIpc(conversationId, virtualGroup.folder);
      if (replies.length > 0) {
        replyCount += replies.length;
        for (const reply of replies) {
          const replyMsgId = generatePWAMessageId();
          addPWAMessage(replyMsgId, conversationId, 'assistant', reply.text, undefined, reply.audioSegments);
          onRealtimeReply?.(reply);
        }
        logger.info({ conversationId, count: replies.length }, 'Remaining reply messages processed');
      }
    } catch (err) {
      logger.error({ conversationId, err }, 'Failed to process reply IPC');
    }

    // If the agent already sent replies via the reply tool, skip the main
    // output.result — it's typically a meta-comment ("I sent you a message")
    // that would appear as a duplicate response.
    if (replyCount > 0) {
      logger.info({ conversationId, replyCount }, 'Replies sent via IPC, skipping main output.result');
      // Still feed memory with the actual reply content
      feedExchange({
        channel: 'pwa',
        conversation_name: conversation.name,
        conversationId,
        user_message: userMessage,
        assistant_response: output.result || '',
        timestamp: new Date().toISOString(),
      });
      return { response: '', messageId: '', renamedTo, audioSegments };
    }

    const response = output.result || 'Pas de reponse';
    const assistantMsgId = generatePWAMessageId();
    addPWAMessage(assistantMsgId, conversationId, 'assistant', response, undefined, audioSegments);

    feedExchange({
      channel: 'pwa',
      conversation_name: conversation.name,
      conversationId,
      user_message: userMessage,
      assistant_response: response,
      timestamp: new Date().toISOString(),
    });

    return { response, messageId: assistantMsgId, renamedTo, audioSegments };
  } catch (err) {
    watcher?.stop();
    logger.error({ conversationId, err }, 'Failed to call PWA agent');
    throw err;
  }
}
