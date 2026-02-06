# Démarrage Rapide NanoClaw

## Installation (5 minutes)

```bash
git clone https://github.com/gavrielc/nanoclaw.git
cd nanoclaw
npm install
npm run build
```

## Première utilisation

### Option 1 : PWA uniquement (Recommandé)

**Pour** : Usage personnel, interface moderne, pas besoin de WhatsApp

```bash
# 1. La config par défaut utilise déjà PWA standalone
npm start

# 2. Un QR code s'affiche
# → Scannez avec votre iPhone
# → Vous êtes connecté !

# 3. Commencez à discuter
# → Pas besoin de @Jimmy
# → L'assistant répond directement
```

**URL** : `https://[votre-machine].tail[xxx].ts.net` (via Tailscale Funnel)

**Setup Tailscale** (une fois) :
```bash
sudo tailscale set --operator=$USER
```

### Option 2 : WhatsApp uniquement

**Pour** : Utilisation en groupe, messagerie existante

```bash
# 1. Modifier la config
nano channels.yaml
# Mettre whatsapp.enabled: true
# Mettre pwa.enabled: false

# 2. Authentifier WhatsApp
npm run auth
# → Scannez le QR code avec WhatsApp

# 3. Démarrer
npm start

# 4. Dans un groupe WhatsApp
@Jimmy bonjour !
```

### Option 3 : Les deux en parallèle

**Pour** : Meilleur des deux mondes

```yaml
# channels.yaml
channels:
  pwa:
    enabled: true
    standalone: false    # Synchronisé avec WhatsApp
  whatsapp:
    enabled: true
```

```bash
npm run auth    # Authentifier WhatsApp
npm start       # Démarrer
```

Les conversations WhatsApp apparaissent dans la PWA !

## Configuration interactive

```bash
# Lancez Claude Code
claude

# Dans Claude Code
/channels
```

Claude vous guide pour configurer les interfaces.

## Fichiers importants

```
channels.yaml              # Configuration des interfaces
data/                      # Données de l'application
groups/                    # Mémoire par conversation
  main/CLAUDE.md          # Instructions globales
public/                    # Interface PWA
src/                       # Code source
```

## Commandes utiles

```bash
npm start              # Démarrer NanoClaw
npm run auth          # Authentifier WhatsApp
npm run build         # Recompiler après modifications
npm run dev           # Mode développement (hot reload)
```

## Exemples d'utilisation

### PWA Standalone

1. Ouvrez la PWA
2. "Quelle heure est-il ?"
3. "Crée-moi un résumé de mes tâches de la semaine"
4. "Programme un rappel pour demain à 9h"

### WhatsApp

Dans un groupe :
```
@Jimmy quelle est la météo aujourd'hui ?
@Jimmy envoie un résumé chaque lundi matin
@Jimmy liste toutes les tâches programmées
```

## Personnalisation

**Via Claude Code** :
```
# Dans Claude Code
"Change le nom de l'assistant en Bob"
"Fais des réponses plus courtes"
"Ajoute Gmail"
```

**Ou via skill** :
```
/customize
/add-gmail
/channels
```

## Prochaines étapes

1. **Lire** : `docs/CHANNELS.md` - Guide complet des interfaces
2. **Personnaliser** : `groups/main/CLAUDE.md` - Instructions pour l'assistant
3. **Explorer** : `/customize` - Ajouter des fonctionnalités

## Troubleshooting

**PWA ne démarre pas** :
- Vérifiez `channels.yaml` existe
- Port 3000 libre ? `lsof -i :3000`

**WhatsApp ne se connecte pas** :
- Relancez `npm run auth`
- Vérifiez téléphone connecté

**Tailscale Funnel ne marche pas** :
- `sudo tailscale set --operator=$USER`
- Ou désactivez : `tailscale_funnel: false`

**Questions** :
- Consultez `docs/CHANNELS.md`
- Ou demandez à Claude Code !

## Support

- **Documentation** : `docs/`
- **Issues** : GitHub
- **Claude Code** : Demandez-lui directement !
