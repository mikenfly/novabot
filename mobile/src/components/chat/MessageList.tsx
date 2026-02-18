import React, { useCallback, useEffect, useRef } from 'react';
import { FlatList, View, Text, StyleSheet } from 'react-native';
import { useMessageStore } from '@nanoclaw/shared';
import type { Message, PendingMessage } from '@nanoclaw/shared';
import { MessageBubble } from './MessageBubble';
import { Spinner } from '../common/Spinner';
import { colors, spacing } from '../../theme';

interface MessageListProps {
  conversationId: string;
}

type ListItem =
  | { type: 'message'; data: Message }
  | { type: 'pending'; data: PendingMessage };

export function MessageList({ conversationId }: MessageListProps) {
  const messages = useMessageStore((s) => s.messages[conversationId] ?? []);
  const pendingMessages = useMessageStore((s) => s.pendingMessages[conversationId] ?? []);
  const isLoading = useMessageStore((s) => s.isLoading[conversationId] ?? false);
  const fetchMessages = useMessageStore((s) => s.fetchMessages);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    fetchMessages(conversationId);
  }, [conversationId, fetchMessages]);

  // Auto-scroll when new messages arrive
  const prevCountRef = useRef(0);
  useEffect(() => {
    const totalCount = messages.length + pendingMessages.length;
    if (totalCount > prevCountRef.current && totalCount > 0) {
      // Small delay to ensure layout is complete
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
    prevCountRef.current = totalCount;
  }, [messages.length, pendingMessages.length]);

  const listData: ListItem[] = [
    ...messages.map((m): ListItem => ({ type: 'message', data: m })),
    ...pendingMessages.map((p): ListItem => ({ type: 'pending', data: p })),
  ];

  const renderItem = useCallback(({ item }: { item: ListItem }) => {
    if (item.type === 'pending') {
      const p = item.data as PendingMessage;
      const asMessage: Message = {
        id: p.tempId,
        chat_jid: p.conversationId,
        sender_name: 'Vous',
        content: p.content,
        timestamp: p.timestamp,
        is_from_me: true,
        audio_url: p.audio_url,
      };
      return (
        <MessageBubble
          message={asMessage}
          isPending
          pendingStatus={p.status}
        />
      );
    }
    return <MessageBubble message={item.data as Message} />;
  }, []);

  const keyExtractor = useCallback((item: ListItem) => {
    return item.type === 'pending'
      ? (item.data as PendingMessage).tempId
      : (item.data as Message).id;
  }, []);

  if (isLoading && messages.length === 0) {
    return (
      <View style={styles.loading}>
        <Spinner />
        <Text style={styles.loadingText}>Chargement...</Text>
      </View>
    );
  }

  return (
    <FlatList
      ref={flatListRef}
      data={listData}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      contentContainerStyle={styles.list}
      style={styles.container}
      showsVerticalScrollIndicator={false}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  list: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },
  loadingText: {
    color: colors.textTertiary,
    fontSize: 13,
  },
});
