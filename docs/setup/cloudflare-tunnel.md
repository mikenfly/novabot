# Cloudflare Tunnel + Access — Setup

Guide one-time pour exposer NovaBot sur internet de manière sécurisée.

## Architecture

```
User → Cloudflare Edge (WAF, rate limit, geo-filter, anti-DDoS)
     → Cloudflare Access (Google OAuth, session cookie)
     → Cloudflare Tunnel (outbound-only, pas de port ouvert)
     → localhost:WEB_PORT (serveur HTTP NovaBot)
     → Token auth middleware (defense-in-depth)
```

## Prérequis

### Installer cloudflared

```bash
# Debian/Ubuntu
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb

# macOS
brew install cloudflare/cloudflare/cloudflared

# Vérifier
cloudflared --version
```

## Étape 1 : Compte Cloudflare + Domaine

1. Créer un compte sur [dash.cloudflare.com](https://dash.cloudflare.com)
2. Ajouter un domaine (acheter via Cloudflare ou transférer les nameservers d'un domaine existant)

## Étape 2 : Créer le tunnel

1. Dashboard → **Zero Trust** → **Networks** → **Tunnels**
2. **Create a tunnel** → Type : **Cloudflared**
3. Nommer le tunnel (ex: `novabot-prod`)
4. Copier le **connector token** (commence par `eyJ...`)
5. Configurer le **Public Hostname** :
   - Subdomain : `novabot` (ou autre)
   - Domain : votre domaine
   - Service : `http://localhost:17283` (ou votre `WEB_PORT`)

6. Ajouter dans `.env` :
   ```bash
   CLOUDFLARE_TUNNEL_TOKEN=eyJ...
   CLOUDFLARE_TUNNEL_HOSTNAME=novabot.example.com
   ```

## Étape 3 : Cloudflare Access (Google OAuth)

### Configurer Google comme Identity Provider

1. Dashboard → **Zero Trust** → **Settings** → **Authentication** → **Add new**
2. Choisir **Google**
3. Créer un OAuth app dans [Google Cloud Console](https://console.cloud.google.com/apis/credentials) :
   - Type : Web application
   - Authorized redirect URI : `https://<votre-team>.cloudflareaccess.com/cdn-cgi/access/callback`
   - Copier le **Client ID** et **Client Secret**
4. Coller dans Cloudflare et sauvegarder

### Créer l'application Access

1. Dashboard → **Zero Trust** → **Access** → **Applications** → **Add an application**
2. Type : **Self-hosted**
3. Application domain : `novabot.example.com`
4. Session duration : **30 days** (ou selon préférence)
5. Créer une **Policy** :
   - Name : `Google Auth`
   - Action : **Allow**
   - Include : **Login Methods** → **Google**
   - (Optionnel) Restreindre par email : **Emails** → votre adresse

## Étape 4 : WAF (Web Application Firewall)

1. Dashboard (principal, pas Zero Trust) → **Security** → **WAF** → **Managed rules**
2. Activer :
   - **Cloudflare Managed Ruleset**
   - **OWASP Core Ruleset**

## Étape 5 : Rate Limiting

1. Dashboard → **Security** → **WAF** → **Rate limiting rules** → **Create rule**
2. Configuration :
   - Name : `API rate limit`
   - If : URI Path contains `/api/`
   - Rate : **60 requests per minute** per IP
   - Action : **Block** for **60 seconds**

## Étape 6 : Geo-filtering (EU/EEA uniquement)

1. Dashboard → **Security** → **WAF** → **Custom rules** → **Create rule**
2. Expression :
   ```
   (not ip.geoip.country in {"FR" "DE" "BE" "NL" "LU" "IT" "ES" "PT" "AT" "CH" "IE" "SE" "DK" "FI" "NO" "IS" "PL" "CZ" "SK" "HU" "RO" "BG" "HR" "SI" "EE" "LV" "LT" "CY" "MT" "GR" "LI"})
   ```
3. Action : **Block**

## Vérification

```bash
# Démarrer NovaBot
npm start

# Vérifier les logs — chercher "Cloudflare Tunnel connecté"
```

Ouvrir `https://novabot.example.com` → devrait rediriger vers Google OAuth → après connexion, la PWA apparaît.

## Multi-worktrees

Chaque worktree peut avoir son propre tunnel :

| Worktree | Tunnel | Hostname | Token |
|----------|--------|----------|-------|
| main | `novabot-prod` | `novabot.example.com` | Token A |
| feature branch | `novabot-dev` | `novabot-dev.example.com` | Token B |

Créez un tunnel séparé dans le dashboard pour chaque worktree, avec un hostname et un token distincts.

## Troubleshooting

**`cloudflared` non trouvé** :
- Vérifier l'installation : `which cloudflared`
- Ajouter au PATH si nécessaire

**Tunnel ne se connecte pas** :
- Vérifier le token : `cloudflared tunnel run --token <TOKEN>` manuellement
- Vérifier les logs NovaBot pour les erreurs

**Google OAuth ne redirige pas** :
- Vérifier l'URI de redirection dans Google Cloud Console
- Vérifier que l'IdP est configuré dans Cloudflare Zero Trust

**Accès bloqué par geo-filter** :
- Vérifier que votre IP est dans un pays autorisé
- Modifier la règle WAF si nécessaire
