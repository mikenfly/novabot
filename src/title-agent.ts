/**
 * Title Agent — Agent SDK + Haiku for automatic conversation titling.
 *
 * Maintains a persistent conversation per PWA conversation. Called periodically
 * (every N user messages) to evaluate whether the title should change.
 * Disabled when the user manually renames a conversation.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import {
  getPWAConversationDB,
  renamePWAConversation as renamePWAConversationDB,
  countPWAUserMessages,
  getPWARecentMessages,
} from './db.js';
import { MODEL_TITLE } from './config.js';
import { logger } from './logger.js';

const TITLE_CHECK_INTERVAL = 3;

const SYSTEM_PROMPT = `Tu es un agent de titrage de conversations.

Ta SEULE mission : choisir un titre court (3-6 mots) qui résume le sujet principal de la conversation.

Règles :
- Réponds UNIQUEMENT avec le titre, rien d'autre (pas de guillemets, pas d'explication)
- Ne change le titre que si le sujet a VRAIMENT pris un virage significatif
- Si le sujet n'a pas changé, réponds avec le titre actuel tel quel
- Le titre doit être dans la même langue que la conversation (français si en français, anglais si en anglais, etc.)
- Concis et descriptif, pas de verbe conjugué, pas de ponctuation finale`;

// Session IDs per conversation (in-memory, recreated on restart)
const sessions = new Map<string, string>();

export async function evaluateTitle(
  conversationId: string,
  currentTitle: string,
  messages: Array<{ sender: string; content: string }>,
): Promise<string | null> {
  const formatted = messages
    .map(
      (m) =>
        `[${m.sender === 'user' ? 'Utilisateur' : 'Assistant'}]: ${m.content.slice(0, 300)}`,
    )
    .join('\n');

  const prompt = `Titre actuel : "${currentTitle}"\n\nDerniers messages :\n${formatted}`;

  let result: string | null = null;
  const sessionId = sessions.get(conversationId);

  try {
    for await (const message of query({
      prompt,
      options: {
        model: MODEL_TITLE,
        systemPrompt: SYSTEM_PROMPT,
        allowedTools: [],
        resume: sessionId,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        settingSources: [],
      },
    })) {
      // Capture session ID on first init
      if (
        message.type === 'system' &&
        message.subtype === 'init' &&
        !sessions.has(conversationId)
      ) {
        sessions.set(conversationId, message.session_id);
      }

      // Capture result
      if ('result' in message && message.result) {
        result = (message.result as string).trim();
      }
    }
  } catch (err) {
    logger.error({ err, conversationId }, 'Title agent query failed');
    return null;
  }

  // Validation: title between 2 and 60 chars, different from current
  if (result && result.length >= 2 && result.length <= 60 && result !== currentTitle) {
    // Strip surrounding quotes if Haiku wraps them
    if ((result.startsWith('"') && result.endsWith('"')) || (result.startsWith("'") && result.endsWith("'"))) {
      result = result.slice(1, -1);
    }
    return result !== currentTitle ? result : null;
  }
  return null;
}

/**
 * Called after each main agent response. Checks conditions and evaluates
 * the title if needed. Runs asynchronously — does not block the response.
 */
export async function maybeEvaluateTitle(
  conversationId: string,
  broadcastRename: (id: string, name: string) => void,
): Promise<void> {
  const conv = getPWAConversationDB(conversationId);
  if (!conv || !conv.auto_rename) return;

  const userMsgCount = countPWAUserMessages(conversationId);

  // Evaluate on message 1 (improve truncation), then every N messages (4, 7, 10...)
  const shouldCheck =
    userMsgCount === 1 ||
    (userMsgCount > 1 && (userMsgCount - 1) % TITLE_CHECK_INTERVAL === 0);
  if (!shouldCheck) return;

  const recentMessages = getPWARecentMessages(conversationId, 10);
  const newTitle = await evaluateTitle(
    conversationId,
    conv.name,
    recentMessages.map((m) => ({ sender: m.sender, content: m.content })),
  );

  if (newTitle) {
    renamePWAConversationDB(conversationId, newTitle);
    broadcastRename(conversationId, newTitle);
    logger.info(
      { conversationId, oldTitle: conv.name, newTitle },
      'Title agent renamed conversation',
    );
  }
}
