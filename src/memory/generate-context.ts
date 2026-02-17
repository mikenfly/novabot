import fs from 'fs';
import path from 'path';

import { GROUPS_DIR, MEMORY_DIR } from '../config.js';
import { listCategory, getRelations, getAllEntries } from './db.js';
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
}

const DEFAULT_LIMITS: MemoryLimits = {
  user: 10,
  goals: 10,
  projects: 10,
  people: 5,
  facts: 10,
  preferences: 5,
  timeline_days: 14,
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

export async function generateMemoryContext(): Promise<void> {
  const limits = loadLimits();
  const lines: string[] = ['# Memory Context', ''];

  // User — always fully included
  const userEntries = listCategory('user', limits.user);
  if (userEntries.length > 0) {
    lines.push('## User');
    for (const e of userEntries) {
      lines.push(e.content);
    }
    lines.push('');
  }

  // Active goals
  const goals = listCategory('goals', limits.goals);
  if (goals.length > 0) {
    lines.push('## Active Goals');
    for (const e of goals) {
      lines.push(formatEntry(e));
    }
    lines.push('');
  }

  // Current projects
  const projects = listCategory('projects', limits.projects);
  if (projects.length > 0) {
    lines.push('## Current Projects');
    for (const e of projects) {
      lines.push(formatEntry(e));
    }
    lines.push('');
  }

  // People
  const people = listCategory('people', limits.people);
  if (people.length > 0) {
    lines.push('## People');
    for (const e of people) {
      lines.push(formatEntry(e));
    }
    lines.push('');
  }

  // Facts
  const facts = listCategory('facts', limits.facts);
  if (facts.length > 0) {
    lines.push('## Facts');
    for (const e of facts) {
      lines.push(formatEntry(e));
    }
    lines.push('');
  }

  // Preferences
  const preferences = listCategory('preferences', limits.preferences);
  if (preferences.length > 0) {
    lines.push('## Preferences');
    for (const e of preferences) {
      lines.push(formatEntry(e));
    }
    lines.push('');
  }

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

  if (timelineInRange.length > 0) {
    lines.push('## Timeline');
    for (const e of timelineInRange) {
      lines.push(formatEntry(e));
    }
    lines.push('');
  }

  // Write to file
  const content = lines.join('\n').trim() + '\n';

  const dir = path.dirname(CONTEXT_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONTEXT_FILE, content, 'utf-8');
}
