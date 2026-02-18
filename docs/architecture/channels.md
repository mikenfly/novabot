# Channels - Architecture Modulaire

## Introduction

NovaBot utilise une architecture modulaire basée sur des **channels** indépendants. Un channel est une interface qui permet à l'utilisateur de communiquer avec l'agent Claude via un protocole spécifique (WhatsApp, PWA Web, Telegram, Slack, etc.).

## Principe

Le router principal (`src/index.ts`) charge dynamiquement les channels activés dans `channels.yaml` et route les messages vers l'agent Claude via le container runner. Chaque channel gère son propre protocole de communication mais partage l'infrastructure commune.

## Configuration

### channels.yaml

```yaml
channels:
  pwa:
    enabled: true
    port: 17283
    standalone: true
    cloudflare_tunnel: true
  whatsapp:
    enabled: false
    trigger: "@Nova"
  telegram:
    enabled: false
  slack:
    enabled: false

assistant:
  name: "Nova"
  timezone: "Europe/Paris"

paths:
  data_dir: "./data"
  groups_dir: "./groups"
  store_dir: "./store"
```

### Loading (src/channels-config.ts)

```typescript
export function loadChannelsConfig(): ChannelsConfig {
  const configPath = path.join(process.cwd(), 'channels.yaml');

  if (!fs.existsSync(configPath)) {
    logger.warn('channels.yaml not found, using defaults');
    return getDefaultConfig();
  }

  const fileContents = fs.readFileSync(configPath, 'utf8');
  return yaml.load(fileContents) as ChannelsConfig;
}

export function isChannelEnabled(channel: string): boolean {
  const cfg = loadChannelsConfig();
  const channelConfig = (cfg.channels as any)[channel];
  return channelConfig?.enabled ?? false;
}
```

### Router Initialization (src/index.ts)

```typescript
const channelsConfig = loadChannelsConfig();

// Conditionally load channels
if (isChannelEnabled('whatsapp')) {
  logger.info('Initializing WhatsApp channel');
  await initWhatsApp();
  startMessageLoop();
}

if (isChannelEnabled('pwa')) {
  logger.info('Initializing PWA channel');
  const { startWebServer } = await import('./web-server.js');
  await startWebServer(channelsConfig.channels.pwa);
}

// Start shared components
startScheduler();
startIpcWatcher();
```

## Channel: WhatsApp

### Architecture

```
User → WhatsApp → Baileys (WhatsApp Web Protocol)
→ SQLite (messages.db) → Message Loop (polls every 2s)
→ Router → Container Runner → Agent
→ Router → Baileys → WhatsApp → User
```

### Features

- **Multi-group support** : Un groupe = une conversation isolée
- **Trigger pattern** : Messages doivent commencer par `@AssistantName`
- **Conversation catch-up** : L'agent reçoit tous les messages depuis sa dernière interaction
- **Persistent storage** : Messages stockés dans SQLite pour persistence
- **Session continuity** : Sessions Claude par groupe pour mémoire long-terme

### Message Flow

#### 1. Incoming Message

```typescript
// src/index.ts - WhatsApp message handler
sock.ev.on('messages.upsert', async ({ messages }) => {
  for (const msg of messages) {
    const chatJid = msg.key.remoteJid;
    const messageContent = getMessageText(msg);

    // Store in SQLite
    await storeMessage({
      id: msg.key.id,
      chat_jid: chatJid,
      sender: msg.key.fromMe ? 'me' : msg.key.participant,
      content: messageContent,
      timestamp: new Date(msg.messageTimestamp * 1000).toISOString(),
      is_from_me: msg.key.fromMe ? 1 : 0
    });

    // Update chat metadata
    storeChatMetadata(chatJid, timestamp, chatName);
  }
});
```

#### 2. Message Processing Loop

```typescript
async function messageLoop() {
  while (true) {
    const registeredGroups = loadRegisteredGroups();

    for (const [chatJid, group] of Object.entries(registeredGroups)) {
      // Get unprocessed messages
      const messages = getMessagesSince(chatJid, lastAgentTimestamp);

      // Check if any message matches trigger pattern
      const triggerMsg = messages.find(m =>
        m.content.match(new RegExp(`^${group.trigger}\\b`, 'i'))
      );

      if (triggerMsg) {
        // Build conversation context
        const prompt = buildConversationPrompt(messages);

        // Run agent
        const output = await runContainerAgent(group, {
          prompt,
          sessionId: getSessionId(group.folder),
          groupFolder: group.folder,
          chatJid,
          isMain: group.folder === 'main'
        });

        // Send response
        if (output.result) {
          await sendMessage(chatJid, `${assistantName}: ${output.result}`);
        }

        // Update state
        saveSessionId(group.folder, output.newSessionId);
        updateLastAgentTimestamp(chatJid);
      }
    }

    await sleep(POLL_INTERVAL);
  }
}
```

#### 3. Conversation Catch-Up

L'agent reçoit tous les messages depuis sa dernière interaction :

```typescript
function buildConversationPrompt(messages: Message[]): string {
  const formatted = messages.map(m => {
    const time = formatTime(m.timestamp); // "Jan 31 2:32 PM"
    const sender = m.is_from_me ? assistantName : m.sender_name;
    return `[${time}] ${sender}: ${m.content}`;
  }).join('\n');

  return formatted;
}
```

**Example** :
```
[Jan 31 2:32 PM] John: hey everyone, should we do pizza tonight?
[Jan 31 2:33 PM] Sarah: sounds good to me
[Jan 31 2:35 PM] John: @Nova what toppings do you recommend?
```

### Configuration Options

```yaml
whatsapp:
  enabled: true
  trigger: "@Nova"  # Regex pattern: ^@Nova\b (case insensitive)
```

### Group Management

Groups are registered in `data/registered_groups.json` :

```json
{
  "1234567890@g.us": {
    "name": "Family Chat",
    "folder": "family-chat",
    "trigger": "@Nova",
    "added_at": "2026-02-06T10:00:00Z",
    "containerConfig": {
      "additionalMounts": [],
      "timeout": 300000
    }
  }
}
```

## Channel: PWA (Progressive Web App)

### Architecture

```
User → PWA Frontend (React-like) → WebSocket/HTTP
→ Web Server (Express) → PWA Channel
→ Container Runner → Agent
→ PWA Channel → WebSocket → Frontend → User
```

### Features

- **Standalone mode** : Conversations en mémoire, indépendantes de WhatsApp
- **Real-time communication** : WebSocket pour updates instantanées
- **Token authentication** : Temporary tokens (5 min) + permanent tokens
- **Multi-device support** : Plusieurs devices peuvent se connecter
- **Cloudflare Tunnel + Access** : Exposition sécurisée via HTTPS avec Google OAuth (optionnel)

### Message Flow

#### 1. Create Conversation

```typescript
// POST /api/conversations
export function createPWAConversation(name?: string): PWAConversation {
  const id = `pwa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const conversation: PWAConversation = {
    id,
    name: name || `Conversation ${new Date().toLocaleString('fr-FR')}`,
    messages: [],
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString()
  };

  pwaConversations.set(id, conversation);
  return conversation;
}
```

#### 2. Send Message

```typescript
// POST /api/conversations/:jid/messages
export async function sendToPWAAgent(
  conversationId: string,
  userMessage: string,
  assistantName: string
): Promise<string> {
  const conversation = pwaConversations.get(conversationId);

  // Add user message
  addMessageToConversation(conversationId, 'user', userMessage);

  // Build context (last 10 messages)
  const recentMessages = conversation.messages.slice(-10);
  const messagesXml = recentMessages.map(msg => {
    const sender = msg.sender === 'user' ? 'User' : assistantName;
    return `<message sender="${sender}" time="${msg.timestamp}">${escapeXml(msg.content)}</message>`;
  }).join('\n');

  const prompt = `<messages>\n${messagesXml}\n</messages>`;

  // Create virtual group for this conversation
  const virtualGroup: RegisteredGroup = {
    name: conversation.name,
    folder: `pwa-${conversationId}`,
    trigger: '',
    added_at: conversation.createdAt
  };

  // Run agent
  const output = await runContainerAgent(virtualGroup, {
    prompt,
    sessionId: pwaSessions.get(conversationId),
    groupFolder: virtualGroup.folder,
    chatJid: conversationId,
    isMain: false
  });

  // Save session
  if (output.newSessionId) {
    pwaSessions.set(conversationId, output.newSessionId);
  }

  // Add assistant response
  const response = output.result || 'Pas de réponse';
  addMessageToConversation(conversationId, 'assistant', response);

  return response;
}
```

#### 3. WebSocket Updates

```typescript
// src/web-server.ts
wss.on('connection', (ws, req) => {
  const token = extractToken(req);
  if (!verifyToken(token)) {
    ws.close(1008, 'Unauthorized');
    return;
  }

  clients.add(ws);

  ws.on('message', async (data) => {
    const msg = JSON.parse(data.toString());

    if (msg.type === 'subscribe') {
      ws.conversationId = msg.conversationId;
    }
  });
});

// Broadcast new message to all subscribers
function broadcastMessage(conversationId: string, message: PWAMessage) {
  for (const client of clients) {
    if (client.conversationId === conversationId && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'new_message',
        message
      }));
    }
  }
}
```

### Configuration Options

```yaml
pwa:
  enabled: true
  port: 17283                  # HTTP server port
  standalone: true            # true = in-memory, false = sync with WhatsApp
  cloudflare_tunnel: true      # Cloudflare Tunnel (nécessite token dans .env)
```

### Storage

**Standalone mode** (`standalone: true`) :
- Conversations stockées en mémoire (Map)
- Sessions Claude dans `data/sessions/pwa-{conversationId}/.claude/`
- Perdu au redémarrage (TODO: persistence SQLite)

**Sync mode** (`standalone: false`, non implémenté) :
- Conversations WhatsApp synchronisées
- Messages partagés entre PWA et WhatsApp

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/conversations` | GET | List all conversations |
| `/api/conversations` | POST | Create new conversation |
| `/api/conversations/:jid` | GET | Get conversation details |
| `/api/conversations/:jid/messages` | POST | Send message to agent |
| `/api/login` | POST | Exchange temporary token for permanent token |
| `/api/devices` | GET | List connected devices |
| `/api/devices/:deviceName` | DELETE | Revoke device token |

Voir [authentication.md](./authentication.md) pour plus de détails sur l'auth.

## Channel Comparison

| Feature | WhatsApp | PWA |
|---------|----------|-----|
| **Protocol** | WhatsApp Web (Baileys) | HTTP + WebSocket |
| **Storage** | SQLite (persistent) | In-memory (standalone) |
| **Authentication** | QR code (WhatsApp) | Token-based |
| **Multi-user** | Yes (groups) | Single user (for now) |
| **Real-time** | Polling (2s) | WebSocket |
| **Offline support** | No | Yes (Service Worker) |
| **Session continuity** | Yes | Yes |
| **Trigger required** | Yes (`@Nova`) | No |

## Adding a New Channel

### 1. Create Channel Module

**src/telegram-channel.ts** :
```typescript
import TelegramBot from 'node-telegram-bot-api';
import { runContainerAgent } from './container-runner.js';
import { RegisteredGroup } from './types.js';

export function initTelegramChannel(config: any) {
  const bot = new TelegramBot(config.bot_token, { polling: true });

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // Check if registered
    const group = getRegisteredGroup(chatId.toString());
    if (!group) return;

    // Run agent
    const output = await runContainerAgent(group, {
      prompt: text,
      sessionId: getSessionId(group.folder),
      groupFolder: group.folder,
      chatJid: chatId.toString(),
      isMain: false
    });

    // Send response
    if (output.result) {
      await bot.sendMessage(chatId, output.result);
    }
  });

  return bot;
}
```

### 2. Add Configuration

**channels.yaml** :
```yaml
channels:
  telegram:
    enabled: true
    bot_token: "1234567890:ABCdefGHIjklMNOpqrsTUVwxyz"
```

### 3. Load in Router

**src/index.ts** :
```typescript
if (isChannelEnabled('telegram')) {
  logger.info('Initializing Telegram channel');
  const { initTelegramChannel } = await import('./telegram-channel.js');
  initTelegramChannel(channelsConfig.channels.telegram);
}
```

### 4. Document

Add section to `docs/CHANNELS.md` with setup instructions.

## Router Logic

### Dynamic Loading

Les channels sont chargés conditionnellement pour éviter les dépendances inutiles :

```typescript
// Dynamic import - only loaded if enabled
if (isChannelEnabled('pwa')) {
  const { startWebServer } = await import('./web-server.js');
  await startWebServer(config);
}
```

### Shared Components

Tous les channels partagent :
- **Container Runner** : Exécution des agents
- **Database** : Storage des tâches et messages (WhatsApp uniquement pour messages)
- **IPC System** : Communication avec les conteneurs
- **Task Scheduler** : Tâches programmées

### Message Routing

Le router ne fait pas de routing complexe - chaque channel gère son propre flux et appelle directement `runContainerAgent()`.

## Best Practices

### Channel Independence

Chaque channel doit être **complètement indépendant** :
- Pas de dépendances sur d'autres channels
- Configuration isolée dans `channels.yaml`
- Graceful fallback si désactivé

### Error Handling

Les channels doivent gérer leurs propres erreurs :

```typescript
try {
  const output = await runContainerAgent(group, input);
  if (output.status === 'error') {
    await sendErrorMessage(chatId, 'Désolé, une erreur est survenue.');
  }
} catch (err) {
  logger.error({ err }, 'Channel error');
  await sendErrorMessage(chatId, 'Service temporairement indisponible.');
}
```

### Logging

Utiliser le logger structuré Pino :

```typescript
import { logger } from './logger.js';

logger.info({ channel: 'telegram', chatId }, 'Message received');
logger.error({ channel: 'telegram', err }, 'Failed to send message');
```

### Resource Cleanup

Nettoyer les resources au shutdown :

```typescript
process.on('SIGTERM', async () => {
  logger.info('Shutting down Telegram channel');
  await bot.stopPolling();
  process.exit(0);
});
```

## Future Channels

Channels prévus ou possibles :
- **Telegram** : Bot API
- **Slack** : Bot API
- **Discord** : Bot API
- **Email** : IMAP/SMTP
- **SMS** : Twilio
- **Voice** : Twilio Voice ou similar

## Resources

- WhatsApp: [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys)
- PWA: [MDN PWA Guide](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps)
- Telegram: [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api)
- WebSocket: [ws library](https://github.com/websockets/ws)
