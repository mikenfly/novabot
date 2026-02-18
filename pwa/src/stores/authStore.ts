import { create } from 'zustand';
import { api, ApiRequestError } from '../services/api';
import { getToken, setToken, clearToken } from '../services/auth';
import type { LoginResponse } from '../types/api';

interface AuthState {
  token: string | null;
  isAuthenticated: boolean;
  login: (tempToken: string, deviceName: string) => Promise<boolean>;
  loginWithPermanentToken: (token: string) => Promise<boolean>;
  logout: () => void;
  initialize: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  isAuthenticated: false,

  login: async (tempToken: string, deviceName: string) => {
    try {
      const { token } = await api.post<LoginResponse>('/api/login', {
        token: tempToken,
        deviceName,
      });
      setToken(token);
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
    // Validate token by making a test API call
    setToken(token);
    try {
      await api.get('/api/conversations');
      set({ token, isAuthenticated: true });
      return true;
    } catch (error) {
      clearToken();
      set({ token: null, isAuthenticated: false });
      if (error instanceof ApiRequestError) {
        throw error;
      }
      return false;
    }
  },

  logout: () => {
    clearToken();
    set({ token: null, isAuthenticated: false });
  },

  initialize: () => {
    const token = getToken();
    if (token) {
      set({ token, isAuthenticated: true });
    }
  },
}));
