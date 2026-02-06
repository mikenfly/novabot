# Architecture Channels - Guide Complet

NanoClaw utilise une architecture modulaire basée sur des **channels** (canaux). Chaque channel est une interface de communication indépendante.

## Concept

Un **channel** est une interface qui permet d'interagir avec l'assistant :
- **PWA** : Interface web progressive (navigateur, iOS)
- **WhatsApp** : Bot de messagerie
- **Telegram** : Bot Telegram (futur)
- **Slack** : Bot Slack (futur)

**Avantages** :
- ✅ Activez uniquement ce dont vous avez besoin
- ✅ Plusieurs channels en parallèle
- ✅ Configuration centralisée
- ✅ Extensible facilement

## Configuration : `channels.yaml`

Le fichier `channels.yaml` à la racine du projet contrôle tous les channels :

```yaml
channels:
  # Progressive Web App
  pwa:
    enabled: true           # Activer/désactiver
    port: 3000             # Port du serveur web
    standalone: true       # Mode indépendant (sans WhatsApp)
    tailscale_funnel: true # Exposition publique via Tailscale

  # WhatsApp
  whatsapp:
    enabled: false         # Activer/désactiver
    trigger: "@Jimmy"      # Mot-clé pour déclencher l'assistant

  # Telegram (à venir)
  telegram:
    enabled: false

  # Slack (à venir)
  slack:
    enabled: false

# Configuration globale
assistant:
  name: "Jimmy"
  timezone: "Europe/Paris"

paths:
  data_dir: "./data"
  groups_dir: "./groups"
  store_dir: "./store"
```

## Channels disponibles

### PWA (Progressive Web App)

**Interface web moderne** accessible depuis n'importe quel navigateur ou iPhone.

**Modes** :
- **Standalone** (`standalone: true`) : Conversations directes avec l'agent, pas besoin de WhatsApp
- **Synchronisé** (`standalone: false`) : Synchronisé avec les groupes WhatsApp

**Fonctionnalités** :
- ✅ Interface chat moderne
- ✅ Rendu markdown avec code formaté
- ✅ Notifications push
- ✅ Installation sur écran d'accueil (iOS)
- ✅ Mode hors ligne
- ✅ Authentification par token
- ✅ WebSocket temps réel

**Configuration** :
```yaml
pwa:
  enabled: true
  port: 3000                 # Port local
  standalone: true           # true = indépendant, false = sync WhatsApp
  tailscale_funnel: true     # Exposition publique HTTPS
```

**Démarrage** :
```bash
npm start
# → Affiche QR code pour connexion
# → URL: https://[machine].tail[xxx].ts.net
```

**Accès** :
- Local : `http://localhost:3000`
- Tailscale Funnel : `https://[hostname].tail[xxx].ts.net`
- Token requis (affiché au démarrage)

### WhatsApp

**Bot de messagerie** qui répond dans les groupes WhatsApp.

**Fonctionnalités** :
- ✅ Répond dans les groupes
- ✅ Trigger pattern configurable
- ✅ Groupes isolés (mémoire séparée)
- ✅ Tâches programmées
- ✅ Gestion multi-groupes

**Configuration** :
```yaml
whatsapp:
  enabled: true
  trigger: "@Jimmy"          # Mot pour déclencher (ex: @Jimmy bonjour)
```

**Setup initial** :
```bash
npm run auth
# → Scannez le QR code avec votre téléphone
# → WhatsApp → Paramètres → Appareils connectés
```

**Utilisation** :
- Dans un groupe WhatsApp : `@Jimmy quelle heure est-il ?`
- Groupe principal : répond à tous les messages
- Autres groupes : seulement si mention `@Jimmy`

### Telegram (À venir)

Bot Telegram pour interagir via cette plateforme.

### Slack (À venir)

Bot Slack pour les équipes professionnelles.

## Modes d'utilisation

### Mode 1 : PWA uniquement (recommandé)

**Pour** : Usage personnel, pas besoin de WhatsApp

```yaml
channels:
  pwa:
    enabled: true
    standalone: true
  whatsapp:
    enabled: false
```

**Avantages** :
- Simple à configurer
- Pas besoin de téléphone connecté
- Interface moderne
- Conversations privées

### Mode 2 : WhatsApp uniquement

**Pour** : Utilisation en groupe, messagerie existante

```yaml
channels:
  pwa:
    enabled: false
  whatsapp:
    enabled: true
```

**Avantages** :
- Les gens utilisent déjà WhatsApp
- Pas besoin de nouvelle app
- Groupes existants

### Mode 3 : Multi-channels (avancé)

**Pour** : Meilleur des deux mondes

```yaml
channels:
  pwa:
    enabled: true
    standalone: false      # Synchronisé avec WhatsApp
  whatsapp:
    enabled: true
```

**Avantages** :
- Interface web + WhatsApp
- Conversations synchronisées
- Accès depuis partout

## Commandes

### Changer la configuration

**Manuellement** :
```bash
nano channels.yaml
# Éditez la config
npm start
```

**Via skill** (recommandé) :
```bash
# Dans Claude Code
/channels
```

Le skill vous guide interactivement.

### Voir la config actuelle

```bash
cat channels.yaml
```

### Reset à la config par défaut

```bash
rm channels.yaml
npm start
# Crée une nouvelle config par défaut
```

## Architecture technique

### Flux des messages

**Mode PWA standalone** :
```
User → PWA Frontend → API POST /messages
  → PWA Channel → Container Agent
  → Response → WebSocket → Frontend
```

**Mode WhatsApp** :
```
User → WhatsApp → Baileys → Message Router
  → Container Agent → Baileys → WhatsApp
```

### Fichiers clés

```
src/
├── channels-config.ts     # Chargement config
├── pwa-channel.ts         # Logic PWA standalone
├── web-server.ts          # API + WebSocket
├── index.ts               # Point d'entrée, init channels
└── container-runner.ts    # Exécution agent

public/                    # Frontend PWA
├── index.html
├── app.js
├── styles.css
└── sw.js                  # Service worker

channels.yaml              # Configuration
```

### Stockage

**PWA standalone** :
- Conversations : En mémoire
- Sessions : En mémoire
- Pas de DB (pour l'instant)

**WhatsApp** :
- Messages : SQLite (`store/messages.db`)
- Sessions : JSON (`data/sessions.json`)
- Groupes : JSON (`data/registered_groups.json`)

## Extensibilité

### Ajouter un nouveau channel

1. **Créer le module** : `src/telegram-channel.ts`
2. **Ajouter dans config** : `channels.yaml`
3. **Loader le channel** : `src/index.ts`
4. **Endpoints API** si besoin

Exemple structure :
```typescript
export function initTelegramChannel(config) {
  // Setup bot
  // Event handlers
  // Appeler l'agent
}
```

### API pour custom channels

Tous les channels peuvent appeler l'agent via :
```typescript
import { runContainerAgent } from './container-runner.js';

const response = await runContainerAgent(group, {
  prompt: '<messages>...</messages>',
  sessionId: 'session-id',
  groupFolder: 'folder-name',
  chatJid: 'unique-id',
  isMain: false,
});
```

## Troubleshooting

### PWA ne démarre pas

1. Vérifiez `channels.yaml` : `pwa.enabled: true`
2. Port occupé ? Changez `pwa.port`
3. Logs : `npm start` affiche les erreurs

### WhatsApp ne se connecte pas

1. Authentification : `npm run auth`
2. Vérifiez téléphone connecté
3. Sessions : supprimez `store/auth/` et réauthentifiez

### Channels ne se chargent pas

1. `channels.yaml` existe ? Sinon, copier depuis exemple
2. Syntaxe YAML correcte ? Pas de tabulations
3. Rebuild : `npm run build && npm start`

### Tailscale Funnel ne marche pas

1. Permissions : `sudo tailscale set --operator=$USER`
2. Tailscale actif ? `tailscale status`
3. Désactiver : `tailscale_funnel: false` dans config

## FAQ

**Q: Puis-je avoir plusieurs channels en même temps ?**
A: Oui ! Activez-les tous dans `channels.yaml`.

**Q: Les conversations sont-elles synchronisées entre channels ?**
A: Dépend du mode. En `standalone: false`, PWA est synchronisé avec WhatsApp.

**Q: Comment migrer de WhatsApp vers PWA ?**
A: Actuellement pas de migration. Les deux peuvent coexister.

**Q: Les channels partagent-ils la mémoire de l'agent ?**
A: Chaque conversation a sa propre mémoire (isolée par dossier).

**Q: Peut-on avoir plusieurs ports PWA ?**
A: Non, un seul serveur web par instance. Lancez plusieurs instances pour plusieurs ports.

**Q: Les messages WhatsApp apparaissent dans la PWA ?**
A: Seulement en mode `standalone: false` (synchronisé).

## Prochaines étapes

Voir aussi :
- [README.md](../README.md) - Vue d'ensemble
- [DEMARRAGE_PWA.md](../DEMARRAGE_PWA.md) - Guide PWA
- [TAILSCALE_FUNNEL.md](../TAILSCALE_FUNNEL.md) - Configuration Tailscale
