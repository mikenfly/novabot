import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { MEMORY_DB_PATH, MEMORY_DIR } from '../config.js';
import type {
  MemoryCategory,
  MemoryEntry,
  MemoryRelation,
  RelationType,
} from './types.js';

let db: Database.Database;

export function initMemoryDatabase(): void {
  fs.mkdirSync(path.dirname(MEMORY_DB_PATH), { recursive: true });

  db = new Database(MEMORY_DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_entries (
      id              TEXT PRIMARY KEY,
      category        TEXT NOT NULL CHECK(category IN ('user','preferences','goals','facts','projects','people','timeline')),
      key             TEXT UNIQUE NOT NULL,
      content         TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','paused','stale')),
      mention_count   INTEGER NOT NULL DEFAULT 1,
      last_mentioned  TEXT NOT NULL,
      created_at      TEXT NOT NULL,
      origin_type     TEXT NOT NULL CHECK(origin_type IN ('user_statement','conversation','inferred')),
      origin_summary  TEXT,
      embedding       BLOB
    );

    CREATE TABLE IF NOT EXISTS memory_relations (
      source_key      TEXT NOT NULL REFERENCES memory_entries(key) ON DELETE CASCADE,
      target_key      TEXT NOT NULL REFERENCES memory_entries(key) ON DELETE CASCADE,
      relation_type   TEXT NOT NULL CHECK(relation_type IN ('involves','part_of','related_to','depends_on')),
      PRIMARY KEY (source_key, target_key, relation_type)
    );

    CREATE INDEX IF NOT EXISTS idx_entries_category ON memory_entries(category);
    CREATE INDEX IF NOT EXISTS idx_entries_last_mentioned ON memory_entries(last_mentioned);
    CREATE INDEX IF NOT EXISTS idx_entries_status ON memory_entries(status);
    CREATE INDEX IF NOT EXISTS idx_relations_target ON memory_relations(target_key);

    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      entry_key UNINDEXED,
      content,
      tokenize='unicode61 remove_diacritics 2'
    );
  `);

  // Rebuild FTS index from main table (ensures consistency after restart)
  rebuildFtsIndex();
}

function rebuildFtsIndex(): void {
  db.exec('DELETE FROM memory_fts');
  const rows = db.prepare('SELECT key, content FROM memory_entries').all() as { key: string; content: string }[];
  const insert = db.prepare('INSERT INTO memory_fts (entry_key, content) VALUES (?, ?)');
  for (const row of rows) {
    insert.run(row.key, `${row.key} ${row.content}`);
  }
}

function syncFts(key: string, content: string): void {
  db.prepare('DELETE FROM memory_fts WHERE entry_key = ?').run(key);
  db.prepare('INSERT INTO memory_fts (entry_key, content) VALUES (?, ?)').run(key, `${key} ${content}`);
}

function removeFts(key: string): void {
  db.prepare('DELETE FROM memory_fts WHERE entry_key = ?').run(key);
}

export function getEntry(key: string): MemoryEntry | null {
  const row = db
    .prepare('SELECT * FROM memory_entries WHERE key = ?')
    .get(key) as MemoryEntry | undefined;
  return row || null;
}

export function upsertEntry(entry: {
  category: MemoryCategory;
  key: string;
  content: string;
  status?: string;
  origin_type?: string;
  origin_summary?: string | null;
  embedding?: Buffer | null;
}): void {
  const now = new Date().toISOString();
  const existing = getEntry(entry.key);

  if (existing) {
    db.prepare(
      `UPDATE memory_entries SET
        content = ?,
        status = COALESCE(?, status),
        mention_count = mention_count + 1,
        last_mentioned = ?,
        origin_type = COALESCE(?, origin_type),
        origin_summary = COALESCE(?, origin_summary),
        embedding = COALESCE(?, embedding)
      WHERE key = ?`,
    ).run(
      entry.content,
      entry.status || null,
      now,
      entry.origin_type || null,
      entry.origin_summary !== undefined ? entry.origin_summary : null,
      entry.embedding || null,
      entry.key,
    );
  } else {
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO memory_entries (id, category, key, content, status, mention_count, last_mentioned, created_at, origin_type, origin_summary, embedding)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      entry.category,
      entry.key,
      entry.content,
      entry.status || 'active',
      now,
      now,
      entry.origin_type || 'conversation',
      entry.origin_summary || null,
      entry.embedding || null,
    );
  }

  // Sync FTS index
  syncFts(entry.key, entry.content);
}

export function bumpMention(key: string): boolean {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      'UPDATE memory_entries SET mention_count = mention_count + 1, last_mentioned = ? WHERE key = ?',
    )
    .run(now, key);
  return result.changes > 0;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function searchByEmbedding(
  queryEmbedding: Float32Array,
  limit = 10,
  category?: MemoryCategory,
): (MemoryEntry & { similarity: number })[] {
  const sql = category
    ? 'SELECT * FROM memory_entries WHERE embedding IS NOT NULL AND category = ?'
    : 'SELECT * FROM memory_entries WHERE embedding IS NOT NULL';

  const rows = (
    category
      ? db.prepare(sql).all(category)
      : db.prepare(sql).all()
  ) as MemoryEntry[];

  const scored = rows
    .map((row) => {
      const rowEmbedding = new Float32Array(
        (row.embedding as Buffer).buffer,
        (row.embedding as Buffer).byteOffset,
        (row.embedding as Buffer).byteLength / 4,
      );
      return { ...row, similarity: cosineSimilarity(queryEmbedding, rowEmbedding) };
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  return scored;
}

function buildFtsQuery(text: string): string | null {
  // Strip FTS5 special characters, keep only words
  const cleaned = text.replace(/['"()*:^~{}<>@#$%&!?.,;/\\[\]+=|`\-]/g, ' ');
  const words = cleaned
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2);
  if (words.length === 0) return null;
  // Prefix matching with OR for broad recall
  return words.map((w) => `${w}*`).join(' OR ');
}

export function searchByKeyword(
  query: string,
  limit = 10,
  category?: MemoryCategory,
): (MemoryEntry & { rank: number })[] {
  const ftsQuery = buildFtsQuery(query);
  if (!ftsQuery) return [];

  try {
    const ftsMatches = db
      .prepare('SELECT entry_key, rank FROM memory_fts WHERE content MATCH ? ORDER BY rank LIMIT ?')
      .all(ftsQuery, limit * 2) as { entry_key: string; rank: number }[];

    if (ftsMatches.length === 0) return [];

    const results: (MemoryEntry & { rank: number })[] = [];
    for (const match of ftsMatches) {
      const entry = getEntry(match.entry_key);
      if (entry && (!category || entry.category === category)) {
        results.push({ ...entry, rank: match.rank });
      }
    }

    return results.slice(0, limit);
  } catch {
    return [];
  }
}

export function hybridSearch(
  queryEmbedding: Float32Array,
  queryText: string,
  limit = 10,
  category?: MemoryCategory,
): (MemoryEntry & { similarity: number; matchType: 'vector' | 'keyword' | 'both' })[] {
  const candidateCount = limit * 2;

  // Vector search
  const vectorResults = searchByEmbedding(queryEmbedding, candidateCount, category);

  // Keyword search
  const keywordResults = searchByKeyword(queryText, candidateCount, category);

  // If no keyword results, return vector only
  if (keywordResults.length === 0) {
    return vectorResults.slice(0, limit).map((r) => ({ ...r, matchType: 'both' as const }));
  }

  // Build score map
  const scores = new Map<string, { entry: MemoryEntry; vector: number; keyword: number }>();

  for (const r of vectorResults) {
    scores.set(r.key, { entry: r, vector: r.similarity, keyword: 0 });
  }

  // Normalize keyword scores: |rank| / max|rank| → 0-1
  const maxRank = Math.max(...keywordResults.map((r) => Math.abs(r.rank)));
  for (const r of keywordResults) {
    const normalizedScore = maxRank > 0 ? Math.abs(r.rank) / maxRank : 0;
    const existing = scores.get(r.key);
    if (existing) {
      existing.keyword = normalizedScore;
    } else {
      scores.set(r.key, { entry: r, vector: 0, keyword: normalizedScore });
    }
  }

  // Combined score (0.6 vector + 0.4 keyword)
  return [...scores.values()]
    .map((s) => {
      const matchType = s.vector > 0 && s.keyword > 0 ? 'both' as const
        : s.vector > 0 ? 'vector' as const
        : 'keyword' as const;
      return {
        ...s.entry,
        similarity: 0.6 * s.vector + 0.4 * s.keyword,
        matchType,
      };
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

export function getRelations(key: string): MemoryRelation[] {
  return db
    .prepare(
      'SELECT * FROM memory_relations WHERE source_key = ? OR target_key = ?',
    )
    .all(key, key) as MemoryRelation[];
}

export function addRelation(
  sourceKey: string,
  targetKey: string,
  relationType: RelationType,
): { error?: string } {
  const source = getEntry(sourceKey);
  const target = getEntry(targetKey);
  if (!source) return { error: `Entry "${sourceKey}" not found` };
  if (!target) return { error: `Entry "${targetKey}" not found` };

  db.prepare(
    'INSERT OR IGNORE INTO memory_relations (source_key, target_key, relation_type) VALUES (?, ?, ?)',
  ).run(sourceKey, targetKey, relationType);
  return {};
}

export function removeRelation(
  sourceKey: string,
  targetKey: string,
): boolean {
  const result = db
    .prepare(
      'DELETE FROM memory_relations WHERE source_key = ? AND target_key = ?',
    )
    .run(sourceKey, targetKey);
  return result.changes > 0;
}

export function deleteEntry(key: string): boolean {
  removeFts(key);
  const result = db
    .prepare('DELETE FROM memory_entries WHERE key = ?')
    .run(key);
  return result.changes > 0;
}

export function listCategory(
  category: MemoryCategory,
  limit = 20,
): MemoryEntry[] {
  return db
    .prepare(
      `SELECT * FROM memory_entries
       WHERE category = ? AND status = 'active'
       ORDER BY (CAST(mention_count AS REAL) / (julianday('now') - julianday(last_mentioned) + 1)) DESC
       LIMIT ?`,
    )
    .all(category, limit) as MemoryEntry[];
}

export function getAllEntries(): MemoryEntry[] {
  return db
    .prepare('SELECT * FROM memory_entries ORDER BY last_mentioned DESC')
    .all() as MemoryEntry[];
}

export function checkpointWal(): void {
  db.pragma('wal_checkpoint(TRUNCATE)');
}

export function closeMemoryDatabase(): void {
  if (db) {
    checkpointWal();
    db.close();
  }
}
