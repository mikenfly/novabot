import { useEffect, useRef, useCallback } from 'react';
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

  // Auto-advance: track play functions for audio messages
  const audioPlayFns = useRef<Map<number, () => void>>(new Map());

  const registerPlayFn = useCallback((index: number) => {
    return (playFn: () => void) => {
      audioPlayFns.current.set(index, playFn);
    };
  }, []);

  const handleAudioEnded = useCallback((index: number) => {
    return () => {
      const currentMsg = messages[index];
      if (!currentMsg) return;

      // Auto-advance only within the same turn (same sender)
      for (let i = index + 1; i < messages.length; i++) {
        const nextMsg = messages[i];
        if (!nextMsg) break;
        // Stop at turn boundary (sender changes)
        if (nextMsg.is_from_me !== currentMsg.is_from_me) break;

        if (nextMsg.audio_url || nextMsg.audio_segments?.length) {
          const playNext = audioPlayFns.current.get(i);
          if (playNext) playNext();
          return;
        }
      }
    };
  }, [messages]);

  return (
    <div className="message-list" ref={containerRef}>
      {isLoading && messages.length === 0 && (
        <div className="message-list__loading">Chargement...</div>
      )}
      {messages.map((msg, index) => {
        const hasAudio = !!(msg.audio_url || msg.audio_segments?.length);
        return (
          <MessageBubble
            key={msg.id}
            message={msg}
            onAudioEnded={hasAudio ? handleAudioEnded(index) : undefined}
            audioPlayRef={hasAudio ? registerPlayFn(index) : undefined}
          />
        );
      })}
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
            audio_url: msg.audio_url,
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
