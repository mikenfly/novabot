import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, Pressable, StyleSheet } from 'react-native';
import { useAgentStatusStore, api } from '@nanoclaw/shared';
import { colors, spacing } from '../../theme';

interface TypingIndicatorProps {
  conversationId: string;
}

function AnimatedDot({ delay }: { delay: number }) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 400, delay, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 400, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity, delay]);

  return <Animated.View style={[styles.dot, { opacity }]} />;
}

export function TypingIndicator({ conversationId }: TypingIndicatorProps) {
  const status = useAgentStatusStore((s) => s.status[conversationId]);

  if (!status) return null;

  const handleInterrupt = async () => {
    try {
      await api.post(`/api/conversations/${conversationId}/interrupt`);
    } catch {
      // ignore
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.dots}>
        <AnimatedDot delay={0} />
        <AnimatedDot delay={150} />
        <AnimatedDot delay={300} />
      </View>
      <Text style={styles.status} numberOfLines={1}>
        {status}
      </Text>
      <Pressable onPress={handleInterrupt} hitSlop={8} style={styles.stopButton}>
        <View style={styles.stopIcon} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  dots: {
    flexDirection: 'row',
    gap: 3,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.textSecondary,
  },
  status: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 12,
  },
  stopButton: {
    width: 22,
    height: 22,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stopIcon: {
    width: 8,
    height: 8,
    backgroundColor: colors.error,
    borderRadius: 1,
  },
});
