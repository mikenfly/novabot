---
name: channels
description: Configure NanoClaw channels (PWA, WhatsApp, Telegram, Slack). Interactive guide to enable/disable interfaces, choose between standalone and synchronized modes, and optimize setup for personal or team use.
---

# Channels Management

Ce skill aide l'utilisateur à configurer les channels (interfaces) de NanoClaw.

## Ton rôle

Tu es un assistant qui guide l'utilisateur dans la configuration des channels NanoClaw. Tu dois :

1. **Comprendre les besoins** de l'utilisateur
2. **Recommander** la meilleure configuration
3. **Modifier** `channels.yaml` selon les choix
4. **Expliquer** les changements

## Channels disponibles

### PWA (Progressive Web App)
- Interface web moderne
- Accessible depuis navigateur ou iOS
- **Modes** :
  - `standalone: true` : Indépendant, conversations directes avec l'agent
  - `standalone: false` : Synchronisé avec WhatsApp
- **Options** :
  - `port` : Port du serveur (défaut 3000)
  - `tailscale_funnel` : Exposition publique HTTPS

**Recommandé pour** : Usage personnel, interface moderne, pas besoin de WhatsApp

### WhatsApp
- Bot de messagerie dans les groupes
- Nécessite authentification téléphone
- **Options** :
  - `trigger` : Mot-clé pour déclencher (ex: "@Jimmy")

**Recommandé pour** : Groupes existants, équipes qui utilisent déjà WhatsApp

### Telegram (à venir)
- Bot Telegram
- Pas encore implémenté

### Slack (à venir)
- Bot Slack pour équipes
- Pas encore implémenté

## Workflow

### 1. Comprendre le besoin

Pose des questions pour comprendre :
- Utilisation personnelle ou en équipe ?
- Préférence pour interface moderne ou messagerie existante ?
- Besoin de WhatsApp ?
- Besoin d'accès externe (Tailscale) ?

### 2. Recommander

Selon les réponses :

**Usage personnel, moderne** :
```yaml
pwa:
  enabled: true
  standalone: true
  tailscale_funnel: true
whatsapp:
  enabled: false
```

**Équipe avec WhatsApp** :
```yaml
pwa:
  enabled: true
  standalone: false  # Synchronisé
whatsapp:
  enabled: true
  trigger: "@Jimmy"
```

**WhatsApp uniquement** :
```yaml
pwa:
  enabled: false
whatsapp:
  enabled: true
```

### 3. Modifier la config

1. **Lire** `channels.yaml`
2. **Modifier** selon les choix
3. **Écrire** le nouveau fichier
4. **Expliquer** ce qui a changé

### 4. Instructions post-config

Après modification :
```bash
npm run build
npm start
```

Si WhatsApp activé pour la première fois :
```bash
npm run auth  # Scanner QR code
```

## Exemples d'interactions

### Exemple 1 : Premier setup

**User** : "/channels"

**You** :
```
Configurons les interfaces de NanoClaw !

Questions :
1. Utilisation personnelle ou en équipe ?
2. Voulez-vous une interface web moderne ?
3. Besoin de WhatsApp ?
```

**User** : "Personnel, interface web, pas de WhatsApp"

**You** :
```
Parfait ! Je recommande :
- ✅ PWA activée (mode standalone)
- ✅ Tailscale Funnel (accès HTTPS public)
- ❌ WhatsApp désactivé

Cette config vous donnera une interface web moderne accessible depuis
n'importe où, sans dépendre de WhatsApp.

[Modifier channels.yaml avec ces paramètres]

Configuration appliquée ! Lancez :
  npm start

Un QR code s'affichera pour vous connecter depuis iOS.
```

### Exemple 2 : Activer WhatsApp

**User** : "Je veux ajouter WhatsApp"

**You** :
```
D'accord ! Quelques questions :

1. Voulez-vous garder la PWA aussi ?
2. Si oui, synchroniser PWA avec WhatsApp ou séparer ?
3. Quel mot-clé pour déclencher l'assistant ? (ex: @Jimmy)
```

**User** : "Garder PWA, synchroniser, @Andy"

**You** :
```
Configuration mise à jour :
- ✅ PWA (synchronisée avec WhatsApp)
- ✅ WhatsApp (trigger: @Andy)

[Modifier channels.yaml]

Pour finaliser :
1. npm run auth     # Authentifier WhatsApp
2. npm start        # Démarrer

Les conversations WhatsApp apparaîtront dans la PWA !
```

### Exemple 3 : Voir config actuelle

**User** : "Quelle est ma config ?"

**You** :
```
Configuration actuelle :

✅ PWA
   - Mode: standalone
   - Port: 3000
   - Tailscale Funnel: activé

❌ WhatsApp (désactivé)
❌ Telegram (pas encore disponible)
❌ Slack (pas encore disponible)

Voulez-vous modifier quelque chose ?
```

## Commandes importantes

### Lire la config
```bash
cat channels.yaml
```

### Tester la config
```bash
npm run build && npm start
```

### Reset à défaut
```bash
rm channels.yaml
npm start  # Génère une config par défaut
```

## Notes importantes

- **Rebuild requis** : Après modification, toujours faire `npm run build`
- **WhatsApp nécessite auth** : `npm run auth` si activé pour la première fois
- **Port en conflit** : Changer `pwa.port` si 3000 occupé
- **Tailscale optionnel** : Mettre `tailscale_funnel: false` si pas besoin

## Fichiers à manipuler

- **Config** : `channels.yaml` (racine du projet)
- **Doc** : `docs/CHANNELS.md` (référence complète)
- **Exemple** : Tu peux créer `channels.example.yaml` pour exemples

## Garde-fous

Avant de modifier :
1. **Backup** : Sauvegarder `channels.yaml` actuel
2. **Validation** : Vérifier syntaxe YAML
3. **Explication** : Expliquer clairement les changements

Ne jamais :
- Supprimer la section `channels`
- Utiliser des tabulations (YAML nécessite espaces)
- Oublier les `:` après les clés
