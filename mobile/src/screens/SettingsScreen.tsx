import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Alert,
} from 'react-native';
import { useAuthStore, api } from '@nanoclaw/shared';
import type { Device } from '@nanoclaw/shared';
import { Spinner } from '../components/common/Spinner';
import { colors, radius, spacing, typography } from '../theme';

export function SettingsScreen() {
  const logout = useAuthStore((s) => s.logout);
  const [devices, setDevices] = useState<Device[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);

  const fetchDevices = useCallback(async () => {
    try {
      const { devices } = await api.get<{ devices: Device[] }>('/api/devices');
      setDevices(devices);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  const handleRevoke = useCallback(
    (token: string, deviceName: string) => {
      Alert.alert(
        'Révoquer',
        `Déconnecter "${deviceName}" ?`,
        [
          { text: 'Annuler', style: 'cancel' },
          {
            text: 'Révoquer',
            style: 'destructive',
            onPress: async () => {
              await api.delete(`/api/devices/${token}`);
              setDevices((prev) => prev.filter((d) => d.token !== token));
            },
          },
        ],
      );
    },
    [],
  );

  const handleGenerateToken = useCallback(async () => {
    const { token } = await api.post<{ token: string; expiresAt: string }>(
      '/api/devices/generate',
    );
    setGeneratedToken(token);
  }, []);

  const handleLogout = useCallback(() => {
    Alert.alert('Déconnexion', 'Voulez-vous vous déconnecter ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Se déconnecter',
        style: 'destructive',
        onPress: () => logout(),
      },
    ]);
  }, [logout]);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Devices section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Appareils</Text>
        {isLoading ? (
          <View style={styles.spinnerRow}>
            <Spinner />
          </View>
        ) : (
          devices.map((device) => (
            <View key={device.token} style={styles.deviceRow}>
              <View style={styles.deviceInfo}>
                <Text style={styles.deviceName} numberOfLines={1}>
                  {device.device_name}
                </Text>
                <Text style={styles.deviceDate}>
                  Dernier accès: {formatDate(device.last_used)}
                </Text>
              </View>
              <Pressable
                style={styles.revokeButton}
                onPress={() => handleRevoke(device.token, device.device_name)}
              >
                <Text style={styles.revokeButtonText}>Révoquer</Text>
              </Pressable>
            </View>
          ))
        )}

        <Pressable style={styles.actionButton} onPress={handleGenerateToken}>
          <Text style={styles.actionButtonText}>Générer un token</Text>
        </Pressable>

        {generatedToken ? (
          <View style={styles.tokenDisplay}>
            <Text style={styles.tokenLabel}>Token temporaire (5 min):</Text>
            <Text style={styles.tokenValue} selectable>
              {generatedToken}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Account section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Compte</Text>
        <Pressable style={styles.dangerButton} onPress={handleLogout}>
          <Text style={styles.dangerButtonText}>Se déconnecter</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  section: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  sectionTitle: {
    ...typography.heading,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  spinnerRow: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  deviceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  deviceInfo: {
    flex: 1,
    marginRight: spacing.md,
  },
  deviceName: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '500',
  },
  deviceDate: {
    color: colors.textTertiary,
    fontSize: 12,
    marginTop: 2,
  },
  revokeButton: {
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  revokeButtonText: {
    color: colors.error,
    fontSize: 13,
    fontWeight: '500',
  },
  actionButton: {
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  actionButtonText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '500',
  },
  tokenDisplay: {
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  tokenLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    marginBottom: spacing.xs,
  },
  tokenValue: {
    fontFamily: 'Menlo',
    fontSize: 11,
    color: colors.accent,
  },
  dangerButton: {
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  dangerButtonText: {
    color: colors.error,
    fontSize: 15,
    fontWeight: '500',
  },
});
