import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import {
  getEntry,
  upsertEntry,
  bumpMention,
  searchByEmbedding,
  getRelations,
  addRelation,
  removeRelation,
  listCategory,
} from './db.js';
import { generateEmbedding, embeddingToBuffer } from './embeddings.js';
import type { MemoryCategory, MemoryEntry, RelationType } from './types.js';

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

function formatEntry(entry: MemoryEntry): string {
  const relations = getRelations(entry.key);
  const relStr =
    relations.length > 0
      ? `\nRelations: ${relations.map((r) => `${r.source_key} -[${r.relation_type}]-> ${r.target_key}`).join(', ')}`
      : '';
  return `[${entry.category}] ${entry.key} (status: ${entry.status}, mentions: ${entry.mention_count}, last: ${entry.last_mentioned})
${entry.content}${relStr}`;
}

export function createMemoryMcpServer() {
  return createSdkMcpServer({
    name: 'memory',
    version: '1.0.0',
    tools: [
      tool(
        'search_memory',
        'Search memory entries by semantic similarity. Returns the most relevant entries matching the query.',
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
        },
        async (args) => {
          try {
            const embedding = await generateEmbedding(args.query);
            const results = searchByEmbedding(
              embedding,
              args.limit || 10,
              args.category as MemoryCategory | undefined,
            );

            if (results.length === 0) {
              return {
                content: [
                  {
                    type: 'text',
                    text: 'No matching entries found.',
                  },
                ],
              };
            }

            const formatted = results
              .map(
                (r) =>
                  `[similarity: ${r.similarity.toFixed(3)}]\n${formatEntry(r)}`,
              )
              .join('\n\n---\n\n');

            return {
              content: [{ type: 'text', text: formatted }],
            };
          } catch (err) {
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
      ),

      tool(
        'get_entry',
        'Get a specific memory entry by its key, with all relations.',
        {
          key: z.string().describe('The entry key'),
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
            content: [{ type: 'text', text: formatEntry(entry) }],
          };
        },
      ),

      tool(
        'upsert_entry',
        `Create a new memory entry or rewrite an existing one. If the key already exists, the content is fully replaced and mention_count is incremented.

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
          try {
            const embedding = await generateEmbedding(args.content);
            upsertEntry({
              category: args.category as MemoryCategory,
              key: args.key,
              content: args.content,
              status: args.status,
              origin_type: args.origin_type,
              origin_summary: args.origin_summary,
              embedding: embeddingToBuffer(embedding),
            });

            const action = getEntry(args.key)!.mention_count > 1 ? 'Updated' : 'Created';
            return {
              content: [
                {
                  type: 'text',
                  text: `${action} entry "${args.key}" in ${args.category}.`,
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
      ),

      tool(
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
      ),

      tool(
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
      ),

      tool(
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
      ),

      tool(
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
      ),
    ],
  });
}
