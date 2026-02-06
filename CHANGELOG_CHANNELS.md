# Changelog - Channels & PWA Integration

Date: 2024-02-06

## Vue d'ensemble

Ce fork ajoute une architecture modulaire de **channels** (canaux) à NanoClaw, permettant d'interagir avec l'assistant via plusieurs interfaces : PWA (Progressive Web App), WhatsApp, et d'autres à venir (Telegram, Slack).

## Changements majeurs

### 1. Architecture Channels

**Nouveaux fichiers** :
- `src/channels-config.ts` - Système de configuration centralisé pour tous les channels
- `channels.yaml` - Fichier de configuration utilisateur
- `channels.example.yaml` - Exemples de configuration

**Concept** :
- Configuration centralisée dans `channels.yaml`
- Chaque channel peut être activé/désactivé indépendamment
- Support multi-channels simultanés
- Configuration par défaut : PWA standalone activé, WhatsApp désactivé

### 2. PWA (Progressive Web App)

**Nouveaux fichiers** :

Backend :
- `src/pwa-channel.ts` - Gestion des conversations PWA standalone
- `src/web-server.ts` - API REST + WebSocket pour la PWA
- `src/auth.ts` - Système d'authentification par tokens
- `src/tailscale-funnel.ts` - Configuration automatique de Tailscale Funnel

Frontend :
- `public/index.html` - Interface utilisateur PWA
- `public/app.js` - Logique client (API, WebSocket, UI)
- `public/styles.css` - Styles modernes responsive
- `public/sw.js` - Service Worker (offline, notifications)
- `public/manifest.json` - Manifest PWA (installation iOS)
- `public/CREATE_ICONS.txt` - Guide pour générer les icônes

Scripts :
- `scripts/generate-token.js` - Générateur de tokens d'accès

**Fonctionnalités** :
- Interface chat moderne avec rendu Markdown
- Authentification par token sécurisée
- WebSocket temps réel
- Support iOS (installation sur écran d'accueil)
- Mode standalone : conversations directes avec l'agent (pas besoin de WhatsApp)
- Mode synchronisé : affichage des conversations WhatsApp dans la PWA
- Tailscale Funnel : exposition HTTPS publique automatique
- QR code de connexion rapide

**Modes d'utilisation** :
1. **Standalone** (`pwa.standalone: true`) : Conversations indépendantes, pas de WhatsApp requis
2. **Synchronisé** (`pwa.standalone: false`) : Synchronisation avec les groupes WhatsApp

### 3. Configuration et documentation

**Documentation** :
- `QUICKSTART.md` - Guide de démarrage rapide (5 min)
- `DEMARRAGE_PWA.md` - Guide PWA détaillé
- `TAILSCALE_FUNNEL.md` - Configuration Tailscale Funnel
- `docs/CHANNELS.md` - Architecture complète des channels

**Skill** :
- `.claude/skills/channels/SKILL.md` - Skill interactif pour configurer les channels

### 4. Authentification et sécurité

**Système de tokens** :
- Tokens générés automatiquement au démarrage ou via script
- Expiration configurable (1 an par défaut)
- Gestion multi-devices
- API de révocation

**Tailscale Funnel** :
- Configuration automatique au démarrage
- Fallback gracieux si Tailscale non disponible
- Génération de QR code pour connexion rapide
- HTTPS gratuit et certificat auto-géré

### 5. Architecture technique

**Flux de messages** :

Mode PWA standalone :
```
User → PWA Frontend → POST /api/conversations/:jid/messages
     → pwa-channel.ts → container-runner.ts (agent)
     → WebSocket → Frontend
```

Mode WhatsApp :
```
User → WhatsApp → Baileys → index.ts
     → container-runner.ts (agent)
     → Baileys → WhatsApp
```

**API REST** :
- `POST /api/login` - Authentification
- `GET /api/conversations` - Liste des conversations
- `GET /api/conversations/:jid/messages` - Messages d'une conversation
- `POST /api/conversations/:jid/messages` - Envoyer un message
- `POST /api/conversations` - Créer une conversation (PWA standalone)
- `GET /api/tokens` - Gestion des tokens
- `DELETE /api/tokens/:token` - Révoquer un token

**WebSocket** :
- Temps réel bidirectionnel
- Notifications de nouveaux messages
- Ping/pong keep-alive

### 6. Stockage

**PWA standalone** :
- Conversations en mémoire (in-memory)
- Sessions en mémoire
- Pas de persistence DB (pour l'instant)

**WhatsApp** :
- Messages : SQLite (`store/messages.db`)
- Sessions : JSON (`data/sessions.json`)
- Groupes : JSON (`data/registered_groups.json`)

### 7. Configuration par défaut

```yaml
channels:
  pwa:
    enabled: true
    port: 3000
    standalone: true           # Mode indépendant
    tailscale_funnel: true     # Exposition HTTPS publique

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

## État d'intégration

### ✅ Complet et fonctionnel

- Architecture channels (config, loader)
- PWA backend complet (API, WebSocket, auth)
- PWA frontend complet (UI, service worker, manifest)
- Tailscale Funnel automatique
- Documentation complète
- Skill de configuration

### ⚠️ Non intégré

**IMPORTANT** : Le code PWA/channels existe mais n'est **pas encore appelé depuis `src/index.ts`**.

Pour compléter l'intégration :

1. Importer dans `src/index.ts` :
```typescript
import { loadChannelsConfig, isChannelEnabled } from './channels-config.js';
import { startWebServer, notifyNewMessage } from './web-server.js';
import { initializeAuth } from './auth.js';
import { setupTailscaleFunnel, displayConnectionQR, ensureAccessToken } from './tailscale-funnel.js';
```

2. Ajouter au `main()` :
```typescript
async function main(): Promise<void> {
  ensureContainerSystemRunning();
  initDatabase();
  logger.info('Database initialized');
  loadState();

  // Charger la configuration des channels
  const config = loadChannelsConfig();

  // Initialiser la PWA si activée
  if (isChannelEnabled('pwa')) {
    initializeAuth();

    // Tailscale Funnel
    if (config.channels.pwa?.tailscale_funnel) {
      const tailscale = await setupTailscaleFunnel();
      if (tailscale) {
        const token = await ensureAccessToken();
        displayConnectionQR(tailscale.funnelUrl, token);
      }
    }

    // Démarrer le serveur web
    const port = config.channels.pwa?.port || 3000;
    startWebServer(
      port,
      () => registeredGroups,
      async (jid, text) => {
        await sock.sendMessage(jid, { text });
      }
    );
  }

  // WhatsApp (optionnel maintenant)
  if (isChannelEnabled('whatsapp')) {
    await connectWhatsApp();
  }
}
```

3. Ajouter `WEB_PORT` à `src/config.ts` :
```typescript
export const WEB_PORT = parseInt(process.env.WEB_PORT || '3000', 10);
```

4. Notifier les clients WebSocket des nouveaux messages :
```typescript
// Dans la fonction storeMessage ou le handler messages.upsert
import { notifyNewMessage } from './web-server.js';

// Après storageMessage
if (isChannelEnabled('pwa')) {
  notifyNewMessage({
    chat_jid: chatJid,
    sender_name: msg.pushName || 'User',
    content: messageContent,
    timestamp: timestamp,
  });
}
```

### 📦 Nouvelles dépendances

Ajoutées à `package.json` :
```json
{
  "dependencies": {
    "express": "^4.18.2",
    "ws": "^8.14.2",
    "js-yaml": "^4.1.0",
    "qrcode-terminal": "^0.12.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.20",
    "@types/ws": "^8.5.8",
    "@types/js-yaml": "^4.0.9"
  }
}
```

## Cas d'usage

### Usage personnel (recommandé)
```yaml
pwa.enabled: true
pwa.standalone: true
whatsapp.enabled: false
```
→ Interface moderne, pas besoin de WhatsApp

### Équipe avec WhatsApp
```yaml
pwa.enabled: true
pwa.standalone: false  # Synchronisé
whatsapp.enabled: true
```
→ PWA + WhatsApp synchronisés

### WhatsApp uniquement
```yaml
pwa.enabled: false
whatsapp.enabled: true
```
→ Comportement original de NanoClaw

## Migration

Pour migrer un NanoClaw existant :

1. Pull les changements
2. `npm install` (nouvelles dépendances)
3. Créer `channels.yaml` ou laisser la config par défaut
4. `npm run build`
5. `npm start`

La config par défaut active la PWA standalone, donc NanoClaw fonctionnera immédiatement avec l'interface web.

Pour revenir au comportement WhatsApp-only :
```yaml
channels:
  pwa:
    enabled: false
  whatsapp:
    enabled: true
```

## Améliorations futures

- [ ] Persistence des conversations PWA (SQLite)
- [ ] Support Telegram
- [ ] Support Slack
- [ ] Mode multi-utilisateurs pour la PWA
- [ ] Pièces jointes dans la PWA
- [ ] Notifications push natives
- [ ] Export/import de conversations
- [ ] Synchronisation bi-directionnelle PWA ↔ WhatsApp

## Auteur

Fork par mikenfly (miklaw)
Base : NanoClaw par gavrielc
