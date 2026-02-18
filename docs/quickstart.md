# Démarrage rapide

Guide d'installation en 5 minutes.

## Installation

```bash
git clone https://github.com/gavrielc/novabot.git
cd novabot
npm install
npm run build
```

## Premier démarrage

### Option 1 : PWA uniquement (Recommandé)

**Pour** : Usage personnel, interface moderne, pas besoin de WhatsApp

```bash
npm start
```

C'est tout ! NovaBot démarre avec la configuration par défaut (PWA activée).

**Vous verrez** :
- ✅ Un QR code pour connexion rapide (si configuré)
- ✅ URL locale : `http://localhost:17283`
- ✅ Token d'accès temporaire

**Connexion** :
1. Scannez le QR code avec votre téléphone
2. OU ouvrez l'URL et entrez le token
3. Le token devient permanent après première connexion

**Installation sur iOS** :
1. Ouvrez l'URL dans Safari
2. Menu Partager → "Sur l'écran d'accueil"
3. Utilisez comme app native !

### Option 2 : WhatsApp uniquement

**Pour** : Utilisation en groupe, messagerie existante

1. **Modifier la config** :
   ```bash
   nano channels.yaml
   # Mettre pwa.enabled: false
   # Mettre whatsapp.enabled: true
   ```

2. **Authentifier WhatsApp** :
   ```bash
   npm run auth
   # Scannez le QR code avec WhatsApp
   ```

3. **Démarrer** :
   ```bash
   npm start
   ```

4. **Dans un groupe WhatsApp** :
   ```
   @Nova bonjour !
   ```

### Option 3 : Les deux (PWA + WhatsApp)

1. **Config** :
   ```yaml
   # channels.yaml
   channels:
     pwa:
       enabled: true
       standalone: false    # Synchronisé avec WhatsApp
     whatsapp:
       enabled: true
   ```

2. **Authentifier WhatsApp** :
   ```bash
   npm run auth
   ```

3. **Démarrer** :
   ```bash
   npm start
   ```

Les conversations WhatsApp apparaissent dans la PWA !

## Cloudflare Tunnel (optionnel)

Pour un accès HTTPS sécurisé depuis n'importe où (connexion sortante uniquement, Google OAuth obligatoire) :

1. Suivez le guide : [docs/setup/cloudflare-tunnel.md](setup/cloudflare-tunnel.md)
2. Ajoutez le token dans `.env` :
   ```bash
   CLOUDFLARE_TUNNEL_TOKEN=eyJ...
   CLOUDFLARE_TUNNEL_HOSTNAME=novabot.example.com
   ```
3. Relancez : `npm start`

**Pas de Cloudflare ?** Pas de problème, l'app fonctionne en local.

## Gestion des devices (PWA)

### Ajouter un appareil

1. **Dans la PWA** : Settings → "Ajouter un appareil" → QR code
2. **Ou depuis le terminal** :
   ```bash
   npm start -- --add-device "Mon iPhone"
   ```

### Voir les appareils connectés

1. **Dans la PWA** : Settings → Devices
2. **Ou depuis le terminal** :
   ```bash
   npm start -- --list-devices
   ```

### Révoquer un appareil

1. **Dans la PWA** : Settings → Devices → Révoquer
2. **Ou depuis le terminal** :
   ```bash
   npm start -- --revoke-device <token>
   ```

## Fichiers importants

```
channels.yaml          # Configuration des interfaces
data/                  # Données de l'application
groups/                # Mémoire par conversation
  main/CLAUDE.md      # Instructions globales de l'assistant
public/                # Interface PWA
```

## Commandes utiles

```bash
npm start              # Démarrer NovaBot
npm run auth          # Authentifier WhatsApp
npm run build         # Recompiler après modifications
npm run dev           # Mode développement (hot reload)
```

## Personnalisation

**Via skill interactif** :
```bash
# Dans Claude Code
/channels              # Configurer les interfaces
/customize            # Ajouter des fonctionnalités
```

**Via fichiers** :
- `channels.yaml` - Configuration des channels
- `groups/main/CLAUDE.md` - Instructions pour l'assistant

## Troubleshooting

**PWA ne démarre pas** :
- Vérifiez que `channels.yaml` existe
- Port 3000 libre ? `lsof -i :17283`

**WhatsApp ne se connecte pas** :
- Relancez `npm run auth`
- Vérifiez que le téléphone est connecté

**Cloudflare Tunnel ne se connecte pas** :
- Vérifiez que `cloudflared` est installé : `cloudflared --version`
- Vérifiez le token dans `.env`
- Consultez les logs pour les erreurs de connexion

**Token expiré** :
- Les tokens temporaires expirent après 5 minutes
- Redémarrez `npm start` pour un nouveau token

## Prochaines étapes

- **[Channels](channels.md)** - Comprendre PWA, WhatsApp, et configuration avancée
- **[Architecture](architecture.md)** - Détails techniques (pour contributeurs)
- **Skills** - Explorez `/setup`, `/channels`, `/customize` dans Claude Code
