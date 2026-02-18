import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radius } from '../../theme';

interface AvatarProps {
  name: string;
  isUser?: boolean;
}

export function Avatar({ name, isUser }: AvatarProps) {
  const initial = (name?.[0] ?? '?').toUpperCase();

  return (
    <View style={[styles.avatar, isUser ? styles.user : styles.assistant]}>
      <Text style={styles.initial}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  user: {
    backgroundColor: colors.accent,
  },
  assistant: {
    backgroundColor: '#34d399',
  },
  initial: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});
