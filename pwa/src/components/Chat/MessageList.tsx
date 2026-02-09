import { useEffect } from 'react';
import { useMessageStore } from '../../stores/messageStore';
import { useAutoScroll } from '../../hooks/useAutoScroll';
import MessageBubble from './MessageBubble';
import './MessageList.css';

interface MessageListProps {
  conversationId: string;
}

// Shared empty array to avoid creating new references
const EMPTY_ARRAY: never[] = [];

export default function MessageList({ conversationId }: MessageListProps) {
  const messages = useMessageStore((s) => s.messages[conversationId] || EMPTY_ARRAY);
  const pendingMessages = useMessageStore((s) => s.pendingMessages[conversationId] || EMPTY_ARRAY);
  const isLoading = useMessageStore((s) => s.isLoading[conversationId] ?? false);
  const fetchMessages = useMessageStore((s) => s.fetchMessages);

  const { containerRef, showNewMessageBadge, scrollToBottom } = useAutoScroll([
    messages.length,
    pendingMessages.length,
  ]);

  useEffect(() => {
    fetchMessages(conversationId);
  }, [conversationId, fetchMessages]);

  return (
    <div className="message-list" ref={containerRef}>
      {isLoading && messages.length === 0 && (
        <div className="message-list__loading">Chargement...</div>
      )}
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
      {pendingMessages.map((msg) => (
        <MessageBubble
          key={msg.tempId}
          message={{
            id: msg.tempId,
            chat_jid: msg.conversationId,
            sender_name: 'You',
            content: msg.content,
            timestamp: msg.timestamp,
            is_from_me: true,
          }}
          isPending
          pendingStatus={msg.status}
        />
      ))}
      {showNewMessageBadge && (
        <button className="message-list__new-badge" onClick={scrollToBottom}>
          Nouveaux messages
        </button>
      )}
    </div>
  );
}
