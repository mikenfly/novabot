---
name: migrate-to-mac
description: Migrate NovaBot to a Mac Mini. Checks prerequisites, installs dependencies, configures Apple Container, Cloudflare tunnel, and launchd service. Run this skill FROM the Mac Mini.
---

# Migrate NovaBot to Mac Mini

This skill guides the migration of NovaBot to a Mac Mini running macOS Sequoia 15+.

**Important:** Run this skill FROM the Mac Mini itself, in a Claude Code session within the NovaBot project directory.

**UX:** Use `AskUserQuestion` for choices and confirmations.

---

## 1. Verify Prerequisites

```bash
echo "=== Mac Mini Diagnostics ==="
echo "macOS: $(sw_vers -productVersion)"
echo "Architecture: $(uname -m)"
echo "Node: $(node --version 2>/dev/null || echo 'NOT INSTALLED')"
echo "Git: $(git --version 2>/dev/null || echo 'NOT INSTALLED')"
echo "Apple Container: $(container --version 2>/dev/null || echo 'NOT INSTALLED')"
echo "Claude Code: $(claude --version 2>/dev/null || echo 'NOT INSTALLED')"
echo "Homebrew: $(brew --version 2>/dev/null | head -1 || echo 'NOT INSTALLED')"
```

### Install missing tools

**Homebrew** (if not installed):
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

**Node.js 22+:**
```bash
brew install node
```

**Apple Container:**
Download from https://github.com/apple/container/releases and install the .pkg.

Then start the system:
```bash
container system start
container system status
```

**Claude Code CLI** (if not installed):
```bash
npm install -g @anthropic-ai/claude-code
```

**Git** (via Xcode Command Line Tools):
```bash
xcode-select --install
```

---

## 2. Get the NovaBot Code

Ask the user how they want to get the code:

> How should we get the NovaBot code on this Mac Mini?
>
> 1. **Git clone** - Clone from the remote repository
> 2. **Already here** - The code is already in ~/Projects/novabot/
> 3. **Copy from another machine** - scp/rsync from the current server

### Option 1: Git clone

```bash
mkdir -p ~/Projects
cd ~/Projects
git clone <REPO_URL> novabot
cd novabot
```

### Option 2: Already here

```bash
cd ~/Projects/novabot
git status
```

### Option 3: Copy from another machine

Ask for the source machine's SSH details, then:
```bash
mkdir -p ~/Projects
rsync -avz --exclude node_modules --exclude dist --exclude '*.db' --exclude store/ --exclude data/ --exclude memory/ user@source:~/Projects/novabot/ ~/Projects/novabot/
cd ~/Projects/novabot
```

---

## 3. Install Dependencies

```bash
cd ~/Projects/novabot
npm install
```

---

## 4. Build Everything

```bash
# Backend TypeScript
npm run build

# Container image
./container/build.sh

# PWA frontend
npm run build:pwa
```

Verify:
```bash
echo "=== Build Verification ==="
[ -f dist/index.js ] && echo "✓ Backend built" || echo "✗ Backend missing"
container images 2>/dev/null | grep novabot-agent && echo "✓ Container image built" || echo "✗ Container image missing"
[ -f pwa/dist/index.html ] && echo "✓ PWA built" || echo "✗ PWA missing"
```

---

## 5. Configure Environment

Ask the user for their Claude authentication:

> How do you authenticate with Claude?
>
> 1. **Claude subscription** (Pro/Max) - OAuth token via `claude setup-token`
> 2. **Anthropic API key** - From console.anthropic.com

Create `.env`:

```bash
cat > .env << 'EOF'
# Claude Authentication
CLAUDE_CODE_OAUTH_TOKEN=<token>

# Web server port
WEB_PORT=17283

# Agent models
MODEL_MAIN=claude-sonnet-4-6
MODEL_RAG=claude-sonnet-4-6
MODEL_CONTEXT=claude-sonnet-4-6
MODEL_TITLE=claude-haiku-4-5

# Stable dev token (never expires)
DEV_TOKEN=<generate with openssl rand -hex 32>
EOF
```

Generate DEV_TOKEN:
```bash
DEV_TOKEN=$(openssl rand -hex 32)
sed -i '' "s|DEV_TOKEN=.*|DEV_TOKEN=$DEV_TOKEN|" .env
echo "✓ DEV_TOKEN: $DEV_TOKEN"
```

---

## 6. Configure Cloudflare Tunnel

Ask:
> Do you have an existing Cloudflare Tunnel configured (e.g., novabot.work)?
>
> 1. **Yes** - I'll transfer the tunnel config
> 2. **No** - Skip for now, access via local network only
> 3. **New tunnel** - Help me set up a new one

### If transferring existing tunnel:

The tunnel token and hostname just need to be added to `.env`:

```bash
echo "" >> .env
echo "# Cloudflare Tunnel" >> .env
echo "CLOUDFLARE_TUNNEL_TOKEN=<token>" >> .env
echo "CLOUDFLARE_TUNNEL_HOSTNAME=novabot.work" >> .env
```

**Important:** Update the tunnel ingress to point to the Mac Mini's port. If cloudflared is installed:

```bash
# Install cloudflared if needed
brew install cloudflared

# The tunnel token already contains the config. NovaBot handles the rest.
```

### If creating new tunnel:

See `docs/setup/cloudflare-tunnel.md` for full guide.

---

## 7. Test Run

```bash
npm run dev:all
```

Wait for:
- "Web server started"
- "NovaBot ready."

Test access:
```bash
curl -s http://localhost:17283/api/health
```

Ask the user to open `http://<mac-mini-ip>:17283/?token=<DEV_TOKEN>` from their phone/computer.

---

## 8. Configure launchd Service

For automatic startup:

```bash
NODE_PATH=$(which node)
PROJECT_PATH=$(pwd)
HOME_PATH=$HOME

cat > ~/Library/LaunchAgents/com.novabot.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.novabot</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NODE_PATH}</string>
        <string>--env-file=.env</string>
        <string>${PROJECT_PATH}/dist/index.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${PROJECT_PATH}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${HOME_PATH}/.local/bin</string>
        <key>HOME</key>
        <string>${HOME_PATH}</string>
    </dict>
    <key>StandardOutPath</key>
    <string>${PROJECT_PATH}/logs/novabot.log</string>
    <key>StandardErrorPath</key>
    <string>${PROJECT_PATH}/logs/novabot.error.log</string>
</dict>
</plist>
EOF

mkdir -p logs
launchctl load ~/Library/LaunchAgents/com.novabot.plist
echo "✓ Service loaded"
launchctl list | grep novabot
```

---

## 9. Verify Everything

```bash
echo "=== Final Verification ==="

# Check service is running
launchctl list | grep novabot && echo "✓ Service running" || echo "✗ Service not running"

# Health check
sleep 3
curl -sf http://localhost:17283/api/health && echo "✓ Health check passed" || echo "✗ Health check failed"

# Container runtime
container system status && echo "✓ Apple Container running" || echo "✗ Container system not running"
```

If Cloudflare Tunnel is configured:
```bash
HOSTNAME=$(grep CLOUDFLARE_TUNNEL_HOSTNAME .env | cut -d= -f2)
[ -n "$HOSTNAME" ] && echo "✓ Tunnel: https://$HOSTNAME" || echo "ℹ No tunnel configured (local access only)"
```

---

## 10. Decommission Old Server (Optional)

If NovaBot was running on another machine:

Ask:
> Do you want to stop NovaBot on the old server?
>
> 1. **Yes** - Stop the old instance
> 2. **Not yet** - I'll do it manually later

If yes, provide the commands:
```bash
# On the old server:
# If using launchd:
launchctl unload ~/Library/LaunchAgents/com.novabot.plist

# If using systemd:
systemctl --user stop novabot
systemctl --user disable novabot

# If running manually, just Ctrl+C the process
```

---

## Useful Commands

```bash
# Restart service
launchctl kickstart -k gui/$(id -u)/com.novabot

# Stop service
launchctl unload ~/Library/LaunchAgents/com.novabot.plist

# View logs
tail -f logs/novabot.log
tail -f logs/novabot.error.log

# Development mode (hot reload)
npm run dev:all
```

---

## Troubleshooting

**Apple Container won't start:**
- Requires macOS Sequoia 15+: `sw_vers -productVersion`
- Try: `container system stop && container system start`

**Container image build fails:**
- Ensure Apple Container system is running: `container system status`
- Check disk space: `df -h`

**Port already in use:**
- `lsof -ti :17283 | xargs kill -9`
- Or change port: `WEB_PORT=17284` in `.env`

**Cloudflare Tunnel not connecting:**
- Check token: `grep CLOUDFLARE_TUNNEL_TOKEN .env`
- Test manually: `cloudflared tunnel run --token <token>`
- Check logs for tunnel errors

**Node.js version too old:**
- `brew upgrade node`
- Need Node.js 20+
