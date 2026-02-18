# IPC - Inter-Process Communication

## Overview

NovaBot uses file-based IPC to enable communication between containerized agents and the host process. This allows agents to perform privileged operations (send messages, schedule tasks, manage groups) while maintaining security through authorization checks.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│              CONTAINER (Agent)                           │
│                                                          │
│  Claude Agent SDK                                        │
│       │                                                  │
│       ▼                                                  │
│  MCP Server (ipc-mcp.ts)                                │
│       │                                                  │
│       ▼                                                  │
│  Write JSON file → /workspace/ipc/                       │
│  Read snapshots ← /workspace/ipc/                        │
│                                                          │
└────────────┬─────────────────────────────────────────────┘
             │ (file-based IPC)
             │
┌────────────▼─────────────────────────────────────────────┐
│              HOST PROCESS                                 │
│                                                          │
│  IPC Watcher (polls /data/ipc/*)                         │
│       │                                                  │
│       ▼                                                  │
│  Authorization Check (verify group identity)             │
│       │                                                  │
│       ▼                                                  │
│  Execute Operation:                                      │
│    • Send WhatsApp message                               │
│    • Schedule/update/cancel task                         │
│    • Register/unregister group                           │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

## IPC Namespace

Each group has an isolated IPC directory:

```
data/ipc/
├── main/                           # Main group IPC
│   ├── messages/
│   │   └── 1234567890.json         # Outgoing messages
│   ├── tasks/
│   │   ├── schedule-abc123.json    # Schedule task
│   │   ├── update-def456.json      # Update task
│   │   └── cancel-ghi789.json      # Cancel task
│   ├── groups/
│   │   ├── register-xyz.json       # Register group
│   │   └── unregister-xyz.json     # Unregister group
│   ├── current_tasks.json          # Snapshot (all tasks)
│   └── available_groups.json       # Snapshot (all groups)
│
└── family-chat/                    # Non-main group IPC
    ├── messages/
    │   └── 1234567890.json         # Own chat only
    ├── tasks/
    │   └── schedule-abc123.json    # Own tasks only
    ├── current_tasks.json          # Snapshot (own tasks only)
    └── available_groups.json       # Snapshot (empty)
```

**Key principle** : A group can only read/write to its own IPC directory. The host validates the source before executing operations.

## Message Types

### 1. Send Message

**Purpose** : Send a WhatsApp message to a chat

**Written by** : Container (via MCP tool `send_message`)

**File location** : `data/ipc/{group}/messages/{timestamp}.json`

**Structure** :
```json
{
  "type": "send_message",
  "chatJid": "1234567890@g.us",
  "message": "Hello from agent!",
  "groupFolder": "main"
}
```

**Authorization** :
- Main group: Can send to any chat
- Non-main groups: Can only send to own chat (chatJid matches registration)

**Processing** :
```typescript
// src/index.ts (IPC watcher)
async function processIpcMessage(filePath: string, content: any) {
  const { type, chatJid, message, groupFolder } = content;

  // Verify authorization
  const group = registeredGroups[chatJid];
  if (!group) {
    logger.warn({ chatJid }, 'Message for unregistered group');
    return;
  }

  if (groupFolder !== 'main' && group.folder !== groupFolder) {
    logger.warn({ chatJid, groupFolder }, 'Unauthorized send_message attempt');
    return;
  }

  // Send message
  await sock.sendMessage(chatJid, { text: message });

  // Delete IPC file
  fs.unlinkSync(filePath);
}
```

### 2. Schedule Task

**Purpose** : Create a new scheduled task

**Written by** : Container (via MCP tool `schedule_task`)

**File location** : `data/ipc/{group}/tasks/schedule-{uuid}.json`

**Structure** :
```json
{
  "type": "schedule_task",
  "prompt": "Send a daily weather report",
  "schedule_type": "cron",
  "schedule_value": "0 9 * * *",
  "context_mode": "isolated",
  "groupFolder": "main",
  "chatJid": "1234567890@g.us"
}
```

**Schedule types** :
- `cron` : Cron expression (e.g., `0 9 * * *` = 9am daily)
- `interval` : Milliseconds (e.g., `3600000` = every hour)
- `once` : ISO timestamp (e.g., `2026-02-06T17:00:00Z`)

**Context modes** :
- `isolated` : Task runs in clean context (no conversation history)
- `group` : Task runs with group's conversation history

**Authorization** :
- Main group: Can schedule tasks for any group
- Non-main groups: Can only schedule tasks for own group

**Processing** :
```typescript
// src/index.ts (IPC watcher)
async function processIpcTask(filePath: string, content: any) {
  const { type, groupFolder, chatJid, ...taskData } = content;

  // Verify authorization
  const group = registeredGroups[chatJid];
  if (!group) return;

  if (groupFolder !== 'main' && group.folder !== groupFolder) {
    logger.warn({ groupFolder }, 'Unauthorized schedule_task attempt');
    return;
  }

  // Create task in database
  const taskId = crypto.randomUUID();
  insertTask({
    id: taskId,
    group_folder: group.folder,
    chat_jid: chatJid,
    ...taskData,
    status: 'active',
    created_at: new Date().toISOString()
  });

  // Calculate next run
  const nextRun = calculateNextRun(taskData.schedule_type, taskData.schedule_value);
  updateTaskNextRun(taskId, nextRun);

  fs.unlinkSync(filePath);
}
```

### 3. Update Task

**Purpose** : Modify existing task (prompt, schedule, status)

**Written by** : Container (via MCP tool `update_task`)

**File location** : `data/ipc/{group}/tasks/update-{uuid}.json`

**Structure** :
```json
{
  "type": "update_task",
  "taskId": "task-abc123",
  "updates": {
    "prompt": "New prompt",
    "schedule_value": "0 10 * * *",
    "status": "paused"
  },
  "groupFolder": "family-chat"
}
```

**Authorization** :
- Main group: Can update any task
- Non-main groups: Can only update own tasks

**Processing** :
```typescript
async function processIpcTaskUpdate(filePath: string, content: any) {
  const { taskId, updates, groupFolder } = content;

  const task = getTask(taskId);
  if (!task) return;

  // Verify authorization
  if (groupFolder !== 'main' && task.group_folder !== groupFolder) {
    logger.warn({ taskId, groupFolder }, 'Unauthorized update_task attempt');
    return;
  }

  // Update task
  updateTask(taskId, updates);

  // Recalculate next_run if schedule changed
  if (updates.schedule_value || updates.schedule_type) {
    const nextRun = calculateNextRun(
      updates.schedule_type || task.schedule_type,
      updates.schedule_value || task.schedule_value
    );
    updateTaskNextRun(taskId, nextRun);
  }

  fs.unlinkSync(filePath);
}
```

### 4. Cancel Task

**Purpose** : Delete a scheduled task

**Written by** : Container (via MCP tool `cancel_task`)

**File location** : `data/ipc/{group}/tasks/cancel-{uuid}.json`

**Structure** :
```json
{
  "type": "cancel_task",
  "taskId": "task-abc123",
  "groupFolder": "family-chat"
}
```

**Authorization** : Same as update_task

**Processing** :
```typescript
async function processIpcTaskCancel(filePath: string, content: any) {
  const { taskId, groupFolder } = content;

  const task = getTask(taskId);
  if (!task) return;

  if (groupFolder !== 'main' && task.group_folder !== groupFolder) {
    logger.warn({ taskId, groupFolder }, 'Unauthorized cancel_task attempt');
    return;
  }

  deleteTask(taskId);
  fs.unlinkSync(filePath);
}
```

### 5. Register Group (Main Only)

**Purpose** : Register a new WhatsApp group

**Written by** : Container (via MCP tool `register_group` - main only)

**File location** : `data/ipc/main/groups/register-{uuid}.json`

**Structure** :
```json
{
  "type": "register_group",
  "jid": "1234567890@g.us",
  "name": "Family Chat",
  "folder": "family-chat",
  "trigger": "@Nova",
  "groupFolder": "main"
}
```

**Authorization** : Main group only

**Processing** :
```typescript
async function processIpcGroupRegister(filePath: string, content: any) {
  const { jid, name, folder, trigger, groupFolder } = content;

  // Verify main group
  if (groupFolder !== 'main') {
    logger.warn({ groupFolder }, 'Unauthorized register_group attempt');
    return;
  }

  // Create group folder
  const groupPath = path.join(GROUPS_DIR, folder);
  fs.mkdirSync(groupPath, { recursive: true });

  // Add to registered groups
  registeredGroups[jid] = {
    name,
    folder,
    trigger,
    added_at: new Date().toISOString()
  };

  saveRegisteredGroups();
  fs.unlinkSync(filePath);
}
```

### 6. Unregister Group (Main Only)

**Purpose** : Unregister a WhatsApp group

**Written by** : Container (via MCP tool `unregister_group` - main only)

**File location** : `data/ipc/main/groups/unregister-{uuid}.json`

**Structure** :
```json
{
  "type": "unregister_group",
  "jid": "1234567890@g.us",
  "groupFolder": "main"
}
```

**Authorization** : Main group only

**Processing** :
```typescript
async function processIpcGroupUnregister(filePath: string, content: any) {
  const { jid, groupFolder } = content;

  if (groupFolder !== 'main') {
    logger.warn({ groupFolder }, 'Unauthorized unregister_group attempt');
    return;
  }

  delete registeredGroups[jid];
  saveRegisteredGroups();
  fs.unlinkSync(filePath);
}
```

## Snapshots

Snapshots are JSON files written by the host and read by containers. They provide a view of system state to the agent.

### current_tasks.json

**Purpose** : List of tasks visible to the agent

**Updated by** : Host (before spawning container)

**Location** : `data/ipc/{group}/current_tasks.json`

**Content** :
```json
[
  {
    "id": "task-abc123",
    "groupFolder": "main",
    "prompt": "Daily weather report",
    "schedule_type": "cron",
    "schedule_value": "0 9 * * *",
    "status": "active",
    "next_run": "2026-02-07T09:00:00Z"
  }
]
```

**Filtering** :
- Main group: Sees all tasks
- Non-main groups: Sees only own tasks

**Implementation** :
```typescript
// src/container-runner.ts
export function writeTasksSnapshot(
  groupFolder: string,
  isMain: boolean,
  tasks: Task[]
): void {
  const groupIpcDir = path.join(DATA_DIR, 'ipc', groupFolder);
  fs.mkdirSync(groupIpcDir, { recursive: true });

  // Filter tasks based on privilege
  const filteredTasks = isMain
    ? tasks
    : tasks.filter(t => t.groupFolder === groupFolder);

  const tasksFile = path.join(groupIpcDir, 'current_tasks.json');
  fs.writeFileSync(tasksFile, JSON.stringify(filteredTasks, null, 2));
}
```

### available_groups.json

**Purpose** : List of WhatsApp groups available for activation

**Updated by** : Host (before spawning container)

**Location** : `data/ipc/{group}/available_groups.json`

**Content** :
```json
{
  "groups": [
    {
      "jid": "1234567890@g.us",
      "name": "Family Chat",
      "lastActivity": "2026-02-06T12:34:56Z",
      "isRegistered": false
    }
  ],
  "lastSync": "2026-02-06T12:35:00Z"
}
```

**Filtering** :
- Main group: Sees all groups
- Non-main groups: Empty (cannot activate groups)

**Implementation** :
```typescript
// src/container-runner.ts
export function writeGroupsSnapshot(
  groupFolder: string,
  isMain: boolean,
  groups: AvailableGroup[],
  registeredJids: Set<string>
): void {
  const groupIpcDir = path.join(DATA_DIR, 'ipc', groupFolder);
  fs.mkdirSync(groupIpcDir, { recursive: true });

  // Main sees all groups; others see nothing
  const visibleGroups = isMain ? groups : [];

  const groupsFile = path.join(groupIpcDir, 'available_groups.json');
  fs.writeFileSync(groupsFile, JSON.stringify({
    groups: visibleGroups,
    lastSync: new Date().toISOString()
  }, null, 2));
}
```

## MCP Server Implementation

The containerized agent uses an MCP server to expose IPC tools:

```typescript
// container/agent-runner/src/ipc-mcp.ts
import { MCPServer } from '@anthropic-ai/mcp-server';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const IPC_DIR = '/workspace/ipc';
const GROUP_FOLDER = process.env.GROUP_FOLDER || 'unknown';
const IS_MAIN = process.env.IS_MAIN === 'true';

export function createIpcMcpServer(): MCPServer {
  const server = new MCPServer({
    name: 'novabot',
    version: '1.0.0'
  });

  // Tool: send_message
  server.tool('send_message', {
    description: 'Send a message to the current chat',
    parameters: {
      message: { type: 'string', required: true }
    }
  }, async ({ message }) => {
    const filename = `${Date.now()}.json`;
    const filepath = path.join(IPC_DIR, 'messages', filename);

    fs.writeFileSync(filepath, JSON.stringify({
      type: 'send_message',
      chatJid: process.env.CHAT_JID,
      message,
      groupFolder: GROUP_FOLDER
    }));

    return { success: true };
  });

  // Tool: schedule_task
  server.tool('schedule_task', {
    description: 'Schedule a recurring or one-time task',
    parameters: {
      prompt: { type: 'string', required: true },
      schedule_type: { type: 'string', enum: ['cron', 'interval', 'once'], required: true },
      schedule_value: { type: 'string', required: true },
      context_mode: { type: 'string', enum: ['isolated', 'group'], default: 'isolated' }
    }
  }, async (params) => {
    const filename = `schedule-${crypto.randomUUID()}.json`;
    const filepath = path.join(IPC_DIR, 'tasks', filename);

    fs.writeFileSync(filepath, JSON.stringify({
      type: 'schedule_task',
      ...params,
      groupFolder: GROUP_FOLDER,
      chatJid: process.env.CHAT_JID
    }));

    return { success: true, message: 'Task scheduled' };
  });

  // Tool: list_tasks (reads snapshot)
  server.tool('list_tasks', {
    description: 'List all scheduled tasks'
  }, async () => {
    const tasksFile = path.join(IPC_DIR, 'current_tasks.json');

    if (!fs.existsSync(tasksFile)) {
      return { tasks: [] };
    }

    const tasks = JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));
    return { tasks };
  });

  // Main-only tools
  if (IS_MAIN) {
    server.tool('register_group', {
      description: 'Register a new WhatsApp group',
      parameters: {
        jid: { type: 'string', required: true },
        name: { type: 'string', required: true },
        folder: { type: 'string', required: true },
        trigger: { type: 'string', required: true }
      }
    }, async (params) => {
      const filename = `register-${crypto.randomUUID()}.json`;
      const filepath = path.join(IPC_DIR, 'groups', filename);

      fs.writeFileSync(filepath, JSON.stringify({
        type: 'register_group',
        ...params,
        groupFolder: GROUP_FOLDER
      }));

      return { success: true };
    });
  }

  return server;
}
```

## IPC Watcher

The host process polls IPC directories for new files:

```typescript
// src/index.ts
function startIpcWatcher() {
  setInterval(() => {
    for (const [chatJid, group] of Object.entries(registeredGroups)) {
      const ipcDir = path.join(DATA_DIR, 'ipc', group.folder);

      // Process messages
      const messagesDir = path.join(ipcDir, 'messages');
      if (fs.existsSync(messagesDir)) {
        for (const file of fs.readdirSync(messagesDir)) {
          const filepath = path.join(messagesDir, file);
          const content = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
          processIpcMessage(filepath, content);
        }
      }

      // Process tasks
      const tasksDir = path.join(ipcDir, 'tasks');
      if (fs.existsSync(tasksDir)) {
        for (const file of fs.readdirSync(tasksDir)) {
          const filepath = path.join(tasksDir, file);
          const content = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
          processIpcTask(filepath, content);
        }
      }

      // Process groups (main only)
      if (group.folder === 'main') {
        const groupsDir = path.join(ipcDir, 'groups');
        if (fs.existsSync(groupsDir)) {
          for (const file of fs.readdirSync(groupsDir)) {
            const filepath = path.join(groupsDir, file);
            const content = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
            processIpcGroup(filepath, content);
          }
        }
      }
    }
  }, IPC_POLL_INTERVAL); // Default: 1 second
}
```

## Security Considerations

### Namespace Isolation

**Problem** : Agent could write to another group's IPC directory.

**Solution** : Each group only has access to its own IPC directory via mount:
```typescript
{
  hostPath: '/home/user/novabot/data/ipc/family-chat',
  containerPath: '/workspace/ipc',
  readonly: false
}
```

Agent cannot access `/home/user/novabot/data/ipc/main/` because it's not mounted.

### Path Traversal

**Problem** : Agent could use `..` to escape IPC directory.

**Solution** : Container filesystem isolation prevents access to unmounted paths.

**Example attack (prevented)** :
```typescript
// Agent tries to write to main's IPC
fs.writeFileSync('../main/tasks/evil.json', '...');
// Error: ENOENT (parent directory not accessible)
```

### Authorization Bypass

**Problem** : Agent could lie about its identity in IPC messages.

**Solution** : Host verifies group identity before executing operations:
```typescript
const { groupFolder, chatJid } = ipcMessage;

// Verify the IPC file came from the claimed group
const expectedIpcDir = path.join(DATA_DIR, 'ipc', groupFolder);
if (!filepath.startsWith(expectedIpcDir)) {
  logger.warn('IPC file from unexpected location');
  return;
}

// Verify the group has permission for the operation
const group = registeredGroups[chatJid];
if (group.folder !== groupFolder && groupFolder !== 'main') {
  logger.warn('Unauthorized operation attempt');
  return;
}
```

### Race Conditions

**Problem** : Host could process IPC file while agent is still writing.

**Solution** : Atomic write via rename:
```typescript
// Agent writes to temp file first
const tempFile = filepath + '.tmp';
fs.writeFileSync(tempFile, JSON.stringify(data));

// Then renames (atomic operation)
fs.renameSync(tempFile, filepath);
```

**Alternative** : Write complete JSON, read is atomic (current implementation).

## Performance

### Polling Interval

**Default** : 1 second (IPC_POLL_INTERVAL)

**Trade-offs** :
- Faster polling = lower latency, higher CPU usage
- Slower polling = higher latency, lower CPU usage

**Recommendation** : 1 second is reasonable for most use cases.

### File Operations

**Cost** : `readdir` + `readFile` + `JSON.parse` per IPC directory per interval

**Optimization ideas** :
- Use `fs.watch()` instead of polling (more complex)
- Batch multiple IPC files in single message
- Use binary format instead of JSON

## Debugging

### Enable IPC Logging

```typescript
// src/index.ts
logger.debug({ filepath, content }, 'Processing IPC message');
```

### Inspect IPC Files

```bash
# View pending IPC operations
ls -la data/ipc/main/messages/
ls -la data/ipc/main/tasks/

# Read IPC file
cat data/ipc/main/messages/1234567890.json
```

### Container Logs

Container logs show IPC operations:
```
groups/main/logs/container-2026-02-06T12-34-56.log
```

## Future Enhancements

### IPC Protocol Versioning

Add version field to enable protocol changes:
```json
{
  "version": 1,
  "type": "send_message",
  ...
}
```

### Binary IPC

Use binary format for performance:
- Protobuf
- MessagePack
- CBOR

### WebSocket IPC

Replace file-based IPC with WebSocket for lower latency:
- Agent connects to host via WebSocket
- Real-time bidirectional communication
- Requires persistent containers

### IPC Encryption

Encrypt IPC messages to prevent tampering:
- Sign messages with HMAC
- Encrypt with AES
- Verify signature before processing

## Resources

- [Unix Domain Sockets](https://en.wikipedia.org/wiki/Unix_domain_socket)
- [Named Pipes (FIFO)](https://man7.org/linux/man-pages/man7/fifo.7.html)
- [File-based IPC Patterns](https://en.wikipedia.org/wiki/Inter-process_communication#File)
- [MCP Protocol Spec](https://github.com/anthropics/mcp)
