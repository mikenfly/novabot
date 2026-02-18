# Channels - Interfaces de communication

NanoClaw supporte plusieurs **channels** (interfaces) pour interagir avec l'assistant. Chaque channel peut être activé/désactivé indépendamment via `channels.yaml`.

## Table des matières

- [PWA (Progressive Web App)](#pwa)
  - [Fonctionnalités](#fonctionnalités-pwa)
  - [Configuration](#configuration-pwa)
  - [Authentification et tokens](#authentification-et-tokens)
  - [Gestion des devices](#gestion-des-devices)
  - [Cloudflare Tunnel + Access](#cloudflare-tunnel--access)
- [WhatsApp](#whatsapp)
- [Telegram](#telegram) (à venir)
- [Slack](#slack) (à venir)
- [Configuration générale](#configuration)

---

## PWA

Interface web moderne accessible depuis n'importe quel navigateur ou iPhone.

### Fonctionnalités PWA

- ✅ Interface chat moderne avec rendu Markdown
- ✅ Code syntax highlighting
- ✅ WebSocket temps réel (pas de polling)
- ✅ Installation sur écran d'accueil iOS
- ✅ Notifications push natives
- ✅ Mode hors ligne (via Service Worker)
- ✅ Multi-devices simultanés
- ✅ Authentification par tokens sécurisés
- ✅ Accès HTTPS sécurisé via Cloudflare Tunnel + Access

### Configuration PWA

```yaml
# channels.yaml
channels:
  pwa:
    enabled: true              # Activer/désactiver
    port: 17283                # Port du serveur web
    standalone: true          # Mode standalone ou synchronisé
    cloudflare_tunnel: true   # Tunnel sécurisé (nécessite token dans .env)
```

**Modes** :

1. **Standalone** (`standalone: true`)
   - Conversations directes avec l'agent
   - Pas besoin de WhatsApp
   - Recommandé pour usage personnel

2. **Synchronisé** (`standalone: false`)
   - Affiche les conversations WhatsApp dans la PWA
   - Nécessite WhatsApp activé
   - Pour équipes utilisant déjà WhatsApp

### Authentification et tokens

La PWA utilise un système de **tokens temporaires** et **permanents** pour l'authentification.

#### Comment ça marche

1. **Démarrage** : `npm start` génère un **token temporaire**
   - Valide pendant **5 minutes**
   - Affiché dans le QR code et la console
   - Usage unique (expire après première connexion)

2. **Première connexion** :
   - Scannez le QR code OU entrez le token manuellement
   - Le token temporaire est validé
   - Un **token permanent** est créé pour votre device
   - Le token temporaire expire

3. **Connexions suivantes** :
   - Votre device utilise son token permanent
   - Pas besoin de re-scanner

#### Tokens temporaires

**Expiration** :
- Après première utilisation (pairing réussi)
- Après 5 minutes si non utilisé
- Au redémarrage de NanoClaw

**Obtenir un nouveau token** :
```bash
npm start    # Affiche un nouveau token
```

#### Tokens permanents

**Caractéristiques** :
- Un token par device
- Jamais d'expiration
- Révocable depuis la PWA ou CLI
- Stockés dans `data/auth.json`

**Sécurité** :
- Générés avec `crypto.randomBytes(32)` (256 bits)
- Transmission via HTTPS (Cloudflare Tunnel)
- Pas de password requis (tokens suffisent)

### Gestion des devices

Vous pouvez connecter plusieurs appareils simultanément (iPhone, iPad, laptop, etc.).

#### Ajouter un device

**Méthode 1 : Via PWA**
1. Ouvrez la PWA sur un device déjà connecté
2. Settings → "Ajouter un appareil"
3. Un QR code s'affiche
4. Scannez avec le nouvel appareil

**Méthode 2 : Via terminal**
```bash
npm start -- --add-device "Nom du device"
# Affiche un QR code + token temporaire
```

**Méthode 3 : Redémarrage**
```bash
npm start
# Affiche toujours un token temporaire au démarrage
```

#### Voir les devices connectés

**Méthode 1 : Via PWA**
1. Settings → "Appareils"
2. Liste avec nom, date de connexion, dernier accès

**Méthode 2 : Via terminal**
```bash
npm start -- --list-devices
```

Affiche :
```
📱 Devices connectés (3):

1. iPhone de Michael
   Token: a3f9...
   Connecté: 2024-02-06 10:30
   Dernier accès: il y a 2h

2. iPad Pro
   Token: 7bc2...
   Connecté: 2024-02-05 18:00
   Dernier accès: il y a 1 jour

3. MacBook
   Token: e1d4...
   Connecté: 2024-02-04 09:15
   Dernier accès: actif
```

#### Révoquer un device

**Méthode 1 : Via PWA**
1. Settings → "Appareils"
2. Cliquez sur "Révoquer" à côté du device
3. Confirmation requise

**Méthode 2 : Via terminal**
```bash
npm start -- --revoke-device <token>
# ou
npm start -- --revoke-device "Nom du device"
```

**Note** : Le device révoqué devra se reconnecter avec un nouveau token temporaire.

### Cloudflare Tunnel + Access

Cloudflare Tunnel expose votre PWA sur internet via une connexion sortante uniquement (aucun port ouvert). Cloudflare Access ajoute une authentification Google OAuth obligatoire.

#### Avantages

- ✅ Connexion sortante uniquement — aucun port ouvert sur la machine
- ✅ Authentification Google OAuth obligatoire (Cloudflare Access)
- ✅ WAF, rate limiting, geo-filtering, anti-DDoS inclus
- ✅ URL HTTPS fixe qui ne change jamais
- ✅ Certificat SSL automatique
- ✅ Fonctionne derrière firewall/NAT

#### Setup

Voir le guide complet : [docs/setup/cloudflare-tunnel.md](setup/cloudflare-tunnel.md)

En résumé :
1. Installer `cloudflared`
2. Créer un tunnel dans le dashboard Cloudflare Zero Trust
3. Configurer Cloudflare Access avec Google OAuth
4. Ajouter le token dans `.env`

#### Configuration

```bash
# .env
CLOUDFLARE_TUNNEL_TOKEN=eyJ...
CLOUDFLARE_TUNNEL_HOSTNAME=nanoclaw.example.com
```

#### Désactiver le tunnel

Ne pas définir `CLOUDFLARE_TUNNEL_TOKEN` dans `.env`. L'app fonctionnera en local uniquement : `http://localhost:17283`

---

## WhatsApp

Bot de messagerie qui répond dans les groupes WhatsApp.

### Fonctionnalités WhatsApp

- ✅ Répond dans les groupes
- ✅ Trigger pattern configurable (`@Jimmy`)
- ✅ Groupes isolés (mémoire séparée)
- ✅ Tâches programmées
- ✅ Gestion multi-groupes

### Configuration WhatsApp

```yaml
# channels.yaml
channels:
  whatsapp:
    enabled: true
    trigger: "@Jimmy"    # Mot-clé pour déclencher
```

### Setup initial

```bash
npm run auth
# Scannez le QR code avec votre téléphone
# WhatsApp → Paramètres → Appareils connectés → Associer un appareil
```

### Utilisation

**Dans un groupe WhatsApp** :
```
@Jimmy quelle heure est-il ?
@Jimmy envoie un résumé chaque lundi matin
@Jimmy liste toutes les tâches programmées
```

**Dans le groupe principal** (`main`) :
- Répond à tous les messages
- Pas besoin de mentionner `@Jimmy`

**Dans les autres groupes** :
- Répond uniquement si `@Jimmy` est mentionné

### Enregistrer un nouveau groupe

1. Ajoutez le bot au groupe WhatsApp
2. Dans le groupe `main` :
   ```
   @Jimmy enregistre ce groupe
   ```
3. Suivez les instructions

Ou via skill :
```
/setup
# Choisir "Enregistrer un groupe"
```

---

## Telegram

**Statut** : À venir

Bot Telegram pour interagir via cette plateforme.

**Configuration prévue** :
```yaml
telegram:
  enabled: true
  bot_token: "YOUR_BOT_TOKEN"
```

Pour l'implémenter : `/customize` → "Ajouter Telegram"

---

## Slack

**Statut** : À venir

Bot Slack pour les équipes professionnelles.

**Configuration prévue** :
```yaml
slack:
  enabled: true
  bot_token: "xoxb-..."
  app_token: "xapp-..."
```

Pour l'implémenter : `/customize` → "Ajouter Slack"

---

## Configuration

Le fichier `channels.yaml` à la racine du projet contrôle tous les channels.

### Structure complète

```yaml
channels:
  # Progressive Web App
  pwa:
    enabled: true
    port: 17283
    standalone: true
    cloudflare_tunnel: true   # Nécessite CLOUDFLARE_TUNNEL_TOKEN dans .env

  # WhatsApp
  whatsapp:
    enabled: false
    trigger: "@Jimmy"

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

# Chemins (ne pas modifier sauf si nécessaire)
paths:
  data_dir: "./data"
  groups_dir: "./groups"
  store_dir: "./store"
```

### Notes importantes

**Configuration du port :**
- Le port défini dans `channels.yaml` (`pwa.port`) est la **source unique de vérité**
- Ce port est utilisé par le serveur web ET par le Cloudflare Tunnel
- Pour changer le port, modifiez uniquement cette valeur dans `channels.yaml`
- Port par défaut : `17283` (choisi pour éviter les conflits avec les ports courants comme 3000)

### Exemples de configuration

#### PWA uniquement (personnel)

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

#### WhatsApp uniquement (groupes)

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

#### Multi-channels (avancé)

```yaml
channels:
  pwa:
    enabled: true
    standalone: false    # Synchronisé
  whatsapp:
    enabled: true
```

**Avantages** :
- Interface web + WhatsApp
- Conversations synchronisées
- Accès depuis partout

### Changer la configuration

**Manuellement** :
```bash
nano channels.yaml
npm start
```

**Via skill** (recommandé) :
```bash
# Dans Claude Code
/channels
```

Le skill vous guide interactivement.

### Reset à la config par défaut

```bash
rm channels.yaml
npm start
# Crée une nouvelle config par défaut (PWA activé)
```

---

## Stockage

### PWA

**Mode standalone** :
- Conversations : En mémoire
- Sessions : En mémoire
- Tokens : `data/auth.json`

**Note** : Persistence SQLite prévue pour une future version.

### WhatsApp

- Messages : SQLite `store/messages.db`
- Sessions : JSON `data/sessions.json`
- Groupes : JSON `data/registered_groups.json`

---

## API (pour développeurs)

La PWA expose une API REST + WebSocket.

### REST Endpoints

```
POST   /api/login                         # Authentification
GET    /api/conversations                 # Liste conversations
GET    /api/conversations/:jid/messages   # Messages d'une conversation
POST   /api/conversations/:jid/messages   # Envoyer un message
POST   /api/conversations                 # Créer conversation (PWA standalone)
GET    /api/devices                       # Liste devices
DELETE /api/devices/:token                # Révoquer device
```

### WebSocket

**URL** : `ws://localhost:17283/ws?token=<token>`

**Messages** :
```json
// Nouveau message
{
  "type": "message",
  "data": {
    "chat_jid": "...",
    "sender_name": "...",
    "content": "...",
    "timestamp": "..."
  }
}

// Ping/pong (keep-alive)
{ "type": "ping" }
{ "type": "pong" }
```

---

## Prochaines étapes

- **[Démarrage rapide](quickstart.md)** - Installation et setup
- **[Architecture](architecture.md)** - Détails techniques
- **Skills** - Utilisez `/channels` pour configurer interactivement
