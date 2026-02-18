/**
 * Auth token storage — platform-agnostic interface.
 *
 * PWA: uses localStorage (sync)
 * Mobile: uses AsyncStorage (async)
 *
 * The shared stores/services call these as async — on web the promises
 * resolve synchronously which is fine.
 */

export interface TokenStorage {
  getToken(): Promise<string | null>;
  setToken(token: string): Promise<void>;
  clearToken(): Promise<void>;
}

let _storage: TokenStorage | null = null;

export function configureAuth(storage: TokenStorage): void {
  _storage = storage;
}

function getStorage(): TokenStorage {
  if (!_storage) {
    throw new Error('Auth not configured — call configureAuth() at app startup');
  }
  return _storage;
}

export function getToken(): Promise<string | null> {
  return getStorage().getToken();
}

export function setToken(token: string): Promise<void> {
  return getStorage().setToken(token);
}

export function clearToken(): Promise<void> {
  return getStorage().clearToken();
}
