/**
 * NanoClaw Agent Runner
 * Runs inside a container. Supports two modes:
 * - One-shot: receives prompt via stdin, runs query, outputs result to stdout, exits
 * - Supervisor: receives bootstrap via stdin, enters loop processing inbox messages via IPC
 */

import fs from 'fs';
import path from 'path';
import {
  query, HookCallback, PreCompactHookInput,
  SessionStartHookInput, SDKCompactBoundaryMessage
} from '@anthropic-ai/claude-agent-sdk';
import { createIpcMcp } from './ipc-mcp.js';

// One-shot mode input (has prompt)
interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
}

// Supervisor mode bootstrap (no prompt)
interface BootstrapInput {
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
}

interface ContainerOutput {
  status: 'success' | 'error' | 'interrupted';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

interface InboxMessage {
  id: string;
  prompt: string;
  audioMode?: boolean;
  timestamp: string;
}

interface OutboxMessage {
  id: string;
  status: 'success' | 'error' | 'interrupted';
  result?: string;
  newSessionId?: string;
  error?: string;
  timestamp: string;
}

interface SessionEntry {
  sessionId: string;
  fullPath: string;
  summary: string;
  firstPrompt: string;
}

interface SessionsIndex {
  entries: SessionEntry[];
}

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';
const STATUS_PREFIX = '---NANOCLAW_STATUS---';

// IPC directories for supervisor mode
const INBOX_DIR = '/workspace/ipc/inbox';
const OUTBOX_DIR = '/workspace/ipc/outbox';
const CONTROL_DIR = '/workspace/ipc/control';
const IDLE_TIMEOUT = 300000; // 5 minutes

function writeOutput(output: ContainerOutput): void {
  console.log(OUTPUT_START_MARKER);
  console.log(JSON.stringify(output));
  console.log(OUTPUT_END_MARKER);
}

function emitStatus(text: string): void {
  const payload = JSON.stringify({ status: text, timestamp: new Date().toISOString() });
  // Write to stderr — it's unbuffered even when piped, unlike stdout which fully buffers in Docker
  process.stderr.write(`${STATUS_PREFIX}${payload}\n`);
}

function craftToolStatus(toolName: string, input: Record<string, any>): string {
  switch (toolName) {
    case 'Read': return `Lecture de ${input.file_path?.split('/').pop() || 'fichier'}...`;
    case 'Write': return `Écriture de ${input.file_path?.split('/').pop() || 'fichier'}...`;
    case 'Edit': return `Modification de ${input.file_path?.split('/').pop() || 'fichier'}...`;
    case 'Bash': return `Exécution d'une commande...`;
    case 'Glob': return `Recherche de fichiers...`;
    case 'Grep': return `Recherche dans le code...`;
    case 'WebSearch': return `Recherche sur le web...`;
    case 'WebFetch': return `Récupération d'une page web...`;
    default: return `Utilisation de ${toolName}...`;
  }
}

function log(message: string): void {
  console.error(`[agent-runner] ${message}`);
}

function getSessionSummary(sessionId: string, transcriptPath: string): string | null {
  const projectDir = path.dirname(transcriptPath);
  const indexPath = path.join(projectDir, 'sessions-index.json');

  if (!fs.existsSync(indexPath)) {
    log(`Sessions index not found at ${indexPath}`);
    return null;
  }

  try {
    const index: SessionsIndex = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    const entry = index.entries.find(e => e.sessionId === sessionId);
    if (entry?.summary) {
      return entry.summary;
    }
  } catch (err) {
    log(`Failed to read sessions index: ${err instanceof Error ? err.message : String(err)}`);
  }

  return null;
}

function createPreCompactHook(): HookCallback {
  return async (input, _toolUseId, _context) => {
    const preCompact = input as PreCompactHookInput;
    const transcriptPath = preCompact.transcript_path;
    const sessionId = preCompact.session_id;

    if (!transcriptPath || !fs.existsSync(transcriptPath)) {
      log('No transcript found for archiving');
      return {};
    }

    try {
      const content = fs.readFileSync(transcriptPath, 'utf-8');
      const messages = parseTranscript(content);

      if (messages.length === 0) {
        log('No messages to archive');
        return {};
      }

      const summary = getSessionSummary(sessionId, transcriptPath);
      const name = summary ? sanitizeFilename(summary) : generateFallbackName();

      const conversationsDir = '/workspace/group/conversations';
      fs.mkdirSync(conversationsDir, { recursive: true });

      const date = new Date().toISOString().split('T')[0];
      const filename = `${date}-${name}.md`;
      const filePath = path.join(conversationsDir, filename);

      const markdown = formatTranscriptMarkdown(messages, summary);
      fs.writeFileSync(filePath, markdown);

      log(`Archived conversation to ${filePath}`);
    } catch (err) {
      log(`Failed to archive transcript: ${err instanceof Error ? err.message : String(err)}`);
    }

    return {};
  };
}

function sanitizeFilename(summary: string): string {
  return summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function generateFallbackName(): string {
  const time = new Date();
  return `conversation-${time.getHours().toString().padStart(2, '0')}${time.getMinutes().toString().padStart(2, '0')}`;
}

interface ParsedMessage {
  role: 'user' | 'assistant';
  content: string;
}

function parseTranscript(content: string): ParsedMessage[] {
  const messages: ParsedMessage[] = [];

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'user' && entry.message?.content) {
        const text = typeof entry.message.content === 'string'
          ? entry.message.content
          : entry.message.content.map((c: { text?: string }) => c.text || '').join('');
        if (text) messages.push({ role: 'user', content: text });
      } else if (entry.type === 'assistant' && entry.message?.content) {
        const textParts = entry.message.content
          .filter((c: { type: string }) => c.type === 'text')
          .map((c: { text: string }) => c.text);
        const text = textParts.join('');
        if (text) messages.push({ role: 'assistant', content: text });
      }
    } catch {
    }
  }

  return messages;
}

function formatTranscriptMarkdown(messages: ParsedMessage[], title?: string | null): string {
  const now = new Date();
  const formatDateTime = (d: Date) => d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  const lines: string[] = [];
  lines.push(`# ${title || 'Conversation'}`);
  lines.push('');
  lines.push(`Archived: ${formatDateTime(now)}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const msg of messages) {
    const sender = msg.role === 'user' ? 'User' : 'Andy';
    const content = msg.content.length > 2000
      ? msg.content.slice(0, 2000) + '...'
      : msg.content;
    lines.push(`**${sender}**: ${content}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ==================== Memory context injection ====================

const MEMORY_CONTEXT_PATH = '/workspace/global/memory-context.md';

function loadMemoryContext(): string | null {
  try {
    if (fs.existsSync(MEMORY_CONTEXT_PATH)) {
      return fs.readFileSync(MEMORY_CONTEXT_PATH, 'utf-8').trim() || null;
    }
  } catch (err) {
    log(`Failed to load memory context: ${err instanceof Error ? err.message : String(err)}`);
  }
  return null;
}

/**
 * Hook: inject memory context on session startup and after compaction.
 */
function createSessionStartHook(): HookCallback {
  return async (input) => {
    const sessionStart = input as SessionStartHookInput;

    if (sessionStart.source === 'startup' || sessionStart.source === 'compact') {
      const context = loadMemoryContext();
      if (context) {
        log(`Injecting memory context (source: ${sessionStart.source})`);
        return {
          hookSpecificOutput: {
            hookEventName: 'SessionStart' as const,
            additionalContext: context,
          }
        };
      }
    }

    return {};
  };
}

/**
 * Hook: re-inject memory context on every user message.
 * Re-reads the file each time so the agent always has the latest context.
 * Prompt caching ensures unchanged content is a cache hit (no extra cost).
 */
function createUserPromptSubmitHook(): HookCallback {
  return async () => {
    const context = loadMemoryContext();
    if (context) {
      return {
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit' as const,
          additionalContext: context,
        }
      };
    }
    return {};
  };
}

// ==================== Shared query execution ====================

/**
 * Run a single agent query with the Claude SDK.
 * Used by both one-shot and supervisor modes.
 */
async function runAgentQuery(
  prompt: string,
  sessionId: string | undefined,
  ipcMcp: ReturnType<typeof createIpcMcp>,
  checkInterrupt?: () => boolean,
): Promise<{ status: 'success' | 'error' | 'interrupted'; result: string | null; newSessionId?: string; error?: string }> {
  let result: string | null = null;
  let newSessionId: string | undefined;
  let interrupted = false;

  try {
    emitStatus('Réflexion...');

    for await (const message of query({
      prompt,
      options: {
        cwd: '/workspace/group',
        resume: sessionId,
        allowedTools: [
          'Bash',
          'Read', 'Write', 'Edit', 'Glob', 'Grep',
          'WebSearch', 'WebFetch',
          'mcp__nanoclaw__*'
        ],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        settingSources: ['project'],
        mcpServers: {
          nanoclaw: ipcMcp
        },
        hooks: {
          PreCompact: [{ hooks: [createPreCompactHook()] }],
          SessionStart: [{ hooks: [createSessionStartHook()] }],
          UserPromptSubmit: [{ hooks: [createUserPromptSubmitHook()] }],
        }
      }
    })) {
      // Check for interrupt between iterations
      if (checkInterrupt?.()) {
        emitStatus('interrupted');
        log('Interrupt signal received during query');
        interrupted = true;
        break;
      }

      if (message.type === 'system' && message.subtype === 'init') {
        newSessionId = message.session_id;
        log(`Session initialized: ${newSessionId}`);
        if (message.betas?.length) {
          log(`Active betas: ${message.betas.join(', ')}`);
        }
      }

      // Detect compaction to re-inject context on next query
      if (message.type === 'system' && message.subtype === 'compact_boundary') {
        const compact = message as SDKCompactBoundaryMessage;
        log(`Compaction detected (trigger: ${compact.compact_metadata.trigger}, pre_tokens: ${compact.compact_metadata.pre_tokens})`);
      }

      if (message.type === 'assistant' && message.message?.content) {
        for (const block of message.message.content) {
          if (block.type === 'tool_use') {
            emitStatus(craftToolStatus(block.name, (block as any).input || {}));
          }
        }
      }

      if ('result' in message && message.result) {
        result = message.result as string;
      }
    }

    return { status: interrupted ? 'interrupted' : 'success', result, newSessionId };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log(`Query error: ${errorMessage}`);
    return { status: 'error', result: null, newSessionId, error: errorMessage };
  }
}

// ==================== One-shot mode ====================

async function runOneShot(input: ContainerInput): Promise<void> {
  const ipcMcp = createIpcMcp({
    chatJid: input.chatJid,
    groupFolder: input.groupFolder,
    isMain: input.isMain
  });

  let prompt = input.prompt;
  if (input.isScheduledTask) {
    prompt = `[SCHEDULED TASK - You are running automatically, not in response to a user message. Use mcp__nanoclaw__send_message if needed to communicate with the user.]\n\n${input.prompt}`;
  }

  log('Starting agent (one-shot mode)...');
  const output = await runAgentQuery(prompt, input.sessionId, ipcMcp);

  log('Agent completed');
  writeOutput({
    status: output.status,
    result: output.result,
    newSessionId: output.newSessionId,
    error: output.error,
  });

  if (output.status === 'error') {
    process.exit(1);
  }
}

// ==================== Supervisor mode ====================

function writeOutbox(msg: OutboxMessage): void {
  fs.mkdirSync(OUTBOX_DIR, { recursive: true });
  const filePath = path.join(OUTBOX_DIR, `${msg.id}-${Date.now()}.json`);
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(msg));
  fs.renameSync(tempPath, filePath);
}

function checkControl(type: string): boolean {
  const filePath = path.join(CONTROL_DIR, `${type}.json`);
  if (fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    return true;
  }
  return false;
}

function readNextInboxMessage(): InboxMessage | null {
  try {
    if (!fs.existsSync(INBOX_DIR)) return null;
    const files = fs.readdirSync(INBOX_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort();

    if (files.length === 0) return null;

    const filePath = path.join(INBOX_DIR, files[0]!);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    fs.unlinkSync(filePath);
    return data as InboxMessage;
  } catch (err) {
    log(`Error reading inbox: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function runSupervisor(bootstrap: BootstrapInput): Promise<void> {
  log(`Supervisor started for group: ${bootstrap.groupFolder}`);

  const ipcMcp = createIpcMcp({
    chatJid: bootstrap.chatJid,
    groupFolder: bootstrap.groupFolder,
    isMain: bootstrap.isMain,
  });

  // Ensure IPC directories exist
  fs.mkdirSync(INBOX_DIR, { recursive: true });
  fs.mkdirSync(OUTBOX_DIR, { recursive: true });
  fs.mkdirSync(CONTROL_DIR, { recursive: true });

  // Write ready signal
  writeOutbox({
    id: 'ready',
    status: 'success',
    timestamp: new Date().toISOString(),
  });
  log('Ready signal written');

  let sessionId: string | undefined;
  let lastActivity = Date.now();

  // Supervisor loop
  while (true) {
    // Check for shutdown signal
    if (checkControl('shutdown')) {
      log('Shutdown signal received');
      break;
    }

    // Check idle timeout
    if (Date.now() - lastActivity > IDLE_TIMEOUT) {
      log('Idle timeout reached, shutting down');
      break;
    }

    // Check for new message in inbox
    const message = readNextInboxMessage();
    if (message) {
      lastActivity = Date.now();
      log(`Processing message: ${message.id}`);
      emitStatus('Réflexion...');

      const output = await runAgentQuery(
        message.prompt,
        sessionId,
        ipcMcp,
        () => checkControl('interrupt'),
      );

      if (output.newSessionId) {
        sessionId = output.newSessionId;
      }

      // Write result to outbox
      writeOutbox({
        id: message.id,
        status: output.status,
        result: output.result || undefined,
        newSessionId: output.newSessionId,
        error: output.error,
        timestamp: new Date().toISOString(),
      });

      lastActivity = Date.now();
      continue; // Check for more messages immediately
    }

    // Sleep 300ms before next poll
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  log('Supervisor exiting');
  process.exit(0);
}

// ==================== Main entry point ====================

async function main(): Promise<void> {
  let stdinData: string;

  try {
    stdinData = await readStdin();
  } catch (err) {
    writeOutput({
      status: 'error',
      result: null,
      error: `Failed to read stdin: ${err instanceof Error ? err.message : String(err)}`
    });
    process.exit(1);
    return; // unreachable, for TypeScript
  }

  let input: any;
  try {
    input = JSON.parse(stdinData);
  } catch (err) {
    writeOutput({
      status: 'error',
      result: null,
      error: `Failed to parse input: ${err instanceof Error ? err.message : String(err)}`
    });
    process.exit(1);
    return;
  }

  // Detect mode: if input has a prompt, it's one-shot; otherwise supervisor
  if (input.prompt) {
    log(`One-shot mode for group: ${input.groupFolder}`);
    await runOneShot(input as ContainerInput);
  } else {
    log(`Supervisor mode for group: ${input.groupFolder}`);
    await runSupervisor(input as BootstrapInput);
  }
}

main();
