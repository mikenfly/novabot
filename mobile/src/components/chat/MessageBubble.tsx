import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { Message } from '@nanoclaw/shared';
import { Avatar } from '../common/Avatar';
import { MessageContent } from './MessageContent';
import { colors, radius, spacing, typography } from '../../theme';

interface MessageBubbleProps {
  message: Message;
  isPending?: boolean;
  pendingStatus?: 'sending' | 'failed';
}

function stripAssistantPrefix(content: string): string {
  return content.replace(/^\w+:\s/, '');
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export function MessageBubble({ message, isPending, pendingStatus }: MessageBubbleProps) {
  const isUser = message.is_from_me;
  const displayContent = isUser ? message.content : stripAssistantPrefix(message.content);

  return (
    <View
      style={[
        styles.row,
        isUser ? styles.rowUser : styles.rowAssistant,
        isPending && styles.pending,
      ]}
    >
      {!isUser ? <Avatar name={message.sender_name} /> : null}

      <View
        style={[
          styles.bubble,
          isUser ? styles.bubbleUser : styles.bubbleAssistant,
        ]}
      >
        <View style={styles.header}>
          <Text style={[styles.sender, isUser && styles.senderUser]}>
            {isUser ? 'Vous' : message.sender_name}
          </Text>
          {isPending ? (
            <Text style={styles.pendingLabel}>
              {pendingStatus === 'failed' ? 'Échec' : 'Envoi...'}
            </Text>
          ) : (
            <Text style={styles.time}>{formatTime(message.timestamp)}</Text>
          )}
        </View>

        {displayContent ? (
          <MessageContent
            content={displayContent}
            conversationId={message.chat_jid}
          />
        ) : null}
      </View>

      {isUser ? <Avatar name="Vous" isUser /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    maxWidth: '85%',
  },
  rowUser: {
    alignSelf: 'flex-end',
    flexDirection: 'row-reverse',
  },
  rowAssistant: {
    alignSelf: 'flex-start',
  },
  pending: {
    opacity: 0.5,
  },
  bubble: {
    flex: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
  },
  bubbleUser: {
    backgroundColor: colors.messageUser,
    borderColor: colors.messageUserBorder,
  },
  bubbleAssistant: {
    backgroundColor: colors.messageAssistant,
    borderColor: colors.messageAssistantBorder,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  sender: {
    color: colors.connectionOk,
    fontSize: 12,
    fontWeight: '600',
  },
  senderUser: {
    color: colors.accent,
  },
  time: {
    color: colors.textTertiary,
    fontSize: 11,
  },
  pendingLabel: {
    color: colors.textTertiary,
    fontSize: 11,
    fontStyle: 'italic',
  },
});
