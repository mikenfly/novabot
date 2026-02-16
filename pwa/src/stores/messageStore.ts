import { create } from 'zustand';
import { api } from '../services/api';
import { useAgentStatusStore } from './agentStatusStore';
import type { Message, PendingMessage } from '../types/conversation';
import type { MessagesResponse, SendMessageResponse } from '../types/api';
import type { WsMessageData } from '../types/websocket';

interface MessageState {
  messages: Record<string, Message[]>;
  pendingMessages: Record<string, PendingMessage[]>;
  isLoading: Record<string, boolean>;
  fetchMessages: (conversationId: string, since?: string) => Promise<void>;
  sendMessage: (conversationId: string, content: string, audioMode?: boolean) => Promise<void>;
  sendAudio: (conversationId: string, blob: Blob) => Promise<void>;
  handleIncomingMessage: (data: WsMessageData) => void;
}

export const useMessageStore = create<MessageState>((set) => ({
  messages: {},
  pendingMessages: {},
  isLoading: {},

  fetchMessages: async (conversationId: string, since?: string) => {
    set((state) => ({
      isLoading: { ...state.isLoading, [conversationId]: true },
    }));
    try {
      const query = since ? `?since=${encodeURIComponent(since)}` : '';
      const { messages } = await api.get<MessagesResponse>(
        `/api/conversations/${conversationId}/messages${query}`,
      );
      set((state) => {
        const existing = since ? (state.messages[conversationId] ?? []) : [];
        const existingIds = new Set(existing.map((m) => m.id));
        const newMessages = messages.filter((m) => !existingIds.has(m.id));
        return {
          messages: {
            ...state.messages,
            [conversationId]: [...existing, ...newMessages],
          },
          isLoading: { ...state.isLoading, [conversationId]: false },
        };
      });
    } catch {
      set((state) => ({
        isLoading: { ...state.isLoading, [conversationId]: false },
      }));
    }
  },

  sendMessage: async (conversationId: string, content: string, audioMode?: boolean) => {
    const tempId = `temp-${Date.now()}`;
    const pending: PendingMessage = {
      tempId,
      conversationId,
      content,
      timestamp: new Date().toISOString(),
      status: 'sending',
    };

    set((state) => ({
      pendingMessages: {
        ...state.pendingMessages,
        [conversationId]: [
          ...(state.pendingMessages[conversationId] ?? []),
          pending,
        ],
      },
    }));

    // Show immediate typing indicator while agent starts
    useAgentStatusStore.getState().handleAgentStatus(conversationId, 'Réflexion...');

    try {
      await api.post<SendMessageResponse>(
        `/api/conversations/${conversationId}/messages`,
        { content, audioMode },
      );
      // Move pending message to confirmed messages
      set((state) => {
        const confirmedMsg: Message = {
          id: tempId,
          chat_jid: conversationId,
          sender_name: 'Vous',
          content,
          timestamp: pending.timestamp,
          is_from_me: true,
        };
        const existing = state.messages[conversationId] ?? [];
        return {
          messages: {
            ...state.messages,
            [conversationId]: [...existing, confirmedMsg],
          },
          pendingMessages: {
            ...state.pendingMessages,
            [conversationId]: (state.pendingMessages[conversationId] ?? []).filter(
              (p) => p.tempId !== tempId,
            ),
          },
        };
      });
    } catch {
      set((state) => ({
        pendingMessages: {
          ...state.pendingMessages,
          [conversationId]: (state.pendingMessages[conversationId] ?? []).map(
            (p) => (p.tempId === tempId ? { ...p, status: 'failed' as const } : p),
          ),
        },
      }));
    }
  },

  sendAudio: async (conversationId: string, blob: Blob) => {
    const tempId = `temp-audio-${Date.now()}`;
    const blobUrl = URL.createObjectURL(blob);
    const pending: PendingMessage = {
      tempId,
      conversationId,
      content: '',
      timestamp: new Date().toISOString(),
      status: 'sending',
      audio_url: blobUrl,
    };

    set((state) => ({
      pendingMessages: {
        ...state.pendingMessages,
        [conversationId]: [
          ...(state.pendingMessages[conversationId] ?? []),
          pending,
        ],
      },
    }));

    useAgentStatusStore.getState().handleAgentStatus(conversationId, 'Transcription audio...');

    try {
      const result = await api.uploadBlob<{ success: boolean; messageId: string; transcription: string; audioUrl: string }>(
        `/api/conversations/${conversationId}/audio`,
        blob,
        blob.type || 'audio/webm',
      );
      URL.revokeObjectURL(blobUrl);
      // Move pending to confirmed with the transcription + server audio URL
      set((state) => {
        const confirmedMsg: Message = {
          id: result.messageId || tempId,
          chat_jid: conversationId,
          sender_name: 'Vous',
          content: result.transcription,
          timestamp: pending.timestamp,
          is_from_me: true,
          audio_url: result.audioUrl,
        };
        const existing = state.messages[conversationId] ?? [];
        return {
          messages: {
            ...state.messages,
            [conversationId]: [...existing, confirmedMsg],
          },
          pendingMessages: {
            ...state.pendingMessages,
            [conversationId]: (state.pendingMessages[conversationId] ?? []).filter(
              (p) => p.tempId !== tempId,
            ),
          },
        };
      });
    } catch {
      URL.revokeObjectURL(blobUrl);
      set((state) => ({
        pendingMessages: {
          ...state.pendingMessages,
          [conversationId]: (state.pendingMessages[conversationId] ?? []).map(
            (p) => (p.tempId === tempId ? { ...p, status: 'failed' as const } : p),
          ),
        },
      }));
    }
  },

  handleIncomingMessage: (data: WsMessageData) => {
    const isFromMe = data.is_from_me ?? false;
    const message: Message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      chat_jid: data.chat_jid,
      sender_name: data.sender_name,
      content: data.content,
      timestamp: data.timestamp,
      is_from_me: isFromMe,
      audio_url: data.audio_url,
      audio_segments: data.audio_segments,
    };

    set((state) => {
      // Skip if this is a self-sent message (already handled by sendMessage)
      if (isFromMe) return state;

      const existing = state.messages[data.chat_jid] ?? [];
      return {
        messages: {
          ...state.messages,
          [data.chat_jid]: [...existing, message],
        },
      };
    });
  },
}));
