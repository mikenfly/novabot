import path from 'path';

export const ASSISTANT_NAME = process.env.ASSISTANT_NAME || 'Jimmy';
export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;

// Absolute paths needed for container mounts
const PROJECT_ROOT = process.cwd();
const HOME_DIR = process.env.HOME || '/Users/user';

// Mount security: allowlist stored OUTSIDE project root, never mounted into containers
export const MOUNT_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  '.config',
  'nanoclaw',
  'mount-allowlist.json',
);
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
export const MAIN_GROUP_FOLDER = 'main';

export const CONTAINER_IMAGE =
  process.env.CONTAINER_IMAGE || 'nanoclaw-agent:latest';
export const CONTAINER_TIMEOUT = parseInt(
  process.env.CONTAINER_TIMEOUT || '300000',
  10,
);
export const CONTAINER_MAX_OUTPUT_SIZE = parseInt(
  process.env.CONTAINER_MAX_OUTPUT_SIZE || '10485760',
  10,
); // 10MB default
export const IPC_POLL_INTERVAL = 1000;

// Persistent container settings
export const CONTAINER_IDLE_TIMEOUT = parseInt(
  process.env.CONTAINER_IDLE_TIMEOUT || '300000',
  10,
); // 5 min default
export const CONTAINER_IPC_POLL_INTERVAL = 300; // 300ms for inbox/outbox polling

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const TRIGGER_PATTERN = new RegExp(
  `^@${escapeRegex(ASSISTANT_NAME)}\\b`,
  'i',
);

// Timezone for scheduled tasks (cron expressions, etc.)
// Uses system timezone by default
export const TIMEZONE =
  process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

// Web server port for PWA
export const WEB_PORT = parseInt(process.env.WEB_PORT || '17283', 10);

// Memory system
export const MEMORY_DIR = path.resolve(PROJECT_ROOT, 'memory');
export const MEMORY_DB_PATH = path.join(MEMORY_DIR, 'memory.db');

// RAG agent (agentic pre-search before context agent)
export const RAG_MODEL = process.env.RAG_MODEL || 'claude-sonnet-4-5-20250929';
export const RAG_ENABLED = process.env.RAG_ENABLED !== 'false'; // true by default
export const RAG_TIMEOUT = parseInt(process.env.RAG_TIMEOUT || '60000', 10); // 60s
export const RAG_RECENT_EXCHANGES_BUFFER = 20; // global circular buffer size
export const RAG_RECENT_EXCHANGES_PER_CONV = 10; // filtered per-conversation for RAG agent
