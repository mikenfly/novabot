# Overview - Architecture NanoClaw

## Introduction

NanoClaw est un assistant Claude personnel avec une architecture modulaire basée sur des channels. Le système permet de connecter Claude à différentes interfaces (WhatsApp, PWA Web) tout en maintenant une isolation stricte entre les conversations.

## Diagramme Système Complet

```
┌─────────────────────────────────────────────────────────────────────┐
│                        HOST (macOS/Linux)                            │
│                   (Main Node.js Process)                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐                     ┌────────────────────┐        │
│  │  WhatsApp    │────────────────────▶│   SQLite Database  │        │
│  │  (baileys)   │◀────────────────────│   (messages.db)    │        │
│  └──────────────┘   store/send        └─────────┬──────────┘        │
│                                                  │                   │
│         ┌────────────────────────────────────────┘                   │
│         │                                                            │
│         ▼                                                            │
│  ┌──────────────────┐    ┌──────────────────┐    ┌───────────────┐  │
│  │  Message Loop    │    │  Scheduler Loop  │    │  IPC Watcher  │  │
│  │  (polls SQLite)  │    │  (checks tasks)  │    │  (file-based) │  │
│  └────────┬─────────┘    └────────┬─────────┘    └───────────────┘  │
│           │                       │                                  │
│           └───────────┬───────────┘                                  │
│                       │ spawns container                             │
│                       ▼                                              │
├─────────────────────────────────────────────────────────────────────┤
│                  CONTAINER (Docker / Apple Container)                │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    AGENT RUNNER                               │   │
│  │                                                                │   │
│  │  Working directory: /workspace/group (mounted from host)       │   │
│  │  Volume mounts:                                                │   │
│  │    • groups/{name}/ → /workspace/group                         │   │
│  │    • groups/global/ → /workspace/global/ (non-main only)       │   │
│  │    • data/sessions/{group}/.claude/ → /home/node/.claude/      │   │
│  │    • Additional dirs → /workspace/extra/*                      │   │
│  │                                                                │   │
│  │  Tools (all groups):                                           │   │
│  │    • Bash (safe - sandboxed in container!)                     │   │
│  │    • Read, Write, Edit, Glob, Grep (file operations)           │   │
│  │    • WebSearch, WebFetch (internet access)                     │   │
│  │    • agent-browser (browser automation)                        │   │
│  │    • mcp__nanoclaw__* (scheduler tools via IPC)                │   │
│  │                                                                │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| WhatsApp Connection | Node.js (@whiskeysockets/baileys) | Connect to WhatsApp, send/receive messages |
| Message Storage | SQLite (better-sqlite3) | Store messages for polling |
| Container Runtime | Docker / Apple Container | Isolated Linux environments for agent execution |
| Agent | @anthropic-ai/claude-agent-sdk (0.2.29) | Run Claude with tools and MCP servers |
| Browser Automation | agent-browser + Chromium | Web interaction and screenshots |
| Runtime | Node.js 20+ | Host process for routing and scheduling |
| Web Server | Express + WebSocket | API REST et communication temps réel (PWA) |
| Configuration | js-yaml | Parsing de channels.yaml |
| Logging | Pino | Logging structuré et performant |

## Folder Structure

```
nanoclaw/
├── CLAUDE.md                      # Project context for Claude Code
├── docs/
│   ├── SPEC.md                    # Original specification
│   ├── SECURITY.md                # Security model
│   └── architecture/              # Architecture documentation
│       ├── overview.md            # This file
│       ├── channels.md            # Channels system
│       ├── authentication.md      # Auth system (PWA)
│       ├── containers.md          # Container runtime
│       ├── security.md            # Security details
│       ├── ipc.md                 # Inter-process communication
│       └── database.md            # Database schema
├── README.md                      # User documentation
├── package.json                   # Node.js dependencies
├── tsconfig.json                  # TypeScript configuration
├── channels.yaml                  # Channel configuration
├── .mcp.json                      # MCP server configuration (reference)
├── .gitignore
│
├── src/
│   ├── index.ts                   # Main application (WhatsApp + routing)
│   ├── config.ts                  # Configuration constants
│   ├── types.ts                   # TypeScript interfaces
│   ├── utils.ts                   # Generic utility functions
│   ├── db.ts                      # Database initialization and queries
│   ├── whatsapp-auth.ts           # Standalone WhatsApp authentication
│   ├── task-scheduler.ts          # Runs scheduled tasks when due
│   ├── container-runner.ts        # Spawns agents in containers
│   ├── channels-config.ts         # Load and validate channels.yaml
│   ├── pwa-channel.ts             # PWA standalone logic
│   ├── web-server.ts              # Express + WebSocket server
│   ├── auth.ts                    # Token authentication system
│   ├── cloudflare-tunnel.ts       # Cloudflare Tunnel subprocess management
│   ├── logger.ts                  # Structured logging (Pino)
│   └── mount-security.ts          # Mount allowlist validation
│
├── container/
│   ├── Dockerfile                 # Container image (runs as 'node' user)
│   ├── build.sh                   # Build script for container image
│   ├── agent-runner/              # Code that runs inside the container
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts           # Entry point (reads JSON, runs agent)
│   │       └── ipc-mcp.ts         # MCP server for host communication
│   └── skills/
│       └── agent-browser.md       # Browser automation skill
│
├── public/                        # PWA Frontend
│   ├── index.html
│   ├── app.js                     # Client-side logic
│   ├── styles.css
│   ├── sw.js                      # Service Worker
│   └── manifest.json              # PWA manifest
│
├── dist/                          # Compiled JavaScript (gitignored)
│
├── .claude/
│   └── skills/
│       ├── setup/
│       │   └── SKILL.md           # /setup skill
│       ├── customize/
│       │   └── SKILL.md           # /customize skill
│       ├── debug/
│       │   └── SKILL.md           # /debug skill
│       └── channels/
│           └── SKILL.md           # /channels skill (PWA setup)
│
├── groups/
│   ├── CLAUDE.md                  # Global memory (all groups read this)
│   ├── main/                      # Self-chat (main control channel)
│   │   ├── CLAUDE.md              # Main channel memory
│   │   └── logs/                  # Task execution logs
│   ├── {Group Name}/              # Per-group folders (created on registration)
│   │   ├── CLAUDE.md              # Group-specific memory
│   │   ├── logs/                  # Task logs for this group
│   │   └── *.md                   # Files created by the agent
│   └── pwa-{conversationId}/      # PWA virtual groups (standalone mode)
│       ├── CLAUDE.md
│       └── logs/
│
├── store/                         # Local data (gitignored)
│   ├── auth/                      # WhatsApp authentication state
│   └── messages.db                # SQLite database
│
├── data/                          # Application state (gitignored)
│   ├── sessions.json              # Active session IDs per group
│   ├── registered_groups.json     # Group JID → folder mapping
│   ├── router_state.json          # Last processed timestamp
│   ├── auth.json                  # PWA authentication tokens
│   ├── env/env                    # Filtered .env for containers
│   ├── ipc/                       # Container IPC
│   │   ├── {group}/
│   │   │   ├── messages/
│   │   │   ├── tasks/
│   │   │   ├── current_tasks.json
│   │   │   └── available_groups.json
│   └── sessions/                  # Per-group Claude sessions
│       └── {group}/.claude/
│
├── logs/                          # Runtime logs (gitignored)
│   ├── nanoclaw.log               # Host stdout
│   └── nanoclaw.error.log         # Host stderr
│   # Note: Per-container logs are in groups/{folder}/logs/container-*.log
│
├── scripts/                       # Utility scripts
│   └── show-qr.ts                 # Display PWA QR code
│
└── launchd/
    └── com.nanoclaw.plist         # macOS service configuration
```

## Architecture Principles

### 1. Modularity

Le système est conçu autour de **channels** indépendants qui peuvent être activés/désactivés via `channels.yaml`. Chaque channel gère son propre protocole de communication mais partage l'infrastructure commune (container runner, database, IPC).

### 2. Isolation

Chaque conversation (groupe WhatsApp ou conversation PWA) est isolée :
- **Filesystem isolation** : Dossier dédié dans `groups/{name}/`
- **Session isolation** : Sessions Claude séparées dans `data/sessions/{name}/.claude/`
- **IPC namespace** : Namespace IPC par groupe dans `data/ipc/{name}/`
- **Container isolation** : Exécution dans des conteneurs isolés

### 3. Security by Design

La sécurité est assurée par :
- **Container sandboxing** : Agents dans des environnements isolés
- **Mount allowlist** : Contrôle strict des répertoires montés (voir `mount-security.ts`)
- **Privilege separation** : Main group vs non-main groups
- **Credential filtering** : Seules les variables d'authentification Claude exposées
- **IPC authorization** : Vérification de l'identité du groupe pour chaque opération

### 4. Extensibility

L'architecture permet d'ajouter facilement :
- **Nouveaux channels** : Telegram, Slack, Discord, etc.
- **Nouveaux outils MCP** : Extensions via IPC
- **Nouvelles intégrations** : Email, calendrier, etc.

## Configuration

La configuration principale se fait via `channels.yaml` :

```yaml
channels:
  pwa:
    enabled: true
    port: 17283
    standalone: true
    cloudflare_tunnel: true
  whatsapp:
    enabled: false
    trigger: "@Jimmy"
  telegram:
    enabled: false
  slack:
    enabled: false

assistant:
  name: "Jimmy"
  timezone: "Europe/Paris"

paths:
  data_dir: "./data"
  groups_dir: "./groups"
  store_dir: "./store"
```

### Environment Variables

Le fichier `.env` à la racine du projet contient les credentials :

```bash
# Claude authentication (choose one)
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...  # Subscription
ANTHROPIC_API_KEY=sk-ant-api03-...        # Pay-per-use

# Optional
ASSISTANT_NAME=Jimmy
CONTAINER_IMAGE=nanoclaw-agent:latest
CONTAINER_TIMEOUT=300000
```

**Important** : Seules `CLAUDE_CODE_OAUTH_TOKEN` et `ANTHROPIC_API_KEY` sont extraites et montées dans les conteneurs. Voir [security.md](./security.md) pour les détails.

## Memory Hierarchy

NanoClaw utilise un système de mémoire hiérarchique via fichiers `CLAUDE.md` :

| Level | Location | Read By | Written By | Purpose |
|-------|----------|---------|------------|---------|
| **Global** | `groups/CLAUDE.md` | All groups | Main only | Preferences, facts, context shared across all conversations |
| **Group** | `groups/{name}/CLAUDE.md` | That group | That group | Group-specific context, conversation memory |
| **Files** | `groups/{name}/*.md` | That group | That group | Notes, research, documents created during conversation |

### Loading Mechanism

Le Claude Agent SDK avec `settingSources: ['project']` charge automatiquement :
- `../CLAUDE.md` (parent directory = global memory)
- `./CLAUDE.md` (current directory = group memory)

Le working directory de l'agent est `/workspace/group` (monté depuis `groups/{name}/`).

## Execution Flow

### 1. Incoming Message (WhatsApp)

```
User → WhatsApp → Baileys → SQLite
→ Message Loop (polls) → Router
→ Container Runner → Docker/Container
→ Claude Agent SDK → Response
→ Router → Baileys → WhatsApp → User
```

### 2. Incoming Message (PWA)

```
User → PWA Frontend → WebSocket/HTTP
→ Web Server → PWA Channel
→ Container Runner → Docker/Container
→ Claude Agent SDK → Response
→ PWA Channel → WebSocket → Frontend → User
```

### 3. Scheduled Task

```
Scheduler Loop (polls DB) → Detect due task
→ Container Runner → Docker/Container
→ Claude Agent SDK → Optional send_message
→ Update DB (last_run, next_run)
```

## Key Components

### Router (src/index.ts)

Point d'entrée principal qui :
- Charge la configuration channels
- Initialise les channels actifs
- Lance les boucles de polling (messages, scheduler)
- Gère l'état global de l'application

### Container Runner (src/container-runner.ts)

Responsable de l'exécution des agents :
- Détection automatique du runtime (Docker vs Apple Container)
- Construction des volume mounts (group, global, sessions, IPC, env)
- Validation des additional mounts via allowlist
- Gestion du timeout et du cleanup
- Parsing de l'output JSON (avec sentinels)

### Database (src/db.ts)

Gère la persistence SQLite :
- **chats** : Métadonnées des conversations (jid, name, last_message_time)
- **messages** : Messages WhatsApp (pour polling)
- **scheduled_tasks** : Tâches programmées
- **task_run_logs** : Historique d'exécution des tâches

### IPC System

Communication entre conteneurs et host via fichiers JSON :
- **Namespace par groupe** : `data/ipc/{groupFolder}/`
- **Messages sortants** : `data/ipc/{groupFolder}/messages/`
- **Task operations** : `data/ipc/{groupFolder}/tasks/`
- **Snapshots** : `current_tasks.json`, `available_groups.json`

Voir [ipc.md](./ipc.md) pour les détails.

## Performance Characteristics

### Polling Intervals

- **Messages** : 2 secondes (POLL_INTERVAL)
- **Scheduler** : 60 secondes (SCHEDULER_POLL_INTERVAL)
- **IPC** : 1 seconde (IPC_POLL_INTERVAL)

### Resource Limits

- **Container output** : 5 MB max (CONTAINER_MAX_OUTPUT_SIZE)
- **Container timeout** : 5 minutes par défaut (configurable par groupe)
- **PWA conversations** : En mémoire (limitées par RAM)
- **WhatsApp messages** : Stockage SQLite illimité

### Optimizations

- **Connection reuse** : WebSocket pour PWA (pas de HTTP polling)
- **Session persistence** : Sessions Claude sauvegardées entre exécutions
- **Lazy loading** : Channels chargés à la demande
- **Container cleanup** : Automatic removal (`--rm` flag)

## Monitoring & Debugging

### Logs

- **Host logs** : `logs/nanoclaw.log`, `logs/nanoclaw.error.log`
- **Container logs** : `groups/{folder}/logs/container-{timestamp}.log`
- **Structured logging** : Pino avec niveaux (trace, debug, info, warn, error)

### Debug Mode

```bash
# Run with debug logging
LOG_LEVEL=debug npm start

# Manual execution (verbose output)
npm run dev
```

### Container Inspection

```bash
# Docker
docker ps                    # Active containers
docker logs <container-id>   # Container logs

# Apple Container
container ls                 # Active containers
container logs <container-id>
```

## Next Steps

Pour plus de détails sur des aspects spécifiques :
- [Channels System](./channels.md) - Architecture des channels
- [Authentication](./authentication.md) - Système d'authentification PWA
- [Containers](./containers.md) - Runtime et isolation
- [Security](./security.md) - Modèle de sécurité
- [IPC](./ipc.md) - Communication inter-process
- [Database](./database.md) - Schéma et requêtes
