# Worktrees : instances parallèles

Développer sur une branche feature sans arrêter l'instance principale.

## Principe

Chaque worktree a son propre `process.cwd()` donc `store/`, `data/`, `groups/` sont déjà isolés. Le seul conflit possible est le **port réseau**.

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
```

L'instance tourne sur `http://localhost:17284`, zéro interférence avec l'instance principale.

### Avec Cloudflare Tunnel (accès distant sécurisé)

```bash
# .env
WEB_PORT=17284
CLOUDFLARE_TUNNEL_TOKEN=<token-pour-ce-tunnel>
CLOUDFLARE_TUNNEL_HOSTNAME=nanoclaw-dev.example.com
```

L'instance est accessible sur `https://nanoclaw-dev.example.com`, protégée par Cloudflare Access (Google OAuth). Chaque worktree a son propre tunnel avec un hostname distinct.

Voir [docs/setup/cloudflare-tunnel.md](../setup/cloudflare-tunnel.md) pour le setup initial.

## Variables d'environnement

| Variable | Effet | Défaut |
|----------|-------|--------|
| `WEB_PORT` | Port local du serveur HTTP | `channels.yaml` → 17283 |
| `CLOUDFLARE_TUNNEL_TOKEN` | Token du tunnel Cloudflare | (aucun, local uniquement) |
| `CLOUDFLARE_TUNNEL_HOSTNAME` | Hostname public du tunnel | (aucun) |

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
