---
name: setup
description: Initial NanoClaw setup following the quickstart guide. Choose your interface (PWA/WhatsApp/Both), install dependencies, configure authentication, and start the app. Simple and fast.
---

# NanoClaw Setup

Guide simplifié suivant [docs/quickstart.md](../../docs/quickstart.md).

Run commands automatically. Pause only for user actions (QR code scanning, choices).

**UX:** Use `AskUserQuestion` tool for interactive choices.

---

## 0. Choose Your Interface

**Use AskUserQuestion** to ask:

> NanoClaw supports multiple interfaces. Which do you want to use?
>
> **PWA only** - Modern web interface, no WhatsApp needed (Recommended)
> **WhatsApp only** - Bot in group chats
> **Both PWA + WhatsApp** - Best of both worlds

Store their choice - you'll use it to configure `channels.yaml`.

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

> NanoClaw needs containers for isolated agent execution. Choose one:
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
  echo '{}' | docker run -i --entrypoint /bin/echo nanoclaw-agent:latest "Container OK" || echo "✗ Build failed"
else
  echo '{}' | container run -i --entrypoint /bin/echo nanoclaw-agent:latest "Container OK" || echo "✗ Build failed"
fi
```

---

## 5. Configure Channels

Create/update `channels.yaml` based on their choice from step 0.

### If PWA only:

```bash
cat > channels.yaml << 'EOF'
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
EOF
```

Tell them:
> ✓ Configured PWA standalone mode. You'll get a QR code to connect your phone.

**Skip to step 8.**

### If WhatsApp only:

```bash
cat > channels.yaml << 'EOF'
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
EOF
```

Tell them:
> ✓ Configured WhatsApp mode.

**Continue to step 6.**

### If Both:

```bash
cat > channels.yaml << 'EOF'
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
EOF
```

Tell them:
> ✓ Configured PWA + WhatsApp synchronized mode.

**Continue to step 6.**

---

## 6. Authenticate WhatsApp

**Skip this if user chose "PWA only".**

```bash
npm run auth
```

Tell them:
> A QR code will appear. On your phone:
> 1. Open WhatsApp
> 2. Settings → Linked Devices → Link a Device
> 3. Scan the QR code

Wait for "Successfully authenticated" before continuing.

---

## 7. Register Main WhatsApp Channel

**Skip this if user chose "PWA only".**

Ask:
> Send a message to yourself in WhatsApp (the "Message Yourself" chat).
> Let me know when done.

After confirmation:

```bash
timeout 10 npm start || true
```

Find the JID:
```bash
sqlite3 store/messages.db "SELECT DISTINCT chat_jid FROM messages WHERE chat_jid LIKE '%@s.whatsapp.net' ORDER BY timestamp DESC LIMIT 1"
```

Create `data/registered_groups.json`:
```json
{
  "JID_FROM_ABOVE": {
    "name": "main",
    "folder": "main",
    "trigger": "@Jimmy",
    "added_at": "CURRENT_ISO_TIMESTAMP"
  }
}
```

Ensure folder exists:
```bash
mkdir -p groups/main/logs
```

---

## 8. Start NanoClaw

```bash
npm start
```

### For PWA users:

Tell them:
> ✓ NanoClaw is running!
>
> You should see:
> - A QR code (if configured)
> - URL: http://localhost:3000
> - A temporary access token
>
> **To connect:**
> 1. Scan the QR code with your phone, OR
> 2. Open the URL and enter the token
>
> **Install on iOS:**
> 1. Open in Safari
> 2. Share → Add to Home Screen
> 3. Use as native app!

### For WhatsApp users:

Tell them:
> ✓ NanoClaw is running!
>
> **Test it:**
> Send `@Jimmy hello` in your WhatsApp chat.

---

## Advanced Configuration

The following sections are optional but recommended for production use.

---

## 9. Configure Assistant Name (Optional)

**For WhatsApp users who want a custom trigger word.**

Ask the user:
> What trigger word do you want to use? (default: `@Jimmy`)
>
> Messages starting with `@TriggerWord` will be sent to Claude.

If they choose something other than `@Jimmy`, update it in these places:
1. `channels.yaml` - Change `assistant.name` and `whatsapp.trigger`
2. `groups/main/CLAUDE.md` - Change "# Jimmy" and "You are Jimmy" to the new name
3. `data/registered_groups.json` - Use `@NewName` as the trigger

---

## 10. Understand the Security Model (WhatsApp)

**Skip if using PWA only.**

Before adding more WhatsApp groups, understand the security model.

**Use AskUserQuestion** to present this:

> **Important: Your "main" channel is your admin control portal.**
>
> The main channel has elevated privileges:
> - Can see messages from ALL other registered groups
> - Can manage and delete tasks across all groups
> - Can write to global memory that all groups can read
> - Has read-write access to the entire NanoClaw project
>
> **Recommendation:** Use your personal "Message Yourself" chat or a solo WhatsApp group as your main channel. This ensures only you have admin control.
>
> **Question:** Which setup will you use for your main channel?
>
> Options:
> 1. Personal chat (Message Yourself) - Recommended
> 2. Solo WhatsApp group (just me)
> 3. Group with other people (I understand the security implications)

If they choose option 3, ask a follow-up:

> You've chosen a group with other people. This means everyone in that group will have admin privileges over NanoClaw.
>
> Are you sure you want to proceed? The other members will be able to:
> - Read messages from your other registered chats
> - Schedule and manage tasks
> - Access any directories you've mounted
>
> Options:
> 1. Yes, I understand and want to proceed
> 2. No, let me use a personal chat or solo group instead

---

## 11. Configure External Directory Access (Mount Allowlist)

**Optional but important for security.**

Ask the user:
> Do you want the agent to be able to access any directories **outside** the NanoClaw project?
>
> Examples: Git repositories, project folders, documents you want Claude to work on.
>
> **Note:** This is optional. Without configuration, agents can only access their own group folders.

### If no:

Create an empty allowlist to make this explicit:

```bash
mkdir -p ~/.config/nanoclaw
cat > ~/.config/nanoclaw/mount-allowlist.json << 'EOF'
{
  "allowedRoots": [],
  "blockedPatterns": [],
  "nonMainReadOnly": true
}
EOF
echo "✓ Mount allowlist created - no external directories allowed"
```

Skip to the next step.

### If yes:

#### 11a. Collect Directory Paths

Ask the user:
> Which directories do you want to allow access to?
>
> You can specify:
> - A parent folder like `~/projects` (allows access to anything inside)
> - Specific paths like `~/repos/my-app`
>
> List them one per line, or give me a comma-separated list.

For each directory they provide, ask:
> Should `[directory]` be **read-write** (agents can modify files) or **read-only**?
>
> Read-write is needed for: code changes, creating files, git commits
> Read-only is safer for: reference docs, config examples, templates

#### 11b. Configure Non-Main Group Access

Ask the user:
> Should **non-main groups** (other WhatsApp chats you add later) be restricted to **read-only** access even if read-write is allowed for the directory?
>
> Recommended: **Yes** - this prevents other groups from modifying files even if you grant them access to a directory.

#### 11c. Create the Allowlist

Create the allowlist file based on their answers:

```bash
mkdir -p ~/.config/nanoclaw
```

Then write the JSON file. Example for a user who wants `~/projects` (read-write) and `~/docs` (read-only) with non-main read-only:

```bash
cat > ~/.config/nanoclaw/mount-allowlist.json << 'EOF'
{
  "allowedRoots": [
    {
      "path": "~/projects",
      "allowReadWrite": true,
      "description": "Development projects"
    },
    {
      "path": "~/docs",
      "allowReadWrite": false,
      "description": "Reference documents"
    }
  ],
  "blockedPatterns": [],
  "nonMainReadOnly": true
}
EOF
```

Verify the file:

```bash
cat ~/.config/nanoclaw/mount-allowlist.json
```

Tell the user:
> ✓ Mount allowlist configured. The following directories are now accessible:
> - `~/projects` (read-write)
> - `~/docs` (read-only)
>
> **Security notes:**
> - Sensitive paths (`.ssh`, `.gnupg`, `.aws`, credentials) are always blocked
> - This config file is stored outside the project, so agents cannot modify it
> - Changes require restarting the NanoClaw service
>
> To grant a group access to a directory, add it to their config in `data/registered_groups.json`:
> ```json
> "containerConfig": {
>   "additionalMounts": [
>     { "hostPath": "~/projects/my-app", "containerPath": "my-app", "readonly": false }
>   ]
> }
> ```

---

## 12. Configure launchd Service (macOS Background Service)

**Optional: Run NanoClaw as a background service on macOS.**

**Skip this if:**
- You're on Linux (use systemd instead)
- You prefer to run `npm start` manually

Generate the plist file with correct paths automatically:

```bash
NODE_PATH=$(which node)
PROJECT_PATH=$(pwd)
HOME_PATH=$HOME

cat > ~/Library/LaunchAgents/com.nanoclaw.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.nanoclaw</string>
    <key>ProgramArguments</key>
    <array>
        <string>\${NODE_PATH}</string>
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
        <string>/usr/local/bin:/usr/bin:/bin:\${HOME_PATH}/.local/bin</string>
        <key>HOME</key>
        <string>\${HOME_PATH}</string>
    </dict>
    <key>StandardOutPath</key>
    <string>\${PROJECT_PATH}/logs/nanoclaw.log</string>
    <key>StandardErrorPath</key>
    <string>\${PROJECT_PATH}/logs/nanoclaw.error.log</string>
</dict>
</plist>
EOF

echo "✓ Created launchd plist with:"
echo "  Node: \${NODE_PATH}"
echo "  Project: \${PROJECT_PATH}"
```

Build and start the service:

```bash
npm run build
mkdir -p logs
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
```

Verify it's running:
```bash
launchctl list | grep nanoclaw
```

**Useful commands:**

```bash
# Restart service
launchctl kickstart -k gui/$(id -u)/com.nanoclaw

# Stop service
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist

# View logs
tail -f logs/nanoclaw.log
tail -f logs/nanoclaw.error.log
```

---

## Optional: Cloudflare Tunnel Setup

**For PWA users who want secure remote HTTPS access.**

See `docs/setup/cloudflare-tunnel.md` for the full guide.

In short:
1. Install `cloudflared`
2. Create a tunnel in Cloudflare Zero Trust dashboard
3. Add to `.env`:
   ```bash
   CLOUDFLARE_TUNNEL_TOKEN=eyJ...
   CLOUDFLARE_TUNNEL_HOSTNAME=nanoclaw.example.com
   ```
4. Restart: `npm start`

---

## Next Steps

Tell them:

> **Setup complete!** 🎉
>
> **Useful commands:**
> - `npm start` - Start NanoClaw
> - `npm run build` - Rebuild after code changes
> - `/channels` - Change interfaces later
> - `/customize` - Add features
>
> **Documentation:**
> - `docs/quickstart.md` - Quick reference
> - `docs/channels.md` - Detailed channel config

---

## Test Your Setup

### For PWA users:

Tell them:
> **Test the PWA:**
> 1. Open the URL (http://localhost:3000 or your Cloudflare hostname)
> 2. Enter the token or scan the QR code
> 3. Send a message like "hello"
> 4. You should get a response from the agent

### For WhatsApp users:

Tell them:
> **Test WhatsApp:**
> Send `@Jimmy hello` (or your custom trigger) in your registered chat.

Check the logs:
```bash
tail -f logs/nanoclaw.log
```

You should see:
- Message received
- Container agent starting
- Response being sent

---

## Troubleshooting

**Container build fails:**
- Ensure Docker/Apple Container is running
- On macOS: `container system start`
- On Linux: `sudo systemctl start docker`

**WhatsApp won't connect:**
- Check phone is connected to internet
- Re-run `npm run auth`

**Port 3000 already in use:**
- Change port in `channels.yaml`: `pwa.port: 3001`

**No QR code for PWA:**
- Cloudflare Tunnel not configured (optional)
- App still works on `http://localhost:3000`
- See `docs/setup/cloudflare-tunnel.md` for remote access setup

**Service not starting (launchd):**
- Check `logs/nanoclaw.error.log`
- Verify paths in plist: `cat ~/Library/LaunchAgents/com.nanoclaw.plist`

**Container agent fails with "Claude Code process exited with code 1":**
- Ensure the container runtime is running:
  - Apple Container: `container system start`
  - Docker: `docker info` (start Docker Desktop on macOS, or `sudo systemctl start docker` on Linux)
- Check container logs: `cat groups/main/logs/container-*.log | tail -50`

**No response to messages:**
- Verify the trigger pattern matches (e.g., `@Jimmy` at start of message for WhatsApp)
- Check that the chat JID is in `data/registered_groups.json` (WhatsApp)
- Check `logs/nanoclaw.log` for errors

**WhatsApp disconnected:**
- The service will show a macOS notification
- Run `npm run auth` to re-authenticate
- Restart the service: `launchctl kickstart -k gui/$(id -u)/com.nanoclaw`

**Unload launchd service:**
```bash
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
```
