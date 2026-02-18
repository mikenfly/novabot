---
name: channels
description: Configure or change NanoClaw channels (PWA, WhatsApp) interactively. Enable/disable interfaces, switch between standalone and synchronized modes. Based on docs/channels.md.
---

# Channels Configuration

Interactive guide to configure NanoClaw interfaces. See [docs/channels.md](../../docs/channels.md) for full reference.

**Goal:** Help users switch between PWA, WhatsApp, or both easily.

---

## Your Role

You guide the user through channel configuration by:

1. **Reading** current `channels.yaml`
2. **Understanding** what they want
3. **Recommending** best config
4. **Modifying** `channels.yaml`
5. **Explaining** next steps

---

## Step 1: Check Current Config

Read `channels.yaml`:

```bash
cat channels.yaml
```

If it doesn't exist:
```bash
# Check if channels.example.yaml exists
cat channels.example.yaml 2>/dev/null || echo "No example found"
```

Show the user their current setup:

```
📊 Current Configuration:

PWA: [enabled/disabled]
  Mode: [standalone/synchronized]
  Port: [port]
  Cloudflare Tunnel: [yes/no]

WhatsApp: [enabled/disabled]
  Trigger: [@Jimmy]

Assistant Name: [Jimmy]
```

---

## Step 2: Understand What They Want

**Use AskUserQuestion** to ask:

> What would you like to do?
>
> **Switch to PWA only** - Modern web interface, no WhatsApp
> **Switch to WhatsApp only** - Bot in group chats
> **Enable both** - PWA + WhatsApp synchronized
> **Change settings** - Modify port, trigger word, etc.

Based on their answer, follow the appropriate section below.

---

## Option A: Switch to PWA Only

Perfect for personal use, modern interface.

**Modify channels.yaml:**

```yaml
channels:
  pwa:
    enabled: true
    port: 3000
    standalone: true
    cloudflare_tunnel: true

  whatsapp:
    enabled: false
    trigger: "@Jimmy"

assistant:
  name: "Jimmy"
  timezone: "Europe/Paris"

paths:
  data_dir: "./data"
  groups_dir: "./groups"
  store_dir: "./store"
```

**Tell them:**

> ✓ Switched to PWA standalone mode.
>
> **Next steps:**
> ```bash
> npm run build
> npm start
> ```
>
> You'll see:
> - A QR code to connect your phone (if configured)
> - URL: http://localhost:3000
> - A temporary access token
>
> No WhatsApp needed! Just scan the QR or enter the token.

---

## Option B: Switch to WhatsApp Only

Good for teams already using WhatsApp.

**Modify channels.yaml:**

```yaml
channels:
  pwa:
    enabled: false

  whatsapp:
    enabled: true
    trigger: "@Jimmy"

assistant:
  name: "Jimmy"
  timezone: "Europe/Paris"

paths:
  data_dir: "./data"
  groups_dir: "./groups"
  store_dir: "./store"
```

**Check if WhatsApp is already authenticated:**

```bash
ls -la data/auth_info_baileys 2>/dev/null && echo "✓ Already authenticated" || echo "✗ Need to authenticate"
```

**Tell them:**

> ✓ Switched to WhatsApp mode.
>
> **Next steps:**
> ```bash
> npm run build
> npm run auth    # If not authenticated yet
> npm start
> ```
>
> Test by sending `@Jimmy hello` in WhatsApp.

---

## Option C: Enable Both (Synchronized)

Best of both worlds - PWA shows WhatsApp conversations.

**Modify channels.yaml:**

```yaml
channels:
  pwa:
    enabled: true
    port: 3000
    standalone: false  # Synchronized with WhatsApp
    cloudflare_tunnel: true

  whatsapp:
    enabled: true
    trigger: "@Jimmy"

assistant:
  name: "Jimmy"
  timezone: "Europe/Paris"

paths:
  data_dir: "./data"
  groups_dir: "./groups"
  store_dir: "./store"
```

**Check WhatsApp auth:**

```bash
ls -la data/auth_info_baileys 2>/dev/null && echo "✓ Already authenticated" || echo "✗ Need to authenticate"
```

**Tell them:**

> ✓ Enabled both PWA and WhatsApp in synchronized mode.
>
> **Next steps:**
> ```bash
> npm run build
> npm run auth    # If not authenticated yet
> npm start
> ```
>
> Your WhatsApp conversations will appear in the PWA!

---

## Option D: Change Settings

For fine-tuning without switching channels.

Ask what they want to change:

### Change Assistant Name

Ask for new name (current: [current_name]).

Update in `channels.yaml`:
```yaml
assistant:
  name: "NewName"
```

And update trigger if WhatsApp enabled:
```yaml
whatsapp:
  trigger: "@NewName"
```

### Change Trigger Word (WhatsApp only)

Ask for new trigger (current: [@Jimmy]).

Update in `channels.yaml`:
```yaml
whatsapp:
  trigger: "@NewTrigger"
```

### Change PWA Port

Ask for new port (current: 3000).

Update in `channels.yaml`:
```yaml
pwa:
  port: 3001
```

### Toggle Cloudflare Tunnel

Current: [enabled/disabled]

Set in `.env`:
```bash
# Enable tunnel
CLOUDFLARE_TUNNEL_TOKEN=eyJ...
CLOUDFLARE_TUNNEL_HOSTNAME=nanoclaw.example.com

# Disable tunnel: remove or comment out CLOUDFLARE_TUNNEL_TOKEN
```

### Switch PWA Mode (standalone ↔ synchronized)

Current: [standalone/synchronized]

**Standalone → Synchronized:**
Requires WhatsApp enabled.

```yaml
pwa:
  standalone: false

whatsapp:
  enabled: true
```

**Synchronized → Standalone:**
PWA becomes independent.

```yaml
pwa:
  standalone: true
```

---

## After Any Change

Always remind them:

```bash
npm run build    # Recompile
npm start        # Restart with new config
```

**If they enabled WhatsApp for the first time:**
```bash
npm run auth     # Authenticate before starting
```

---

## Common Scenarios

### "I want to access from my phone"

**Current setup:** PWA enabled

**Recommendation:**
1. Set up Cloudflare Tunnel: see `docs/setup/cloudflare-tunnel.md`
2. Add `CLOUDFLARE_TUNNEL_TOKEN` and `CLOUDFLARE_TUNNEL_HOSTNAME` in `.env`
3. Restart: `npm start`
4. Open the Cloudflare hostname URL on your phone

### "WhatsApp keeps disconnecting"

**Check:**
```bash
ls -la data/auth_info_baileys
```

**Solution:**
```bash
rm -rf data/auth_info_baileys
npm run auth     # Re-authenticate
npm start
```

### "I want to try WhatsApp but keep PWA"

**Recommendation:** Enable both in synchronized mode (Option C above).

This way:
- WhatsApp messages show up in PWA
- You can use either interface
- Everything stays in sync

### "Port 3000 is already in use"

**Check what's using it:**
```bash
lsof -i :3000
```

**Change port in channels.yaml:**
```yaml
pwa:
  port: 3001  # or any free port
```

---

## Safety Checks

Before modifying `channels.yaml`:

1. **Backup current config:**
   ```bash
   cp channels.yaml channels.yaml.backup
   ```

2. **Validate YAML syntax** after changes

3. **Explain what changed** clearly

**Never:**
- Delete the `channels` section entirely
- Use tabs (YAML requires spaces)
- Forget `:` after keys
- Remove `assistant` or `paths` sections

---

## Quick Reference

### PWA Standalone (Personal)
```yaml
pwa: enabled: true, standalone: true
whatsapp: enabled: false
```

### WhatsApp Only (Groups)
```yaml
pwa: enabled: false
whatsapp: enabled: true
```

### Both Synchronized (Advanced)
```yaml
pwa: enabled: true, standalone: false
whatsapp: enabled: true
```

---

## Helpful Commands

```bash
cat channels.yaml              # View config
nano channels.yaml            # Edit manually
npm run build && npm start    # Apply changes
npm run auth                  # Authenticate WhatsApp
```

---

## Documentation Links

Point users to:
- [docs/channels.md](../../docs/channels.md) - Full channel reference
- [docs/quickstart.md](../../docs/quickstart.md) - Quick setup guide
