import React from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { MessageList } from '../components/chat/MessageList';
import { TypingIndicator } from '../components/chat/TypingIndicator';
import { MessageInput } from '../components/chat/MessageInput';
import { ConnectionBanner } from '../components/common/ConnectionBanner';
import { colors } from '../theme';
import type { AppStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AppStackParamList, 'Chat'>;

export function ChatScreen({ route }: Props) {
  const { conversationId } = route.params;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <ConnectionBanner />
      <MessageList conversationId={conversationId} />
      <TypingIndicator conversationId={conversationId} />
      <MessageInput conversationId={conversationId} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
});
