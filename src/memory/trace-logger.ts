/**
 * Structured JSONL trace logger for the memory pipeline.
 * Captures the full lifecycle of each exchange through RAG + context agent.
 *
 * Usage: memory/traces.jsonl — one JSON line per exchange.
 */

import fs from 'fs';
import path from 'path';

import { MEMORY_DIR, MODEL_RAG } from '../config.js';
import type { ExchangeMessage } from './types.js';

const TRACES_FILE = path.join(MEMORY_DIR, 'traces.jsonl');

// ==================== Types ====================

interface TraceToolCall {
  tool: string;
  input: Record<string, any>;
  durationMs?: number;
}

interface TraceRag {
  model: string;
  durationMs: number;
  costUsd: number | null;
  toolCalls: TraceToolCall[];
  priority: 'normal' | 'important' | 'critical';
  relevantKeys: string[];
  reasoning: string;
  recentExchangesCount: number;
}

interface TraceInjection {
  urgentContextWritten: boolean;
  urgentContextFile: string | null;
}

interface TraceContextAgent {
  durationMs: number;
  costUsd: number | null;
  turns: number;
  toolCalls: TraceToolCall[];
  embeddingsRefreshed: number;
}

export interface TraceEntry {
  id: string;
  timestamp: string;
  exchange: {
    channel: string;
    conversation: string;
    conversationId: string | null;
    userMessage: string;
    assistantResponse: string;
    exchangeTimestamp: string;
  };
  rag: TraceRag | null;
  injection: TraceInjection;
  contextAgent: TraceContextAgent | null;
}

// ==================== In-memory trace store ====================

const pendingTraces = new Map<string, TraceEntry>();

// Track per-tool-call start times (for RAG timing)
const toolCallStarts = new Map<string, number>();

// ==================== Public API ====================

export function startTrace(
  exchangeId: string,
  exchange: ExchangeMessage,
  recentExchangesCount: number,
): void {
  const trace: TraceEntry = {
    id: exchangeId,
    timestamp: new Date().toISOString(),
    exchange: {
      channel: exchange.channel,
      conversation: exchange.conversation_name,
      conversationId: exchange.conversationId || null,
      userMessage: exchange.user_message,
      assistantResponse: exchange.assistant_response,
      exchangeTimestamp: exchange.timestamp,
    },
    rag: {
      model: MODEL_RAG,
      durationMs: 0,
      costUsd: null,
      toolCalls: [],
      priority: 'normal',
      relevantKeys: [],
      reasoning: '',
      recentExchangesCount,
    },
    injection: {
      urgentContextWritten: false,
      urgentContextFile: null,
    },
    contextAgent: null,
  };

  pendingTraces.set(exchangeId, trace);
}

export function traceRagToolCallStart(
  exchangeId: string,
  callId: string,
): void {
  toolCallStarts.set(`${exchangeId}:${callId}`, Date.now());
}

export function traceRagToolCall(
  exchangeId: string,
  callId: string,
  tool: string,
  input: Record<string, any>,
): void {
  const trace = pendingTraces.get(exchangeId);
  if (!trace?.rag) return;

  const startKey = `${exchangeId}:${callId}`;
  const startTime = toolCallStarts.get(startKey);
  const durationMs = startTime ? Date.now() - startTime : undefined;
  toolCallStarts.delete(startKey);

  trace.rag.toolCalls.push({ tool, input, durationMs });
}

export function traceRagResult(
  exchangeId: string,
  data: {
    priority: 'normal' | 'important' | 'critical';
    relevantKeys: string[];
    reasoning: string;
    costUsd: number | null;
    durationMs: number;
  },
): void {
  const trace = pendingTraces.get(exchangeId);
  if (!trace?.rag) return;

  trace.rag.priority = data.priority;
  trace.rag.relevantKeys = data.relevantKeys;
  trace.rag.reasoning = data.reasoning;
  trace.rag.costUsd = data.costUsd;
  trace.rag.durationMs = data.durationMs;
}

export function traceInjection(
  exchangeId: string,
  data: {
    urgentContextWritten: boolean;
    urgentContextFile?: string;
  },
): void {
  const trace = pendingTraces.get(exchangeId);
  if (!trace) return;

  trace.injection = {
    urgentContextWritten: data.urgentContextWritten,
    urgentContextFile: data.urgentContextFile || null,
  };
}

export function traceContextStart(exchangeId: string): void {
  const trace = pendingTraces.get(exchangeId);
  if (!trace) return;

  trace.contextAgent = {
    durationMs: 0,
    costUsd: null,
    turns: 0,
    toolCalls: [],
    embeddingsRefreshed: 0,
  };
}

export function traceContextToolCall(
  exchangeId: string,
  tool: string,
  input: Record<string, any>,
): void {
  const trace = pendingTraces.get(exchangeId);
  if (!trace?.contextAgent) return;

  trace.contextAgent.toolCalls.push({ tool, input });
}

export function traceContextResult(
  exchangeId: string,
  data: {
    durationMs: number;
    costUsd: number | null;
    turns: number;
    embeddingsRefreshed: number;
  },
): void {
  const trace = pendingTraces.get(exchangeId);
  if (!trace) return;

  if (trace.contextAgent) {
    trace.contextAgent.durationMs = data.durationMs;
    trace.contextAgent.costUsd = data.costUsd;
    trace.contextAgent.turns = data.turns;
    trace.contextAgent.embeddingsRefreshed = data.embeddingsRefreshed;
  }

  // Flush trace to JSONL file
  flushTrace(exchangeId);
}

/**
 * Force-flush a trace (e.g. on RAG error/timeout when context agent won't run).
 */
export function flushTrace(exchangeId: string): void {
  const trace = pendingTraces.get(exchangeId);
  if (!trace) return;

  try {
    fs.mkdirSync(path.dirname(TRACES_FILE), { recursive: true });
    fs.appendFileSync(TRACES_FILE, JSON.stringify(trace) + '\n');
  } catch {
    // ignore write errors
  }

  pendingTraces.delete(exchangeId);
}

// ==================== Reading traces ====================

export function readTraces(options?: {
  limit?: number;
  conversation?: string;
}): TraceEntry[] {
  const limit = options?.limit ?? 50;
  const conversation = options?.conversation;

  try {
    if (!fs.existsSync(TRACES_FILE)) return [];

    const content = fs.readFileSync(TRACES_FILE, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    // Parse all lines (newest last in file)
    const traces: TraceEntry[] = [];
    for (let i = lines.length - 1; i >= 0 && traces.length < limit * 2; i--) {
      try {
        const trace = JSON.parse(lines[i]) as TraceEntry;
        if (!conversation || trace.exchange.conversation === conversation) {
          traces.push(trace);
        }
      } catch {
        // skip malformed lines
      }
    }

    return traces.slice(0, limit);
  } catch {
    return [];
  }
}
