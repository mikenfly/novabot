import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { Conversation } from '@nanoclaw/shared';
import { colors, radius, spacing } from '../../theme';

interface ConversationItemProps {
  conversation: Conversation;
  isSelected: boolean;
  isSelecting: boolean;
  onPress: () => void;
  onLongPress: () => void;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `il y a ${days}j`;
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export function ConversationItem({
  conversation,
  isSelected,
  isSelecting,
  onPress,
  onLongPress,
}: ConversationItemProps) {
  return (
    <Pressable
      style={[
        styles.item,
        isSelected && styles.itemSelected,
      ]}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
    >
      {isSelecting ? (
        <View style={[styles.checkbox, isSelected && styles.checkboxChecked]}>
          {isSelected ? <Text style={styles.checkmark}>✓</Text> : null}
        </View>
      ) : null}

      <View style={styles.textContainer}>
        <Text style={styles.name} numberOfLines={1}>
          {conversation.name}
        </Text>
        <Text style={styles.time}>
          {formatRelativeTime(conversation.lastActivity)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  itemSelected: {
    backgroundColor: colors.accentSubtle,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.textTertiary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  checkmark: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  textContainer: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '500',
  },
  time: {
    color: colors.textTertiary,
    fontSize: 12,
    marginTop: 2,
  },
});
