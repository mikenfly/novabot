import { create } from 'zustand';
import { api } from '../services/api';
import type { Conversation } from '../types/conversation';
import type { ConversationsResponse } from '../types/api';

interface ConversationState {
  conversations: Conversation[];
  activeId: string | null;
  isLoading: boolean;
  fetchConversations: () => Promise<void>;
  createConversation: (name?: string) => Promise<string>;
  renameConversation: (id: string, name: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  setActive: (id: string) => void;
  /** Move a conversation to the top (new message received) */
  bumpConversation: (id: string) => void;
  handleConversationCreated: (conv: Conversation) => void;
  handleConversationRenamed: (id: string, name: string) => void;
  handleConversationDeleted: (id: string) => void;
}

export const useConversationStore = create<ConversationState>((set) => ({
  conversations: [],
  activeId: null,
  isLoading: false,

  fetchConversations: async () => {
    set({ isLoading: true });
    try {
      const { conversations } = await api.get<ConversationsResponse>('/api/conversations');
      set({ conversations, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  createConversation: async (name?: string) => {
    const conv = await api.post<Conversation>('/api/conversations', name ? { name } : {});
    set((state) => {
      // Dedup: the WebSocket broadcast may have already added this conversation
      if (state.conversations.some((c) => c.jid === conv.jid)) {
        return { activeId: conv.jid };
      }
      return {
        conversations: [conv, ...state.conversations],
        activeId: conv.jid,
      };
    });
    return conv.jid;
  },

  renameConversation: async (id: string, name: string) => {
    await api.patch('/api/conversations/' + id, { name });
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.jid === id ? { ...c, name } : c,
      ),
    }));
  },

  deleteConversation: async (id: string) => {
    await api.delete('/api/conversations/' + id);
    set((state) => ({
      conversations: state.conversations.filter((c) => c.jid !== id),
      activeId: state.activeId === id ? null : state.activeId,
    }));
  },

  setActive: (id: string) => {
    set({ activeId: id });
  },

  bumpConversation: (id: string) => {
    set((state) => {
      const idx = state.conversations.findIndex((c) => c.jid === id);
      if (idx <= 0) return state; // already first or not found
      const conv = state.conversations[idx]!;
      const updated = { ...conv, lastActivity: new Date().toISOString() };
      const rest = state.conversations.filter((_, i) => i !== idx);
      return { conversations: [updated, ...rest] };
    });
  },

  handleConversationCreated: (conv: Conversation) => {
    set((state) => {
      if (state.conversations.some((c) => c.jid === conv.jid)) return state;
      return { conversations: [conv, ...state.conversations] };
    });
  },

  handleConversationRenamed: (id: string, name: string) => {
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.jid === id ? { ...c, name } : c,
      ),
    }));
  },

  handleConversationDeleted: (id: string) => {
    set((state) => ({
      conversations: state.conversations.filter((c) => c.jid !== id),
      activeId: state.activeId === id ? null : state.activeId,
    }));
  },
}));
