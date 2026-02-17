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
  `);
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
