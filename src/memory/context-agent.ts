import { query } from '@anthropic-ai/claude-agent-sdk';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { MEMORY_DIR, GROUPS_DIR, MODEL_CONTEXT, RAG_ENABLED, RAG_RECENT_EXCHANGES_BUFFER, RAG_RECENT_EXCHANGES_PER_CONV } from '../config.js';
import {
  initMemoryDatabase,
  checkpointWal,
  closeMemoryDatabase,
  getDirtyEmbeddingKeys,
  buildEmbeddingText,
  getEntry,
  updateEmbedding,
} from './db.js';
import { generateEmbedding, embeddingToBuffer } from './embeddings.js';
import {
  startTrace,
  traceInjection,
  traceContextStart,
  traceContextToolCall,
  traceContextResult,
  flushTrace,
} from './trace-logger.js';
import { generateMemoryContext } from './generate-context.js';
import { runRagAgent, type RagResult } from './rag-agent.js';
import { CONTEXT_AGENT_SYSTEM_PROMPT } from './system-prompt.js';
import { createMemoryMcpServer } from './tools.js';
import type { ExchangeMessage } from './types.js';

const SESSION_FILE = path.join(MEMORY_DIR, '.session');
const LOG_FILE = path.join(MEMORY_DIR, 'agent.log');
const URGENT_CONTEXT_DIR = path.join(GROUPS_DIR, 'global');
const URGENT_CONTEXT_TTL = 60000; // 60s

function urgentContextPath(conversationId?: string): string {
  // Per-conversation file to avoid cross-conversation pollution
  const suffix = conversationId ? `-${conversationId}` : '';
  return path.join(URGENT_CONTEXT_DIR, `urgent-context${suffix}.md`);
}
const MODEL = MODEL_CONTEXT;

let sessionId: string | null = null;
let processing = false;
let lastCompletedAt: string | null = null;
let memoryMcpServer: ReturnType<typeof createMemoryMcpServer> | null = null;
let urgentContextCleanupTimer: ReturnType<typeof setInterval> | null = null;

// ==================== RAG pipeline state ====================

let exchangeCounter = 0;
let nextSequenceToProcess = 0;

interface PendingRag {
  sequence: number;
  exchangeId: string;
  exchange: ExchangeMessage;
  startedAt: number;
}

interface CompletedRag {
  sequence: number;
  ragResult: RagResult;
}

const pendingRagQueue: PendingRag[] = [];
const completedRagResults: CompletedRag[] = [];
const contextAgentQueue: RagResult[] = [];
const recentExchanges: ExchangeMessage[] = [];

// ==================== Critical injection callback ====================

type CriticalInjectionCallback = (exchange: ExchangeMessage) => void;
let criticalInjectionCallback: CriticalInjectionCallback | null = null;

export function onCriticalInjection(cb: CriticalInjectionCallback): void {
  criticalInjectionCallback = cb;
}

// ==================== Logging ====================

function log(msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  const line = `[${ts}] [memory] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {
    // ignore — log file may not exist yet
  }
}

function summarizeToolInput(name: string, input: Record<string, any>): string {
  switch (name) {
    case 'mcp__memory__search_memory':
      return `query="${input.query}"${input.category ? `, category=${input.category}` : ''}`;
    case 'mcp__memory__get_entry':
      return `key="${input.key}"`;
    case 'mcp__memory__upsert_entry':
      return `category=${input.category}, key="${input.key}", content="${(input.content || '').slice(0, 80)}..."`;
    case 'mcp__memory__bump_mention':
      return `key="${input.key}"`;
    case 'mcp__memory__delete_entry':
      return `key="${input.key}"`;
    case 'mcp__memory__add_relation':
      return `${input.source_key} -[${input.relation_type}]-> ${input.target_key}`;
    case 'mcp__memory__remove_relation':
      return `${input.source_key} <-> ${input.target_key}`;
    case 'mcp__memory__list_category':
      return `category=${input.category}`;
    default:
      return JSON.stringify(input).slice(0, 100);
  }
}

// ==================== Status ====================

export function getProcessingStatus() {
  return {
    processing,
    queueLength: contextAgentQueue.length,
    pendingRag: pendingRagQueue.length,
    lastCompletedAt,
  };
}

// ==================== Session management ====================

function loadSessionId(): string | null {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      return fs.readFileSync(SESSION_FILE, 'utf-8').trim() || null;
    }
  } catch {
    // ignore
  }
  return null;
}

function saveSessionId(id: string): void {
  fs.writeFileSync(SESSION_FILE, id, 'utf-8');
}

// ==================== Git ====================

function initGitRepo(): void {
  const gitDir = path.join(MEMORY_DIR, '.git');
  if (!fs.existsSync(gitDir)) {
    execSync('git init', { cwd: MEMORY_DIR, stdio: 'ignore' });
    log('Initialized git repo in memory/');
  }
}

function gitCommitIfChanged(): void {
  try {
    const status = execSync('git status --porcelain', {
      cwd: MEMORY_DIR,
      encoding: 'utf-8',
    }).trim();

    if (status) {
      checkpointWal();
      execSync('git add -A && git commit -m "auto: update after exchange"', {
        cwd: MEMORY_DIR,
        stdio: 'ignore',
      });
    }
  } catch {
    // ignore git errors
  }
}

// ==================== Urgent context ====================

// Simple write lock to prevent race conditions between parallel RAG agents
const urgentWriteLock = new Map<string, Promise<void>>();

function writeUrgentContext(ragResult: RagResult): void {
  const convId = ragResult.exchange.conversationId || '';
  const filePath = urgentContextPath(ragResult.exchange.conversationId);

  // Serialize writes per conversation
  const prev = urgentWriteLock.get(convId) || Promise.resolve();
  const next = prev.then(() => doWriteUrgentContext(ragResult, filePath));
  urgentWriteLock.set(convId, next);
}

function doWriteUrgentContext(ragResult: RagResult, filePath: string): void {
  const header = ragResult.priority === 'critical'
    ? '# CRITICAL Memory Update'
    : '# Urgent Memory Update';

  const content = `${header}
${ragResult.reasoning}

${ragResult.preContext}
`;

  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  // Append if file exists (multiple priority results may arrive for same conversation)
  const existing = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, 'utf-8')
    : '';
  const newContent = existing ? `${existing}\n\n---\n\n${content}` : content;
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, newContent, 'utf-8');
  fs.renameSync(tempPath, filePath);

  log(`Urgent context written (${ragResult.priority}): ${ragResult.relevantKeys.length} entries → ${path.basename(filePath)}`);
}

function cleanupUrgentContext(): void {
  try {
    if (!fs.existsSync(URGENT_CONTEXT_DIR)) return;
    const files = fs.readdirSync(URGENT_CONTEXT_DIR)
      .filter(f => f.startsWith('urgent-context') && f.endsWith('.md'));

    for (const file of files) {
      const filePath = path.join(URGENT_CONTEXT_DIR, file);
      const stat = fs.statSync(filePath);
      if (Date.now() - stat.mtimeMs > URGENT_CONTEXT_TTL) {
        fs.unlinkSync(filePath);
        log(`Cleaned up stale ${file}`);
      }
    }
  } catch {
    // ignore
  }
}

// ==================== RAG pipeline ====================

async function runRagForExchange(pending: PendingRag): Promise<void> {
  try {
    // Filter recent exchanges to same conversation for RAG context
    const conversationExchanges = recentExchanges
      .filter(e => e.conversation_name === pending.exchange.conversation_name)
      .slice(-RAG_RECENT_EXCHANGES_PER_CONV);

    const ragResult = await runRagAgent(
      pending.exchangeId,
      pending.exchange,
      conversationExchanges,
    );

    const elapsed = Date.now() - pending.startedAt;
    log(`RAG[${pending.sequence}] done: priority=${ragResult.priority}, keys=${ragResult.relevantKeys.length}, ${elapsed}ms`);

    // Handle injection for important/critical
    const isInjected = ragResult.priority === 'important' || ragResult.priority === 'critical';
    const isCritical = ragResult.priority === 'critical' && !!criticalInjectionCallback;
    if (isInjected) {
      writeUrgentContext(ragResult);
    }
    if (isCritical) {
      criticalInjectionCallback!(ragResult.exchange);
    }

    // Trace: injection details
    traceInjection(pending.exchangeId, {
      urgentContextWritten: isInjected,
      urgentContextFile: isInjected
        ? path.basename(urgentContextPath(ragResult.exchange.conversationId))
        : undefined,
      criticalInjectionTriggered: isCritical,
    });

    // Store completed result
    completedRagResults.push({ sequence: pending.sequence, ragResult });
  } catch (err) {
    log(`RAG[${pending.sequence}] error: ${err instanceof Error ? err.message : String(err)}`);

    // On error, still feed the exchange to context agent (without pre-context)
    completedRagResults.push({
      sequence: pending.sequence,
      ragResult: {
        exchangeId: pending.exchangeId,
        exchange: pending.exchange,
        priority: 'normal',
        preContext: '',
        relevantKeys: [],
        reasoning: `RAG error: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: new Date().toISOString(),
      },
    });
  } finally {
    // Remove from pending
    const idx = pendingRagQueue.findIndex(p => p.exchangeId === pending.exchangeId);
    if (idx !== -1) pendingRagQueue.splice(idx, 1);
  }

  // Drain completed results to context agent (in order)
  drainToContextAgent();
}

function drainToContextAgent(): void {
  // Sort by sequence
  completedRagResults.sort((a, b) => a.sequence - b.sequence);

  // Drain consecutive results starting from nextSequenceToProcess
  while (completedRagResults.length > 0 && completedRagResults[0].sequence === nextSequenceToProcess) {
    const { ragResult } = completedRagResults.shift()!;
    nextSequenceToProcess++;
    contextAgentQueue.push(ragResult);
  }

  // Try to process
  processContextAgentQueue();
}

// ==================== Context agent prompt formatting ====================

function formatExchangesWithRag(results: RagResult[]): string {
  const items = results.map(r => {
    const ragBlock = r.preContext
      ? `<rag_pre_context>\nEntrées pertinentes trouvées pour cet échange :\n${r.preContext}\n</rag_pre_context>\n`
      : '';

    return `${ragBlock}<exchange channel="${r.exchange.channel}" conversation="${r.exchange.conversation_name}" time="${r.exchange.timestamp}">
<user>${r.exchange.user_message}</user>
<assistant>${r.exchange.assistant_response}</assistant>
</exchange>`;
  });

  if (items.length === 1) {
    return items[0];
  }
  return `<exchanges>\n${items.join('\n\n')}\n</exchanges>`;
}

// Legacy format for when RAG is disabled
function formatExchanges(exchanges: ExchangeMessage[]): string {
  if (exchanges.length === 1) {
    const e = exchanges[0];
    return `<exchange channel="${e.channel}" conversation="${e.conversation_name}" time="${e.timestamp}">
<user>${e.user_message}</user>
<assistant>${e.assistant_response}</assistant>
</exchange>`;
  }

  const items = exchanges
    .map(
      (e) => `<exchange channel="${e.channel}" conversation="${e.conversation_name}" time="${e.timestamp}">
<user>${e.user_message}</user>
<assistant>${e.assistant_response}</assistant>
</exchange>`,
    )
    .join('\n');

  return `<exchanges>\n${items}\n</exchanges>`;
}

// ==================== Context agent processing ====================

async function processContextAgentQueue(): Promise<void> {
  if (processing || contextAgentQueue.length === 0) return;

  processing = true;
  let batchExchangeIds: string[] = [];

  try {
    // Drain all pending results into a batch
    const batch = contextAgentQueue.splice(0, contextAgentQueue.length);

    const hasRagContext = batch.some(r => r.preContext);
    const prompt = hasRagContext
      ? formatExchangesWithRag(batch)
      : formatExchanges(batch.map(r => r.exchange));

    const channels = [...new Set(batch.map(r => r.exchange.channel))].join(', ');
    const ragInfo = hasRagContext ? ' (with RAG pre-context)' : '';
    log(`Processing ${batch.length} exchange(s) from ${channels}${ragInfo}`);

    // Trace: mark context agent start for all exchanges in batch
    batchExchangeIds = batch.map(r => r.exchangeId);
    for (const eid of batchExchangeIds) traceContextStart(eid);
    const contextStartTime = Date.now();

    const isFirstQuery = sessionId === null;
    const fullPrompt = isFirstQuery
      ? `${CONTEXT_AGENT_SYSTEM_PROMPT}\n\n---\n\nVoici le premier lot d'échanges à traiter :\n\n${prompt}`
      : prompt;

    const q = query({
      prompt: fullPrompt,
      options: {
        model: MODEL,
        cwd: MEMORY_DIR,
        ...(sessionId ? { resume: sessionId } : {}),
        tools: [],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        settingSources: [],
        mcpServers: {
          memory: memoryMcpServer!,
        },
        systemPrompt: isFirstQuery ? undefined : CONTEXT_AGENT_SYSTEM_PROMPT,
      },
    });

    let toolCallCount = 0;
    let contextCostUsd: number | null = null;
    let contextTurns = 0;

    for await (const message of q) {
      // Capture session_id from any message
      if ('session_id' in message && message.session_id) {
        if (message.session_id !== sessionId) {
          sessionId = message.session_id;
          saveSessionId(sessionId);
        }
      }

      // Log + trace tool calls from assistant messages
      if (message.type === 'assistant' && 'message' in message) {
        const content = (message as any).message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_use') {
              toolCallCount++;
              const toolName = block.name.replace('mcp__memory__', '');
              const input = block.input as Record<string, any>;
              const summary = summarizeToolInput(block.name, input);
              log(`  → ${toolName}(${summary})`);

              // Trace: record context agent tool calls for all exchanges in batch
              for (const eid of batchExchangeIds) {
                traceContextToolCall(eid, toolName, input);
              }
            }
          }
        }
      }

      // Log result
      if (message.type === 'result') {
        const result = message as any;
        if (result.subtype === 'success') {
          log(`  ✓ Done: ${toolCallCount} tool calls, ${result.num_turns} turns, $${result.total_cost_usd?.toFixed(3) || '?'}`);
          contextCostUsd = result.total_cost_usd ?? null;
          contextTurns = result.num_turns ?? 0;
        } else {
          log(`  ✗ Error (${result.subtype}): ${JSON.stringify(result.errors)}`);
        }
      }
    }

    // After processing: generate context file, refresh dirty embeddings, git commit
    await generateMemoryContext();
    const refreshed = await refreshDirtyEmbeddings();
    if (refreshed > 0) log(`  Refreshed ${refreshed} dirty embeddings`);
    gitCommitIfChanged();

    // Trace: finalize context agent for all exchanges in batch
    const contextDuration = Date.now() - contextStartTime;
    for (const eid of batchExchangeIds) {
      traceContextResult(eid, {
        durationMs: contextDuration,
        costUsd: contextCostUsd,
        turns: contextTurns,
        embeddingsRefreshed: refreshed,
      });
    }

    lastCompletedAt = new Date().toISOString();
    log('Done processing exchanges');
  } catch (err) {
    log(`Error: ${err instanceof Error ? err.message : String(err)}`);
    // Flush any pending traces on error
    for (const eid of batchExchangeIds) flushTrace(eid);
    lastCompletedAt = new Date().toISOString();
  } finally {
    processing = false;
  }

  // Process any items that arrived during processing
  if (contextAgentQueue.length > 0) {
    setImmediate(() => processContextAgentQueue());
  }
}

// ==================== Dirty embedding refresh ====================

/**
 * Re-generate embeddings for entries whose relations changed.
 * Compares new embedding_text with stored one to skip unchanged entries.
 */
async function refreshDirtyEmbeddings(): Promise<number> {
  const dirtyKeys = getDirtyEmbeddingKeys();
  if (dirtyKeys.length === 0) return 0;

  let refreshed = 0;
  for (const key of dirtyKeys) {
    try {
      const entry = getEntry(key);
      if (!entry) continue;

      const newText = buildEmbeddingText(key);

      // Skip if embedding text hasn't actually changed
      if (entry.embedding_text === newText) {
        // Clear dirty flag without re-embedding
        updateEmbedding(
          key,
          entry.embedding as Buffer,
          newText,
        );
        continue;
      }

      const embeddingArray = await generateEmbedding(newText);
      updateEmbedding(key, embeddingToBuffer(embeddingArray), newText);
      refreshed++;
    } catch (err) {
      log(`  ⚠ Failed to refresh embedding for ${key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return refreshed;
}

// ==================== Public API ====================

export function feedExchange(exchange: ExchangeMessage): void {
  // Add to recent exchanges circular buffer (global, all conversations)
  recentExchanges.push(exchange);
  if (recentExchanges.length > RAG_RECENT_EXCHANGES_BUFFER) {
    recentExchanges.shift();
  }

  if (!RAG_ENABLED) {
    // Bypass RAG — feed directly to context agent
    const bypassId = `exch-${exchangeCounter++}-${Date.now()}`;
    startTrace(bypassId, exchange, 0);
    contextAgentQueue.push({
      exchangeId: bypassId,
      exchange,
      priority: 'normal',
      preContext: '',
      relevantKeys: [],
      reasoning: 'RAG disabled',
      timestamp: new Date().toISOString(),
    });
    processContextAgentQueue();
    return;
  }

  const sequence = exchangeCounter++;
  const exchangeId = `exch-${sequence}-${Date.now()}`;

  // Start trace for this exchange
  const conversationExchangesCount = recentExchanges
    .filter(e => e.conversation_name === exchange.conversation_name).length;
  startTrace(exchangeId, exchange, conversationExchangesCount);

  const pending: PendingRag = {
    sequence,
    exchangeId,
    exchange,
    startedAt: Date.now(),
  };

  pendingRagQueue.push(pending);

  // Fire RAG agent in parallel (don't await)
  runRagForExchange(pending);
}

export async function initContextAgent(): Promise<void> {
  log('Initializing context agent...');

  // Ensure memory directory exists
  fs.mkdirSync(MEMORY_DIR, { recursive: true });

  // Initialize DB
  initMemoryDatabase();

  // Initialize git repo
  initGitRepo();

  // Create MCP server
  memoryMcpServer = createMemoryMcpServer();

  // Load previous session
  sessionId = loadSessionId();
  if (sessionId) {
    log(`Resuming session ${sessionId.slice(0, 8)}...`);
  }

  // Start urgent context cleanup timer
  urgentContextCleanupTimer = setInterval(cleanupUrgentContext, 30000);

  log(`Context agent ready (RAG: ${RAG_ENABLED ? 'enabled' : 'disabled'})`);
}

export async function resetContextAgent(): Promise<void> {
  if (processing) {
    log('Warning: reset while processing — waiting...');
    const start = Date.now();
    while (processing && Date.now() - start < 30000) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  log('Resetting context agent (full wipe)...');

  // Close DB
  closeMemoryDatabase();

  // Delete DB files
  const dbPath = path.join(MEMORY_DIR, 'memory.db');
  for (const suffix of ['', '-wal', '-shm']) {
    const f = dbPath + suffix;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  // Delete session file
  if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
  sessionId = null;

  // Delete context files
  const contextFile = path.join(GROUPS_DIR, 'global', 'memory-context.md');
  if (fs.existsSync(contextFile)) fs.unlinkSync(contextFile);
  // Clean up all urgent-context files
  if (fs.existsSync(URGENT_CONTEXT_DIR)) {
    for (const f of fs.readdirSync(URGENT_CONTEXT_DIR)) {
      if (f.startsWith('urgent-context') && f.endsWith('.md')) {
        fs.unlinkSync(path.join(URGENT_CONTEXT_DIR, f));
      }
    }
  }

  // Clear log file
  fs.writeFileSync(LOG_FILE, '', 'utf-8');

  // Clear all queues
  pendingRagQueue.length = 0;
  completedRagResults.length = 0;
  contextAgentQueue.length = 0;
  recentExchanges.length = 0;
  exchangeCounter = 0;
  nextSequenceToProcess = 0;
  lastCompletedAt = null;

  // Reinit DB
  initMemoryDatabase();

  // Recreate MCP server
  memoryMcpServer = createMemoryMcpServer();

  log('Context agent reset complete — clean state');
}

export async function shutdownContextAgent(): Promise<void> {
  log('Shutting down context agent...');
  if (urgentContextCleanupTimer) {
    clearInterval(urgentContextCleanupTimer);
    urgentContextCleanupTimer = null;
  }
  closeMemoryDatabase();
  log('Context agent stopped');
}
