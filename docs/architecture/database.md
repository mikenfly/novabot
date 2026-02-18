# Database - SQLite Schema & Operations

## Overview

NovaBot uses SQLite (via better-sqlite3) for persistent data storage. The database stores WhatsApp messages, scheduled tasks, and metadata.

**Database file** : `store/messages.db`

## Schema

### Table: chats

Stores metadata for all WhatsApp chats (groups and direct messages).

```sql
CREATE TABLE IF NOT EXISTS chats (
  jid TEXT PRIMARY KEY,           -- WhatsApp JID (e.g., "1234567890@g.us")
  name TEXT,                      -- Chat name (e.g., "Family Chat")
  last_message_time TEXT          -- ISO timestamp of last activity
);
```

**Purpose** :
- Enable group discovery (list all chats for activation)
- Track activity for sorting
- Store display names

**Indexes** : Primary key on `jid`

**Example data** :
```
jid                    name           last_message_time
-----------------------------------------------------
1234567890@g.us        Family Chat    2026-02-06T12:34:56Z
9876543210@s.whatsapp  John Doe       2026-02-05T10:20:30Z
```

### Table: messages

Stores WhatsApp messages for polling and conversation catch-up.

```sql
CREATE TABLE IF NOT EXISTS messages (
  id TEXT,                        -- Message ID from WhatsApp
  chat_jid TEXT,                  -- Chat JID (foreign key to chats)
  sender TEXT,                    -- Sender JID or "me"
  sender_name TEXT,               -- Sender display name
  content TEXT,                   -- Message text content
  timestamp TEXT,                 -- ISO timestamp
  is_from_me INTEGER,             -- 1 if sent by bot, 0 if received
  PRIMARY KEY (id, chat_jid),
  FOREIGN KEY (chat_jid) REFERENCES chats(jid)
);

CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp);
```

**Purpose** :
- Store incoming messages for polling
- Enable conversation catch-up (agent sees all messages since last interaction)
- Track message history

**Indexes** :
- Primary key on `(id, chat_jid)`
- Index on `timestamp` for efficient time-based queries

**Example data** :
```
id        chat_jid          sender           sender_name  content                timestamp              is_from_me
-----------------------------------------------------------------------------------------------------------------------
msg123    1234567890@g.us   1111@s.whatsapp  John         Hey everyone           2026-02-06T10:00:00Z   0
msg124    1234567890@g.us   2222@s.whatsapp  Sarah        Hi!                    2026-02-06T10:01:00Z   0
msg125    1234567890@g.us   me               null         Nova: Hello!          2026-02-06T10:02:00Z   1
```

### Table: scheduled_tasks

Stores scheduled tasks (recurring, one-time, interval-based).

```sql
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id TEXT PRIMARY KEY,            -- UUID task identifier
  group_folder TEXT NOT NULL,     -- Group folder name (e.g., "main", "family-chat")
  chat_jid TEXT NOT NULL,         -- Chat JID where task sends messages (if any)
  prompt TEXT NOT NULL,           -- Task prompt/instruction for agent
  schedule_type TEXT NOT NULL,    -- "cron", "interval", or "once"
  schedule_value TEXT NOT NULL,   -- Cron expression, milliseconds, or ISO timestamp
  next_run TEXT,                  -- ISO timestamp of next scheduled run
  last_run TEXT,                  -- ISO timestamp of last execution
  last_result TEXT,               -- Result from last execution
  status TEXT DEFAULT 'active',   -- "active", "paused", "completed", "failed"
  context_mode TEXT DEFAULT 'isolated', -- "isolated" or "group"
  created_at TEXT NOT NULL        -- ISO timestamp of task creation
);

CREATE INDEX IF NOT EXISTS idx_next_run ON scheduled_tasks(next_run);
CREATE INDEX IF NOT EXISTS idx_status ON scheduled_tasks(status);
```

**Purpose** :
- Store scheduled tasks created by agents
- Track task status and execution history
- Enable task management (list, update, cancel)

**Indexes** :
- Primary key on `id`
- Index on `next_run` for efficient scheduler polling
- Index on `status` for filtering active tasks

**Schedule types** :
- `cron` : Cron expression (e.g., `0 9 * * *` = daily at 9am)
- `interval` : Milliseconds (e.g., `3600000` = every hour)
- `once` : ISO timestamp (e.g., `2026-02-06T17:00:00Z`)

**Context modes** :
- `isolated` : Task runs in clean context (no conversation history)
- `group` : Task runs with group's conversation history

**Example data** :
```
id           group_folder  chat_jid          prompt                schedule_type  schedule_value  next_run              status
----------------------------------------------------------------------------------------------------------------------------------
task-abc     main          1234567890@g.us   Daily weather         cron           0 9 * * *       2026-02-07T09:00:00Z  active
task-def     family-chat   1234567890@g.us   Remind groceries      once           2026-02-06T17:00 2026-02-06T17:00:00Z paused
```

### Table: task_run_logs

Stores execution history for scheduled tasks.

```sql
CREATE TABLE IF NOT EXISTS task_run_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,          -- Task ID (foreign key to scheduled_tasks)
  run_at TEXT NOT NULL,           -- ISO timestamp of execution
  duration_ms INTEGER NOT NULL,   -- Execution duration in milliseconds
  status TEXT NOT NULL,           -- "success" or "error"
  result TEXT,                    -- Agent output or error message
  error TEXT,                     -- Error details if status=error
  FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
);

CREATE INDEX IF NOT EXISTS idx_task_run_logs ON task_run_logs(task_id, run_at);
```

**Purpose** :
- Track task execution history
- Debug failed tasks
- Monitor task performance

**Indexes** :
- Primary key on `id` (auto-increment)
- Index on `(task_id, run_at)` for efficient task history queries

**Example data** :
```
id  task_id   run_at                duration_ms  status   result                    error
-----------------------------------------------------------------------------------------
1   task-abc  2026-02-06T09:00:00Z  5432         success  "Weather: sunny, 22°C"    null
2   task-abc  2026-02-07T09:00:00Z  6123         success  "Weather: cloudy, 18°C"   null
3   task-def  2026-02-06T17:00:00Z  1234         error    null                      "Container timeout"
```

## Database Operations

### Initialization

```typescript
// src/db.ts
import Database from 'better-sqlite3';

let db: Database.Database;

export function initDatabase(): void {
  const dbPath = path.join(STORE_DIR, 'messages.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);

  // Create tables and indexes
  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (...);
    CREATE TABLE IF NOT EXISTS messages (...);
    CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp);
    CREATE TABLE IF NOT EXISTS scheduled_tasks (...);
    CREATE INDEX IF NOT EXISTS idx_next_run ON scheduled_tasks(next_run);
    CREATE TABLE IF NOT EXISTS task_run_logs (...);
    CREATE INDEX IF NOT EXISTS idx_task_run_logs ON task_run_logs(task_id, run_at);
  `);

  // Migrations for existing databases
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN sender_name TEXT`);
  } catch {
    // Column already exists
  }

  try {
    db.exec(`ALTER TABLE scheduled_tasks ADD COLUMN context_mode TEXT DEFAULT 'isolated'`);
  } catch {
    // Column already exists
  }
}
```

### Chat Operations

#### Store Chat Metadata

```typescript
export function storeChatMetadata(
  chatJid: string,
  timestamp: string,
  name?: string
): void {
  if (name) {
    // Update with name, preserving existing timestamp if newer
    db.prepare(`
      INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        name = excluded.name,
        last_message_time = MAX(last_message_time, excluded.last_message_time)
    `).run(chatJid, name, timestamp);
  } else {
    // Update timestamp only, preserve existing name
    db.prepare(`
      INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        last_message_time = MAX(last_message_time, excluded.last_message_time)
    `).run(chatJid, chatJid, timestamp);
  }
}
```

#### Get All Chats

```typescript
export interface ChatInfo {
  jid: string;
  name: string;
  last_message_time: string;
}

export function getAllChats(): ChatInfo[] {
  return db.prepare(`
    SELECT jid, name, last_message_time
    FROM chats
    ORDER BY last_message_time DESC
  `).all() as ChatInfo[];
}
```

### Message Operations

#### Store Message

```typescript
export function storeMessage(msg: NewMessage): void {
  db.prepare(`
    INSERT OR REPLACE INTO messages
    (id, chat_jid, sender, sender_name, content, timestamp, is_from_me)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    msg.id,
    msg.chat_jid,
    msg.sender,
    msg.sender_name || null,
    msg.content,
    msg.timestamp,
    msg.is_from_me
  );
}
```

#### Get Messages Since Timestamp

```typescript
export function getMessagesSince(
  chatJid: string,
  since: string
): Message[] {
  return db.prepare(`
    SELECT *
    FROM messages
    WHERE chat_jid = ? AND timestamp > ?
    ORDER BY timestamp ASC
  `).all(chatJid, since) as Message[];
}
```

#### Get Recent Messages (Conversation Catch-Up)

```typescript
export function getRecentMessages(
  chatJid: string,
  limit: number = 50
): Message[] {
  return db.prepare(`
    SELECT *
    FROM messages
    WHERE chat_jid = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(chatJid, limit).reverse() as Message[];
}
```

### Task Operations

#### Insert Task

```typescript
export function insertTask(task: ScheduledTask): void {
  db.prepare(`
    INSERT INTO scheduled_tasks
    (id, group_folder, chat_jid, prompt, schedule_type, schedule_value,
     next_run, status, context_mode, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    task.id,
    task.group_folder,
    task.chat_jid,
    task.prompt,
    task.schedule_type,
    task.schedule_value,
    task.next_run || null,
    task.status || 'active',
    task.context_mode || 'isolated',
    task.created_at
  );
}
```

#### Get Due Tasks

```typescript
export function getDueTasks(): ScheduledTask[] {
  const now = new Date().toISOString();

  return db.prepare(`
    SELECT *
    FROM scheduled_tasks
    WHERE status = 'active' AND next_run <= ?
    ORDER BY next_run ASC
  `).all(now) as ScheduledTask[];
}
```

#### Get All Tasks

```typescript
export function getAllTasks(): ScheduledTask[] {
  return db.prepare(`
    SELECT *
    FROM scheduled_tasks
    ORDER BY created_at DESC
  `).all() as ScheduledTask[];
}
```

#### Get Tasks for Group

```typescript
export function getTasksForGroup(groupFolder: string): ScheduledTask[] {
  return db.prepare(`
    SELECT *
    FROM scheduled_tasks
    WHERE group_folder = ?
    ORDER BY created_at DESC
  `).all(groupFolder) as ScheduledTask[];
}
```

#### Update Task

```typescript
export function updateTask(taskId: string, updates: Partial<ScheduledTask>): void {
  const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = [...Object.values(updates), taskId];

  db.prepare(`
    UPDATE scheduled_tasks
    SET ${fields}
    WHERE id = ?
  `).run(...values);
}
```

#### Update Task Next Run

```typescript
export function updateTaskNextRun(taskId: string, nextRun: string | null): void {
  db.prepare(`
    UPDATE scheduled_tasks
    SET next_run = ?
    WHERE id = ?
  `).run(nextRun, taskId);
}
```

#### Delete Task

```typescript
export function deleteTask(taskId: string): void {
  db.prepare(`DELETE FROM scheduled_tasks WHERE id = ?`).run(taskId);
}
```

### Task Run Log Operations

#### Insert Run Log

```typescript
export function insertTaskRunLog(log: TaskRunLog): void {
  db.prepare(`
    INSERT INTO task_run_logs
    (task_id, run_at, duration_ms, status, result, error)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    log.task_id,
    log.run_at,
    log.duration_ms,
    log.status,
    log.result || null,
    log.error || null
  );
}
```

#### Get Run History

```typescript
export function getTaskRunHistory(
  taskId: string,
  limit: number = 10
): TaskRunLog[] {
  return db.prepare(`
    SELECT *
    FROM task_run_logs
    WHERE task_id = ?
    ORDER BY run_at DESC
    LIMIT ?
  `).all(taskId, limit) as TaskRunLog[];
}
```

## Migrations

### Adding New Columns

When adding columns to existing tables, use `ALTER TABLE` with error handling:

```typescript
try {
  db.exec(`ALTER TABLE messages ADD COLUMN sender_name TEXT`);
  logger.info('Added sender_name column to messages table');
} catch {
  // Column already exists, ignore
}
```

### Renaming Tables

Use `ALTER TABLE RENAME` :

```typescript
db.exec(`ALTER TABLE old_table_name RENAME TO new_table_name`);
```

### Data Transformations

Use transactions for complex migrations:

```typescript
db.transaction(() => {
  // Create new table with updated schema
  db.exec(`CREATE TABLE messages_new (...)`);

  // Copy data with transformations
  db.exec(`INSERT INTO messages_new SELECT ... FROM messages`);

  // Drop old table
  db.exec(`DROP TABLE messages`);

  // Rename new table
  db.exec(`ALTER TABLE messages_new RENAME TO messages`);
})();
```

## Performance Considerations

### Indexes

**Current indexes** :
- `messages(timestamp)` : For time-based queries
- `scheduled_tasks(next_run)` : For scheduler polling
- `scheduled_tasks(status)` : For filtering active tasks
- `task_run_logs(task_id, run_at)` : For task history

**Future indexes** (if needed) :
- `messages(chat_jid, timestamp)` : Composite index for faster conversation queries
- `messages(is_from_me)` : Filter by sender type

### Query Optimization

**Use prepared statements** :
```typescript
// Good (compiled once, reused)
const stmt = db.prepare('SELECT * FROM messages WHERE chat_jid = ?');
for (const jid of jids) {
  stmt.all(jid);
}

// Bad (compiled every time)
for (const jid of jids) {
  db.prepare('SELECT * FROM messages WHERE chat_jid = ?').all(jid);
}
```

**Use transactions for bulk operations** :
```typescript
const insertStmt = db.prepare('INSERT INTO messages (...) VALUES (...)');

db.transaction(() => {
  for (const msg of messages) {
    insertStmt.run(...msg);
  }
})();
```

### Database Size

**Growth rate** :
- Messages: ~200 bytes per message
- Tasks: ~500 bytes per task
- Run logs: ~300 bytes per log

**Example** : 10,000 messages/day = ~2 MB/day

**Cleanup strategy** :
- Delete old messages (> 30 days)
- Archive old run logs
- Vacuum database periodically

```typescript
// Delete messages older than 30 days
const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
db.prepare(`DELETE FROM messages WHERE timestamp < ?`).run(thirtyDaysAgo);

// Vacuum to reclaim space
db.exec('VACUUM');
```

## Backup & Recovery

### Backup

```typescript
// Create backup
const backup = db.backup('store/messages-backup.db');
await backup.run();
backup.close();
```

```bash
# Manual backup
cp store/messages.db store/messages-$(date +%Y%m%d).db
```

### Recovery

```bash
# Restore from backup
cp store/messages-20260206.db store/messages.db
```

### Automated Backups

```typescript
// Daily backup via scheduled task
cron.schedule('0 2 * * *', () => {
  const timestamp = new Date().toISOString().split('T')[0];
  const backupPath = `store/backups/messages-${timestamp}.db`;
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });

  const backup = db.backup(backupPath);
  backup.run().then(() => {
    logger.info({ backupPath }, 'Database backup completed');
  });
});
```

## Debugging

### Enable Query Logging

```typescript
// Log all queries
db.prepare = new Proxy(db.prepare, {
  apply(target, thisArg, args) {
    logger.debug({ sql: args[0] }, 'SQL query');
    return Reflect.apply(target, thisArg, args);
  }
});
```

### Inspect Database

```bash
# Open database in SQLite CLI
sqlite3 store/messages.db

# List tables
.tables

# Describe table schema
.schema messages

# Query data
SELECT * FROM messages LIMIT 10;

# Exit
.quit
```

### Analyze Query Performance

```sql
-- Enable query plan
EXPLAIN QUERY PLAN SELECT * FROM messages WHERE chat_jid = ?;

-- Analyze table statistics
ANALYZE;
```

## Best Practices

1. **Use prepared statements** : Prevents SQL injection, improves performance
2. **Use transactions** : Ensures atomicity for multi-step operations
3. **Index frequently queried columns** : Speeds up queries
4. **Clean up old data** : Prevents unbounded growth
5. **Backup regularly** : Automated daily backups
6. **Handle errors gracefully** : Use try-catch for migrations
7. **Log database operations** : Debug issues in production

## Future Enhancements

### Pagination

Add pagination for large result sets:

```typescript
export function getMessagesPaginated(
  chatJid: string,
  limit: number = 50,
  offset: number = 0
): { messages: Message[], total: number } {
  const messages = db.prepare(`
    SELECT * FROM messages
    WHERE chat_jid = ?
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `).all(chatJid, limit, offset) as Message[];

  const total = db.prepare(`
    SELECT COUNT(*) as count
    FROM messages
    WHERE chat_jid = ?
  `).get(chatJid) as { count: number };

  return { messages, total: total.count };
}
```

### Full-Text Search

Add FTS5 virtual table for message search:

```sql
CREATE VIRTUAL TABLE messages_fts USING fts5(
  content,
  chat_jid UNINDEXED,
  timestamp UNINDEXED
);

-- Populate FTS table
INSERT INTO messages_fts SELECT content, chat_jid, timestamp FROM messages;

-- Search
SELECT * FROM messages_fts WHERE messages_fts MATCH 'weather' ORDER BY rank;
```

### WAL Mode

Enable Write-Ahead Logging for better concurrency:

```typescript
db.pragma('journal_mode = WAL');
```

**Benefits** :
- Readers don't block writers
- Better performance for concurrent access

**Trade-offs** :
- Slightly more disk usage
- More complex recovery

## Resources

- [better-sqlite3 Documentation](https://github.com/WiseLibs/better-sqlite3)
- [SQLite Documentation](https://www.sqlite.org/docs.html)
- [SQLite Performance Tuning](https://www.sqlite.org/optoverview.html)
- [FTS5 Full-Text Search](https://www.sqlite.org/fts5.html)
- [WAL Mode](https://www.sqlite.org/wal.html)
