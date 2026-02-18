# Authentication - PWA Token System

## Overview

NovaBot's PWA channel uses a two-tier token authentication system designed for secure device pairing without passwords.

## Token Types

### Temporary Tokens

**Purpose** : Initial device pairing via QR code

**Characteristics** :
- **Lifetime** : 5 minutes (TEMP_TOKEN_TTL)
- **Usage** : One-time only
- **Generation** : Automatic at startup
- **Display** : QR code in terminal + URL

**Use case** : User scans QR code with new device, exchanges temporary token for permanent token.

### Permanent Tokens

**Purpose** : Long-term device authentication

**Characteristics** :
- **Lifetime** : No expiration
- **Usage** : Unlimited (until revoked)
- **Generation** : Created when exchanging temporary token
- **Storage** : `data/auth.json`

**Use case** : Stored in device's localStorage, sent with every API request.

## Data Structure

### Storage Format (data/auth.json)

```json
{
  "temporary_tokens": [
    {
      "token": "abc123...",
      "created_at": "2026-02-06T10:30:00Z",
      "expires_at": "2026-02-06T10:35:00Z",
      "used": false
    }
  ],
  "permanent_tokens": [
    {
      "token": "def456...",
      "device_name": "iPhone",
      "created_at": "2026-02-06T10:31:00Z",
      "last_used": "2026-02-06T12:00:00Z"
    },
    {
      "token": "ghi789...",
      "device_name": "MacBook Pro",
      "created_at": "2026-02-05T14:20:00Z",
      "last_used": "2026-02-06T11:45:00Z"
    }
  ]
}
```

### Token Generation

```typescript
// src/auth.ts
function generateToken(): string {
  return crypto.randomBytes(32).toString('hex'); // 256 bits
}
```

**Security** : Uses Node.js `crypto.randomBytes()` for cryptographically secure random generation.

## Authentication Flow

### 1. Initial Setup

**Server starts** :
```typescript
// src/index.ts (if PWA enabled)
import { initializeAuth, generateTemporaryToken } from './auth.js';

initializeAuth(); // Load existing tokens from disk
const tempToken = generateTemporaryToken();
const qrUrl = `${funnelUrl}/?token=${tempToken}`;
displayQR(qrUrl);
```

**Terminal output** :
```
╔═══════════════════════════════════════╗
║                                       ║
║   █▀▀▀▀▀█ ▀▀█▄ █ ▄█▀▀ █▀▀▀▀▀█      ║
║   █ ███ █ ▄█ ▀▄▀█▀▄█ █ ███ █      ║
║   █ ▀▀▀ █ █▀▄█▀ █▀ ▄ █ ▀▀▀ █      ║
║   ▀▀▀▀▀▀▀ █ ▀ ▀▄▀ ▀ █ ▀▀▀▀▀▀▀      ║
║   ...                                 ║
║                                       ║
╚═══════════════════════════════════════╝

PWA Access:
https://novabot.work/?token=abc123...

Temporary token expires in 5 minutes.
```

### 2. Device Pairing

**User opens URL** :
```
https://novabot.work/?token=abc123...
```

**Frontend (public/app.js)** :
```javascript
// Extract token from URL
const urlParams = new URLSearchParams(window.location.search);
const tempToken = urlParams.get('token');

if (tempToken) {
  // Exchange for permanent token
  const response = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: tempToken,
      device_name: getDeviceName() // e.g., "iPhone Safari"
    })
  });

  const { token: permanentToken } = await response.json();

  // Store permanently
  localStorage.setItem('auth_token', permanentToken);

  // Remove token from URL
  window.history.replaceState({}, '', '/');
}
```

**Backend (src/web-server.ts)** :
```typescript
app.post('/api/login', (req, res) => {
  const { token, device_name } = req.body;

  const permanentToken = exchangeTemporaryToken(token, device_name);

  if (!permanentToken) {
    return res.status(401).json({
      error: 'Invalid or expired token'
    });
  }

  res.json({ token: permanentToken });
});
```

**Backend logic (src/auth.ts)** :
```typescript
export function exchangeTemporaryToken(
  tempToken: string,
  deviceName: string
): string | null {
  const now = new Date();

  // Find temporary token
  const tokenEntry = authStore.temporary_tokens.find(t => t.token === tempToken);
  if (!tokenEntry) return null;

  // Check expiration
  if (new Date(tokenEntry.expires_at) < now) return null;

  // Check if already used
  if (tokenEntry.used) return null;

  // Mark as used
  tokenEntry.used = true;

  // Generate permanent token
  const permanentToken = generateToken();
  const permToken: PermanentToken = {
    token: permanentToken,
    device_name: deviceName || 'Unknown Device',
    created_at: now.toISOString(),
    last_used: now.toISOString()
  };

  authStore.permanent_tokens.push(permToken);
  saveAuthStore();

  return permanentToken;
}
```

### 3. Subsequent Requests

**Frontend** :
```javascript
const token = localStorage.getItem('auth_token');

// HTTP requests
const response = await fetch('/api/conversations', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

// WebSocket connections
const ws = new WebSocket(`wss://novabot.work/ws?token=${token}`);
```

**Backend middleware (src/web-server.ts)** :
```typescript
function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // Extract token from header or query
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : req.query.token as string;

  if (!token || !verifyPermanentToken(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

// Apply to protected routes
app.use('/api', authMiddleware);
```

**Token verification (src/auth.ts)** :
```typescript
export function verifyPermanentToken(token: string): boolean {
  const tokenEntry = authStore.permanent_tokens.find(t => t.token === token);

  if (!tokenEntry) return false;

  // Update last used timestamp
  tokenEntry.last_used = new Date().toISOString();
  saveAuthStore();

  return true;
}
```

## Device Management

### List Devices

```bash
# CLI (if implemented)
npm run devices:list
```

**Output** :
```
📱 Devices connectés (2):

1. iPhone
   Token: def456...
   Connecté: 06/02/2026 10:31:00
   Dernier accès: il y a 30 min

2. MacBook Pro
   Token: ghi789...
   Connecté: 05/02/2026 14:20:00
   Dernier accès: il y a 15 min
```

**API endpoint** :
```typescript
// GET /api/devices
app.get('/api/devices', authMiddleware, (req, res) => {
  const devices = getAllTokens().map(t => ({
    device_name: t.device_name,
    created_at: t.created_at,
    last_used: t.last_used
  }));

  res.json({ devices });
});
```

### Revoke Device

**API endpoint** :
```typescript
// DELETE /api/devices/:deviceName
app.delete('/api/devices/:deviceName', authMiddleware, (req, res) => {
  const { deviceName } = req.params;

  const success = revokeToken(deviceName);

  if (!success) {
    return res.status(404).json({ error: 'Device not found' });
  }

  res.json({ message: 'Device revoked' });
});
```

**Backend logic (src/auth.ts)** :
```typescript
export function revokeToken(tokenOrDeviceName: string): boolean {
  const initialLength = authStore.permanent_tokens.length;

  authStore.permanent_tokens = authStore.permanent_tokens.filter(
    t => t.token !== tokenOrDeviceName && t.device_name !== tokenOrDeviceName
  );

  if (authStore.permanent_tokens.length < initialLength) {
    saveAuthStore();
    return true;
  }

  return false;
}
```

## Security Considerations

### Token Security

**Generation** :
- 256-bit random tokens (64 hex characters)
- Cryptographically secure (crypto.randomBytes)
- Collision probability negligible

**Transmission** :
- HTTPS enforced (Cloudflare Tunnel provides TLS)
- No plaintext transmission over unsecured connections

**Storage** :
- Server: `data/auth.json` (filesystem, readable only by process owner)
- Client: localStorage (isolated per origin, not accessible from other sites)

### Attack Vectors & Mitigations

#### 1. Token Interception

**Attack** : Man-in-the-middle captures token during pairing.

**Mitigation** :
- HTTPS enforced (Cloudflare Tunnel)
- 5-minute expiration window for temporary tokens
- One-time use for temporary tokens

#### 2. Token Theft

**Attack** : Attacker gains access to `data/auth.json` or client's localStorage.

**Mitigation** :
- Filesystem permissions (owner-only read/write)
- Device management allows remote revocation
- Last-used tracking helps detect unauthorized usage

#### 3. Replay Attacks

**Attack** : Attacker captures and replays API requests.

**Mitigation** :
- HTTPS prevents capture
- Permanent tokens updated on each use (last_used timestamp)
- Optional: Add request signing (not yet implemented)

#### 4. QR Code Phishing

**Attack** : Attacker replaces legitimate QR code with malicious one.

**Mitigation** :
- Physical access required to terminal displaying QR
- Temporary token visible in URL (user can verify domain)
- Cloudflare domain unique to user's configuration

### Token Lifetime Management

#### Temporary Token Cleanup

```typescript
// src/auth.ts
function cleanupExpiredTokens(): void {
  const now = new Date();

  authStore.temporary_tokens = authStore.temporary_tokens.filter(
    t => !t.used && new Date(t.expires_at) > now
  );

  saveAuthStore();
}

// Run at startup and periodically
initializeAuth(); // Calls cleanupExpiredTokens()
```

#### Permanent Token Rotation (TODO)

Future enhancement: Optional periodic rotation of permanent tokens.

```typescript
// Proposed API
// POST /api/refresh-token
app.post('/api/refresh-token', authMiddleware, (req, res) => {
  const oldToken = extractToken(req);
  const newToken = rotateToken(oldToken);

  res.json({ token: newToken });
});
```

## Implementation Details

### Token Extraction

```typescript
// src/web-server.ts
function extractToken(req: Request): string | null {
  // 1. Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  // 2. Check query parameter (for WebSocket)
  if (req.query.token) {
    return req.query.token as string;
  }

  return null;
}
```

### WebSocket Authentication

```typescript
// src/web-server.ts
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');

  if (!token || !verifyToken(token)) {
    ws.close(1008, 'Unauthorized');
    return;
  }

  // Connection authenticated
  clients.add(ws);
});
```

### Migration Support

```typescript
// src/auth.ts - Migration from old format
function loadAuthStore(): AuthStore {
  if (fs.existsSync(AUTH_FILE)) {
    const data = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));

    // Old format: { tokens: [...] }
    // New format: { temporary_tokens: [...], permanent_tokens: [...] }
    if (!data.temporary_tokens) {
      return {
        temporary_tokens: [],
        permanent_tokens: data.tokens || data.permanent_tokens || []
      };
    }

    return data;
  }

  return { temporary_tokens: [], permanent_tokens: [] };
}
```

## API Reference

### POST /api/login

Exchange temporary token for permanent token.

**Request** :
```json
{
  "token": "abc123...",
  "device_name": "iPhone Safari"
}
```

**Response** :
```json
{
  "token": "def456..."
}
```

**Errors** :
- `401 Unauthorized` : Invalid, expired, or already-used token

### GET /api/devices

List all connected devices.

**Headers** :
```
Authorization: Bearer {permanent_token}
```

**Response** :
```json
{
  "devices": [
    {
      "device_name": "iPhone",
      "created_at": "2026-02-06T10:31:00Z",
      "last_used": "2026-02-06T12:00:00Z"
    }
  ]
}
```

### DELETE /api/devices/:deviceName

Revoke a device's access.

**Headers** :
```
Authorization: Bearer {permanent_token}
```

**Response** :
```json
{
  "message": "Device revoked"
}
```

**Errors** :
- `404 Not Found` : Device not found

## Future Enhancements

### Multi-User Support

Currently single-user. Future:
- User accounts with passwords/OAuth
- Per-user conversation isolation
- Role-based access control

### Session Management

Currently tokens don't expire. Future:
- Optional expiration (e.g., 30 days)
- Automatic renewal
- Session invalidation on security events

### Two-Factor Authentication

Optional 2FA for additional security:
- TOTP (Time-based One-Time Password)
- SMS verification
- Email confirmation

### OAuth Integration

Allow login with external providers:
- Google
- GitHub
- Apple

## Resources

- [Web Authentication API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API)
- [OWASP Token Best Practices](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html)
- [localStorage Security](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage#security)
