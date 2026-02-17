import { create } from 'zustand';

interface AgentStatusState {
  status: Record<string, string | null>;
  handleAgentStatus: (conversationId: string, status: string) => void;
  clearStatus: (conversationId: string) => void;
  clearAllStatuses: () => void;
}

export const useAgentStatusStore = create<AgentStatusState>((set) => ({
  status: {},

  handleAgentStatus: (conversationId: string, status: string) => {
    // "done", "error", and "interrupted" are terminal — clear the indicator
    if (status === 'done' || status === 'error' || status === 'interrupted') {
      set((state) => ({
        status: { ...state.status, [conversationId]: null },
      }));
      return;
    }
    set((state) => ({
      status: { ...state.status, [conversationId]: status },
    }));
  },

  clearStatus: (conversationId: string) => {
    set((state) => ({
      status: { ...state.status, [conversationId]: null },
    }));
  },

  clearAllStatuses: () => {
    set({ status: {} });
  },
}));
