import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { STORE_DIR } from './config.js';
import { ScheduledTask, TaskRunLog } from './types.js';

let db: Database.Database;

export function initDatabase(): void {
  const dbPath = path.join(STORE_DIR, 'messages.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      group_folder TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      prompt TEXT NOT NULL,
      schedule_type TEXT NOT NULL,
      schedule_value TEXT NOT NULL,
      next_run TEXT,
      last_run TEXT,
      last_result TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_next_run ON scheduled_tasks(next_run);
    CREATE INDEX IF NOT EXISTS idx_status ON scheduled_tasks(status);

    CREATE TABLE IF NOT EXISTS task_run_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      run_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      status TEXT NOT NULL,
      result TEXT,
      error TEXT,
      FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
    );
    CREATE INDEX IF NOT EXISTS idx_task_run_logs ON task_run_logs(task_id, run_at);

    CREATE TABLE IF NOT EXISTS pwa_conversations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_activity TEXT NOT NULL,
      archived INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_pwa_conv_activity ON pwa_conversations(last_activity);

    CREATE TABLE IF NOT EXISTS pwa_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES pwa_conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_pwa_msg_conv ON pwa_messages(conversation_id, timestamp);

    CREATE TABLE IF NOT EXISTS pwa_push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint TEXT NOT NULL UNIQUE,
      keys_p256dh TEXT NOT NULL,
      keys_auth TEXT NOT NULL,
      device_token TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_push_device ON pwa_push_subscriptions(device_token);
  `);

  // Add context_mode column if it doesn't exist (migration for existing DBs)
  try {
    db.exec(
      `ALTER TABLE scheduled_tasks ADD COLUMN context_mode TEXT DEFAULT 'isolated'`,
    );
  } catch {
    /* column already exists */
  }

  // Add audio_url column to pwa_messages if it doesn't exist
  try {
    db.exec(`ALTER TABLE pwa_messages ADD COLUMN audio_url TEXT`);
  } catch {
    /* column already exists */
  }

  // Add audio_segments column (JSON array of {url, title}) to pwa_messages
  try {
    db.exec(`ALTER TABLE pwa_messages ADD COLUMN audio_segments TEXT`);
  } catch {
    /* column already exists */
  }

  // Add auto_rename column to pwa_conversations (1 = enabled by default)
  try {
    db.exec(`ALTER TABLE pwa_conversations ADD COLUMN auto_rename INTEGER DEFAULT 1`);
  } catch {
    /* column already exists */
  }
}

// --- Scheduled Tasks ---

export function createTask(
  task: Omit<ScheduledTask, 'last_run' | 'last_result'>,
): void {
  db.prepare(
    `
    INSERT INTO scheduled_tasks (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, context_mode, next_run, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    task.id,
    task.group_folder,
    task.chat_jid,
    task.prompt,
    task.schedule_type,
    task.schedule_value,
    task.context_mode || 'isolated',
    task.next_run,
    task.status,
    task.created_at,
  );
}

export function getTaskById(id: string): ScheduledTask | undefined {
  return db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as
    | ScheduledTask
    | undefined;
}

export function getTasksForGroup(groupFolder: string): ScheduledTask[] {
  return db
    .prepare(
      'SELECT * FROM scheduled_tasks WHERE group_folder = ? ORDER BY created_at DESC',
    )
    .all(groupFolder) as ScheduledTask[];
}

export function getAllTasks(): ScheduledTask[] {
  return db
    .prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC')
    .all() as ScheduledTask[];
}

export function updateTask(
  id: string,
  updates: Partial<
    Pick<
      ScheduledTask,
      'prompt' | 'schedule_type' | 'schedule_value' | 'next_run' | 'status'
    >
  >,
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.prompt !== undefined) {
    fields.push('prompt = ?');
    values.push(updates.prompt);
  }
  if (updates.schedule_type !== undefined) {
    fields.push('schedule_type = ?');
    values.push(updates.schedule_type);
  }
  if (updates.schedule_value !== undefined) {
    fields.push('schedule_value = ?');
    values.push(updates.schedule_value);
  }
  if (updates.next_run !== undefined) {
    fields.push('next_run = ?');
    values.push(updates.next_run);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }

  if (fields.length === 0) return;

  values.push(id);
  db.prepare(
    `UPDATE scheduled_tasks SET ${fields.join(', ')} WHERE id = ?`,
  ).run(...values);
}

export function deleteTask(id: string): void {
  // Delete child records first (FK constraint)
  db.prepare('DELETE FROM task_run_logs WHERE task_id = ?').run(id);
  db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
}

export function getDueTasks(): ScheduledTask[] {
  const now = new Date().toISOString();
  return db
    .prepare(
      `
    SELECT * FROM scheduled_tasks
    WHERE status = 'active' AND next_run IS NOT NULL AND next_run <= ?
    ORDER BY next_run
  `,
    )
    .all(now) as ScheduledTask[];
}

export function updateTaskAfterRun(
  id: string,
  nextRun: string | null,
  lastResult: string,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE scheduled_tasks
    SET next_run = ?, last_run = ?, last_result = ?, status = CASE WHEN ? IS NULL THEN 'completed' ELSE status END
    WHERE id = ?
  `,
  ).run(nextRun, now, lastResult, nextRun, id);
}

export function logTaskRun(log: TaskRunLog): void {
  db.prepare(
    `
    INSERT INTO task_run_logs (task_id, run_at, duration_ms, status, result, error)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  ).run(
    log.task_id,
    log.run_at,
    log.duration_ms,
    log.status,
    log.result,
    log.error,
  );
}

export function getTaskRunLogs(taskId: string, limit = 10): TaskRunLog[] {
  return db
    .prepare(
      `
    SELECT task_id, run_at, duration_ms, status, result, error
    FROM task_run_logs
    WHERE task_id = ?
    ORDER BY run_at DESC
    LIMIT ?
  `,
    )
    .all(taskId, limit) as TaskRunLog[];
}

// --- PWA Conversations CRUD ---

export interface PWAConversationRow {
  id: string;
  name: string;
  created_at: string;
  last_activity: string;
  archived: number;
  auto_rename: number;
}

export interface PWAMessageRow {
  id: string;
  conversation_id: string;
  sender: 'user' | 'assistant';
  content: string;
  timestamp: string;
  audio_url: string | null;
  audio_segments: string | null;
}

export interface PushSubscriptionRow {
  id: number;
  endpoint: string;
  keys_p256dh: string;
  keys_auth: string;
  device_token: string | null;
  created_at: string;
}

export function createPWAConversationDB(id: string, name: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO pwa_conversations (id, name, created_at, last_activity) VALUES (?, ?, ?, ?)`,
  ).run(id, name, now, now);
}

export function getPWAConversationDB(
  id: string,
): PWAConversationRow | undefined {
  return db
    .prepare(`SELECT * FROM pwa_conversations WHERE id = ?`)
    .get(id) as PWAConversationRow | undefined;
}

export function getAllPWAConversationsDB(): PWAConversationRow[] {
  return db
    .prepare(
      `SELECT * FROM pwa_conversations WHERE archived = 0 ORDER BY last_activity DESC`,
    )
    .all() as PWAConversationRow[];
}

export function renamePWAConversation(id: string, name: string): boolean {
  const result = db
    .prepare(`UPDATE pwa_conversations SET name = ? WHERE id = ?`)
    .run(name, id);
  return result.changes > 0;
}

export function setPWAAutoRename(id: string, enabled: boolean): boolean {
  const result = db
    .prepare(`UPDATE pwa_conversations SET auto_rename = ? WHERE id = ?`)
    .run(enabled ? 1 : 0, id);
  return result.changes > 0;
}

export function countPWAUserMessages(conversationId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) as count FROM pwa_messages WHERE conversation_id = ? AND sender = 'user'`,
    )
    .get(conversationId) as { count: number };
  return row.count;
}

export function deletePWAConversation(id: string): boolean {
  db.prepare(`DELETE FROM pwa_messages WHERE conversation_id = ?`).run(id);
  const result = db
    .prepare(`DELETE FROM pwa_conversations WHERE id = ?`)
    .run(id);
  return result.changes > 0;
}

export function updatePWAConversationActivity(id: string): void {
  const now = new Date().toISOString();
  db.prepare(`UPDATE pwa_conversations SET last_activity = ? WHERE id = ?`).run(
    now,
    id,
  );
}

export function addPWAMessage(
  id: string,
  conversationId: string,
  sender: 'user' | 'assistant',
  content: string,
  audioUrl?: string,
  audioSegments?: Array<{ url: string; title?: string }>,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO pwa_messages (id, conversation_id, sender, content, timestamp, audio_url, audio_segments) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, conversationId, sender, content, now, audioUrl || null, audioSegments ? JSON.stringify(audioSegments) : null);
  updatePWAConversationActivity(conversationId);
}

export function getPWAMessages(
  conversationId: string,
  since?: string,
): PWAMessageRow[] {
  if (since) {
    return db
      .prepare(
        `SELECT * FROM pwa_messages WHERE conversation_id = ? AND timestamp > ? ORDER BY timestamp ASC`,
      )
      .all(conversationId, since) as PWAMessageRow[];
  }
  return db
    .prepare(
      `SELECT * FROM pwa_messages WHERE conversation_id = ? ORDER BY timestamp ASC`,
    )
    .all(conversationId) as PWAMessageRow[];
}

export function getPWARecentMessages(
  conversationId: string,
  limit: number,
): PWAMessageRow[] {
  return db
    .prepare(
      `SELECT * FROM (
        SELECT * FROM pwa_messages WHERE conversation_id = ? ORDER BY timestamp DESC LIMIT ?
      ) sub ORDER BY timestamp ASC`,
    )
    .all(conversationId, limit) as PWAMessageRow[];
}

// --- Push Subscriptions CRUD ---

export function savePushSubscription(
  endpoint: string,
  p256dh: string,
  auth: string,
  deviceToken?: string,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO pwa_push_subscriptions (endpoint, keys_p256dh, keys_auth, device_token, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET keys_p256dh = excluded.keys_p256dh, keys_auth = excluded.keys_auth, device_token = excluded.device_token`,
  ).run(endpoint, p256dh, auth, deviceToken || null, now);
}

export function removePushSubscription(endpoint: string): boolean {
  const result = db
    .prepare(`DELETE FROM pwa_push_subscriptions WHERE endpoint = ?`)
    .run(endpoint);
  return result.changes > 0;
}

export function getAllPushSubscriptions(): PushSubscriptionRow[] {
  return db
    .prepare(`SELECT * FROM pwa_push_subscriptions`)
    .all() as PushSubscriptionRow[];
}

// --- PWA ID generation helpers ---

export function generatePWAConversationId(): string {
  return `pwa-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

export function generatePWAMessageId(): string {
  return `msg-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}
