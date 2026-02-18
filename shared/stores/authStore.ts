import { create } from 'zustand';
import { api, ApiRequestError } from '../services/api';
import { getToken, setToken, clearToken } from '../services/auth';
import type { LoginResponse } from '../types/api';

interface AuthState {
  token: string | null;
  isAuthenticated: boolean;
  /** True once initialize() has completed (token loaded from storage). */
  hydrated: boolean;
  login: (tempToken: string, deviceName: string) => Promise<boolean>;
  loginWithPermanentToken: (token: string) => Promise<boolean>;
  logout: () => Promise<void>;
  /** Load token from storage. Must be awaited before rendering protected screens. */
  initialize: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  isAuthenticated: false,
  hydrated: false,

  login: async (tempToken: string, deviceName: string) => {
    try {
      const { token } = await api.post<LoginResponse>('/api/login', {
        token: tempToken,
        deviceName,
      });
      await setToken(token);
      set({ token, isAuthenticated: true });
      return true;
    } catch (error) {
      if (error instanceof ApiRequestError) {
        throw error;
      }
      return false;
    }
  },

  loginWithPermanentToken: async (token: string) => {
    await setToken(token);
    try {
      await api.get('/api/conversations');
      set({ token, isAuthenticated: true });
      return true;
    } catch (error) {
      await clearToken();
      set({ token: null, isAuthenticated: false });
      if (error instanceof ApiRequestError) {
        throw error;
      }
      return false;
    }
  },

  logout: async () => {
    await clearToken();
    set({ token: null, isAuthenticated: false });
  },

  initialize: async () => {
    const token = await getToken();
    if (token) {
      set({ token, isAuthenticated: true, hydrated: true });
    } else {
      set({ hydrated: true });
    }
  },
}));
