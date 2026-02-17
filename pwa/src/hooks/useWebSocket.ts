import { useEffect } from 'react';
import { wsService } from '../services/websocket';
import { useAuthStore } from '../stores/authStore';
import { useConversationStore } from '../stores/conversationStore';
import { useMessageStore } from '../stores/messageStore';
import { useAgentStatusStore } from '../stores/agentStatusStore';
import { useUIStore } from '../stores/uiStore';
import type { WsMessage } from '../types/websocket';

export function useWebSocket(): void {
  const token = useAuthStore((s) => s.token);

  useEffect(() => {
    if (!token) return;

    const handleMessage = (msg: WsMessage) => {
      switch (msg.type) {
        case 'connected':
          useUIStore.getState().setConnectionStatus('connected');
          useAgentStatusStore.getState().clearAllStatuses();
          break;
        case 'pong':
          break;
        case 'message':
          useMessageStore.getState().handleIncomingMessage(msg.data);
          useAgentStatusStore.getState().clearStatus(msg.data.chat_jid);
          useConversationStore.getState().bumpConversation(msg.data.chat_jid);
          break;
        case 'agent_status':
          useAgentStatusStore.getState().handleAgentStatus(
            msg.data.conversation_id,
            msg.data.status,
          );
          break;
        case 'conversation_created':
          useConversationStore.getState().handleConversationCreated({
            jid: msg.data.jid,
            name: msg.data.name,
            folder: `pwa-${msg.data.jid}`,
            lastActivity: msg.data.lastActivity,
            type: msg.data.type,
          });
          break;
        case 'conversation_renamed':
          useConversationStore.getState().handleConversationRenamed(
            msg.data.jid,
            msg.data.name,
          );
          break;
        case 'conversation_deleted':
          useConversationStore.getState().handleConversationDeleted(msg.data.jid);
          break;
      }
    };

    const handleStatus = (status: 'connected' | 'disconnected' | 'reconnecting') => {
      useUIStore.getState().setConnectionStatus(status);
    };

    wsService.connect(token, handleMessage, handleStatus);

    return () => {
      wsService.disconnect();
    };
  }, [token]);
}
