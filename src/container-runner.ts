/**
 * Container Runner for NanoClaw
 * Spawns agent execution in Apple Container or Docker and handles IPC
 */
import { ChildProcess, exec, execSync, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  ASSISTANT_NAME,
  CONTAINER_IDLE_TIMEOUT,
  CONTAINER_IMAGE,
  CONTAINER_IPC_POLL_INTERVAL,
  CONTAINER_MAX_OUTPUT_SIZE,
  CONTAINER_TIMEOUT,
  DATA_DIR,
  GROUPS_DIR,
} from './config.js';
import { logger } from './logger.js';
import { validateAdditionalMounts } from './mount-security.js';
import { RegisteredGroup } from './types.js';

// Sentinel markers for robust output parsing (must match agent-runner)
const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';
const STATUS_PREFIX = '---NANOCLAW_STATUS---';

function getHomeDir(): string {
  const home = process.env.HOME || os.homedir();
  if (!home) {
    throw new Error(
      'Unable to determine home directory: HOME environment variable is not set and os.homedir() returned empty',
    );
  }
  return home;
}

function detectContainerRuntime(): 'docker' | 'container' {
  // Try Docker first (cross-platform)
  try {
    execSync('which docker', { stdio: 'pipe' });
    return 'docker';
  } catch {
    // Fall back to Apple Container
    return 'container';
  }
}

export interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  agentName?: string;
}

export interface ContainerOutput {
  status: 'success' | 'error' | 'interrupted';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

interface VolumeMount {
  hostPath: string;
  containerPath: string;
  readonly?: boolean;
}

function buildVolumeMounts(
  group: RegisteredGroup,
  isMain: boolean,
): VolumeMount[] {
  const mounts: VolumeMount[] = [];
  const homeDir = getHomeDir();
  const projectRoot = process.cwd();

  if (isMain) {
    // Main gets the entire project root mounted
    mounts.push({
      hostPath: projectRoot,
      containerPath: '/workspace/project',
      readonly: false,
    });

    // Main also gets its group folder as the working directory
    mounts.push({
      hostPath: path.join(GROUPS_DIR, group.folder),
      containerPath: '/workspace/group',
      readonly: false,
    });
  } else {
    // Other groups only get their own folder
    mounts.push({
      hostPath: path.join(GROUPS_DIR, group.folder),
      containerPath: '/workspace/group',
      readonly: false,
    });

    // Global memory directory (read-only for non-main)
    // Apple Container only supports directory mounts, not file mounts
    const globalDir = path.join(GROUPS_DIR, 'global');
    if (fs.existsSync(globalDir)) {
      mounts.push({
        hostPath: globalDir,
        containerPath: '/workspace/global',
        readonly: true,
      });
    }
  }

  // Per-group Claude sessions directory (isolated from other groups)
  // Each group gets their own .claude/ to prevent cross-group session access
  const groupSessionsDir = path.join(
    DATA_DIR,
    'sessions',
    group.folder,
    '.claude',
  );
  fs.mkdirSync(groupSessionsDir, { recursive: true });
  mounts.push({
    hostPath: groupSessionsDir,
    containerPath: '/home/node/.claude',
    readonly: false,
  });

  // Per-group IPC namespace: each group gets its own IPC directory
  // This prevents cross-group privilege escalation via IPC
  const groupIpcDir = path.join(DATA_DIR, 'ipc', group.folder);
  fs.mkdirSync(path.join(groupIpcDir, 'messages'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'audio'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'inbox'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'outbox'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'control'), { recursive: true });
  mounts.push({
    hostPath: groupIpcDir,
    containerPath: '/workspace/ipc',
    readonly: false,
  });

  // Dev hot reload: mount agent-runner dist/ for live code updates.
  // When the local compiled dist exists, it overrides the code baked into the image.
  // Combined with `npm run dev:agent` (tsc --watch), new containers get
  // the latest code without needing to rebuild the image.
  const agentDistDir = path.join(projectRoot, 'container', 'agent-runner', 'dist');
  if (fs.existsSync(agentDistDir)) {
    mounts.push({
      hostPath: agentDistDir,
      containerPath: '/app/dist',
      readonly: true,
    });
  }

  // Environment file directory (workaround for Apple Container -i env var bug)
  // Only expose specific auth variables needed by Claude Code, not the entire .env
  const envDir = path.join(DATA_DIR, 'env');
  fs.mkdirSync(envDir, { recursive: true });
  const envFile = path.join(projectRoot, '.env');
  if (fs.existsSync(envFile)) {
    const envContent = fs.readFileSync(envFile, 'utf-8');
    const allowedVars = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'MODEL_MAIN'];
    const filteredLines = envContent.split('\n').filter((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return false;
      return allowedVars.some((v) => trimmed.startsWith(`${v}=`));
    });

    if (filteredLines.length > 0) {
      fs.writeFileSync(
        path.join(envDir, 'env'),
        filteredLines.join('\n') + '\n',
      );
      mounts.push({
        hostPath: envDir,
        containerPath: '/workspace/env-dir',
        readonly: true,
      });
    }
  }

  // Additional mounts validated against external allowlist (tamper-proof from containers)
  if (group.containerConfig?.additionalMounts) {
    const validatedMounts = validateAdditionalMounts(
      group.containerConfig.additionalMounts,
      group.name,
      isMain,
    );
    mounts.push(...validatedMounts);
  }

  return mounts;
}

function buildContainerArgs(mounts: VolumeMount[], containerName: string): string[] {
  const args: string[] = ['run', '-i', '--rm', '--name', containerName];

  // Apple Container: --mount for readonly, -v for read-write
  for (const mount of mounts) {
    if (mount.readonly) {
      args.push(
        '--mount',
        `type=bind,source=${mount.hostPath},target=${mount.containerPath},readonly`,
      );
    } else {
      args.push('-v', `${mount.hostPath}:${mount.containerPath}`);
    }
  }

  args.push(CONTAINER_IMAGE);

  return args;
}

export async function runContainerAgent(
  group: RegisteredGroup,
  input: ContainerInput,
  onStatus?: (status: string) => void,
): Promise<ContainerOutput> {
  const startTime = Date.now();

  const groupDir = path.join(GROUPS_DIR, group.folder);
  fs.mkdirSync(groupDir, { recursive: true });

  const mounts = buildVolumeMounts(group, input.isMain);
  const safeName = group.folder.replace(/[^a-zA-Z0-9-]/g, '-');
  const containerName = `nanoclaw-${safeName}-${Date.now()}`;
  const containerArgs = buildContainerArgs(mounts, containerName);

  logger.debug(
    {
      group: group.name,
      containerName,
      mounts: mounts.map(
        (m) =>
          `${m.hostPath} -> ${m.containerPath}${m.readonly ? ' (ro)' : ''}`,
      ),
      containerArgs: containerArgs.join(' '),
    },
    'Container mount configuration',
  );

  logger.info(
    {
      group: group.name,
      containerName,
      mountCount: mounts.length,
      isMain: input.isMain,
    },
    'Spawning container agent',
  );

  const logsDir = path.join(GROUPS_DIR, group.folder, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  return new Promise((resolve) => {
    // Auto-detect container runtime
    const runtime = detectContainerRuntime();
    logger.debug({ runtime }, 'Using container runtime');

    const container = spawn(runtime, containerArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let stderrLineBuffer = '';

    container.stdin.write(JSON.stringify(input));
    container.stdin.end();

    container.stdout.on('data', (data) => {
      if (stdoutTruncated) return;
      const chunk = data.toString();

      const remaining = CONTAINER_MAX_OUTPUT_SIZE - stdout.length;
      if (chunk.length > remaining) {
        stdout += chunk.slice(0, remaining);
        stdoutTruncated = true;
        logger.warn(
          { group: group.name, size: stdout.length },
          'Container stdout truncated due to size limit',
        );
      } else {
        stdout += chunk;
      }
    });

    container.stderr.on('data', (data) => {
      const chunk = data.toString();

      // Line-by-line parsing for STATUS_PREFIX (status lines are on stderr for instant delivery)
      stderrLineBuffer += chunk;
      const lines = stderrLineBuffer.split('\n');
      // Keep the last incomplete line in the buffer
      stderrLineBuffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith(STATUS_PREFIX)) {
          const statusText = line.slice(STATUS_PREFIX.length).trim();
          if (statusText && onStatus) {
            let status: string;
            try {
              const parsed = JSON.parse(statusText);
              status = parsed.status || statusText;
            } catch {
              status = statusText;
            }
            logger.debug({ status }, 'Agent status received');
            onStatus(status);
          }
          continue; // Don't add status lines to stderr log
        }
        if (line) logger.debug({ container: group.folder }, line);
      }

      if (stderrTruncated) return;
      const remaining = CONTAINER_MAX_OUTPUT_SIZE - stderr.length;
      if (chunk.length > remaining) {
        stderr += chunk.slice(0, remaining);
        stderrTruncated = true;
        logger.warn(
          { group: group.name, size: stderr.length },
          'Container stderr truncated due to size limit',
        );
      } else {
        stderr += chunk;
      }
    });

    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      logger.error({ group: group.name, containerName }, 'Container timeout, stopping gracefully');
      // Graceful stop: sends SIGTERM, waits, then SIGKILL — lets --rm fire
      exec(`container stop ${containerName}`, { timeout: 15000 }, (err) => {
        if (err) {
          logger.warn({ group: group.name, containerName, err }, 'Graceful stop failed, force killing');
          container.kill('SIGKILL');
        }
      });
    }, group.containerConfig?.timeout || CONTAINER_TIMEOUT);

    container.on('close', (code) => {
      clearTimeout(timeout);
      const duration = Date.now() - startTime;

      if (timedOut) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const timeoutLog = path.join(logsDir, `container-${ts}.log`);
        fs.writeFileSync(timeoutLog, [
          `=== Container Run Log (TIMEOUT) ===`,
          `Timestamp: ${new Date().toISOString()}`,
          `Group: ${group.name}`,
          `Container: ${containerName}`,
          `Duration: ${duration}ms`,
          `Exit Code: ${code}`,
        ].join('\n'));

        logger.error(
          { group: group.name, containerName, duration, code },
          'Container timed out',
        );

        resolve({
          status: 'error',
          result: null,
          error: `Container timed out after ${group.containerConfig?.timeout || CONTAINER_TIMEOUT}ms`,
        });
        return;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const logFile = path.join(logsDir, `container-${timestamp}.log`);
      const isVerbose =
        process.env.LOG_LEVEL === 'debug' || process.env.LOG_LEVEL === 'trace';

      const logLines = [
        `=== Container Run Log ===`,
        `Timestamp: ${new Date().toISOString()}`,
        `Group: ${group.name}`,
        `IsMain: ${input.isMain}`,
        `Duration: ${duration}ms`,
        `Exit Code: ${code}`,
        `Stdout Truncated: ${stdoutTruncated}`,
        `Stderr Truncated: ${stderrTruncated}`,
        ``,
      ];

      if (isVerbose) {
        logLines.push(
          `=== Input ===`,
          JSON.stringify(input, null, 2),
          ``,
          `=== Container Args ===`,
          containerArgs.join(' '),
          ``,
          `=== Mounts ===`,
          mounts
            .map(
              (m) =>
                `${m.hostPath} -> ${m.containerPath}${m.readonly ? ' (ro)' : ''}`,
            )
            .join('\n'),
          ``,
          `=== Stderr${stderrTruncated ? ' (TRUNCATED)' : ''} ===`,
          stderr,
          ``,
          `=== Stdout${stdoutTruncated ? ' (TRUNCATED)' : ''} ===`,
          stdout,
        );
      } else {
        logLines.push(
          `=== Input Summary ===`,
          `Prompt length: ${input.prompt.length} chars`,
          `Session ID: ${input.sessionId || 'new'}`,
          ``,
          `=== Mounts ===`,
          mounts
            .map((m) => `${m.containerPath}${m.readonly ? ' (ro)' : ''}`)
            .join('\n'),
          ``,
        );

        if (code !== 0) {
          logLines.push(
            `=== Stderr (last 500 chars) ===`,
            stderr.slice(-500),
            ``,
          );
        }
      }

      fs.writeFileSync(logFile, logLines.join('\n'));
      logger.debug({ logFile, verbose: isVerbose }, 'Container log written');

      if (code !== 0) {
        logger.error(
          {
            group: group.name,
            code,
            duration,
            stderr: stderr.slice(-500),
            logFile,
          },
          'Container exited with error',
        );

        resolve({
          status: 'error',
          result: null,
          error: `Container exited with code ${code}: ${stderr.slice(-200)}`,
        });
        return;
      }

      try {
        // Extract JSON between sentinel markers for robust parsing
        const startIdx = stdout.indexOf(OUTPUT_START_MARKER);
        const endIdx = stdout.indexOf(OUTPUT_END_MARKER);

        let jsonLine: string;
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
          jsonLine = stdout
            .slice(startIdx + OUTPUT_START_MARKER.length, endIdx)
            .trim();
        } else {
          // Fallback: last non-empty line (backwards compatibility)
          const lines = stdout.trim().split('\n');
          jsonLine = lines[lines.length - 1];
        }

        const output: ContainerOutput = JSON.parse(jsonLine);

        logger.info(
          {
            group: group.name,
            duration,
            status: output.status,
            hasResult: !!output.result,
          },
          'Container completed',
        );

        resolve(output);
      } catch (err) {
        logger.error(
          {
            group: group.name,
            stdout: stdout.slice(-500),
            error: err,
          },
          'Failed to parse container output',
        );

        resolve({
          status: 'error',
          result: null,
          error: `Failed to parse container output: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });

    container.on('error', (err) => {
      clearTimeout(timeout);
      logger.error({ group: group.name, containerName, error: err }, 'Container spawn error');
      resolve({
        status: 'error',
        result: null,
        error: `Container spawn error: ${err.message}`,
      });
    });
  });
}

export function writeTasksSnapshot(
  groupFolder: string,
  isMain: boolean,
  tasks: Array<{
    id: string;
    groupFolder: string;
    prompt: string;
    schedule_type: string;
    schedule_value: string;
    status: string;
    next_run: string | null;
  }>,
): void {
  // Write filtered tasks to the group's IPC directory
  const groupIpcDir = path.join(DATA_DIR, 'ipc', groupFolder);
  fs.mkdirSync(groupIpcDir, { recursive: true });

  // Main sees all tasks, others only see their own
  const filteredTasks = isMain
    ? tasks
    : tasks.filter((t) => t.groupFolder === groupFolder);

  const tasksFile = path.join(groupIpcDir, 'current_tasks.json');
  fs.writeFileSync(tasksFile, JSON.stringify(filteredTasks, null, 2));
}

export interface AvailableGroup {
  jid: string;
  name: string;
  lastActivity: string;
  isRegistered: boolean;
}

/**
 * Write available groups snapshot for the container to read.
 * Only main group can see all available groups (for activation).
 * Non-main groups only see their own registration status.
 */
export function writeGroupsSnapshot(
  groupFolder: string,
  isMain: boolean,
  groups: AvailableGroup[],
  registeredJids: Set<string>,
): void {
  const groupIpcDir = path.join(DATA_DIR, 'ipc', groupFolder);
  fs.mkdirSync(groupIpcDir, { recursive: true });

  // Main sees all groups; others see nothing (they can't activate groups)
  const visibleGroups = isMain ? groups : [];

  const groupsFile = path.join(groupIpcDir, 'available_groups.json');
  fs.writeFileSync(
    groupsFile,
    JSON.stringify(
      {
        groups: visibleGroups,
        lastSync: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

// ==================== Persistent Container Manager ====================

interface BootstrapInput {
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  agentName?: string;
}

interface InboxMessage {
  id: string;
  prompt: string;
  audioMode?: boolean;
  timestamp: string;
}

interface OutboxMessage {
  id: string;
  status: 'success' | 'error' | 'interrupted';
  result?: string;
  newSessionId?: string;
  error?: string;
  timestamp: string;
}

interface ContainerHandle {
  containerId: string;
  groupFolder: string;
  state: 'starting' | 'idle' | 'busy';
  conversationId: string;
  messageQueue: Array<{
    inbox: InboxMessage;
    resolve: (output: ContainerOutput) => void;
    reject: (err: Error) => void;
  }>;
  idleTimer: ReturnType<typeof setTimeout> | null;
  outboxPollTimer: ReturnType<typeof setTimeout> | null;
  process: ChildProcess;
  pendingResolvers: Map<string, {
    resolve: (output: ContainerOutput) => void;
    reject: (err: Error) => void;
  }>;
  onStatus?: (status: string) => void;
}

function buildPersistentContainerArgs(mounts: VolumeMount[], containerName: string): string[] {
  // No --rm: container is cleaned up explicitly by the manager
  const args: string[] = ['run', '-i', '--name', containerName];

  for (const mount of mounts) {
    if (mount.readonly) {
      args.push(
        '--mount',
        `type=bind,source=${mount.hostPath},target=${mount.containerPath},readonly`,
      );
    } else {
      args.push('-v', `${mount.hostPath}:${mount.containerPath}`);
    }
  }

  args.push(CONTAINER_IMAGE);

  return args;
}

/**
 * Manages persistent containers for PWA conversations.
 * Each conversation gets a long-lived container that processes multiple messages
 * without the cold-start overhead of spawning a new one each time.
 */
export class ContainerManager {
  private containers = new Map<string, ContainerHandle>();

  /**
   * Send a message to the agent in a persistent container.
   * Spawns a new container if none exists for this conversation.
   * Queues the message if the container is busy.
   */
  async sendMessageAndWait(
    conversationId: string,
    group: RegisteredGroup,
    message: { prompt: string; audioMode?: boolean },
    onStatus?: (status: string) => void,
  ): Promise<ContainerOutput> {
    let handle = this.containers.get(conversationId);

    if (!handle) {
      handle = await this.spawnContainer(conversationId, group, onStatus);
      this.containers.set(conversationId, handle);
    }

    // Update status callback (may change between requests)
    handle.onStatus = onStatus;

    const msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const inbox: InboxMessage = {
      id: msgId,
      prompt: message.prompt,
      audioMode: message.audioMode,
      timestamp: new Date().toISOString(),
    };

    return new Promise<ContainerOutput>((resolve, reject) => {
      if (handle!.state === 'busy') {
        // Queue the message and interrupt the current query so the agent
        // processes the new message promptly (user clearly wants to redirect)
        handle!.messageQueue.push({ inbox, resolve, reject });
        this.interruptContainer(conversationId);
        logger.info({ conversationId, msgId, queueSize: handle!.messageQueue.length }, 'Message queued + interrupt sent (container busy)');
      } else {
        // Send immediately
        handle!.state = 'busy';
        this.resetIdleTimer(handle!);
        handle!.pendingResolvers.set(msgId, { resolve, reject });
        this.writeInbox(handle!, inbox);
      }
    });
  }

  private async spawnContainer(
    conversationId: string,
    group: RegisteredGroup,
    onStatus?: (status: string) => void,
  ): Promise<ContainerHandle> {
    const groupDir = path.join(GROUPS_DIR, group.folder);
    fs.mkdirSync(groupDir, { recursive: true });

    const mounts = buildVolumeMounts(group, false);
    const safeName = conversationId.replace(/[^a-zA-Z0-9-]/g, '-');
    const containerName = `nanoclaw-pwa-${safeName}`;
    const containerArgs = buildPersistentContainerArgs(mounts, containerName);

    // Clean up any pre-existing container with the same name
    const runtime = detectContainerRuntime();
    try {
      execSync(`${runtime} rm -f ${containerName}`, { stdio: 'pipe' });
    } catch { /* ignore */ }

    // Clean outbox from previous runs
    const outboxDir = path.join(DATA_DIR, 'ipc', group.folder, 'outbox');
    try {
      if (fs.existsSync(outboxDir)) {
        for (const f of fs.readdirSync(outboxDir)) {
          fs.unlinkSync(path.join(outboxDir, f));
        }
      }
    } catch { /* ignore */ }

    logger.info({ conversationId, containerName, mountCount: mounts.length }, 'Spawning persistent container');

    const container = spawn(runtime, containerArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Write bootstrap JSON to stdin (no prompt — supervisor mode)
    const bootstrap: BootstrapInput = {
      groupFolder: group.folder,
      chatJid: conversationId,
      isMain: false,
      agentName: ASSISTANT_NAME,
    };
    container.stdin.write(JSON.stringify(bootstrap));
    container.stdin.end();

    const handle: ContainerHandle = {
      containerId: containerName,
      groupFolder: group.folder,
      state: 'starting',
      conversationId,
      messageQueue: [],
      idleTimer: null,
      outboxPollTimer: null,
      process: container,
      pendingResolvers: new Map(),
      onStatus,
    };

    // Watch stderr for status updates
    let stderrLineBuffer = '';
    container.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stderrLineBuffer += chunk;
      const lines = stderrLineBuffer.split('\n');
      stderrLineBuffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith(STATUS_PREFIX)) {
          const statusText = line.slice(STATUS_PREFIX.length).trim();
          if (statusText && handle.onStatus) {
            let status: string;
            try {
              const parsed = JSON.parse(statusText);
              status = parsed.status || statusText;
            } catch {
              status = statusText;
            }
            handle.onStatus(status);
          }
        } else if (line) {
          logger.debug({ container: group.folder }, line);
        }
      }
    });

    // Discard stdout (supervisor mode uses file-based IPC, not stdout)
    container.stdout.on('data', () => {});

    // Handle container exit
    container.on('close', (code) => {
      logger.info({ conversationId, containerName, code }, 'Persistent container exited');
      this.handleContainerExit(handle, code);
    });

    container.on('error', (err) => {
      logger.error({ conversationId, containerName, err }, 'Persistent container spawn error');
      this.handleContainerExit(handle, -1);
    });

    // Wait for ready signal in outbox
    await this.waitForReady(handle);
    handle.state = 'idle';
    logger.info({ conversationId, containerName }, 'Persistent container ready');

    // Start outbox polling
    this.startOutboxPoll(handle);

    return handle;
  }

  private async waitForReady(handle: ContainerHandle): Promise<void> {
    const outboxDir = path.join(DATA_DIR, 'ipc', handle.groupFolder, 'outbox');
    const timeout = 60000; // 60s for container startup
    const start = Date.now();

    while (Date.now() - start < timeout) {
      try {
        if (fs.existsSync(outboxDir)) {
          const files = fs.readdirSync(outboxDir).filter((f) => f.endsWith('.json'));
          for (const file of files) {
            const filePath = path.join(outboxDir, file);
            try {
              const data: OutboxMessage = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              if (data.id === 'ready') {
                fs.unlinkSync(filePath);
                return;
              }
            } catch { /* ignore partial files */ }
          }
        }
      } catch { /* ignore */ }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    // Timeout — kill container
    handle.process.kill('SIGKILL');
    throw new Error('Persistent container failed to become ready within 60s');
  }

  private startOutboxPoll(handle: ContainerHandle): void {
    const outboxDir = path.join(DATA_DIR, 'ipc', handle.groupFolder, 'outbox');

    const poll = () => {
      if (!this.containers.has(handle.conversationId)) return;

      try {
        const files = fs.readdirSync(outboxDir)
          .filter((f) => f.endsWith('.json'))
          .sort();

        for (const file of files) {
          const filePath = path.join(outboxDir, file);
          try {
            const data: OutboxMessage = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            fs.unlinkSync(filePath);

            if (data.id === 'ready') continue; // Skip late ready signals

            const resolver = handle.pendingResolvers.get(data.id);
            if (resolver) {
              handle.pendingResolvers.delete(data.id);
              resolver.resolve({
                status: data.status,
                result: data.result || null,
                newSessionId: data.newSessionId,
                error: data.error,
              });
            }

            // Process queued messages
            handle.state = 'idle';
            this.processQueue(handle);
          } catch (err) {
            logger.error({ file, err }, 'Error processing outbox message');
            try { fs.unlinkSync(filePath); } catch { /* ignore */ }
          }
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          logger.error({ err }, 'Error polling outbox');
        }
      }

      handle.outboxPollTimer = setTimeout(poll, CONTAINER_IPC_POLL_INTERVAL);
    };

    handle.outboxPollTimer = setTimeout(poll, CONTAINER_IPC_POLL_INTERVAL);
  }

  private processQueue(handle: ContainerHandle): void {
    if (handle.messageQueue.length === 0) {
      this.resetIdleTimer(handle);
      return;
    }

    const next = handle.messageQueue.shift()!;
    handle.state = 'busy';
    handle.pendingResolvers.set(next.inbox.id, { resolve: next.resolve, reject: next.reject });
    this.writeInbox(handle, next.inbox);
    logger.info({ conversationId: handle.conversationId, msgId: next.inbox.id }, 'Processing queued message');
  }

  private writeInbox(handle: ContainerHandle, msg: InboxMessage): void {
    const inboxDir = path.join(DATA_DIR, 'ipc', handle.groupFolder, 'inbox');
    fs.mkdirSync(inboxDir, { recursive: true });

    // Atomic write
    const filePath = path.join(inboxDir, `${msg.id}.json`);
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(msg));
    fs.renameSync(tempPath, filePath);
  }

  private resetIdleTimer(handle: ContainerHandle): void {
    if (handle.idleTimer) {
      clearTimeout(handle.idleTimer);
    }
    handle.idleTimer = setTimeout(() => {
      if (handle.state === 'idle') {
        logger.info({ conversationId: handle.conversationId }, 'Container idle timeout, shutting down');
        this.shutdownContainer(handle.conversationId);
      }
    }, CONTAINER_IDLE_TIMEOUT);
  }

  private handleContainerExit(handle: ContainerHandle, code: number | null): void {
    if (handle.idleTimer) clearTimeout(handle.idleTimer);
    if (handle.outboxPollTimer) clearTimeout(handle.outboxPollTimer);

    // Reject all pending resolvers
    const exitError = new Error(`Container exited with code ${code}`);
    for (const [, resolver] of handle.pendingResolvers) {
      resolver.reject(exitError);
    }
    handle.pendingResolvers.clear();

    // Reject queued messages
    for (const queued of handle.messageQueue) {
      queued.reject(exitError);
    }
    handle.messageQueue = [];

    this.containers.delete(handle.conversationId);

    // Clean up stopped container
    const runtime = detectContainerRuntime();
    exec(`${runtime} rm -f ${handle.containerId}`, { timeout: 5000 }, (err) => {
      if (err) logger.warn({ containerId: handle.containerId, err }, 'Failed to remove stopped container');
    });
  }

  /** Write interrupt signal to stop the current agent query */
  interruptContainer(conversationId: string): void {
    const handle = this.containers.get(conversationId);
    if (!handle) return;
    const controlDir = path.join(DATA_DIR, 'ipc', handle.groupFolder, 'control');
    fs.mkdirSync(controlDir, { recursive: true });
    const filePath = path.join(controlDir, 'interrupt.json');
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify({ type: 'interrupt', timestamp: new Date().toISOString() }));
    fs.renameSync(tempPath, filePath);
    logger.info({ conversationId }, 'Interrupt signal sent');
  }

  /** Write shutdown signal to gracefully stop the container */
  shutdownContainer(conversationId: string): void {
    const handle = this.containers.get(conversationId);
    if (!handle) return;
    const controlDir = path.join(DATA_DIR, 'ipc', handle.groupFolder, 'control');
    fs.mkdirSync(controlDir, { recursive: true });
    const filePath = path.join(controlDir, 'shutdown.json');
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify({ type: 'shutdown', timestamp: new Date().toISOString() }));
    fs.renameSync(tempPath, filePath);
    logger.info({ conversationId }, 'Shutdown signal sent');
  }

  /** Shutdown all persistent containers gracefully */
  async shutdownAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [convId, handle] of this.containers) {
      this.shutdownContainer(convId);
      promises.push(new Promise((resolve) => {
        handle.process.on('close', () => resolve());
        // Force kill after 10s
        setTimeout(() => {
          if (this.containers.has(convId)) {
            handle.process.kill('SIGKILL');
          }
          resolve();
        }, 10000);
      }));
    }
    await Promise.all(promises);
  }

  isContainerActive(conversationId: string): boolean {
    return this.containers.has(conversationId);
  }

  isContainerBusy(conversationId: string): boolean {
    const handle = this.containers.get(conversationId);
    return handle?.state === 'busy' || false;
  }
}
