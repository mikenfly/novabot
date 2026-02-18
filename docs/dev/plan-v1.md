# Refonte PWA NanoClaw — React + Vite

Refactoring de la PWA NanoClaw depuis une application vanilla JS (571 lignes dans `public/app.js`) vers React 19 + Vite 6 + TypeScript dans `pwa/`, avec persistence SQLite, streaming temps réel du statut agent, previews fichiers, gestion clavier iOS, device management, et service worker Vite-aware. Le backend Express existant (`src/web-server.ts`) sert `pwa/dist/` en production.

## Problem Statement

1. **Pas de persistence.** Les conversations PWA sont stockées dans un `Map<string, PWAConversation>` en mémoire (`src/pwa-channel.ts`). Un redémarrage perd tout.
2. **Pas de statut agent temps réel.** L'utilisateur ne voit rien pendant que l'agent travaille (lecture fichiers, recherche web, écriture code) — la réponse arrive d'un coup.
3. **Pas de CRUD conversations.** Impossible de renommer ou supprimer. Pas d'archivage.
4. **Pas de previews fichiers.** Les fichiers générés par l'agent (images, PDF, code) ne sont pas visibles inline.
5. **Vanilla JS ne scale pas.** 571 lignes de manipulation DOM sans composants, sans types, sans tree-shaking.
6. **Pas de gestion clavier iOS.** L'input est caché derrière le clavier virtuel en mode standalone Safari.
7. **Pas de page settings.** Le device management nécessite des commandes CLI.
8. **Service worker inadapté.** Le SW actuel cache des URLs CDN qui seront remplacées par des imports bundlés.

**Solution** : Refactoring en 9 phases organisé par concern (Database → Backend → Frontend). Chaque phase ajoute une tranche verticale de fonctionnalité. Conçu pour une équipe de 3 agents (database+backend, frontend, agent-runner) travaillant contract-first.

## Tech Stack

| Concern | Choix | Raison |
|---------|-------|--------|
| Framework | React 19 + Vite 6 + TypeScript 5.7 | HMR rapide, tree-shaking, type safety |
| State | Zustand 5 | Minimal boilerplate, pas de provider nesting |
| Routing | React Router v7 | SPA routing avec lazy loading |
| CSS | CSS Modules + custom properties | Styles scopés, préserve le dark theme existant |
| Markdown | react-markdown + remark-gfm + rehype-raw | Tables GFM, HTML passthrough |
| Syntax highlight | Shiki (@shikijs/rehype) | Qualité VS Code, dark theme |
| Virtualisation | @tanstack/virtual | Listes de messages longues performantes |
| PDF | react-pdf | Rendu PDF in-browser |
| Sanitization | DOMPurify | Prévention XSS sur le markdown |
| Database | better-sqlite3 (existant) | Déjà utilisé, synchrone, rapide |
| Backend | Express 4 (existant) | Déjà utilisé, changements minimaux |
| WebSocket | ws (existant) | Déjà utilisé pour le temps réel |

## Project Structure

```
pwa/
  index.html
  vite.config.ts
  package.json
  tsconfig.json
  public/
    manifest.json, sw.js, icon-192.png, icon-512.png
  src/
    main.tsx, App.tsx, vite-env.d.ts
    types/
      conversation.ts        — Conversation, Message, PendingMessage
      websocket.ts            — WsMessage, WsMessageData, AgentStatusData
      device.ts               — Device, AuthState
      api.ts                  — API response envelopes
    services/
      api.ts                  — fetch wrapper avec auth headers, error handling
      websocket.ts            — WS singleton, auto-reconnect, typed events
      auth.ts                 — token storage (localStorage), login/logout
    stores/
      authStore.ts            — token, isAuthenticated, login(), logout()
      conversationStore.ts    — conversations[], activeId, CRUD async
      messageStore.ts         — messages par conversationId, pending, optimistic
      agentStatusStore.ts     — status par conversationId, clear on message
      uiStore.ts              — sidebarOpen, isMobile, connectionStatus
    hooks/
      useWebSocket.ts         — lifecycle, route WS messages vers stores
      useVisualViewport.ts    — détection hauteur clavier iOS
      useAutoScroll.ts        — smart scroll (stick to bottom, badge "nouveaux messages")
    components/
      Layout/
        AppLayout.tsx, AuthGuard.tsx
      Sidebar/
        Sidebar.tsx, ConversationList.tsx, ConversationItem.tsx,
        ContextMenu.tsx, NewConversationButton.tsx
      Chat/
        ChatHeader.tsx, ChatArea.tsx, MessageList.tsx, MessageBubble.tsx,
        MessageContent.tsx, MessageInput.tsx, TypingIndicator.tsx, ConnectionStatus.tsx
      FilePreview/
        FilePreviewInline.tsx, FilePreviewModal.tsx,
        ImagePreview.tsx, VideoPreview.tsx, PdfPreview.tsx, CodePreview.tsx
      Common/
        Avatar.tsx, ConfirmDialog.tsx, EmptyState.tsx, Spinner.tsx
    pages/
      LoginPage.tsx, ChatPage.tsx, SettingsPage.tsx
    styles/
      variables.css, reset.css, global.css
```

## Agent Build Order & Communication

### Contract Chain

```
Phase 1-2: Database+Backend Agent (upstream)
  publie: SQL schema + signatures CRUD TypeScript
    --> Lead vérifie --> forward au Frontend Agent

Phase 1-3: Backend Agent (middle)
  publie: API Contract (endpoints exacts, JSON shapes, WS message types)
    --> Lead vérifie --> forward au Frontend Agent

Phase 1-4: Frontend Agent (downstream)
  consomme: API Contract + WS Contract
  build: React app conforme au contrat

Phase 5: Agent-Runner Agent (indépendant, puis intégration)
  publie: STATUS_PREFIX protocol + WS event shape
    --> Lead vérifie --> forward à Backend + Frontend
```

### Phase-to-Agent Mapping

| Phase | Agent Primaire | Agent Secondaire | Dépendance |
|-------|---------------|-----------------|------------|
| 1: Foundation | Backend | Frontend | Backend publie l'API contract d'abord |
| 2: SQLite persistence | Database+Backend | Frontend | DB schema publié d'abord |
| 3: Messaging + WS | Backend | Frontend | WS message contract publié d'abord |
| 4: UI Polish | Frontend | -- | Aucune (CSS only) |
| 5: Agent Status | Agent-Runner | Backend + Frontend | STATUS_PREFIX protocol publié d'abord |
| 6: File Previews | Backend | Frontend | File serving endpoint contract d'abord |
| 7: iOS Keyboard | Frontend | -- | Aucune |
| 8: Settings + Devices | Backend | Frontend | Nouveaux endpoints contract d'abord |
| 9: Service Worker | Frontend | -- | Aucune |

### Séquence Contract-First

**Round 1 (séquentiel):** Database agent définit et envoie le SQL schema + signatures CRUD. Lead vérifie, forward au backend agent.

**Round 2 (séquentiel):** Backend agent reçoit le DB contract, définit et envoie le full API contract (tous les endpoints, tous les WS message types, tous les JSON shapes). Lead vérifie, forward au frontend agent.

**Round 3 (parallèle):** Les trois agents build simultanément, conformes aux contrats vérifiés.

**Round 4 (séquentiel):** Agent-runner agent définit le STATUS_PREFIX protocol. Lead vérifie, forward au backend (parsing) et frontend (display).

**Round 5 (parallèle):** Phases restantes (file previews, iOS keyboard, settings, SW) en parallèle avec vérification de contrat à chaque point d'intégration.

## Database Schema

### Tables existantes (inchangées)

```sql
-- Déjà dans src/db.ts, PAS modifiées
CREATE TABLE IF NOT EXISTS chats (
  jid TEXT PRIMARY KEY,
  name TEXT,
  last_message_time TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT,
  chat_jid TEXT,
  sender TEXT,
  sender_name TEXT,
  content TEXT,
  timestamp TEXT,
  is_from_me INTEGER,
  PRIMARY KEY (id, chat_jid),
  FOREIGN KEY (chat_jid) REFERENCES chats(jid)
);
CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp);

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
```

### Nouvelles tables (Phase 2)

```sql
CREATE TABLE IF NOT EXISTS pwa_conversations (
  id TEXT PRIMARY KEY,               -- ex: 'pwa-1706000000000-abc123'
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,           -- ISO 8601
  last_activity TEXT NOT NULL,        -- ISO 8601, mis à jour à chaque message
  archived INTEGER DEFAULT 0          -- 0 = actif, 1 = archivé
);
CREATE INDEX IF NOT EXISTS idx_pwa_conv_activity
  ON pwa_conversations(last_activity);

CREATE TABLE IF NOT EXISTS pwa_messages (
  id TEXT PRIMARY KEY,               -- ex: 'msg-1706000000000-abc123'
  conversation_id TEXT NOT NULL,
  sender TEXT NOT NULL,               -- 'user' | 'assistant'
  content TEXT NOT NULL,
  timestamp TEXT NOT NULL,            -- ISO 8601
  FOREIGN KEY (conversation_id) REFERENCES pwa_conversations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pwa_msg_conv
  ON pwa_messages(conversation_id, timestamp);
```

### Nouvelle table (Phase 9)

```sql
CREATE TABLE IF NOT EXISTS pwa_push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL UNIQUE,
  keys_p256dh TEXT NOT NULL,
  keys_auth TEXT NOT NULL,
  device_token TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_device
  ON pwa_push_subscriptions(device_token);
```

### Signatures CRUD (ajoutées à `src/db.ts`)

```typescript
// --- PWA Conversations ---
export function createPWAConversationDB(id: string, name: string): void;
export function getPWAConversationDB(id: string): PWAConversationRow | undefined;
export function getAllPWAConversationsDB(): PWAConversationRow[];
export function renamePWAConversation(id: string, name: string): boolean;
export function deletePWAConversation(id: string): boolean;  // CASCADE delete messages
export function updatePWAConversationActivity(id: string): void;

// --- PWA Messages ---
export function addPWAMessage(
  id: string, conversationId: string, sender: 'user' | 'assistant', content: string
): void;
export function getPWAMessages(conversationId: string, since?: string): PWAMessageRow[];
export function getPWARecentMessages(conversationId: string, limit: number): PWAMessageRow[];

// --- Push Subscriptions (Phase 9) ---
export function savePushSubscription(
  endpoint: string, p256dh: string, auth: string, deviceToken?: string
): void;
export function removePushSubscription(endpoint: string): boolean;
export function getAllPushSubscriptions(): PushSubscriptionRow[];

// Row types
export interface PWAConversationRow {
  id: string; name: string; created_at: string; last_activity: string; archived: number;
}
export interface PWAMessageRow {
  id: string; conversation_id: string; sender: 'user' | 'assistant'; content: string; timestamp: string;
}
```

## API Contract

**IMPORTANT :** Ceci est le contrat d'API autoritatif. Backend et frontend DOIVENT se conformer à ces spécifications exactes. Le lead agent vérifie l'alignement avant intégration.

**Auth** : Tous les endpoints sauf `GET /api/health` et `POST /api/login` requièrent `Authorization: Bearer <token>`.

### Endpoints

| Method | Path | Request Body | Response | Status |
|--------|------|-------------|----------|--------|
| `GET` | `/api/health` | -- | `{ "status": "ok" }` | 200 |
| `POST` | `/api/login` | `{ "token": "...", "deviceName": "..." }` | `{ "token": "permanent-token" }` | 200 |
| `GET` | `/api/conversations` | -- | `{ "conversations": Conversation[] }` | 200 |
| `POST` | `/api/conversations` | `{ "name?": "..." }` | `Conversation` | 200 |
| `GET` | `/api/conversations/:id/messages` | `?since=ISO8601` | `{ "messages": Message[] }` | 200 |
| `POST` | `/api/conversations/:id/messages` | `{ "content": "..." }` | `{ "success": true, "messageId": "..." }` | 200 |
| `PATCH` | `/api/conversations/:id` | `{ "name": "..." }` | `{ "success": true }` | 200 |
| `DELETE` | `/api/conversations/:id` | -- | `{ "success": true }` | 200 |
| `GET` | `/api/conversations/:id/files/*filepath` | -- | Binary file | 200 |
| `GET` | `/api/devices` | -- | `{ "devices": Device[] }` | 200 |
| `DELETE` | `/api/devices/:token` | -- | `{ "success": true }` | 200 |
| `POST` | `/api/devices/generate` | `{ "deviceName?": "..." }` | `{ "token": "...", "expiresAt": "..." }` | 200 |
| `POST` | `/api/push/subscribe` | `{ "endpoint": "...", "keys": {...} }` | `{ "success": true }` | 200 |
| `DELETE` | `/api/push/subscribe` | `{ "endpoint": "..." }` | `{ "success": true }` | 200 |

### Response Shapes

**Conversation**
```json
{
  "jid": "pwa-1706000000000-abc123",
  "name": "Conversation principale",
  "folder": "pwa-pwa-1706000000000-abc123",
  "lastActivity": "2026-02-09T10:30:00.000Z",
  "type": "pwa"
}
```

**Message**
```json
{
  "id": "msg-1706000000000-abc123",
  "chat_jid": "pwa-1706000000000-abc123",
  "sender_name": "You",
  "content": "Hello, can you help me?",
  "timestamp": "2026-02-09T10:30:00.000Z",
  "is_from_me": true
}
```
Note : Les messages assistant ont `content` préfixé par `{ASSISTANT_NAME}: ` et `is_from_me: false`.

**Device**
```json
{
  "token": "64-char-hex-string",
  "device_name": "iPhone 15 Safari",
  "created_at": "2026-02-09T10:00:00.000Z",
  "last_used": "2026-02-09T10:30:00.000Z"
}
```

### Error Responses

| Status | Body | Quand |
|--------|------|-------|
| 400 | `{ "error": "Content required" }` | Champ requis manquant |
| 400 | `{ "error": "PWA standalone mode not enabled" }` | POST /api/conversations quand standalone=false |
| 401 | `{ "error": "Unauthorized" }` | Token invalide ou manquant |
| 401 | `{ "error": "Invalid or expired token" }` | POST /api/login avec mauvais token temporaire |
| 404 | `{ "error": "Conversation not found" }` | ID conversation inconnu |
| 404 | `{ "error": "File not found" }` | Fichier inexistant au chemin demandé |
| 403 | `{ "error": "Path traversal blocked" }` | Tentative de path traversal dans l'endpoint fichiers |
| 500 | `{ "error": "Failed to send message" }` | Erreur container ou agent |

### WebSocket Protocol

**Connexion** : `ws(s)://host/ws?token=<permanent-token>`

**Client → Server :**
```json
{ "type": "ping" }
```

**Server → Client :**

```typescript
// Connexion établie
{ type: 'connected', data: { timestamp: string } }

// Keep-alive
{ type: 'pong' }

// Nouveau message (user ou assistant)
{ type: 'message', data: {
    chat_jid: string, sender_name: string, content: string, timestamp: string
} }

// Statut agent (Phase 5, NOUVEAU)
{ type: 'agent_status', data: {
    conversation_id: string, status: string, timestamp: string
} }

// Conversation créée (Phase 2, NOUVEAU)
{ type: 'conversation_created', data: {
    jid: string, name: string, lastActivity: string, type: 'pwa'
} }

// Conversation renommée (Phase 2, NOUVEAU)
{ type: 'conversation_renamed', data: { jid: string, name: string } }

// Conversation supprimée (Phase 2, NOUVEAU)
{ type: 'conversation_deleted', data: { jid: string } }
```

## Agent Status Pipeline (Phase 5)

### End-to-End Flow

```
Agent SDK query() loop
  → agent-runner émet STATUS_PREFIX vers stdout
    → container-runner parse stdout ligne par ligne en temps réel
      → callback onStatus dans pwa-channel.ts
        → web-server.ts broadcast { type: 'agent_status' } via WS
          → React agentStatusStore met à jour
            → TypingIndicator affiche dots animés + texte statut
              → Effacé quand le message final arrive
```

### 1. Agent Runner (`container/agent-runner/src/index.ts`)

```typescript
const STATUS_PREFIX = '---NANOCLAW_STATUS---';

function emitStatus(text: string): void {
  const payload = JSON.stringify({ status: text, timestamp: new Date().toISOString() });
  console.log(`${STATUS_PREFIX}${payload}`);
}

function craftToolStatus(toolName: string, input: Record<string, any>): string {
  switch (toolName) {
    case 'Read': return `Lecture de ${input.file_path?.split('/').pop() || 'fichier'}...`;
    case 'Write': return `Écriture de ${input.file_path?.split('/').pop() || 'fichier'}...`;
    case 'Edit': return `Modification de ${input.file_path?.split('/').pop() || 'fichier'}...`;
    case 'Bash': return `Exécution d'une commande...`;
    case 'Glob': return `Recherche de fichiers...`;
    case 'Grep': return `Recherche dans le code...`;
    case 'WebSearch': return `Recherche sur le web...`;
    case 'WebFetch': return `Récupération d'une page web...`;
    default: return `Utilisation de ${toolName}...`;
  }
}
```

Dans la boucle `for await (const message of query(...))`, intercepter les messages `assistant` avec `tool_use` content blocks :

```typescript
if (message.type === 'assistant' && message.message?.content) {
  for (const block of message.message.content) {
    if (block.type === 'tool_use') {
      emitStatus(craftToolStatus(block.name, block.input || {}));
    }
  }
}
```

### 2. Container Runner (`src/container-runner.ts`)

Ajouter `onStatus?: (conversationId: string, status: string) => void` à `runContainerAgent()`.

Remplacer le `container.stdout.on('data', ...)` par un parsing ligne par ligne :

```typescript
let stdoutBuffer = '';
container.stdout.on('data', (data) => {
  stdoutBuffer += data.toString();
  const lines = stdoutBuffer.split('\n');
  stdoutBuffer = lines.pop() || '';  // Garder la ligne incomplète dans le buffer
  for (const line of lines) {
    if (line.startsWith(STATUS_PREFIX)) {
      if (onStatus) {
        try {
          const payload = JSON.parse(line.slice(STATUS_PREFIX.length));
          onStatus(input.chatJid, payload.status);
        } catch { /* ignorer les erreurs de parse */ }
      }
    } else {
      stdout += line + '\n';  // Ligne normale → accumulateur
    }
  }
});
```

### 3. PWA Channel (`src/pwa-channel.ts`)

`sendToPWAAgent()` accepte et transmet le callback `onStatus` :

```typescript
export async function sendToPWAAgent(
  conversationId: string, userMessage: string, assistantName: string,
  onStatus?: (conversationId: string, status: string) => void
): Promise<string>
```

### 4. Web Server (`src/web-server.ts`)

Dans `POST /api/conversations/:id/messages`, passer le callback :

```typescript
const response = await sendToPWAAgent(jid, content, ASSISTANT_NAME, (convId, status) => {
  broadcastToClients({
    type: 'agent_status',
    data: { conversation_id: convId, status, timestamp: new Date().toISOString() },
  });
});
```

## Cross-Cutting Concerns

| Concern | Agent | Coordination | Détail |
|---------|-------|-------------|--------|
| Response envelope | Backend | Frontend | Listes retournées dans `{ "key": [...] }`, pas des arrays bruts |
| Message content prefix | Backend | Frontend | Messages assistant préfixés `{ASSISTANT_NAME}: `. Frontend strip le préfixe pour l'affichage via `content.replace(/^\w+:\s*/, '')` |
| Conversation ID format | Database | Backend + Frontend | Toujours `pwa-{Date.now()}-{random}`, préfixe `pwa-`. Frontend check le préfixe pour les features PWA-specific |
| Timestamps | Database | Tous | ISO 8601 partout (`new Date().toISOString()`), jamais d'epoch |
| WebSocket auth | Backend | Frontend | Token en query param `?token=...`. WS ferme avec code 1008 si auth fail. Frontend gère le reconnect |
| Optimistic updates | Frontend | Backend | Frontend assigne un temp ID `temp-{Date.now()}`, affiché immédiatement. Remplacé à réception WS si `chat_jid` match |
| File path security | Backend | -- | `GET /api/.../files/*` résout contre `groups/{folder}/`, rejette si le path résolu sort du dossier |
| CSS custom properties | Frontend | -- | Préserver les variables existantes de `public/styles.css`, étendre sans renommer |

## Frontend Components

### Stores (Zustand)

**authStore**
```typescript
interface AuthState {
  token: string | null;
  isAuthenticated: boolean;
  login: (tempToken: string, deviceName: string) => Promise<boolean>;
  loginWithPermanentToken: (token: string) => void;
  logout: () => void;
  initialize: () => void;  // Check localStorage on app start
}
```

**conversationStore**
```typescript
interface ConversationState {
  conversations: Conversation[];
  activeId: string | null;
  isLoading: boolean;
  fetchConversations: () => Promise<void>;
  createConversation: (name?: string) => Promise<string>;  // Returns new ID
  renameConversation: (id: string, name: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  setActive: (id: string) => void;
  // Called by WS handler
  handleConversationCreated: (conv: Conversation) => void;
  handleConversationRenamed: (id: string, name: string) => void;
  handleConversationDeleted: (id: string) => void;
}
```

**messageStore**
```typescript
interface MessageState {
  messages: Record<string, Message[]>;        // keyed by conversation ID
  pendingMessages: Record<string, PendingMessage[]>;
  isLoading: Record<string, boolean>;
  fetchMessages: (conversationId: string, since?: string) => Promise<void>;
  sendMessage: (conversationId: string, content: string) => Promise<void>;
  // Called by WS handler
  handleIncomingMessage: (data: WsMessageData) => void;
}

interface PendingMessage {
  tempId: string;
  conversationId: string;
  content: string;
  timestamp: string;
  status: 'sending' | 'failed';
}
```

**agentStatusStore**
```typescript
interface AgentStatusState {
  status: Record<string, string | null>;  // conversationId → status text
  handleAgentStatus: (conversationId: string, status: string) => void;
  clearStatus: (conversationId: string) => void;
}
```

**uiStore**
```typescript
interface UIState {
  sidebarOpen: boolean;
  isMobile: boolean;
  connectionStatus: 'connected' | 'disconnected' | 'reconnecting';
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setConnectionStatus: (status: 'connected' | 'disconnected' | 'reconnecting') => void;
  setIsMobile: (isMobile: boolean) => void;
}
```

### Hooks

**useWebSocket**
- On mount : connecte WS avec token de authStore
- Route les messages vers les stores appropriés :
  - `message` → `messageStore.handleIncomingMessage()` + `agentStatusStore.clearStatus()`
  - `agent_status` → `agentStatusStore.handleAgentStatus()`
  - `conversation_created` → `conversationStore.handleConversationCreated()`
  - `conversation_renamed` → `conversationStore.handleConversationRenamed()`
  - `conversation_deleted` → `conversationStore.handleConversationDeleted()`
  - `connected` → `uiStore.setConnectionStatus('connected')`
- On disconnect : `uiStore.setConnectionStatus('disconnected')`
- Auto-reconnect backoff exponentiel : 1s, 2s, 4s, 8s, 16s, 30s (max)
- Ping toutes les 30s

**useVisualViewport** (Phase 7)
- Écoute `window.visualViewport` resize/scroll
- `keyboardHeight = window.innerHeight - visualViewport.height`
- Retourne `{ keyboardHeight: number, isKeyboardVisible: boolean }`

**useAutoScroll**
- Track scroll position relative au bas du container
- Si < 100px du bas → auto-scroll sur nouveau message
- Si scrollé vers le haut → `showNewMessageBadge = true`
- `scrollToBottom()` : smooth scroll + reset badge

### LoginPage
- Input token unique
- `POST /api/login` avec `{ token, deviceName: navigator.userAgent.slice(0,50) }`
- Succès : stocke token permanent via `authStore.login()`, navigate vers `/`
- Erreur : message d'erreur sous l'input
- Check `?token=` URL param au mount (flux QR code) → auto-submit
- Visuel : carte centrée, fond sombre, reprend le design existant

### ChatPage
- Wraps `<AppLayout>` avec `<Sidebar>` et `<ChatArea>`
- Lit `activeConversationId` de `conversationStore`
- Si aucune conversation active → `<EmptyState>` "Sélectionnez ou créez une conversation"
- Initialise le hook `useWebSocket`

### SettingsPage
- **Section Devices** : liste depuis `GET /api/devices`. Chaque device : nom, `created_at`, `last_used` en temps relatif. Bouton "Révoquer" avec `<ConfirmDialog>`. Bouton "Générer Token" → `POST /api/devices/generate` → affiche le token temporaire
- **Section Notifications** : toggle push. On enable : demande permission browser, subscribe Push API, envoie à `POST /api/push/subscribe`. On disable : unsubscribe + `DELETE /api/push/subscribe`
- **Section Compte** : nom du device courant, bouton logout

### AppLayout
- CSS Grid : `grid-template-columns: auto 1fr` sur desktop (>=768px)
- Mobile (<768px) : colonne unique, sidebar en overlay absolu
- Lit `uiStore.sidebarOpen`

### AuthGuard
- Wraps toutes les routes sauf `/login`
- Si `!authStore.isAuthenticated` → `<Navigate to="/login" />`

### Sidebar
- Header : titre "Conversations" + bouton fermer (mobile)
- Body : `<ConversationList />`
- Footer : `<NewConversationButton />` + lien vers `/settings`
- Animation slide : `transform: translateX(-100%)` quand fermé sur mobile

### ConversationList
- Mappe `conversationStore.conversations` → `<ConversationItem>`
- Trié par `lastActivity` desc (déjà trié depuis l'API)
- Vide : texte "Pas encore de conversations"

### ConversationItem
- Affiche : nom conversation, timestamp relatif
- État actif : fond highlight + bordure accent gauche (`var(--accent)`)
- Click : `conversationStore.setActive()`, ferme sidebar sur mobile
- Long press / clic droit : ouvre `<ContextMenu>`

### ContextMenu
- Positionné absolument aux coordonnées du clic
- Actions : "Renommer" (édition inline), "Supprimer" (avec `<ConfirmDialog>`)
- Clic extérieur ou Escape ferme
- Animation : scale(0.95)+opacity(0) → scale(1)+opacity(1), 150ms

### MessageList
- `@tanstack/react-virtual` `useVirtualizer` avec hauteur estimée 80px
- Lit `messageStore.messages[activeConversationId]`
- Rend `<MessageBubble>` pour chaque message
- `useAutoScroll` : auto-scroll si user near bottom, sinon badge "Nouveaux messages"
- Au mount : fetch via `GET /api/conversations/:id/messages`

### MessageBubble
- Layout : `<Avatar>` + colonne contenu
- User : aligné droite, fond bleu (`var(--message-user)`)
- Assistant : aligné gauche, fond sombre (`var(--message-assistant)`)
- Header : nom expéditeur (bold) + timestamp (dim)
- Contenu : `<MessageContent>`
- État pending : opacité réduite, timestamp "Envoi..."
- Animation : `slideIn` keyframes (opacity + translateY, 200ms)

### MessageContent
- `react-markdown` + `remark-gfm` + `rehype-raw`
- Sanitisé via `DOMPurify.sanitize()` avant rendu
- Code blocks highlight par `@shikijs/rehype` thème `github-dark`
- Détecte les références fichiers (`/workspace/group/...`) → convertit en `<FilePreviewInline>` pointant vers `/api/conversations/:id/files/*filepath`

### MessageInput
- `<textarea>` auto-resize (1 row défaut, max 6 rows / 150px)
- Enter envoie (`messageStore.sendMessage()`), Shift+Enter insère newline
- Bouton envoi : cercle, couleur accent, icône flèche SVG
- Disabled quand aucune conversation sélectionnée
- On send : crée message optimistic dans le store, `POST` en background
- Sur iOS : `useVisualViewport` pour padding keyboard-safe

### TypingIndicator
- Lit `agentStatusStore.status[activeConversationId]`
- Si status existe : trois dots animés + texte statut
- Animation dots : fade in/out séquentiel (cycle 0.6s)
- Effacé quand `agentStatusStore` reçoit `null` (à réception du message final)

### ConnectionStatus
- Cercle dans le header : vert `connected`, rouge `disconnected`, jaune `reconnecting`
- Tooltip au hover montrant l'état

### FilePreviewInline
- Détecte le type par extension
- Images : `<img>` lazy loading, max-height 200px, click ouvre modal
- Vidéos : `<video>` avec controls, max-height 200px
- PDF : thumbnail première page via react-pdf, click ouvre modal
- Code : bloc Shiki highlight, max-height 200px avec scroll
- Autre : icône lien de téléchargement

### FilePreviewModal
- Overlay fullscreen avec backdrop semi-transparent
- Fermer : Escape, click backdrop, bouton X
- Contenu : délègue aux composants preview par type
- Navigation PDF (contrôles de page)
- Zoom images (pinch/scroll)

### Common Components
- **Avatar** : badge cercle avec initiales. Fond `var(--accent)` pour assistant, `var(--message-user)` pour user. 32x32px
- **ConfirmDialog** : modal avec titre, message, Cancel + Confirm. Bouton Confirm rouge pour actions destructives
- **EmptyState** : container centré avec icône optionnelle, titre, sous-titre
- **Spinner** : cercle CSS spinning `var(--accent)`. Variantes small (16px), medium (24px), large (40px)

## Styling

### CSS Custom Properties (préservées + étendues)

```css
:root {
  /* Existantes (de public/styles.css) — GARDER EXACTEMENT */
  --bg-primary: #0a0a0a;
  --bg-secondary: #1a1a1a;
  --bg-tertiary: #2a2a2a;
  --text-primary: #ffffff;
  --text-secondary: #a0a0a0;
  --accent: #00b894;
  --accent-hover: #00d9a8;
  --error: #ff6b6b;
  --border: #3a3a3a;
  --message-user: #2d4a7c;
  --message-assistant: #2a2a2a;
  --shadow: rgba(0, 0, 0, 0.3);

  /* Nouvelles (Phase 4) */
  --radius-sm: 6px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --sidebar-width: 300px;
  --header-height: 60px;
  --transition-fast: 150ms ease;
  --transition-normal: 200ms ease;
  --transition-slow: 300ms ease;
  --connection-ok: #00b894;
  --connection-error: #ff6b6b;
  --connection-warning: #fdcb6e;
  --backdrop: rgba(0, 0, 0, 0.5);
  --scrollbar-thumb: #3a3a3a;
  --scrollbar-track: #1a1a1a;
}
```

### Animations

```css
@keyframes slideIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes sidebarSlideIn {
  from { transform: translateX(-100%); }
  to { transform: translateX(0); }
}
@keyframes contextMenuIn {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes dotPulse {
  0%, 80%, 100% { opacity: 0.3; }
  40% { opacity: 1; }
}
```

### Responsive
- `>= 768px` : sidebar persistent + chat côte à côte (CSS Grid deux colonnes)
- `< 768px` : sidebar overlay absolu avec backdrop

### Scrollbar
```css
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: var(--scrollbar-track); }
::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 3px; }
```

## Dependencies

### `pwa/package.json`

```json
{
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.0.0",
    "zustand": "^5.0.0",
    "react-markdown": "^9.0.0",
    "remark-gfm": "^4.0.0",
    "rehype-raw": "^7.0.0",
    "@shikijs/rehype": "^1.0.0",
    "shiki": "^1.0.0",
    "@tanstack/react-virtual": "^3.0.0",
    "dompurify": "^3.0.0",
    "react-pdf": "^9.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@types/dompurify": "^3.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  }
}
```

### Root `package.json` — scripts ajoutés

```json
{
  "scripts": {
    "build:pwa": "cd pwa && npm run build",
    "dev:pwa": "cd pwa && npm run dev"
  }
}
```

### `pwa/vite.config.ts`

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:17283',
      '/ws': { target: 'ws://localhost:17283', ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
```

## Backend Modifications

### `src/web-server.ts`

1. **Static serving** : Remplacer `express.static('public')` par `express.static('pwa/dist')` + SPA fallback (routes non-API → `pwa/dist/index.html`)
2. **Nouveaux endpoints** : `PATCH /api/conversations/:id`, `DELETE /api/conversations/:id`, `GET /api/conversations/:id/files/*filepath`, `POST /api/devices/generate`, `POST /api/push/subscribe`, `DELETE /api/push/subscribe`
3. **WS broadcast conversation events** : Après create/rename/delete, `broadcastToClients()` avec le type correspondant
4. **Agent status callback** : Dans `POST /api/conversations/:id/messages`, passer `onStatus` à `sendToPWAAgent()`

### `src/pwa-channel.ts` — Réécriture

- Supprimer `Map<string, PWAConversation>` et `Map<string, string>` in-memory
- Toutes les fonctions appellent `src/db.ts` CRUD
- `sendToPWAAgent()` accepte `onStatus` optionnel, le passe à `runContainerAgent()`

### `src/container-runner.ts`

- Ajouter param `onStatus?` à `runContainerAgent()`
- Parsing stdout ligne par ligne (buffer + split `\n`)
- Lignes `STATUS_PREFIX` → callback, pas accumulées dans stdout

### `container/agent-runner/src/index.ts`

- Ajouter `STATUS_PREFIX`, `emitStatus()`, `craftToolStatus()`
- Intercepter `tool_use` content blocks dans la boucle query()

## Fichiers Critiques

| Fichier | Modifications |
|---------|---------------|
| `src/web-server.ts` | Static serving path, 6 nouveaux endpoints, SPA fallback, agent status broadcast |
| `src/pwa-channel.ts` | Réécriture complète : SQLite au lieu de Map, callback onStatus |
| `src/db.ts` | Tables pwa_conversations, pwa_messages, pwa_push_subscriptions, fonctions CRUD |
| `src/container-runner.ts` | Parsing stdout ligne par ligne, param onStatus |
| `container/agent-runner/src/index.ts` | STATUS_PREFIX, craftToolStatus(), émission dans boucle query() |
| `package.json` | Scripts build:pwa, dev:pwa |

## Acceptance Criteria

1. **Login** : Token temporaire → permanent, stocké localStorage, persist au refresh
2. **Persistence** : Conversations et messages survivent au redémarrage serveur (SQLite)
3. **CRUD conversations** : Créer, renommer, supprimer depuis la sidebar. Sync temps réel multi-client via WS
4. **Messaging temps réel** : Optimistic update immédiat, réponse agent via WS, pas de doublons
5. **Agent status** : TypingIndicator affiche le statut en temps réel pendant le travail agent
6. **File previews** : Fichiers référencés → preview inline, clic → modal fullscreen
7. **iOS keyboard** : Input visible au-dessus du clavier virtuel en mode standalone
8. **Settings** : Liste devices, révoquer, générer token
9. **Responsive** : Desktop sidebar+chat côte à côte, mobile overlay
10. **Offline** : PWA shell charge depuis le SW cache
11. **Build** : `npm run build:pwa` produit `pwa/dist/`, Express le sert correctement
12. **TypeScript** : `cd pwa && npx tsc --noEmit` passe sans erreur

## Validation

### Backend Agent

```bash
# 1. TypeScript compile
npm run build

# 2. Server démarre
npm run dev

# 3. Tables SQLite existent
sqlite3 store/messages.db ".schema pwa_conversations"
sqlite3 store/messages.db ".schema pwa_messages"

# 4. CRUD conversations
TOKEN="..."
curl -X POST http://localhost:17283/api/conversations \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Test"}'

curl http://localhost:17283/api/conversations -H "Authorization: Bearer $TOKEN"

curl -X PATCH http://localhost:17283/api/conversations/$ID \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Renamed"}'

curl -X DELETE http://localhost:17283/api/conversations/$ID \
  -H "Authorization: Bearer $TOKEN"

# 5. Messages
curl -X POST http://localhost:17283/api/conversations/$ID/messages \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"content":"Hello"}'

curl http://localhost:17283/api/conversations/$ID/messages \
  -H "Authorization: Bearer $TOKEN"

# 6. Generate token
curl -X POST http://localhost:17283/api/devices/generate \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"deviceName":"Test Device"}'

# 7. Restart server → verify conversations persist
# 8. SPA fallback
curl http://localhost:17283/login  # → retourne index.html
```

### Frontend Agent

```bash
# 1. Dependencies
cd pwa && npm install

# 2. TypeScript compiles
npx tsc --noEmit

# 3. Build succeeds
npm run build

# 4. Dev server starts
npm run dev
# Vérifier en browser :
# - /login rend le formulaire, entrer token, redirect vers /
# - Sidebar rend la liste de conversations
# - Click conversation charge les messages
# - Envoyer message montre l'optimistic update
# - Responsive : resize < 768px, sidebar devient overlay
# - Animations : message slide-in, sidebar slide, context menu
```

### Agent-Runner Agent

```bash
# 1. TypeScript compiles
cd container/agent-runner && npx tsc --noEmit

# 2. Verify STATUS_PREFIX constant matches between agent-runner and container-runner
# 3. Send test message, verify status lines in container logs (groups/{folder}/logs/)
# 4. Verify status lines are NOT in final parsed output JSON
```

### End-to-End (Lead Agent)

1. `npm run build:pwa && npm run dev`
2. Générer token, ouvrir PWA, login
3. Créer conversation, envoyer message
4. Vérifier optimistic update + réponse agent + typing indicator
5. Renommer et supprimer conversation
6. Redémarrer serveur → conversations persistent
7. Tester en viewport mobile (<768px)
8. Ouvrir dans 2 onglets → sync WS multi-client
9. Page `/settings` → devices, generate token
10. Couper réseau → PWA shell charge depuis cache
