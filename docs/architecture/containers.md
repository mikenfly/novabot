# Containers - Runtime & Isolation

## Overview

NovaBot executes all agent code inside isolated containers using either Docker or Apple Container. This provides security through filesystem isolation, process separation, and controlled resource access.

## Container Runtimes

### Docker

**Platform** : Cross-platform (Linux, macOS, Windows)

**Characteristics** :
- Industry-standard containerization
- OCI-compliant images
- Resource limits (CPU, memory)
- Network isolation

**Detection** :
```bash
docker info  # Success = Docker available
```

### Apple Container

**Platform** : macOS only (Apple Silicon + Intel)

**Characteristics** :
- Lightweight Linux VMs
- Native macOS integration
- Similar CLI to Docker
- Auto-starts VM system

**Detection** :
```bash
container system status  # Success = Apple Container available
```

## Runtime Auto-Detection

NovaBot automatically detects the best available runtime:

```typescript
// src/container-runner.ts
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
```

**Priority** :
1. Docker (if available)
2. Apple Container (macOS fallback)

## Container Image

### Dockerfile

```dockerfile
# container/Dockerfile
FROM node:20-alpine

# Install system dependencies
RUN apk add --no-cache bash git

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code@latest

# Create non-root user matching host UID (1000)
RUN adduser -D -u 1000 node || true

# Set working directory
WORKDIR /workspace

# Copy agent runner code
COPY agent-runner /app/agent-runner
RUN cd /app/agent-runner && npm install && npm run build

# Set entrypoint
USER node
ENTRYPOINT ["/bin/bash", "-c", "source /workspace/env-dir/env 2>/dev/null; node /app/agent-runner/dist/index.js"]
```

### Building

```bash
# Build container image
./container/build.sh

# Output: novabot-agent:latest
```

**Image includes** :
- Node.js 20
- Claude Code CLI
- Agent runner (TypeScript)
- Non-root user (uid 1000)

## Volume Mounts

Each agent container receives specific directory mounts based on privilege level.

### Main Group Mounts

```typescript
// Main group gets project root + group folder
mounts = [
  {
    hostPath: '/home/user/novabot',
    containerPath: '/workspace/project',
    readonly: false
  },
  {
    hostPath: '/home/user/novabot/groups/main',
    containerPath: '/workspace/group',
    readonly: false
  },
  // ... sessions, IPC, env (see below)
]
```

**Working directory** : `/workspace/group`

**Project access** : Can modify project files at `/workspace/project`

### Non-Main Group Mounts

```typescript
// Other groups only get their own folder
mounts = [
  {
    hostPath: '/home/user/novabot/groups/family-chat',
    containerPath: '/workspace/group',
    readonly: false
  },
  {
    hostPath: '/home/user/novabot/groups/global',
    containerPath: '/workspace/global',
    readonly: true  // Read-only access to global memory
  },
  // ... sessions, IPC, env (see below)
]
```

**Working directory** : `/workspace/group`

**Project access** : None (project root not mounted)

### Session Isolation

Each group has an isolated Claude session directory:

```typescript
// Per-group session mount
{
  hostPath: '/home/user/novabot/data/sessions/family-chat/.claude',
  containerPath: '/home/node/.claude',
  readonly: false
}
```

**Purpose** :
- Stores conversation history
- Prevents cross-group session leakage
- Enables session continuity between runs

**Security** : Groups cannot access other groups' sessions.

### IPC Namespace

Each group has an isolated IPC directory:

```typescript
// Per-group IPC mount
{
  hostPath: '/home/user/novabot/data/ipc/family-chat',
  containerPath: '/workspace/ipc',
  readonly: false
}
```

**Contents** :
- `messages/` : Outgoing messages to send
- `tasks/` : Task operations (schedule, update, cancel)
- `current_tasks.json` : Snapshot of visible tasks
- `available_groups.json` : Snapshot of groups (main only)

See [ipc.md](./ipc.md) for details.

### Environment Variables

Filtered `.env` file mounted for authentication:

```typescript
// Environment file mount
{
  hostPath: '/home/user/novabot/data/env',
  containerPath: '/workspace/env-dir',
  readonly: true
}
```

**Filtering logic** :
```typescript
const envFile = path.join(projectRoot, '.env');
const envContent = fs.readFileSync(envFile, 'utf-8');

const allowedVars = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'];

const filteredLines = envContent.split('\n').filter(line => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return false;
  return allowedVars.some(v => trimmed.startsWith(`${v}=`));
});

fs.writeFileSync(
  path.join(DATA_DIR, 'env', 'env'),
  filteredLines.join('\n') + '\n'
);
```

**Sourced by entrypoint** :
```bash
source /workspace/env-dir/env 2>/dev/null
```

**Why needed** : Apple Container loses `-e` environment variables when using `-i` (interactive stdin). Workaround: mount as file and source it.

### Additional Mounts

Groups can have additional directories mounted via `containerConfig`:

```json
// data/registered_groups.json
{
  "1234567890@g.us": {
    "name": "Dev Team",
    "folder": "dev-team",
    "containerConfig": {
      "additionalMounts": [
        {
          "hostPath": "~/projects/webapp",
          "containerPath": "webapp",
          "readonly": false
        }
      ]
    }
  }
}
```

**Mounted at** : `/workspace/extra/{containerPath}`

**Validation** : Checked against external allowlist (see [security.md](./security.md)).

### Mount Syntax

**Read-write mount** :
```bash
-v /host/path:/container/path
```

**Read-only mount (Apple Container)** :
```bash
--mount "type=bind,source=/host/path,target=/container/path,readonly"
```

**Note** : Apple Container doesn't support `:ro` suffix. Must use `--mount` syntax for read-only.

## Container Lifecycle

### Spawn

```typescript
// src/container-runner.ts
export async function runContainerAgent(
  group: RegisteredGroup,
  input: ContainerInput
): Promise<ContainerOutput> {
  const mounts = buildVolumeMounts(group, input.isMain);
  const containerName = `novabot-${group.folder}-${Date.now()}`;
  const containerArgs = buildContainerArgs(mounts, containerName);

  const runtime = detectContainerRuntime();
  const container = spawn(runtime, containerArgs, {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  // Write input JSON to stdin
  container.stdin.write(JSON.stringify(input));
  container.stdin.end();

  // Collect stdout/stderr
  let stdout = '';
  let stderr = '';

  container.stdout.on('data', data => { stdout += data.toString(); });
  container.stderr.on('data', data => { stderr += data.toString(); });

  // Handle completion
  return new Promise((resolve) => {
    container.on('close', (code) => {
      // Parse output JSON
      const output = parseContainerOutput(stdout);
      resolve(output);
    });
  });
}
```

### Timeout

Containers are killed if they exceed the timeout:

```typescript
const timeout = setTimeout(() => {
  logger.error('Container timeout, stopping gracefully');

  // Graceful stop: SIGTERM → wait → SIGKILL
  exec(`container stop ${containerName}`, { timeout: 15000 }, (err) => {
    if (err) {
      container.kill('SIGKILL');
    }
  });
}, group.containerConfig?.timeout || CONTAINER_TIMEOUT);
```

**Default timeout** : 5 minutes (300,000ms)

**Per-group override** :
```json
{
  "containerConfig": {
    "timeout": 600000  // 10 minutes
  }
}
```

### Cleanup

**Automatic removal** : `--rm` flag ensures container is deleted after exit.

```bash
container run -i --rm --name novabot-main-1234567890 ...
```

**Startup cleanup** : Removes stale stopped containers from previous crashes.

```typescript
// src/index.ts
function cleanupStaleContainers() {
  try {
    const output = execSync('container ls -a', { encoding: 'utf-8' });
    const staleContainers = output
      .split('\n')
      .filter(line => line.includes('novabot-'))
      .map(line => line.split(/\s+/)[0])
      .filter(Boolean);

    if (staleContainers.length > 0) {
      execSync(`container rm ${staleContainers.join(' ')}`);
      logger.info({ count: staleContainers.length }, 'Cleaned up stale containers');
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to cleanup stale containers');
  }
}
```

## Input/Output Protocol

### Input (stdin)

JSON object written to container's stdin:

```typescript
interface ContainerInput {
  prompt: string;           // User message or task prompt
  sessionId?: string;       // Resume existing session
  groupFolder: string;      // Group identifier
  chatJid: string;          // Chat/conversation ID
  isMain: boolean;          // Privilege level
  isScheduledTask?: boolean; // Task vs message
}
```

**Example** :
```json
{
  "prompt": "What's the weather in Paris?",
  "sessionId": "session-abc123",
  "groupFolder": "family-chat",
  "chatJid": "1234567890@g.us",
  "isMain": false,
  "isScheduledTask": false
}
```

### Output (stdout)

JSON object written to stdout, wrapped in sentinel markers:

```
---NOVABOT_OUTPUT_START---
{"status":"success","result":"The weather in Paris is...","newSessionId":"session-def456"}
---NOVABOT_OUTPUT_END---
```

**Sentinels purpose** : Robust parsing even if container logs extra output.

```typescript
interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;       // Agent response
  newSessionId?: string;        // Updated session ID
  error?: string;               // Error message if status=error
}
```

**Parsing** :
```typescript
const startIdx = stdout.indexOf(OUTPUT_START_MARKER);
const endIdx = stdout.indexOf(OUTPUT_END_MARKER);

if (startIdx !== -1 && endIdx !== -1) {
  const jsonLine = stdout
    .slice(startIdx + OUTPUT_START_MARKER.length, endIdx)
    .trim();
  const output: ContainerOutput = JSON.parse(jsonLine);
}
```

## Resource Limits

### Output Size

Stdout and stderr are truncated to prevent memory exhaustion:

```typescript
const CONTAINER_MAX_OUTPUT_SIZE = 5 * 1024 * 1024; // 5 MB

container.stdout.on('data', (data) => {
  if (stdoutTruncated) return;

  const chunk = data.toString();
  const remaining = CONTAINER_MAX_OUTPUT_SIZE - stdout.length;

  if (chunk.length > remaining) {
    stdout += chunk.slice(0, remaining);
    stdoutTruncated = true;
    logger.warn('Container stdout truncated due to size limit');
  } else {
    stdout += chunk;
  }
});
```

### CPU & Memory (Docker only)

Docker supports resource limits:

```bash
docker run --cpus="2" --memory="2g" ...
```

**Not yet implemented** in NovaBot. Could be added per-group in `containerConfig`:

```json
{
  "containerConfig": {
    "cpus": 2,
    "memory": "2g"
  }
}
```

## Logging

### Container Logs

Each container run generates a log file:

```
groups/{folder}/logs/container-{timestamp}.log
```

**Contents** :
- Input summary (or full JSON if verbose)
- Mount configuration
- Exit code
- Duration
- Stdout (if verbose)
- Stderr (if error or verbose)

**Verbosity** : Controlled by `LOG_LEVEL=debug` or `LOG_LEVEL=trace`.

**Example log** :
```
=== Container Run Log ===
Timestamp: 2026-02-06T12:34:56.789Z
Group: family-chat
IsMain: false
Duration: 12345ms
Exit Code: 0
Stdout Truncated: false
Stderr Truncated: false

=== Input Summary ===
Prompt length: 123 chars
Session ID: session-abc123

=== Mounts ===
/workspace/group
/workspace/global (ro)
/home/node/.claude
/workspace/ipc
/workspace/env-dir (ro)
```

### Structured Logging

```typescript
logger.info(
  {
    group: group.name,
    containerName,
    mountCount: mounts.length,
    isMain: input.isMain
  },
  'Spawning container agent'
);

logger.error(
  {
    group: group.name,
    code,
    duration,
    stderr: stderr.slice(-500),
    logFile
  },
  'Container exited with error'
);
```

## Security Isolation

### Filesystem

**What containers can access** :
- Own group folder (`/workspace/group`)
- Global memory (`/workspace/global`, read-only for non-main)
- Project root (`/workspace/project`, main only)
- Additional mounts (validated against allowlist)

**What containers cannot access** :
- Other groups' folders
- Host system directories (unless explicitly mounted)
- WhatsApp credentials (`store/auth/`)
- Mount allowlist config (`~/.config/novabot/mount-allowlist.json`)

### Process

**User** : Non-root `node` user (uid 1000)

**Capabilities** : Limited by container runtime (no privileged access)

**Process tree** : Isolated from host processes

### Network

**Current** : Unrestricted network access (internet for WebSearch, etc.)

**Future** : Could add network isolation per-group:
```bash
docker run --network none ...  # No network
docker run --network custom ... # Custom network
```

## Troubleshooting

### Container Won't Start

**Symptom** : "Container exited with code 1"

**Causes** :
1. Runtime not available (Docker/Apple Container)
2. Image not built (`novabot-agent:latest` missing)
3. Mount path doesn't exist
4. Invalid mount syntax

**Solutions** :
```bash
# Check runtime
docker info
# or
container system status

# Rebuild image
./container/build.sh

# Check logs
tail -f groups/main/logs/container-*.log
```

### Session Not Persisting

**Symptom** : Agent doesn't remember previous conversation

**Causes** :
1. Session mount path wrong
2. Session directory not created
3. Session ID not saved

**Solutions** :
```bash
# Check session directory exists
ls -la data/sessions/{group}/.claude/

# Check mount in container log
cat groups/{folder}/logs/container-*.log | grep claude

# Should see: /home/node/.claude
```

### Mount Permission Denied

**Symptom** : "Permission denied" in container logs

**Causes** :
1. Host directory doesn't exist
2. Host directory not readable by uid 1000
3. SELinux/AppArmor blocking access (Linux)

**Solutions** :
```bash
# Create directory
mkdir -p groups/{folder}

# Fix permissions
chmod 755 groups/{folder}

# SELinux (Linux only)
chcon -Rt svirt_sandbox_file_t groups/
```

### Container Timeout

**Symptom** : Container killed after 5 minutes

**Causes** :
1. Agent taking too long (complex task)
2. Agent hanging (infinite loop, waiting for input)

**Solutions** :
```json
// Increase timeout per-group
{
  "containerConfig": {
    "timeout": 600000  // 10 minutes
  }
}
```

## Performance Optimization

### Container Startup

**Current** : ~1-2 seconds per container spawn

**Optimization ideas** :
- Container pool (pre-started containers)
- Persistent containers (one per group)
- Faster runtime (Apple Container vs Docker)

### Image Size

**Current** : ~500 MB (Node.js + Alpine + Claude Code)

**Optimization ideas** :
- Use smaller base image (distroless)
- Multi-stage build (separate build/runtime)
- Remove unused dependencies

### Mount Performance

**Current** : Direct bind mounts (fast)

**No optimization needed** : Bind mounts are near-native filesystem performance.

## Future Enhancements

### Container Pooling

Pre-start containers for faster response:

```typescript
class ContainerPool {
  private pool: Container[] = [];

  async acquire(group: RegisteredGroup): Promise<Container> {
    return this.pool.pop() || await this.spawn(group);
  }

  release(container: Container): void {
    this.pool.push(container);
  }
}
```

### Persistent Containers

One long-lived container per active group:

```typescript
const persistentContainers = new Map<string, Container>();

function getOrCreateContainer(group: RegisteredGroup): Container {
  if (!persistentContainers.has(group.folder)) {
    const container = spawnPersistentContainer(group);
    persistentContainers.set(group.folder, container);
  }
  return persistentContainers.get(group.folder);
}
```

### Resource Limits

Add CPU/memory limits per-group:

```json
{
  "containerConfig": {
    "cpus": 2,
    "memory": "2g",
    "memory_swap": "2g"
  }
}
```

## Resources

- [Docker Documentation](https://docs.docker.com/)
- [Apple Container Guide](https://developer.apple.com/documentation/containermanager)
- [OCI Runtime Spec](https://github.com/opencontainers/runtime-spec)
- [Linux Namespaces](https://man7.org/linux/man-pages/man7/namespaces.7.html)
