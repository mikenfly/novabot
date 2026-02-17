import { query } from '@anthropic-ai/claude-agent-sdk';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { MEMORY_DIR, GROUPS_DIR } from '../config.js';
import { initMemoryDatabase, checkpointWal, closeMemoryDatabase } from './db.js';
import { generateMemoryContext } from './generate-context.js';
import { CONTEXT_AGENT_SYSTEM_PROMPT } from './system-prompt.js';
import { createMemoryMcpServer } from './tools.js';
import type { ExchangeMessage } from './types.js';

const SESSION_FILE = path.join(MEMORY_DIR, '.session');
const LOG_FILE = path.join(MEMORY_DIR, 'agent.log');
const MODEL = 'claude-sonnet-4-5-20250929';

let sessionId: string | null = null;
let processing = false;
let lastCompletedAt: string | null = null;
const exchangeQueue: ExchangeMessage[] = [];
let memoryMcpServer: ReturnType<typeof createMemoryMcpServer> | null = null;

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

export function getProcessingStatus() {
  return {
    processing,
    queueLength: exchangeQueue.length,
    lastCompletedAt,
  };
}

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

async function processQueue(): Promise<void> {
  if (processing || exchangeQueue.length === 0) return;

  processing = true;

  try {
    // Drain all pending exchanges into a batch
    const batch = exchangeQueue.splice(0, exchangeQueue.length);
    const prompt = formatExchanges(batch);

    log(`Processing ${batch.length} exchange(s) from ${[...new Set(batch.map((e) => e.channel))].join(', ')}`);

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

    for await (const message of q) {
      // Capture session_id from any message
      if ('session_id' in message && message.session_id) {
        if (message.session_id !== sessionId) {
          sessionId = message.session_id;
          saveSessionId(sessionId);
        }
      }

      // Log tool calls from assistant messages
      if (message.type === 'assistant' && 'message' in message) {
        const content = (message as any).message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_use') {
              toolCallCount++;
              const summary = summarizeToolInput(block.name, block.input as Record<string, any>);
              log(`  → ${block.name.replace('mcp__memory__', '')}(${summary})`);
            }
          }
        }
      }

      // Log result
      if (message.type === 'result') {
        const result = message as any;
        if (result.subtype === 'success') {
          log(`  ✓ Done: ${toolCallCount} tool calls, ${result.num_turns} turns, $${result.total_cost_usd?.toFixed(3) || '?'}`);
        } else {
          log(`  ✗ Error (${result.subtype}): ${JSON.stringify(result.errors)}`);
        }
      }
    }

    // After processing: generate context file and git commit
    await generateMemoryContext();
    gitCommitIfChanged();

    lastCompletedAt = new Date().toISOString();
    log('Done processing exchanges');
  } catch (err) {
    log(`Error: ${err instanceof Error ? err.message : String(err)}`);
    lastCompletedAt = new Date().toISOString();
  } finally {
    processing = false;
  }

  // Process any exchanges that arrived during processing
  if (exchangeQueue.length > 0) {
    // Use setImmediate to avoid deep recursion
    setImmediate(() => processQueue());
  }
}

export function feedExchange(exchange: ExchangeMessage): void {
  exchangeQueue.push(exchange);
  processQueue();
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

  log('Context agent ready');
}

export async function resetContextAgent(): Promise<void> {
  if (processing) {
    log('Warning: reset while processing — waiting...');
    // Wait up to 30s for current processing to finish
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

  // Delete context file
  const contextFile = path.join(GROUPS_DIR, 'global', 'memory-context.md');
  if (fs.existsSync(contextFile)) fs.unlinkSync(contextFile);

  // Clear log file
  fs.writeFileSync(LOG_FILE, '', 'utf-8');

  // Clear exchange queue
  exchangeQueue.length = 0;
  lastCompletedAt = null;

  // Reinit DB
  initMemoryDatabase();

  // Recreate MCP server
  memoryMcpServer = createMemoryMcpServer();

  log('Context agent reset complete — clean state');
}

export async function shutdownContextAgent(): Promise<void> {
  log('Shutting down context agent...');
  closeMemoryDatabase();
  log('Context agent stopped');
}
