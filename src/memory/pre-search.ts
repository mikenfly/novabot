import fs from 'fs';
import path from 'path';

import { query } from '@anthropic-ai/claude-agent-sdk';

import { GROUPS_DIR, MEMORY_DIR, MODEL_GATE, PRE_SEARCH_LIMIT } from '../config.js';
import { hybridSearch, searchByKeyword, getRelations, getEntry } from './db.js';
import { generateEmbedding } from './embeddings.js';
import { getMemoryContextContent } from './generate-context.js';

const PRE_SEARCH_TTL = 60000; // 60s cleanup
const MIN_SCORE_THRESHOLD = 0.55; // If best score is below this, trigger Haiku reformulation
const RELATION_DEPTH = 1; // Fetch direct relations of found entries
const ENHANCED_LIMIT = 15; // More results for the enhanced search

const LOG_FILE = path.join(MEMORY_DIR, 'agent.log');

function preSearchLog(msg: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  const line = `[${ts}] [pre-search] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {
    // ignore
  }
}

// ==================== Pending marker for parallelization ====================

function pendingPath(identifier: string): string {
  return path.join(GROUPS_DIR, 'global', `pre-search-${identifier}.pending`);
}

function resultPath(identifier: string): string {
  return path.join(GROUPS_DIR, 'global', `pre-search-${identifier}.md`);
}

/**
 * Write a pending marker to signal that a pre-search is in progress.
 * The container hook will wait for the result file when it sees this marker.
 */
export function writePendingMarker(identifier: string): void {
  const p = pendingPath(identifier);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '', 'utf-8');
}

/**
 * Clear the pending marker after pre-search completes (success or failure).
 */
export function clearPendingMarker(identifier: string): void {
  try { fs.unlinkSync(pendingPath(identifier)); } catch { /* ignore */ }
}

// ==================== Haiku query reformulation ====================

const REFORMULATE_PROMPT = `Tu reçois un message utilisateur. Génère 3 requêtes de recherche différentes pour trouver des informations pertinentes dans une base de mémoire.

Règles :
- Chaque requête doit cibler un angle différent (personnes, lieux, contexte, synonymes, etc.)
- Utilise des mots-clés, pas des phrases complètes
- Une ligne par requête, sans numérotation ni tiret
- Pense aux termes que la base pourrait contenir même si le message ne les utilise pas directement`;

async function reformulateQuery(userMessage: string): Promise<string[]> {
  try {
    let resultText = '';

    for await (const message of query({
      prompt: `Message utilisateur : "${userMessage}"`,
      options: {
        model: MODEL_GATE,
        cwd: MEMORY_DIR,
        tools: [],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        settingSources: [],
        systemPrompt: REFORMULATE_PROMPT,
        maxTurns: 1,
      },
    })) {
      if (message.type === 'result') {
        const result = message as any;
        if (result.subtype === 'success' && result.result) {
          resultText = result.result;
        }
      }
    }

    return resultText
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 2)
      .slice(0, 4);
  } catch {
    return [];
  }
}

// ==================== Relation fetching ====================

interface EnrichedResult {
  key: string;
  category: string;
  content: string;
  similarity: number;
  relations: string[];
}

function fetchRelationsForResults(
  results: { key: string; category: string; content: string; similarity: number }[],
): EnrichedResult[] {
  return results.map(r => {
    const relations: string[] = [];
    try {
      const rels = getRelations(r.key);
      for (const rel of rels) {
        const otherKey = rel.source_key === r.key ? rel.target_key : rel.source_key;
        const otherEntry = getEntry(otherKey);
        if (otherEntry) {
          relations.push(`  → [${rel.relation_type}] **${otherKey}** [${otherEntry.category}]: ${otherEntry.content.slice(0, 100)}${otherEntry.content.length > 100 ? '...' : ''}`);
        }
      }
    } catch {
      // ignore relation fetch errors
    }
    return { ...r, relations };
  });
}

// ==================== Core pre-search ====================

/**
 * Run a fast programmatic pre-search against the memory DB.
 * Returns formatted markdown with relevant entries NOT already in memory-context.md.
 *
 * Flow:
 * 1. Basic search: embed user message + hybridSearch (~200ms)
 * 2. Evaluate search quality (best score) BEFORE dedup
 * 3. If low quality: Haiku reformulates → multi-query search (+2s)
 * 4. Dedup: filter out entries already in memory-context.md
 * 5. Fetch depth-1 relations for all results (~5ms)
 * 6. Format with disclaimer
 */
export async function runPreSearch(userMessage: string): Promise<string | null> {
  if (!userMessage || userMessage.trim().length < 5) return null;

  const t0 = Date.now();

  try {
    const currentContext = getMemoryContextContent() || '';

    const isAlreadyInContext = (key: string) =>
      currentContext.includes(`**${key}**`) || currentContext.includes(`### ${key}`);

    // --- Step 1: Basic search (hybrid with embedding fallback to keyword-only) ---
    const tEmbed = Date.now();
    let basicResults: { key: string; category: string; content: string; similarity: number }[];
    let embeddingFailed = false;
    try {
      const embedding = await generateEmbedding(userMessage);
      const tEmbedDone = Date.now();
      const hybrid = hybridSearch(embedding, userMessage, ENHANCED_LIMIT);
      basicResults = hybrid.map(r => ({ key: r.key, category: r.category, content: r.content, similarity: r.similarity }));
      const tSearchDone = Date.now();
      preSearchLog(`Basic: ${basicResults.length} found, bestScore: ${basicResults.length > 0 ? Math.max(...basicResults.map(r => r.similarity)).toFixed(3) : '0'} [embed: ${tEmbedDone - tEmbed}ms, search: ${tSearchDone - tEmbedDone}ms]`);
    } catch (err) {
      embeddingFailed = true;
      preSearchLog(`Embedding failed, falling back to keyword-only: ${err instanceof Error ? err.message : String(err)}`);
      const kwResults = searchByKeyword(userMessage, ENHANCED_LIMIT);
      basicResults = kwResults.map(r => ({ key: r.key, category: r.category, content: r.content, similarity: Math.abs(r.rank) }));
      preSearchLog(`Keyword fallback: ${basicResults.length} found`);
    }

    // --- Step 2: Evaluate search quality BEFORE dedup ---
    const bestBasicScore = basicResults.length > 0
      ? Math.max(...basicResults.map(r => r.similarity))
      : 0;

    // --- Step 3: Conditional Haiku reformulation (based on score quality) ---
    // Trigger when basic search quality is poor (low scores or nothing found).
    // This runs BEFORE dedup so we evaluate raw search quality.
    let allResults = basicResults.map(r => ({
      key: r.key, category: r.category, content: r.content, similarity: r.similarity,
    }));

    if (!embeddingFailed && (basicResults.length === 0 || bestBasicScore < MIN_SCORE_THRESHOLD)) {
      const tHaikuStart = Date.now();
      preSearchLog(`Triggering Haiku reformulation (bestScore: ${bestBasicScore.toFixed(3)} < ${MIN_SCORE_THRESHOLD})`);
      const queries = await reformulateQuery(userMessage);
      const tHaikuDone = Date.now();

      if (queries.length > 0) {
        preSearchLog(`Haiku generated ${queries.length} queries in ${tHaikuDone - tHaikuStart}ms: ${queries.join(' | ')}`);

        // Run all reformulated queries in parallel (with per-query fallback)
        const tExtraStart = Date.now();
        const extraResults = await Promise.all(
          queries.map(async q => {
            try {
              const emb = await generateEmbedding(q);
              return hybridSearch(emb, q, ENHANCED_LIMIT);
            } catch {
              // Individual query embedding failed — use keyword-only
              return searchByKeyword(q, ENHANCED_LIMIT).map(r => ({
                ...r, similarity: Math.abs(r.rank), matchType: 'keyword' as const,
              }));
            }
          }),
        );
        const tExtraDone = Date.now();

        // Merge results, dedup by key
        const seen = new Set(allResults.map(r => r.key));
        for (const results of extraResults) {
          for (const r of results) {
            if (!seen.has(r.key)) {
              seen.add(r.key);
              allResults.push({ key: r.key, category: r.category, content: r.content, similarity: r.similarity });
            }
          }
        }

        preSearchLog(`After reformulation: ${allResults.length} total [haiku: ${tHaikuDone - tHaikuStart}ms, extra-search: ${tExtraDone - tExtraStart}ms]`);
      } else {
        preSearchLog(`Haiku returned no queries in ${tHaikuDone - tHaikuStart}ms`);
      }
    } else {
      preSearchLog(`Skipping Haiku (bestScore ${bestBasicScore.toFixed(3)} >= ${MIN_SCORE_THRESHOLD})`);
    }

    // --- Step 4: Dedup filter (AFTER Haiku) ---
    let filtered = allResults.filter(r => !isAlreadyInContext(r.key));
    preSearchLog(`After dedup: ${filtered.length} results (${allResults.length - filtered.length} already in context)`);

    if (filtered.length === 0) {
      preSearchLog(`No new results, total: ${Date.now() - t0}ms`);
      return null;
    }

    // Sort by score descending and take top results
    filtered.sort((a, b) => b.similarity - a.similarity);
    filtered = filtered.slice(0, PRE_SEARCH_LIMIT);

    // --- Step 5: Fetch relations ---
    const tRelStart = Date.now();
    const enriched = fetchRelationsForResults(filtered);
    const tRelDone = Date.now();

    preSearchLog(`Relations fetched in ${tRelDone - tRelStart}ms, total: ${tRelDone - t0}ms`);

    // --- Step 6: Format ---
    const formatted = enriched.map(r => {
      const relBlock = r.relations.length > 0 ? '\n' + r.relations.join('\n') : '';
      return `- **${r.key}** [${r.category}] (score: ${r.similarity.toFixed(3)}): ${r.content.slice(0, 200)}${r.content.length > 200 ? '...' : ''}${relBlock}`;
    }).join('\n');

    return `# Pre-Search Results

Additional memory entries found via automatic search (vector/text similarity). These may not all be relevant — use your judgment. If you want to investigate further, use your search_memory tool.

${formatted}`;
  } catch (err) {
    preSearchLog(`Error: ${err instanceof Error ? err.message : String(err)}`);
    return null; // silently fail — pre-search is best-effort
  }
}

// ==================== File I/O ====================

/**
 * Write pre-search results to a file for the container hooks to read.
 * Cleans up automatically after PRE_SEARCH_TTL.
 */
export function writePreSearchFile(identifier: string, content: string): void {
  const p = resultPath(identifier);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');

  // Auto-cleanup after TTL
  setTimeout(() => {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
  }, PRE_SEARCH_TTL);
}
