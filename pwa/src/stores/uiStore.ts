import { create } from 'zustand';

interface UIState {
  sidebarOpen: boolean;
  isMobile: boolean;
  connectionStatus: 'connected' | 'disconnected' | 'reconnecting';
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setConnectionStatus: (status: 'connected' | 'disconnected' | 'reconnecting') => void;
  setIsMobile: (isMobile: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  isMobile: false,
  connectionStatus: 'disconnected',

  toggleSidebar: () => {
    set((state) => ({ sidebarOpen: !state.sidebarOpen }));
  },

  setSidebarOpen: (open: boolean) => {
    set({ sidebarOpen: open });
  },

  setConnectionStatus: (status) => {
    set({ connectionStatus: status });
  },

  setIsMobile: (isMobile: boolean) => {
    set({ isMobile });
  },
}));
