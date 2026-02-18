import { create } from 'zustand';

interface UIState {
  connectionStatus: 'connected' | 'disconnected' | 'reconnecting';
  setConnectionStatus: (status: 'connected' | 'disconnected' | 'reconnecting') => void;
}

export const useUIStore = create<UIState>((set) => ({
  connectionStatus: 'disconnected',

  setConnectionStatus: (status) => {
    set({ connectionStatus: status });
  },
}));
