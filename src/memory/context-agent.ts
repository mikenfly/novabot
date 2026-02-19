import { query } from '@anthropic-ai/claude-agent-sdk';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
import fs from 'fs';
import path from 'path';

import { MEMORY_DIR, GROUPS_DIR, MODEL_CONTEXT, RAG_ENABLED, EXCHANGE_BUFFER_SIZE, RAG_RECENT_EXCHANGES_PER_CONV, GATE_ENABLED } from '../config.js';
import { gateExchange } from './gate.js';
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
import {
  CONTEXT_AGENT_BASE_PROMPT,
  PHASE_1_AUDIT,
  PHASE_2_ACTIONS,
  PHASE_3_BUMPS,
  PHASE_4_SUMMARY,
} from './system-prompt.js';
import { createMemoryMcpServer } from './tools.js';
import type { ExchangeMessage } from './types.js';

const LOG_FILE = path.join(MEMORY_DIR, 'agent.log');
const URGENT_CONTEXT_DIR = path.join(GROUPS_DIR, 'global');
const URGENT_CONTEXT_TTL = 60000; // 60s

function urgentContextPath(conversationId?: string): string {
  // Per-conversation file to avoid cross-conversation pollution
  const suffix = conversationId ? `-${conversationId}` : '';
  return path.join(URGENT_CONTEXT_DIR, `urgent-context${suffix}.md`);
}
const MODEL = MODEL_CONTEXT;

let processing = false;
let lastCompletedAt: string | null = null;
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

// Concurrency limiter for RAG agents — too many concurrent query() calls freeze the event loop
const MAX_CONCURRENT_RAG = 2;
let activeRagCount = 0;
const ragWaitQueue: (() => void)[] = [];

async function acquireRagSlot(): Promise<void> {
  if (activeRagCount < MAX_CONCURRENT_RAG) {
    activeRagCount++;
    return;
  }
  // Wait for a slot to free up
  return new Promise(resolve => {
    ragWaitQueue.push(() => {
      activeRagCount++;
      resolve();
    });
  });
}

function releaseRagSlot(): void {
  activeRagCount--;
  if (ragWaitQueue.length > 0) {
    const next = ragWaitQueue.shift()!;
    next();
  }
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

// ==================== Git ====================

async function initGitRepo(): Promise<void> {
  const gitDir = path.join(MEMORY_DIR, '.git');
  if (!fs.existsSync(gitDir)) {
    await execAsync('git init', { cwd: MEMORY_DIR });
    log('Initialized git repo in memory/');
  }
}

async function gitCommitIfChanged(): Promise<void> {
  try {
    const { stdout } = await execAsync('git status --porcelain', {
      cwd: MEMORY_DIR,
    });

    if (stdout.trim()) {
      checkpointWal();
      await execAsync('git add -A && git commit -m "auto: update after exchange"', {
        cwd: MEMORY_DIR,
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
  // Wait for a concurrency slot (max MAX_CONCURRENT_RAG parallel RAG agents)
  await acquireRagSlot();

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

    // Write urgent context for important/critical (no interruption — agent picks it up on next message)
    const isInjected = ragResult.priority === 'important' || ragResult.priority === 'critical';
    if (isInjected) {
      writeUrgentContext(ragResult);
    }

    // Trace: injection details
    traceInjection(pending.exchangeId, {
      urgentContextWritten: isInjected,
      urgentContextFile: isInjected
        ? path.basename(urgentContextPath(ragResult.exchange.conversationId))
        : undefined,
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
    releaseRagSlot();
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

// ==================== Buffer formatting for multi-phase context agent ====================

/**
 * Format the rolling buffer for the context agent's prompt.
 * Groups exchanges by conversation, ordered from least-recently-active
 * to most-recently-active (for prompt cache optimization: stable prefix).
 * Includes memory_summary when available (from previous Phase 4).
 */
function formatBufferForContextAgent(exchanges: ExchangeMessage[]): string {
  if (exchanges.length === 0) return '';

  // Group by conversation (channel + name for uniqueness)
  const convMap = new Map<string, { channel: string; name: string; exchanges: ExchangeMessage[]; lastTime: string }>();

  for (const e of exchanges) {
    const convKey = `${e.channel}|${e.conversation_name}`;
    let conv = convMap.get(convKey);
    if (!conv) {
      conv = { channel: e.channel, name: e.conversation_name, exchanges: [], lastTime: e.timestamp };
      convMap.set(convKey, conv);
    }
    conv.exchanges.push(e);
    if (e.timestamp > conv.lastTime) conv.lastTime = e.timestamp;
  }

  // Sort conversations: least recently active first (stable prefix for cache)
  const sorted = [...convMap.values()].sort((a, b) => a.lastTime.localeCompare(b.lastTime));

  const sections = sorted.map(conv => {
    const header = `## [${conv.channel}] ${conv.name}`;
    const items = conv.exchanges.map(e => {
      const summary = e.memory_summary
        ? `\n<memory_summary>${e.memory_summary}</memory_summary>`
        : '';
      return `<exchange time="${e.timestamp}">
<user>${e.user_message}</user>
<assistant>${e.assistant_response}</assistant>${summary}
</exchange>`;
    });
    return `${header}\n\n${items.join('\n\n')}`;
  });

  return sections.join('\n\n');
}

// ==================== Multi-phase context agent ====================

interface PhaseResult {
  sessionId: string;
  resultText: string;
  toolCallCount: number;
  costUsd: number | null;
  turns: number;
  durationMs: number;
}

/**
 * Run a single phase of the context agent pipeline.
 * Phase 1 creates a fresh session; Phases 2-4 resume from the previous phase.
 */
async function runPhase(
  phaseName: string,
  userPrompt: string,
  systemPrompt: string,
  mcpServer: ReturnType<typeof createMemoryMcpServer> | null,
  resumeSessionId: string | null,
  batchExchangeIds: string[],
): Promise<PhaseResult> {
  const phaseStart = Date.now();
  let phaseSessionId = resumeSessionId || '';
  let resultText = '';
  let toolCallCount = 0;
  let costUsd: number | null = null;
  let turns = 0;

  log(`  [${phaseName}] starting...`);

  const mcpServers = mcpServer ? { memory: mcpServer } : undefined;

  let lastMsgAt = Date.now();
  for await (const message of query({
    prompt: userPrompt,
    options: {
      model: MODEL,
      cwd: MEMORY_DIR,
      ...(resumeSessionId ? { resume: resumeSessionId } : {}),
      tools: [],
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      settingSources: [],
      systemPrompt,
      ...(mcpServers ? { mcpServers } : {}),
    },
  })) {
    const gap = Date.now() - lastMsgAt;
    log(`  [${phaseName}] msg type=${message.type} (gap=${gap}ms)`);
    lastMsgAt = Date.now();

    // Capture session_id
    if ('session_id' in message && message.session_id) {
      phaseSessionId = message.session_id;
    }

    // Log tool calls
    if (message.type === 'assistant' && 'message' in message) {
      const content = (message as any).message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_use') {
            toolCallCount++;
            const toolName = block.name.replace('mcp__memory__', '');
            const input = block.input as Record<string, any>;
            const summary = summarizeToolInput(block.name, input);
            log(`    → ${toolName}(${summary})`);

            for (const eid of batchExchangeIds) {
              traceContextToolCall(eid, toolName, input);
            }
          }
        }
      }
    }

    // Capture result
    if (message.type === 'result') {
      const result = message as any;
      if (result.subtype === 'success') {
        resultText = result.result || '';
        costUsd = result.total_cost_usd ?? null;
        turns = result.num_turns ?? 0;
      } else {
        log(`    ✗ ${phaseName} error (${result.subtype}): ${JSON.stringify(result.errors)}`);
      }
    }
  }

  const durationMs = Date.now() - phaseStart;
  log(`  [${phaseName}] done: ${toolCallCount} tool calls, ${turns} turns, $${costUsd?.toFixed(3) || '?'}, ${durationMs}ms`);

  return { sessionId: phaseSessionId, resultText, toolCallCount, costUsd, turns, durationMs };
}

/**
 * Run the full 4-phase context agent pipeline for a batch of exchanges.
 * Each cycle uses a FRESH session (no resume from previous exchanges).
 * Phases within a cycle resume from the previous phase.
 */
interface MultiPhaseResult {
  summaryText: string | null;
  totalCost: number;
  totalTools: number;
  totalTurns: number;
  totalDuration: number;
}

async function runMultiPhaseContextAgent(
  batch: RagResult[],
  batchExchangeIds: string[],
): Promise<MultiPhaseResult> {
  // Build recent exchanges block (grouped by conversation, ordered least-active-first)
  const recentBlock = formatBufferForContextAgent(recentExchanges);

  // Build current exchange block with RAG pre-context
  const hasRagContext = batch.some(r => r.preContext);
  const exchangeBlock = hasRagContext
    ? formatExchangesWithRag(batch)
    : formatExchanges(batch.map(r => r.exchange));

  // Phase 1 — Audit (read-only, fresh session)
  const phase1Prompt = `${PHASE_1_AUDIT}\n\n---\n\n# Échanges récents\n\n${recentBlock}\n\n---\n\n# Nouvel échange à traiter\n\n${exchangeBlock}`;
  const readOnlyMcp = createMemoryMcpServer({ readOnly: true });
  const phase1 = await runPhase('audit', phase1Prompt, CONTEXT_AGENT_BASE_PROMPT, readOnlyMcp, null, batchExchangeIds);

  // Phase 2 — Actions (all tools, resume from Phase 1)
  const fullMcp = createMemoryMcpServer();
  const phase2 = await runPhase('actions', PHASE_2_ACTIONS, CONTEXT_AGENT_BASE_PROMPT, fullMcp, phase1.sessionId, batchExchangeIds);

  // Phase 3 — Bumps (bump + read, resume from Phase 2)
  const bumpMcp = createMemoryMcpServer({ bumpOnly: true });
  const phase3 = await runPhase('bumps', PHASE_3_BUMPS, CONTEXT_AGENT_BASE_PROMPT, bumpMcp, phase2.sessionId, batchExchangeIds);

  // Phase 4 — Summary (no tools, resume from Phase 3)
  const phase4 = await runPhase('summary', PHASE_4_SUMMARY, CONTEXT_AGENT_BASE_PROMPT, null, phase3.sessionId, batchExchangeIds);

  const totalCost = [phase1, phase2, phase3, phase4]
    .reduce((sum, p) => sum + (p.costUsd || 0), 0);
  const totalTools = phase1.toolCallCount + phase2.toolCallCount + phase3.toolCallCount;
  const totalTurns = phase1.turns + phase2.turns + phase3.turns + phase4.turns;
  const totalDuration = phase1.durationMs + phase2.durationMs + phase3.durationMs + phase4.durationMs;

  log(`  Multi-phase complete: ${totalTools} total tool calls, $${totalCost.toFixed(3)}, ${totalDuration}ms`);

  return {
    summaryText: phase4.resultText || null,
    totalCost,
    totalTools,
    totalTurns,
    totalDuration,
  };
}

// ==================== Context agent queue processing ====================

async function processContextAgentQueue(): Promise<void> {
  if (processing || contextAgentQueue.length === 0) return;

  processing = true;
  let batchExchangeIds: string[] = [];

  try {
    // Drain all pending results into a batch
    const batch = contextAgentQueue.splice(0, contextAgentQueue.length);

    const channels = [...new Set(batch.map(r => r.exchange.channel))].join(', ');
    const ragInfo = batch.some(r => r.preContext) ? ' (with RAG pre-context)' : '';
    log(`Processing ${batch.length} exchange(s) from ${channels}${ragInfo}`);

    // Trace: mark context agent start for all exchanges in batch
    batchExchangeIds = batch.map(r => r.exchangeId);
    for (const eid of batchExchangeIds) traceContextStart(eid);
    const contextStartTime = Date.now();

    // Run the multi-phase pipeline
    const phaseResult = await runMultiPhaseContextAgent(batch, batchExchangeIds);

    // Store summary on the exchanges in the rolling buffer
    if (phaseResult.summaryText) {
      for (const ragResult of batch) {
        const idx = recentExchanges.findIndex(
          e => e.timestamp === ragResult.exchange.timestamp
            && e.conversation_name === ragResult.exchange.conversation_name
            && e.user_message === ragResult.exchange.user_message
        );
        if (idx !== -1) {
          recentExchanges[idx].memory_summary = phaseResult.summaryText;
        }
      }
    }

    // After processing: generate context file, refresh dirty embeddings, git commit
    log('  Post-processing: generating memory context...');
    await generateMemoryContext();
    log('  Post-processing: refreshing dirty embeddings...');
    const refreshed = await refreshDirtyEmbeddings();
    if (refreshed > 0) log(`  Refreshed ${refreshed} dirty embeddings`);
    log('  Post-processing: git commit...');
    await gitCommitIfChanged();
    log('  Post-processing: done');

    // Trace: finalize context agent for all exchanges in batch
    const contextDuration = Date.now() - contextStartTime;
    for (const eid of batchExchangeIds) {
      traceContextResult(eid, {
        durationMs: contextDuration,
        costUsd: phaseResult.totalCost || null,
        turns: phaseResult.totalTurns,
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

  log(`  refreshDirtyEmbeddings: ${dirtyKeys.length} dirty keys: [${dirtyKeys.join(', ')}]`);
  let refreshed = 0;
  for (const key of dirtyKeys) {
    try {
      const entry = getEntry(key);
      if (!entry) continue;

      const newText = buildEmbeddingText(key);

      // Skip if embedding text hasn't actually changed
      if (entry.embedding_text === newText) {
        log(`  refreshDirtyEmbeddings: ${key} — text unchanged, skip`);
        updateEmbedding(
          key,
          entry.embedding as Buffer,
          newText,
        );
        continue;
      }

      log(`  refreshDirtyEmbeddings: ${key} — generating embedding (${newText.length} chars)...`);
      const embeddingArray = await generateEmbedding(newText);
      updateEmbedding(key, embeddingToBuffer(embeddingArray), newText);
      log(`  refreshDirtyEmbeddings: ${key} — done`);
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
  if (recentExchanges.length > EXCHANGE_BUFFER_SIZE) {
    recentExchanges.shift();
  }

  // Gate: decide if this exchange should be processed by the pipeline
  if (GATE_ENABLED) {
    const conversationExchanges = recentExchanges
      .filter(e => e.conversation_name === exchange.conversation_name);

    gateExchange(exchange, conversationExchanges).then(shouldProcess => {
      if (shouldProcess) {
        launchPipeline(exchange);
      } else {
        log(`Gate: skipped [${exchange.conversation_name}] "${exchange.user_message.slice(0, 50)}..."`);
      }
    }).catch(err => {
      log(`Gate error (processing anyway): ${err instanceof Error ? err.message : String(err)}`);
      launchPipeline(exchange);
    });
  } else {
    launchPipeline(exchange);
  }
}

function launchPipeline(exchange: ExchangeMessage): void {
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

  // Fire RAG agent (don't await — runs before context agent via drainToContextAgent)
  runRagForExchange(pending);
}

export async function initContextAgent(): Promise<void> {
  log('Initializing context agent...');

  // Ensure memory directory exists
  fs.mkdirSync(MEMORY_DIR, { recursive: true });

  // Initialize DB
  initMemoryDatabase();

  // Initialize git repo
  await initGitRepo();

  // Start urgent context cleanup timer
  urgentContextCleanupTimer = setInterval(cleanupUrgentContext, 30000);

  // Heartbeat — proves event loop is alive (logs every 5s to agent.log)
  setInterval(() => {
    const mem = process.memoryUsage();
    const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(1);
    const rssMB = (mem.rss / 1024 / 1024).toFixed(1);
    log(`[heartbeat] heap=${heapMB}MB rss=${rssMB}MB activeRag=${activeRagCount} processing=${processing} queue=${contextAgentQueue.length}`);
  }, 5000);

  log(`Context agent ready (multi-phase, RAG: ${RAG_ENABLED ? 'enabled' : 'disabled'}, gate: ${GATE_ENABLED ? 'enabled' : 'disabled'})`);
}

export async function resetContextAgent(): Promise<void> {
  if (processing) {
    log('Warning: reset while processing — waiting up to 60s...');
    const start = Date.now();
    while (processing && Date.now() - start < 60000) {
      await new Promise((r) => setTimeout(r, 500));
    }
    if (processing) {
      log('Warning: reset timeout — forcing reset while still processing');
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

  // Delete legacy session file if it exists
  const legacySessionFile = path.join(MEMORY_DIR, '.session');
  if (fs.existsSync(legacySessionFile)) fs.unlinkSync(legacySessionFile);

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
