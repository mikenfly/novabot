---
name: setup
description: Initial NovaBot setup. Install dependencies, configure authentication, build container image, and start the app. Simple and fast.
---

# NovaBot Setup

Run commands automatically. Pause only for user actions (choices, config).

**UX:** Use `AskUserQuestion` tool for interactive choices.

---

## 1. Install Dependencies

```bash
npm install
npm run build
```

---

## 2. Setup Container Runtime

Detect platform:

```bash
echo "Platform: $(uname -s)"
which container && echo "✓ Apple Container installed" || echo "✗ Apple Container not found"
which docker && docker info >/dev/null 2>&1 && echo "✓ Docker installed and running" || echo "✗ Docker not available"
```

### On Linux

Use Docker (Apple Container is macOS-only):

> You're on Linux, so we'll use Docker for container isolation.

**Use `/convert-to-docker` skill** to convert the codebase, then continue to step 3.

### On macOS

**If Apple Container installed:** Continue to step 3.

**If not installed:** Ask the user:

> NovaBot needs containers for isolated agent execution. Choose one:
>
> 1. **Apple Container** (recommended) - macOS-native, lightweight
> 2. **Docker** - Cross-platform

**Option A: Apple Container**

> Download from https://github.com/apple/container/releases
> Install the .pkg file
> Run: `container system start`
>
> Let me know when done.

Then verify:
```bash
container system start
container --version
```

**Option B: Docker**

> You chose Docker. Let me set it up.

**Use `/convert-to-docker` skill**, then continue to step 3.

---

## 3. Configure Claude Authentication

Ask:

> Use your **Claude subscription** (Pro/Max) or an **Anthropic API key**?

### Option 1: Claude Subscription (Recommended)

> Open a terminal and run:
> ```
> claude setup-token
> ```
> Paste the token here or add it to `.env` yourself as `CLAUDE_CODE_OAUTH_TOKEN=<token>`

If they give you the token:
```bash
echo "CLAUDE_CODE_OAUTH_TOKEN=<token>" > .env
```

### Option 2: API Key

Ask if they have an existing key or need to create one.

**Create new:**
```bash
echo 'ANTHROPIC_API_KEY=' > .env
```

Tell them to add their key from https://console.anthropic.com/

**Verify:**
```bash
KEY=$(grep "^ANTHROPIC_API_KEY=" .env | cut -d= -f2)
[ -n "$KEY" ] && echo "✓ API key configured: ${KEY:0:10}...${KEY: -4}" || echo "✗ Missing"
```

---

## 4. Build Container Image

```bash
./container/build.sh
```

Verify (auto-detects runtime):
```bash
if which docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo '{}' | docker run -i --entrypoint /bin/echo novabot-agent:latest "Container OK" || echo "✗ Build failed"
else
  echo '{}' | container run -i --entrypoint /bin/echo novabot-agent:latest "Container OK" || echo "✗ Build failed"
fi
```

---

## 5. Build PWA Frontend

```bash
npm run build:pwa
```

---

## 6. Generate DEV_TOKEN (Optional)

For development, a stable token avoids re-generating tokens on each restart:

```bash
DEV_TOKEN=$(openssl rand -hex 32)
echo "" >> .env
echo "DEV_TOKEN=$DEV_TOKEN" >> .env
echo "✓ DEV_TOKEN added to .env"
```

---

## 7. Start NovaBot

```bash
npm start
```

Tell them:
> NovaBot is running!
>
> You should see:
> - URL: http://localhost:17283
> - A temporary access token (or use DEV_TOKEN from .env)
>
> **To connect:**
> Open the URL and enter the token
>
> **Install on iOS:**
> 1. Open in Safari
> 2. Share → Add to Home Screen
> 3. Use as native app!

---

## 8. Configure External Directory Access (Mount Allowlist)

**Optional but important for security.**

Ask the user:
> Do you want the agent to access directories **outside** the NovaBot project?
>
> Examples: Git repositories, project folders, documents you want Claude to work on.

### If no:

```bash
mkdir -p ~/.config/novabot
cat > ~/.config/novabot/mount-allowlist.json << 'EOF'
{
  "allowedRoots": [],
  "blockedPatterns": [],
  "nonMainReadOnly": true
}
EOF
echo "✓ Mount allowlist created - no external directories allowed"
```

### If yes:

Ask which directories and whether read-write or read-only.

```bash
mkdir -p ~/.config/novabot
cat > ~/.config/novabot/mount-allowlist.json << 'EOF'
{
  "allowedRoots": [
    {
      "path": "~/projects",
      "allowReadWrite": true,
      "description": "Development projects"
    }
  ],
  "blockedPatterns": [],
  "nonMainReadOnly": true
}
EOF
```

---

## 9. Configure launchd Service (macOS) or systemd (Linux)

**Optional: Run NovaBot as a background service.**

### macOS (launchd)

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
        <string>\${NODE_PATH}</string>
        <string>--env-file=.env</string>
        <string>\${PROJECT_PATH}/dist/index.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>\${PROJECT_PATH}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:\${HOME_PATH}/.local/bin</string>
        <key>HOME</key>
        <string>\${HOME_PATH}</string>
    </dict>
    <key>StandardOutPath</key>
    <string>\${PROJECT_PATH}/logs/novabot.log</string>
    <key>StandardErrorPath</key>
    <string>\${PROJECT_PATH}/logs/novabot.error.log</string>
</dict>
</plist>
EOF

npm run build
mkdir -p logs
launchctl load ~/Library/LaunchAgents/com.novabot.plist
launchctl list | grep novabot
```

### Linux (systemd)

```bash
cat > ~/.config/systemd/user/novabot.service << EOF
[Unit]
Description=NovaBot Personal Assistant
After=network.target docker.service

[Service]
Type=simple
WorkingDirectory=$(pwd)
ExecStart=$(which node) --env-file=.env dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable novabot
systemctl --user start novabot
systemctl --user status novabot
```

---

## Optional: Cloudflare Tunnel

For secure remote HTTPS access. See `docs/setup/cloudflare-tunnel.md`.

```bash
# Add to .env:
echo "CLOUDFLARE_TUNNEL_TOKEN=eyJ..." >> .env
echo "CLOUDFLARE_TUNNEL_HOSTNAME=your-domain.com" >> .env
```

---

## Next Steps

> **Setup complete!**
>
> **Useful commands:**
> - `npm start` - Start NovaBot
> - `npm run dev:all` - Development mode with hot reload
> - `/customize` - Add features
> - `/debug` - Troubleshoot issues

---

## Troubleshooting

**Container build fails:**
- Ensure Docker/Apple Container is running
- On macOS: `container system start`
- On Linux: `sudo systemctl start docker`

**Port 17283 already in use:**
- Change port in `.env`: `WEB_PORT=17284`

**Service not starting (launchd):**
- Check `logs/novabot.error.log`
- Verify paths: `cat ~/Library/LaunchAgents/com.novabot.plist`

**Container agent fails:**
- Ensure runtime is running: `container system start` or `docker info`
- Check logs: `cat groups/pwa-*/logs/container-*.log | tail -50`

**No response to messages:**
- Check `logs/novabot.log` for errors
- Verify container image exists: `docker images novabot-agent` or `container images`
