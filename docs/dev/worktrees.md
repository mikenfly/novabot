# Worktrees : instances parallèles

Développer sur une branche feature sans arrêter l'instance principale.

## Principe

Chaque worktree a son propre `process.cwd()` donc `store/`, `data/`, `groups/` sont déjà isolés. Le seul conflit possible est le **port réseau** et le **Tailscale Funnel**.

Un fichier `.env` dans le worktree permet d'override les valeurs de `channels.yaml` (qui est tracké par git).

## Setup

```bash
# Créer le worktree
git worktree add ../nanoclaw-feature feature/ma-branche
cd ../nanoclaw-feature

# Installer les dépendances
npm install

# Configurer l'instance
cp .env.example .env
```

Éditer `.env` :

```bash
CLAUDE_CODE_OAUTH_TOKEN=<votre-token>
WEB_PORT=17284
```

## Modes d'accès

### Localhost uniquement (dev local)

```bash
# .env
WEB_PORT=17284
TAILSCALE_FUNNEL=false
```

L'instance tourne sur `http://localhost:17284`, pas de funnel, zéro interférence avec l'instance principale.

### Avec Tailscale Funnel (test sur mobile)

```bash
# .env
WEB_PORT=17284
FUNNEL_PORT=8443
```

L'instance est accessible sur `https://<hostname>.ts.net:8443`. Coexiste avec le funnel principal sur le port 443.

Tailscale supporte les ports HTTPS : **443** (défaut), **8443**, **10000**.

## Variables d'environnement

| Variable | Effet | Défaut |
|----------|-------|--------|
| `WEB_PORT` | Port local du serveur HTTP | `channels.yaml` → 17283 |
| `TAILSCALE_FUNNEL` | Active/désactive le funnel | `channels.yaml` → true |
| `FUNNEL_PORT` | Port HTTPS externe du funnel | 443 |

## Hiérarchie de config

1. `.env` (override local, non tracké)
2. `channels.yaml` (config projet, tracké)
3. `config.ts` (fallback hardcodé)

## Lancer

```bash
npm run dev    # développement avec hot reload
npm start      # production
```

Les scripts chargent `.env` automatiquement via `--env-file`.
