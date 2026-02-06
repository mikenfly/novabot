import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './config.js';
import { logger } from './logger.js';

interface AuthToken {
  token: string;
  createdAt: string;
  expiresAt: string;
  deviceName?: string;
}

interface AuthStore {
  password: string;
  tokens: AuthToken[];
}

const AUTH_FILE = path.join(DATA_DIR, 'auth.json');

function loadAuthStore(): AuthStore {
  try {
    if (fs.existsSync(AUTH_FILE)) {
      return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
    }
  } catch (err) {
    logger.error({ err }, 'Failed to load auth store');
  }
  return { password: '', tokens: [] };
}

function saveAuthStore(store: AuthStore): void {
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify(store, null, 2));
}

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function initializeAuth(initialPassword?: string): void {
  const store = loadAuthStore();

  // If tokens already exist (from generate-token.js), don't require password
  if (store.tokens && store.tokens.length > 0) {
    logger.info('Authentication initialized with existing tokens');
    return;
  }

  if (!store.password && initialPassword) {
    store.password = hashPassword(initialPassword);
    saveAuthStore(store);
    logger.info('Authentication initialized with password');
  } else if (!store.password) {
    // No password and no tokens - user should run generate-token.js
    logger.info('No authentication configured. Run: node scripts/generate-token.js');
    console.log('\n⚠️  Aucun token configuré. Exécutez: node scripts/generate-token.js\n');
  }
}

export function verifyPassword(password: string): boolean {
  const store = loadAuthStore();
  return store.password === hashPassword(password);
}

export function createAuthToken(password: string, deviceName?: string): string | null {
  // Si le mot de passe est 'auto-generated-for-qr', créer un token sans vérification
  const skipPasswordCheck = password === 'auto-generated-for-qr';

  if (!skipPasswordCheck && !verifyPassword(password)) {
    return null;
  }

  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 year for auto-generated

  const store = loadAuthStore();
  store.tokens.push({
    token,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    deviceName,
  });

  // Clean up old tokens (older than expiry)
  store.tokens = store.tokens.filter(
    (t) => new Date(t.expiresAt) > now
  );

  saveAuthStore(store);
  logger.info({ deviceName }, 'Created new auth token');
  return token;
}

export function verifyToken(token: string): boolean {
  const store = loadAuthStore();
  const now = new Date();

  const tokenEntry = store.tokens.find((t) => t.token === token);
  if (!tokenEntry) {
    return false;
  }

  if (new Date(tokenEntry.expiresAt) < now) {
    return false;
  }

  return true;
}

export function revokeToken(token: string): void {
  const store = loadAuthStore();
  store.tokens = store.tokens.filter((t) => t.token !== token);
  saveAuthStore(store);
  logger.info('Revoked auth token');
}

export function getAllTokens(): AuthToken[] {
  const store = loadAuthStore();
  return store.tokens;
}
