import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  RefreshControl,
  Alert,
  ActionSheetIOS,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useConversationStore } from '@nanoclaw/shared';
import type { Conversation } from '@nanoclaw/shared';
import { useWebSocket } from '../hooks/useWebSocket';
import { ConversationItem } from '../components/sidebar/ConversationItem';
import { ConnectionBanner } from '../components/common/ConnectionBanner';
import { colors, spacing, radius, typography } from '../theme';
import type { AppStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList, 'ConversationList'>;

export function ConversationListScreen() {
  const navigation = useNavigation<Nav>();
  const {
    conversations,
    isLoading,
    selecting,
    selectedIds,
    fetchConversations,
    createConversation,
    deleteConversation,
    renameConversation,
    toggleAutoRename,
    toggleSelecting,
    toggleSelected,
    selectAll,
    deleteSelected,
  } = useConversationStore();

  const [isCreating, setIsCreating] = useState(false);

  // Activate WebSocket connection
  useWebSocket();

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  const handleRefresh = useCallback(() => {
    fetchConversations();
  }, [fetchConversations]);

  const handleCreate = useCallback(async () => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const jid = await createConversation();
      navigation.push('Chat', {
        conversationId: jid,
        conversationName: 'Nouvelle conversation',
      });
    } finally {
      setIsCreating(false);
    }
  }, [createConversation, navigation, isCreating]);

  const handlePress = useCallback(
    (conv: Conversation) => {
      if (selecting) {
        toggleSelected(conv.jid);
      } else {
        navigation.push('Chat', {
          conversationId: conv.jid,
          conversationName: conv.name,
        });
      }
    },
    [selecting, toggleSelected, navigation],
  );

  const handleLongPress = useCallback(
    (conv: Conversation) => {
      if (selecting) return;

      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: [
              'Renommer',
              conv.autoRename ? 'Titrage auto: ON' : 'Titrage auto: OFF',
              'Supprimer',
              'Annuler',
            ],
            destructiveButtonIndex: 2,
            cancelButtonIndex: 3,
          },
          (buttonIndex) => {
            if (buttonIndex === 0) {
              Alert.prompt('Renommer', 'Nouveau nom:', [
                { text: 'Annuler', style: 'cancel' },
                {
                  text: 'OK',
                  onPress: (name) => {
                    if (name?.trim()) renameConversation(conv.jid, name.trim());
                  },
                },
              ], 'plain-text', conv.name);
            } else if (buttonIndex === 1) {
              toggleAutoRename(conv.jid);
            } else if (buttonIndex === 2) {
              Alert.alert('Supprimer', `Supprimer "${conv.name}" ?`, [
                { text: 'Annuler', style: 'cancel' },
                {
                  text: 'Supprimer',
                  style: 'destructive',
                  onPress: () => deleteConversation(conv.jid),
                },
              ]);
            }
          },
        );
      }
    },
    [selecting, renameConversation, toggleAutoRename, deleteConversation],
  );

  const handleDeleteSelected = useCallback(() => {
    const count = selectedIds.size;
    Alert.alert(
      'Supprimer',
      `Supprimer ${count} conversation${count > 1 ? 's' : ''} ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () => deleteSelected(),
        },
      ],
    );
  }, [selectedIds, deleteSelected]);

  const renderItem = useCallback(
    ({ item }: { item: Conversation }) => (
      <ConversationItem
        conversation={item}
        isSelected={selectedIds.has(item.jid)}
        isSelecting={selecting}
        onPress={() => handlePress(item)}
        onLongPress={() => handleLongPress(item)}
      />
    ),
    [selecting, selectedIds, handlePress, handleLongPress],
  );

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerRight}>
          {selecting ? (
            <>
              <Pressable onPress={selectAll} hitSlop={8}>
                <Text style={styles.headerAction}>Tout</Text>
              </Pressable>
              <Pressable onPress={toggleSelecting} hitSlop={8}>
                <Text style={styles.headerAction}>Annuler</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable onPress={toggleSelecting} hitSlop={8}>
                <Text style={styles.headerAction}>Sélectionner</Text>
              </Pressable>
              <Pressable
                onPress={() => navigation.push('Settings')}
                hitSlop={8}
              >
                <Text style={styles.headerAction}>Réglages</Text>
              </Pressable>
            </>
          )}
        </View>
      ),
    });
  }, [navigation, selecting, selectAll, toggleSelecting]);

  return (
    <View style={styles.container}>
      <ConnectionBanner />
      <FlatList
        data={conversations}
        renderItem={renderItem}
        keyExtractor={(item) => item.jid}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={handleRefresh}
            tintColor={colors.accent}
          />
        }
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>Pas encore de conversations</Text>
            </View>
          ) : null
        }
      />

      {selecting && selectedIds.size > 0 ? (
        <Pressable style={styles.deleteBar} onPress={handleDeleteSelected}>
          <Text style={styles.deleteBarText}>
            Supprimer ({selectedIds.size})
          </Text>
        </Pressable>
      ) : !selecting ? (
        <Pressable
          style={[styles.newButton, isCreating && styles.newButtonDisabled]}
          onPress={handleCreate}
          disabled={isCreating}
        >
          <Text style={styles.newButtonText}>
            {isCreating ? 'Création...' : '+ Nouvelle conversation'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  list: {
    paddingVertical: spacing.sm,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
  },
  emptyText: {
    color: colors.textTertiary,
    fontSize: 15,
  },
  headerRight: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  headerAction: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '500',
  },
  newButton: {
    backgroundColor: colors.accent,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  newButtonDisabled: {
    opacity: 0.5,
  },
  newButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  deleteBar: {
    backgroundColor: colors.error,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  deleteBarText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
