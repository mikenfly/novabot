import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  DATA_DIR,
  IPC_POLL_INTERVAL,
  MAIN_GROUP_FOLDER,
  TIMEZONE,
  WEB_PORT,
} from './config.js';
import { initializeAuth, ensureAccessToken } from './auth.js';
import { startWebServer } from './web-server.js';
import { startCloudflareTunnel, stopCloudflareTunnel } from './cloudflare-tunnel.js';
import { containerManager } from './pwa-channel.js';
import { initDatabase, createTask, updateTask, deleteTask, getTaskById, getAllTasks } from './db.js';
import { initContextAgent, shutdownContextAgent } from './memory/context-agent.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { logger } from './logger.js';

function ensureContainerSystemRunning(): void {
  // Try Docker first (cross-platform)
  try {
    execSync('docker info', { stdio: 'pipe' });
    logger.debug('Docker is running');
    return;
  } catch {
    // Docker not available, try Apple Container (macOS only)
    try {
      execSync('container system status', { stdio: 'pipe' });
      logger.debug('Apple Container system already running');
      return;
    } catch {
      logger.info('Starting Apple Container system...');
      try {
        execSync('container system start', { stdio: 'pipe', timeout: 30000 });
        logger.info('Apple Container system started');
        return;
      } catch (err) {
        logger.error({ err }, 'Failed to start container runtime');
        console.error(
          '\n╔════════════════════════════════════════════════════════════════╗',
        );
        console.error(
          '║  FATAL: No container runtime available                        ║',
        );
        console.error(
          '║                                                                ║',
        );
        console.error(
          '║  NovaBot requires Docker or Apple Container. To fix:          ║',
        );
        console.error(
          '║  - Install Docker: https://docs.docker.com/get-docker/        ║',
        );
        console.error(
          '║  - Or Apple Container: github.com/apple/container/releases    ║',
        );
        console.error(
          '╚════════════════════════════════════════════════════════════════╝\n',
        );
        throw new Error('Container runtime is required but not available');
      }
    }
  }
}

// Clean up stale containers from previous runs
function cleanupStaleContainers(): void {
  try {
    const output = execSync('docker ps -a --filter "name=novabot-pwa-" --format "{{.Names}}"', {
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
      timeout: 5000,
    });
    const stale = output.split('\n').map(n => n.trim()).filter(n => n);
    if (stale.length > 0) {
      execSync(`docker rm -f ${stale.join(' ')}`, { stdio: 'pipe', timeout: 10000 });
      logger.info({ count: stale.length }, 'Cleaned up stale PWA containers');
    }
  } catch {
    // Docker not available or no stale containers — ignore
  }
}

function startIpcWatcher(): void {
  const ipcBaseDir = path.join(DATA_DIR, 'ipc');
  fs.mkdirSync(ipcBaseDir, { recursive: true });

  const processIpcFiles = async () => {
    let groupFolders: string[];
    try {
      groupFolders = fs.readdirSync(ipcBaseDir).filter((f) => {
        const stat = fs.statSync(path.join(ipcBaseDir, f));
        return stat.isDirectory() && f !== 'errors';
      });
    } catch (err) {
      logger.error({ err }, 'Error reading IPC base directory');
      setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
      return;
    }

    for (const sourceGroup of groupFolders) {
      const tasksDir = path.join(ipcBaseDir, sourceGroup, 'tasks');

      // Process tasks from this group's IPC directory
      try {
        if (fs.existsSync(tasksDir)) {
          const taskFiles = fs
            .readdirSync(tasksDir)
            .filter((f) => f.endsWith('.json'));
          for (const file of taskFiles) {
            const filePath = path.join(tasksDir, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              await processTaskIpc(data, sourceGroup);
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error(
                { file, sourceGroup, err },
                'Error processing IPC task',
              );
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              fs.renameSync(
                filePath,
                path.join(errorDir, `${sourceGroup}-${file}`),
              );
            }
          }
        }
      } catch (err) {
        logger.error({ err, sourceGroup }, 'Error reading IPC tasks directory');
      }
    }

    setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
  };

  processIpcFiles();
  logger.info('IPC watcher started');
}

async function processTaskIpc(
  data: {
    type: string;
    taskId?: string;
    prompt?: string;
    schedule_type?: string;
    schedule_value?: string;
    context_mode?: string;
    groupFolder?: string;
    chatJid?: string;
  },
  sourceGroup: string,
): Promise<void> {
  const { CronExpressionParser } = await import('cron-parser');

  switch (data.type) {
    case 'schedule_task':
      if (
        data.prompt &&
        data.schedule_type &&
        data.schedule_value &&
        data.groupFolder
      ) {
        const targetGroup = data.groupFolder;
        const scheduleType = data.schedule_type as 'cron' | 'interval' | 'once';

        let nextRun: string | null = null;
        if (scheduleType === 'cron') {
          try {
            const interval = CronExpressionParser.parse(data.schedule_value, {
              tz: TIMEZONE,
            });
            nextRun = interval.next().toISOString();
          } catch {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid cron expression',
            );
            break;
          }
        } else if (scheduleType === 'interval') {
          const ms = parseInt(data.schedule_value, 10);
          if (isNaN(ms) || ms <= 0) {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid interval',
            );
            break;
          }
          nextRun = new Date(Date.now() + ms).toISOString();
        } else if (scheduleType === 'once') {
          const scheduled = new Date(data.schedule_value);
          if (isNaN(scheduled.getTime())) {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid timestamp',
            );
            break;
          }
          nextRun = scheduled.toISOString();
        }

        const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const contextMode =
          data.context_mode === 'group' || data.context_mode === 'isolated'
            ? data.context_mode
            : 'isolated';
        createTask({
          id: taskId,
          group_folder: targetGroup,
          chat_jid: data.chatJid || '',
          prompt: data.prompt,
          schedule_type: scheduleType,
          schedule_value: data.schedule_value,
          context_mode: contextMode,
          next_run: nextRun,
          status: 'active',
          created_at: new Date().toISOString(),
        });
        logger.info(
          { taskId, sourceGroup, targetGroup, contextMode },
          'Task created via IPC',
        );
      }
      break;

    case 'pause_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task) {
          updateTask(data.taskId, { status: 'paused' });
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task paused via IPC',
          );
        }
      }
      break;

    case 'resume_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task) {
          updateTask(data.taskId, { status: 'active' });
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task resumed via IPC',
          );
        }
      }
      break;

    case 'cancel_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task) {
          deleteTask(data.taskId);
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task cancelled via IPC',
          );
        }
      }
      break;

    default:
      logger.warn({ type: data.type }, 'Unknown IPC task type');
  }
}

async function main(): Promise<void> {
  // Handle CLI commands for device management
  const args = process.argv.slice(2);

  if (args.includes('--list-devices')) {
    const { initializeAuth, listDevices } = await import('./auth.js');
    initializeAuth();
    listDevices();
    process.exit(0);
  }

  if (args.includes('--revoke-device')) {
    const tokenOrName = args[args.indexOf('--revoke-device') + 1];
    if (!tokenOrName) {
      console.error('Usage: npm start -- --revoke-device <token-ou-nom>');
      process.exit(1);
    }
    const { initializeAuth, revokeToken } = await import('./auth.js');
    initializeAuth();
    const success = revokeToken(tokenOrName);
    if (success) {
      console.log(`Device "${tokenOrName}" revoked`);
    } else {
      console.error(`Device "${tokenOrName}" not found`);
    }
    process.exit(success ? 0 : 1);
  }

  if (args.includes('--generate-token')) {
    const { initializeAuth, generateTemporaryToken } = await import('./auth.js');
    initializeAuth();
    const token = generateTemporaryToken();
    console.log('\nTemporary token generated (valid 5 min):');
    console.log(`   ${token}\n`);
    process.exit(0);
  }

  console.log('Starting NovaBot...');

  ensureContainerSystemRunning();
  cleanupStaleContainers();
  initDatabase();
  logger.info('Database initialized');
  await initContextAgent();
  logger.info('Context agent initialized');

  // Initialize authentication
  console.log('Initializing authentication...');
  initializeAuth();

  const { getAllTokens } = await import('./auth.js');
  const devices = getAllTokens();
  const hasDevices = devices.length > 0;

  // Start web server
  console.log('Starting web server...');
  startWebServer(WEB_PORT);
  console.log('Web server started');

  // Start Cloudflare Tunnel if configured
  const tunnelHostname = process.env.CLOUDFLARE_TUNNEL_HOSTNAME;
  if (process.env.CLOUDFLARE_TUNNEL_TOKEN) {
    const started = await startCloudflareTunnel(WEB_PORT);
    if (started && tunnelHostname) {
      console.log(`\nPWA accessible at https://${tunnelHostname}\n`);
    } else if (started) {
      console.log(`\nCloudflare Tunnel connected`);
      console.log(`Set CLOUDFLARE_TUNNEL_HOSTNAME in .env\n`);
    }
  }

  if (!hasDevices) {
    console.log('\nFirst start — Device setup...\n');
    const token = ensureAccessToken();
    const baseUrl = tunnelHostname
      ? `https://${tunnelHostname}`
      : `http://localhost:${WEB_PORT}`;
    console.log(`URL: ${baseUrl}`);
    console.log(`Token: ${token}\n`);
  } else {
    console.log(`\nPWA running on http://localhost:${WEB_PORT}`);
    console.log(`${devices.length} device(s) connected\n`);
  }

  // Start background services
  startSchedulerLoop();
  startIpcWatcher();

  console.log('NovaBot ready.');
}

// Graceful shutdown
async function gracefulShutdown(signal: string) {
  logger.info({ signal }, 'Received shutdown signal, stopping...');
  try {
    await shutdownContextAgent();
    await stopCloudflareTunnel();
    await containerManager.shutdownAll();
    logger.info('All services stopped');
  } catch (err) {
    logger.error({ err }, 'Error during shutdown');
  }
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

console.log('Loading modules...');
main().catch((err) => {
  logger.error({ err }, 'Failed to start NovaBot');
  process.exit(1);
});
