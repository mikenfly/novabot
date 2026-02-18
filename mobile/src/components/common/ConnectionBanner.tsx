import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useUIStore } from '@nanoclaw/shared';
import { colors, spacing } from '../../theme';

export function ConnectionBanner() {
  const status = useUIStore((s) => s.connectionStatus);

  if (status === 'connected') return null;

  const isReconnecting = status === 'reconnecting';

  return (
    <View style={[styles.banner, isReconnecting ? styles.warning : styles.error]}>
      <Text style={styles.text}>
        {isReconnecting ? 'Reconnexion...' : 'Déconnecté'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    paddingVertical: spacing.xs,
    alignItems: 'center',
  },
  warning: {
    backgroundColor: 'rgba(251, 191, 36, 0.15)',
  },
  error: {
    backgroundColor: 'rgba(255, 85, 85, 0.15)',
  },
  text: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },
});
