import fs from 'fs';
import path from 'path';

import { GROUPS_DIR, MEMORY_DIR } from '../config.js';
import { listCategory, getRelations, getEntry, getAllEntries } from './db.js';
import type { MemoryEntry } from './types.js';

const CONTEXT_FILE = path.join(GROUPS_DIR, 'global', 'memory-context.md');
const SETTINGS_FILE = path.join(MEMORY_DIR, 'settings.json');

export interface MemoryLimits {
  user: number;
  goals: number;
  projects: number;
  people: number;
  facts: number;
  preferences: number;
  timeline_days: number;
  relation_depth: number;
}

const DEFAULT_LIMITS: MemoryLimits = {
  user: 10,
  goals: 10,
  projects: 10,
  people: 5,
  facts: 10,
  preferences: 5,
  timeline_days: 14,
  relation_depth: 2,
};

function loadLimits(): MemoryLimits {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      return { ...DEFAULT_LIMITS, ...raw.limits };
    }
  } catch {
    // ignore malformed file
  }
  return { ...DEFAULT_LIMITS };
}

export function getLimits(): MemoryLimits {
  return loadLimits();
}

export function getMemoryContextContent(): string | null {
  try {
    if (fs.existsSync(CONTEXT_FILE)) {
      return fs.readFileSync(CONTEXT_FILE, 'utf-8');
    }
  } catch {
    // ignore
  }
  return null;
}

export function saveLimits(partial: Partial<MemoryLimits>): MemoryLimits {
  const current = loadLimits();
  const merged = { ...current, ...partial };
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ limits: merged }, null, 2), 'utf-8');
  return merged;
}

function score(entry: MemoryEntry): number {
  const daysSince =
    (Date.now() - new Date(entry.last_mentioned).getTime()) / (1000 * 60 * 60 * 24);
  return entry.mention_count / (daysSince + 1);
}

// When this entry is the TARGET of a relation, show the inverse label
const INVERSE_LABELS: Record<string, string> = {
  involves: 'involved_in',
  part_of: 'includes',
  related_to: 'related_to',
  depends_on: 'required_by',
};

/**
 * Collect related entries recursively up to maxDepth levels.
 * Returns a map of key → { entry, depth } for all discovered entries.
 * The initial entry is at depth 0, its direct relations at depth 1, etc.
 */
function collectRelatedEntries(
  rootKey: string,
  maxDepth: number,
  alreadyIncluded: Set<string>,
): Map<string, { entry: MemoryEntry; depth: number }> {
  const collected = new Map<string, { entry: MemoryEntry; depth: number }>();
  const queue: { key: string; depth: number }[] = [{ key: rootKey, depth: 0 }];

  while (queue.length > 0) {
    const { key, depth } = queue.shift()!;

    // Skip if already collected at same or shallower depth, or already in context
    if (collected.has(key) || (depth > 0 && alreadyIncluded.has(key))) continue;
    if (depth > maxDepth) continue;

    const entry = getEntry(key);
    if (!entry || entry.status !== 'active') continue;

    if (depth > 0) {
      collected.set(key, { entry, depth });
    }

    // Explore relations if we haven't reached max depth
    if (depth < maxDepth) {
      const relations = getRelations(key);
      for (const r of relations) {
        const otherKey = r.source_key === key ? r.target_key : r.source_key;
        if (!collected.has(otherKey) && !alreadyIncluded.has(otherKey)) {
          queue.push({ key: otherKey, depth: depth + 1 });
        }
      }
    }
  }

  return collected;
}

function formatEntry(entry: MemoryEntry): string {
  const relations = getRelations(entry.key);
  const relStr =
    relations.length > 0
      ? ` [${relations.map((r) => {
          const isSource = r.source_key === entry.key;
          const otherKey = isSource ? r.target_key : r.source_key;
          const label = isSource ? r.relation_type : (INVERSE_LABELS[r.relation_type] || r.relation_type);
          return `${label}: ${otherKey}`;
        }).join(', ')}]`
      : '';
  return `- **${entry.key}** (mentioned ${entry.mention_count}x, last: ${entry.last_mentioned.slice(0, 10)}): ${entry.content}${relStr}`;
}

function formatRelatedEntry(entry: MemoryEntry, depth: number): string {
  const indent = '  '.repeat(depth);
  const relations = getRelations(entry.key);
  const relStr =
    relations.length > 0
      ? ` [${relations.map((r) => {
          const isSource = r.source_key === entry.key;
          const otherKey = isSource ? r.target_key : r.source_key;
          const label = isSource ? r.relation_type : (INVERSE_LABELS[r.relation_type] || r.relation_type);
          return `${label}: ${otherKey}`;
        }).join(', ')}]`
      : '';
  return `${indent}- *(lié)* **${entry.key}**: ${entry.content}${relStr}`;
}

export async function generateMemoryContext(): Promise<void> {
  const limits = loadLimits();
  const lines: string[] = ['# Memory Context', ''];

  // Track all keys already included in context (for relation dedup)
  const includedKeys = new Set<string>();

  // Helper: format a section's entries + their related entries
  function addSection(title: string, entries: MemoryEntry[], depth: number) {
    if (entries.length === 0) return;
    lines.push(`## ${title}`);
    for (const e of entries) {
      includedKeys.add(e.key);
    }
    for (const e of entries) {
      lines.push(formatEntry(e));

      // Resolve related entries up to relation_depth levels
      if (depth > 0) {
        const related = collectRelatedEntries(e.key, depth, includedKeys);
        // Sort by depth, then alphabetically
        const sorted = [...related.entries()].sort((a, b) =>
          a[1].depth !== b[1].depth ? a[1].depth - b[1].depth : a[0].localeCompare(b[0])
        );
        for (const [, { entry, depth: d }] of sorted) {
          lines.push(formatRelatedEntry(entry, d));
          includedKeys.add(entry.key);
        }
      }
    }
    lines.push('');
  }

  const depth = limits.relation_depth;

  // User — always fully included (no relations for user profile)
  const userEntries = listCategory('user', limits.user);
  if (userEntries.length > 0) {
    lines.push('## User');
    for (const e of userEntries) {
      lines.push(e.content);
      includedKeys.add(e.key);
    }
    lines.push('');
  }

  // Active goals
  addSection('Active Goals', listCategory('goals', limits.goals), depth);

  // Current projects
  addSection('Current Projects', listCategory('projects', limits.projects), depth);

  // People
  addSection('People', listCategory('people', limits.people), depth);

  // Facts
  addSection('Facts', listCategory('facts', limits.facts), depth);

  // Preferences
  addSection('Preferences', listCategory('preferences', limits.preferences), depth);

  // Timeline — entries within ± configured days
  const allTimeline = getAllEntries().filter((e) => e.category === 'timeline' && e.status === 'active');
  const now = Date.now();
  const rangeMs = limits.timeline_days * 24 * 60 * 60 * 1000;
  const timelineInRange = allTimeline
    .filter((e) => {
      const entryTime = new Date(e.last_mentioned).getTime();
      return Math.abs(entryTime - now) <= rangeMs;
    })
    .sort((a, b) => new Date(a.last_mentioned).getTime() - new Date(b.last_mentioned).getTime());

  addSection('Timeline', timelineInRange, depth);

  // Write to file
  const content = lines.join('\n').trim() + '\n';

  const dir = path.dirname(CONTEXT_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONTEXT_FILE, content, 'utf-8');
}
