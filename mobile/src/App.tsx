import React from 'react';
import { StatusBar } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { configureAuth, configureApi } from '@nanoclaw/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RootNavigator } from './navigation/RootNavigator';
import { colors } from './theme';

// Configure shared services for React Native platform
configureAuth({
  async getToken() {
    return AsyncStorage.getItem('@nanoclaw/token');
  },
  async setToken(token: string) {
    await AsyncStorage.setItem('@nanoclaw/token', token);
  },
  async clearToken() {
    await AsyncStorage.removeItem('@nanoclaw/token');
  },
});

// TODO: Load server URL from AsyncStorage on startup
// For now, configure via LoginScreen
const navigationTheme = {
  dark: true,
  colors: {
    primary: colors.accent,
    background: colors.bgPrimary,
    card: colors.bgSecondary,
    text: colors.textPrimary,
    border: colors.border,
    notification: colors.accent,
  },
  fonts: {
    regular: { fontFamily: 'System', fontWeight: '400' as const },
    medium: { fontFamily: 'System', fontWeight: '500' as const },
    bold: { fontFamily: 'System', fontWeight: '700' as const },
    heavy: { fontFamily: 'System', fontWeight: '900' as const },
  },
};

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={colors.bgPrimary} />
      <NavigationContainer theme={navigationTheme}>
        <RootNavigator />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
