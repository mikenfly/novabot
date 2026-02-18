import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './config.js';
import { logger } from './logger.js';

interface TemporaryToken {
  token: string;
  created_at: string;
  expires_at: string;
  used: boolean;
}

interface PermanentToken {
  token: string;
  device_name: string;
  created_at: string;
  last_used: string;
}

interface AuthStore {
  temporary_tokens: TemporaryToken[];
  permanent_tokens: PermanentToken[];
}

const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const TEMP_TOKEN_TTL = 5 * 60 * 1000; // 5 minutes

let authStore: AuthStore = {
  temporary_tokens: [],
  permanent_tokens: [],
};

function loadAuthStore(): AuthStore {
  try {
    if (fs.existsSync(AUTH_FILE)) {
      const data = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));

      // Migrate old format to new format
      if (!data.temporary_tokens) {
        logger.info('Migrating auth store to new format');

        // Migrate old tokens to new permanent format
        const oldTokens = data.tokens || [];
        const permanentTokens: PermanentToken[] = oldTokens.map((t: any) => ({
          token: t.token,
          device_name: t.deviceName || 'Legacy Device',
          created_at: t.createdAt || new Date().toISOString(),
          last_used: new Date().toISOString(),
        }));

        return {
          temporary_tokens: [],
          permanent_tokens: permanentTokens,
        };
      }

      return data;
    }
  } catch (err) {
    logger.error({ err }, 'Failed to load auth store');
  }
  return { temporary_tokens: [], permanent_tokens: [] };
}

function saveAuthStore(): void {
  try {
    fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
    fs.writeFileSync(AUTH_FILE, JSON.stringify(authStore, null, 2));
  } catch (err) {
    logger.error({ err }, 'Failed to save auth store');
  }
}

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Initialize authentication system
 */
export function initializeAuth(): void {
  authStore = loadAuthStore();

  // Clean up expired temporary tokens
  cleanupExpiredTokens();

  logger.info(
    {
      temporary: authStore.temporary_tokens.length,
      permanent: authStore.permanent_tokens.length,
    },
    'Authentication initialized'
  );
}

/**
 * Generate a temporary token (for QR code pairing)
 */
export function generateTemporaryToken(): string {
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TEMP_TOKEN_TTL);

  const tempToken: TemporaryToken = {
    token,
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    used: false,
  };

  authStore.temporary_tokens.push(tempToken);
  saveAuthStore();

  logger.info(
    { expiresAt: expiresAt.toISOString() },
    'Temporary token generated'
  );

  return token;
}

/**
 * Verify a temporary token and create a permanent token if valid
 */
export function exchangeTemporaryToken(
  tempToken: string,
  deviceName: string
): string | null {
  const now = new Date();

  // Find the temporary token
  const tokenEntry = authStore.temporary_tokens.find(
    (t) => t.token === tempToken
  );

  if (!tokenEntry) {
    logger.warn('Temporary token not found');
    return null;
  }

  // Check if expired
  if (new Date(tokenEntry.expires_at) < now) {
    logger.warn('Temporary token expired');
    return null;
  }

  // Check if already used
  if (tokenEntry.used) {
    logger.warn('Temporary token already used');
    return null;
  }

  // Mark as used
  tokenEntry.used = true;

  // Generate permanent token
  const permanentToken = generateToken();
  const permToken: PermanentToken = {
    token: permanentToken,
    device_name: deviceName || 'Unknown Device',
    created_at: now.toISOString(),
    last_used: now.toISOString(),
  };

  authStore.permanent_tokens.push(permToken);
  saveAuthStore();

  logger.info(
    { deviceName: permToken.device_name },
    'Permanent token created from temporary token'
  );

  return permanentToken;
}

/**
 * Verify a permanent token
 */
export function verifyPermanentToken(token: string): boolean {
  const tokenEntry = authStore.permanent_tokens.find((t) => t.token === token);

  if (!tokenEntry) {
    return false;
  }

  // Update last used
  tokenEntry.last_used = new Date().toISOString();
  saveAuthStore();

  return true;
}

/**
 * Verify any token (temporary or permanent)
 * Used by middleware for backward compatibility
 */
export function verifyToken(token: string): boolean {
  // Check DEV_TOKEN from .env first (stable dev access, never expires)
  const devToken = process.env.DEV_TOKEN;
  if (devToken && token === devToken) {
    return true;
  }

  // Check permanent tokens (most common case)
  if (verifyPermanentToken(token)) {
    return true;
  }

  // Check temporary tokens (for initial pairing)
  const tempToken = authStore.temporary_tokens.find(
    (t) => t.token === token && !t.used && new Date(t.expires_at) > new Date()
  );

  return !!tempToken;
}

/**
 * Get all permanent tokens (for device management)
 */
export function getAllTokens(): PermanentToken[] {
  return authStore.permanent_tokens;
}

/**
 * Revoke a permanent token by token value or device name
 */
export function revokeToken(tokenOrDeviceName: string): boolean {
  const initialLength = authStore.permanent_tokens.length;

  authStore.permanent_tokens = authStore.permanent_tokens.filter(
    (t) => t.token !== tokenOrDeviceName && t.device_name !== tokenOrDeviceName
  );

  if (authStore.permanent_tokens.length < initialLength) {
    saveAuthStore();
    logger.info({ tokenOrDeviceName }, 'Token revoked');
    return true;
  }

  return false;
}

/**
 * Clean up expired temporary tokens
 */
function cleanupExpiredTokens(): void {
  const now = new Date();
  const initialLength = authStore.temporary_tokens.length;

  authStore.temporary_tokens = authStore.temporary_tokens.filter(
    (t) => !t.used && new Date(t.expires_at) > now
  );

  if (authStore.temporary_tokens.length < initialLength) {
    saveAuthStore();
    logger.info(
      { cleaned: initialLength - authStore.temporary_tokens.length },
      'Expired temporary tokens cleaned up'
    );
  }
}

/**
 * Ensure an access token exists — return existing or generate temporary.
 */
export function ensureAccessToken(): string {
  const existingToken = getFirstToken();
  if (existingToken) {
    logger.info('Utilisation du token existant');
    return existingToken;
  }

  logger.info('Génération d\'un token temporaire (5 min)...');
  const token = generateTemporaryToken();
  logger.info('Token temporaire généré');
  return token;
}

/**
 * Get first available token (for backward compatibility with ensureAccessToken)
 */
export function getFirstToken(): string | null {
  // Try to get an existing permanent token
  if (authStore.permanent_tokens.length > 0) {
    return authStore.permanent_tokens[0].token;
  }

  // Try to get an unused temporary token
  const tempToken = authStore.temporary_tokens.find(
    (t) => !t.used && new Date(t.expires_at) > new Date()
  );

  if (tempToken) {
    return tempToken.token;
  }

  return null;
}

/**
 * CLI helper: List all devices
 */
export function listDevices(): void {
  if (authStore.permanent_tokens.length === 0) {
    console.log('\n📱 Aucun device connecté\n');
    return;
  }

  console.log(`\n📱 Devices connectés (${authStore.permanent_tokens.length}):\n`);

  authStore.permanent_tokens.forEach((token, index) => {
    const lastUsed = new Date(token.last_used);
    const now = new Date();
    const diffMs = now.getTime() - lastUsed.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    let lastUsedStr = 'actif';
    if (diffMins < 1) {
      lastUsedStr = 'actif';
    } else if (diffMins < 60) {
      lastUsedStr = `il y a ${diffMins} min`;
    } else if (diffHours < 24) {
      lastUsedStr = `il y a ${diffHours}h`;
    } else {
      lastUsedStr = `il y a ${diffDays} jour${diffDays > 1 ? 's' : ''}`;
    }

    console.log(`${index + 1}. ${token.device_name}`);
    console.log(`   Token: ${token.token.slice(0, 8)}...`);
    console.log(`   Connecté: ${new Date(token.created_at).toLocaleString('fr-FR')}`);
    console.log(`   Dernier accès: ${lastUsedStr}\n`);
  });
}
