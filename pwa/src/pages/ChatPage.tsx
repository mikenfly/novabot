import { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useConversationStore } from '../stores/conversationStore';
import { useWebSocket } from '../hooks/useWebSocket';
import AppLayout from '../components/Layout/AppLayout';
import Sidebar from '../components/Sidebar/Sidebar';
import ChatArea from '../components/Chat/ChatArea';
import ErrorBoundary from '../components/Common/ErrorBoundary';

export default function ChatPage() {
  const initialize = useAuthStore((s) => s.initialize);
  const fetchConversations = useConversationStore((s) => s.fetchConversations);

  useEffect(() => {
    initialize();
    fetchConversations();
  }, [initialize, fetchConversations]);

  useWebSocket();

  return (
    <AppLayout sidebar={<Sidebar />}>
      <ErrorBoundary>
        <ChatArea />
      </ErrorBoundary>
    </AppLayout>
  );
}
