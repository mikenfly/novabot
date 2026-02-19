import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import {
  getEntry,
  upsertEntry,
  bumpMention,
  deleteEntry,
  hybridSearch,
  searchByKeyword,
  getRelations,
  addRelation,
  removeRelation,
  listCategory,
  buildEmbeddingText,
  updateEmbedding,
} from './db.js';
import { generateEmbedding, embeddingToBuffer } from './embeddings.js';
import type { MemoryCategory, MemoryEntry, MemoryRelation, RelationType } from './types.js';

const CATEGORIES = [
  'user',
  'preferences',
  'goals',
  'facts',
  'projects',
  'people',
  'timeline',
] as const;

const RELATION_TYPES = [
  'involves',
  'part_of',
  'related_to',
  'depends_on',
] as const;

/**
 * Format an entry with its relations.
 * depth=0: relation keys only (compact)
 * depth=1: direct related entries with content summary (default)
 * depth=2-3: deeper relation traversal via BFS
 *
 * Pass a shared `visited` set across multiple formatEntry calls to avoid
 * expanding the same related entry twice in search results.
 */
function formatEntry(
  entry: MemoryEntry,
  options?: { depth?: number; maxRelatedLength?: number; visited?: Set<string> },
): string {
  const depth = options?.depth ?? 1;
  const maxLen = options?.maxRelatedLength ?? 150;
  const visited = options?.visited ?? new Set<string>();

  visited.add(entry.key);

  const header = `[${entry.category}] ${entry.key} (status: ${entry.status}, mentions: ${entry.mention_count}, last: ${entry.last_mentioned})`;
  const relations = getRelations(entry.key);

  if (relations.length === 0) {
    return `${header}\n${entry.content}`;
  }

  if (depth <= 0) {
    const relStr = relations
      .map((r) => `${r.source_key} -[${r.relation_type}]-> ${r.target_key}`)
      .join(', ');
    return `${header}\n${entry.content}\nRelations: ${relStr}`;
  }

  // BFS: collect related entries at each depth level
  type QueueItem = {
    parentKey: string;
    relation: MemoryRelation;
    level: number;
  };
  const queue: QueueItem[] = relations.map((r) => ({
    parentKey: entry.key,
    relation: r,
    level: 1,
  }));
  const relLines: string[] = [];

  while (queue.length > 0) {
    const item = queue.shift()!;
    if (item.level > depth) continue;

    const r = item.relation;
    const otherKey =
      r.source_key === item.parentKey ? r.target_key : r.source_key;
    const indent = '  '.repeat(item.level);
    const arrow = `${r.source_key} -[${r.relation_type}]-> ${r.target_key}`;

    if (visited.has(otherKey)) {
      relLines.push(`${indent}${arrow} (see above)`);
      continue;
    }

    const relatedEntry = getEntry(otherKey);
    if (!relatedEntry) {
      relLines.push(`${indent}${arrow} (entry not found)`);
      continue;
    }

    visited.add(otherKey);
    const truncContent =
      relatedEntry.content.length > maxLen
        ? relatedEntry.content.slice(0, maxLen) + '...'
        : relatedEntry.content;
    relLines.push(
      `${indent}${arrow}\n${indent}  [${relatedEntry.category}] ${otherKey}: ${truncContent}`,
    );

    // Enqueue sub-relations for deeper levels
    if (item.level < depth) {
      const subRelations = getRelations(otherKey);
      for (const sr of subRelations) {
        const subOtherKey =
          sr.source_key === otherKey ? sr.target_key : sr.source_key;
        if (!visited.has(subOtherKey)) {
          queue.push({
            parentKey: otherKey,
            relation: sr,
            level: item.level + 1,
          });
        }
      }
    }
  }

  return `${header}\n${entry.content}\nRelations:\n${relLines.join('\n')}`;
}

// ==================== Read-only tools ====================

const searchMemoryTool = tool(
  'search_memory',
  `Search memory entries using hybrid search (semantic similarity + keyword matching). Returns the most relevant entries with content of related entries included by default.

Results automatically include content summaries of directly related entries (depth=1). Use the \`depth\` parameter (0-3) to control how many levels of relations to include:
- depth=0: relation keys only (compact)
- depth=1: direct related entries with content (default)
- depth=2: second-level relations included
- depth=3: three levels deep

If results seem incomplete after depth=1, retry with depth=2 or depth=3 to discover entries connected through intermediary relations.

Always use this before creating a new entry to check for duplicates.`,
  {
    query: z.string().describe('Search query text'),
    category: z
      .enum(CATEGORIES)
      .optional()
      .describe('Filter to a specific category'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe('Max results (default 10)'),
    depth: z
      .number()
      .int()
      .min(0)
      .max(3)
      .optional()
      .describe(
        'Relation depth: 0=keys only, 1=direct relations with content (default), 2-3=deeper',
      ),
    include_related: z
      .boolean()
      .optional()
      .describe('Include related entry content (default true)'),
  },
  async (args) => {
    const t0 = Date.now();
    const tag = `[search "${args.query.slice(0, 40)}"]`;
    console.log(`${tag} START`);
    try {
      const includeRelated = args.include_related !== false;
      const depth = includeRelated ? (args.depth ?? 1) : 0;
      const visited = new Set<string>();
      const limit = args.limit || 10;
      const category = args.category as MemoryCategory | undefined;

      // Try hybrid search (vector + keyword), fall back to keyword-only on embedding failure
      let results: (MemoryEntry & { similarity: number; matchType?: string })[];
      try {
        console.log(`${tag} generating embedding...`);
        const embedding = await generateEmbedding(args.query);
        console.log(`${tag} embedding done (${Date.now() - t0}ms), hybridSearch...`);
        results = hybridSearch(embedding, args.query, limit, category);
        console.log(`${tag} hybridSearch done (${Date.now() - t0}ms), ${results.length} results`);
      } catch (e) {
        console.log(`${tag} embedding failed (${Date.now() - t0}ms): ${e instanceof Error ? e.message : e}, keyword fallback`);
        const kwResults = searchByKeyword(args.query, limit, category);
        results = kwResults.map(r => ({
          ...r,
          similarity: Math.abs(r.rank),
          matchType: 'keyword' as const,
        }));
      }

      if (results.length === 0) {
        return {
          content: [{ type: 'text', text: 'No matching entries found.' }],
        };
      }

      const formatted = results
        .map(
          (r) =>
            `[score: ${r.similarity.toFixed(3)}, match: ${r.matchType || 'hybrid'}]\n${formatEntry(r, { depth, visited })}`,
        )
        .join('\n\n---\n\n');

      console.log(`${tag} DONE (total: ${Date.now() - t0}ms, ${results.length} results)`);
      return {
        content: [{ type: 'text', text: formatted }],
      };
    } catch (err) {
      console.log(`${tag} ERROR (${Date.now() - t0}ms): ${err instanceof Error ? err.message : err}`);
      return {
        content: [
          {
            type: 'text',
            text: `Search error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

const getEntryTool = tool(
  'get_entry',
  `Get a specific memory entry by its key, with all relations and their content.

By default (depth=1), shows the entry with content summaries of directly related entries. Use depth=2 or depth=3 to see deeper connections.`,
  {
    key: z.string().describe('The entry key'),
    depth: z
      .number()
      .int()
      .min(0)
      .max(3)
      .optional()
      .describe(
        'Relation depth: 0=keys only, 1=direct relations with content (default), 2-3=deeper',
      ),
  },
  async (args) => {
    const entry = getEntry(args.key);
    if (!entry) {
      return {
        content: [
          { type: 'text', text: `Entry "${args.key}" not found.` },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text',
          text: formatEntry(entry, { depth: args.depth ?? 1 }),
        },
      ],
    };
  },
);

const listCategoryTool = tool(
  'list_category',
  'List active entries in a category, ordered by relevance score (frequency × recency).',
  {
    category: z.enum(CATEGORIES).describe('Category to list'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe('Max results (default 20)'),
  },
  async (args) => {
    const entries = listCategory(
      args.category as MemoryCategory,
      args.limit || 20,
    );

    if (entries.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No active entries in "${args.category}".`,
          },
        ],
      };
    }

    const formatted = entries.map((e) => formatEntry(e)).join('\n\n---\n\n');
    return {
      content: [{ type: 'text', text: formatted }],
    };
  },
);

// ==================== Write tools ====================

const upsertEntryTool = tool(
  'upsert_entry',
  `Create a new memory entry or rewrite an existing one. If the key already exists, the content is fully replaced and mention_count is incremented.

After every upsert, the tool automatically searches for related entries (hybrid: semantic + keyword) and shows them in the response. Review these carefully:
- If a related entry contains the SAME information in a different category → you have a duplicate. Delete one or merge them.
- If a related entry is AFFECTED by this change → update it too (propagation).

Content style: write a current-state snapshot — what IS true right now, not what happened. 2-5 sentences max. If updating, rewrite entirely so someone understands the situation without history.`,
  {
    category: z.enum(CATEGORIES).describe('Entry category'),
    key: z
      .string()
      .describe(
        'Unique key (lowercase, hyphens, e.g. "cadeau-marie", "habite-paris")',
      ),
    content: z
      .string()
      .describe('Current-state description (2-5 sentences)'),
    status: z
      .enum(['active', 'completed', 'paused', 'stale'])
      .optional()
      .describe('Entry status (default: active)'),
    origin_type: z
      .enum(['user_statement', 'conversation', 'inferred'])
      .optional()
      .describe(
        'How this info was obtained (default: conversation)',
      ),
    origin_summary: z
      .string()
      .optional()
      .describe('Brief note on origin context'),
  },
  async (args) => {
    const t0 = Date.now();
    const tag = `[upsert ${args.key}]`;
    console.log(`${tag} START category=${args.category}`);
    try {
      // Step 1: Pre-search for related entries (hybrid with keyword fallback)
      let relatedOthers: { key: string; category: string; content: string; similarity?: number; matchType?: string }[] = [];
      try {
        console.log(`${tag} step1: generating search embedding...`);
        const basicEmbText = `[${args.category}] ${args.key}: ${args.content}`;
        const searchEmbedding = await generateEmbedding(basicEmbText);
        console.log(`${tag} step1: embedding done (${Date.now() - t0}ms), running hybridSearch...`);
        const related = hybridSearch(searchEmbedding, args.content, 5, undefined);
        console.log(`${tag} step1: hybridSearch done (${Date.now() - t0}ms), ${related.length} results`);
        relatedOthers = related.filter((r) => r.key !== args.key);
      } catch (e) {
        console.log(`${tag} step1: embedding/search failed (${Date.now() - t0}ms): ${e instanceof Error ? e.message : e}, falling back to keyword`);
        const kwResults = searchByKeyword(args.content, 5);
        relatedOthers = kwResults.filter((r) => r.key !== args.key);
        console.log(`${tag} step1: keyword fallback done (${Date.now() - t0}ms), ${kwResults.length} results`);
      }

      // Step 2: Upsert entry
      console.log(`${tag} step2: upserting...`);
      upsertEntry({
        category: args.category as MemoryCategory,
        key: args.key,
        content: args.content,
        status: args.status,
        origin_type: args.origin_type,
        origin_summary: args.origin_summary,
      });
      console.log(`${tag} step2: upsert done (${Date.now() - t0}ms)`);

      // Step 3: Build contextual embedding (includes relation summaries) with fallback
      try {
        console.log(`${tag} step3: building embedding text...`);
        const embeddingText = buildEmbeddingText(args.key);
        console.log(`${tag} step3: generating contextual embedding (${embeddingText.length} chars)...`);
        const embeddingArray = await generateEmbedding(embeddingText);
        console.log(`${tag} step3: embedding done (${Date.now() - t0}ms), updating DB...`);
        updateEmbedding(args.key, embeddingToBuffer(embeddingArray), embeddingText);
        console.log(`${tag} step3: DB updated (${Date.now() - t0}ms)`);
      } catch (e) {
        console.log(`${tag} step3: embedding failed (${Date.now() - t0}ms): ${e instanceof Error ? e.message : e} — stays dirty`);
      }

      const action = getEntry(args.key)!.mention_count > 1 ? 'Updated' : 'Created';
      console.log(`${tag} DONE ${action} (total: ${Date.now() - t0}ms)`);

      // Build related entries feedback
      let relatedInfo = '';
      if (relatedOthers.length > 0) {
        relatedInfo = `\n\nRelated entries in database:\n${relatedOthers
          .map(
            (d) =>
              `  - [${d.category}] ${d.key} (score: ${(d as any).similarity?.toFixed(3) || 'kw'}): ${d.content.slice(0, 120)}...`,
          )
          .join('\n')}\nReview: if any of these contain the SAME information, merge them. If any are affected by this change, update them too.`;
      }

      return {
        content: [
          {
            type: 'text',
            text: `${action} entry "${args.key}" in ${args.category}.${relatedInfo}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `Upsert error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

const bumpMentionTool = tool(
  'bump_mention',
  'Increment mention count and update timestamp for an entry, without changing its content. Use when something is referenced but nothing changed.',
  {
    key: z.string().describe('The entry key to bump'),
  },
  async (args) => {
    const success = bumpMention(args.key);
    if (!success) {
      return {
        content: [
          { type: 'text', text: `Entry "${args.key}" not found.` },
        ],
      };
    }
    return {
      content: [
        { type: 'text', text: `Bumped "${args.key}".` },
      ],
    };
  },
);

const deleteEntryTool = tool(
  'delete_entry',
  `Delete a memory entry. Will REFUSE if the entry still has relations — you must remove or transfer them first with remove_relation/add_relation.

This forces you to think about the impact: if entry X involves Y, deleting X without handling that relation would leave Y with a broken link. Review connected entries, reorganize relations, then retry.`,
  {
    key: z.string().describe('The entry key to delete'),
  },
  async (args) => {
    const entry = getEntry(args.key);
    if (!entry) {
      return {
        content: [
          { type: 'text', text: `Entry "${args.key}" not found.` },
        ],
      };
    }

    // Check for existing relations — refuse deletion if any exist
    const relations = getRelations(args.key);
    if (relations.length > 0) {
      const relList = relations.map((r) => {
        const direction = r.source_key === args.key ? 'outgoing' : 'incoming';
        const otherKey = r.source_key === args.key ? r.target_key : r.source_key;
        return `  - ${direction} ${r.relation_type}: ${otherKey}`;
      }).join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `Cannot delete "${args.key}" — it has ${relations.length} relation(s):\n${relList}\n\nRemove or transfer these relations first (use remove_relation/add_relation), then retry. Think about whether the connected entries need updating too.`,
          },
        ],
        isError: true,
      };
    }

    const deleted = deleteEntry(args.key);
    return {
      content: [
        {
          type: 'text',
          text: deleted
            ? `Deleted entry "${args.key}" (was in ${entry.category}).`
            : `Failed to delete "${args.key}".`,
        },
      ],
    };
  },
);

const addRelationTool = tool(
  'add_relation',
  'Create a directional link between two entries. Both entries must exist.',
  {
    source_key: z.string().describe('Source entry key'),
    target_key: z.string().describe('Target entry key'),
    relation_type: z
      .enum(RELATION_TYPES)
      .describe('Type of relation'),
  },
  async (args) => {
    const result = addRelation(
      args.source_key,
      args.target_key,
      args.relation_type as RelationType,
    );
    if (result.error) {
      return {
        content: [{ type: 'text', text: result.error }],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: 'text',
          text: `Linked: ${args.source_key} -[${args.relation_type}]-> ${args.target_key}`,
        },
      ],
    };
  },
);

const removeRelationTool = tool(
  'remove_relation',
  'Remove all relations between two entries (both directions).',
  {
    source_key: z.string().describe('Source entry key'),
    target_key: z.string().describe('Target entry key'),
  },
  async (args) => {
    const removed = removeRelation(args.source_key, args.target_key);
    return {
      content: [
        {
          type: 'text',
          text: removed
            ? `Removed relations between "${args.source_key}" and "${args.target_key}".`
            : `No relations found between "${args.source_key}" and "${args.target_key}".`,
        },
      ],
    };
  },
);

// ==================== Server factory ====================

export function createMemoryMcpServer(options?: { readOnly?: boolean; bumpOnly?: boolean }) {
  const readOnlyTools = [searchMemoryTool, getEntryTool, listCategoryTool];
  const writeTools = [upsertEntryTool, bumpMentionTool, deleteEntryTool, addRelationTool, removeRelationTool];

  let tools;
  if (options?.readOnly) {
    tools = readOnlyTools;
  } else if (options?.bumpOnly) {
    tools = [...readOnlyTools, bumpMentionTool];
  } else {
    tools = [...readOnlyTools, ...writeTools];
  }

  return createSdkMcpServer({
    name: 'memory',
    version: '1.0.0',
    tools,
  });
}
