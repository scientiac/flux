import { useColorScheme } from '@/hooks/use-color-scheme';
import { useMaterial3Theme } from '@pchmn/expo-material3-theme';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { MD3DarkTheme, MD3LightTheme, PaperProvider, adaptNavigationTheme } from 'react-native-paper';
import 'react-native-reanimated';
import { AppProvider } from '../context/AppContext';

export const unstable_settings = {
  anchor: 'index',
};

import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { theme } = useMaterial3Theme();

  const { NavigationTheme, PaperTheme } = useMemo(() => {
    const isDark = colorScheme === 'dark';
    const paperTheme = isDark ? { ...MD3DarkTheme, colors: theme.dark } : { ...MD3LightTheme, colors: theme.light };
    const { LightTheme, DarkTheme: NavDarkTheme } = adaptNavigationTheme({
      reactNavigationLight: DefaultTheme,
      reactNavigationDark: DarkTheme,
      materialLight: MD3LightTheme,
      materialDark: MD3DarkTheme,
    });

    const combinedTheme = isDark ? NavDarkTheme : LightTheme;

    return {
      PaperTheme: paperTheme,
      NavigationTheme: {
        ...combinedTheme,
        colors: {
          ...combinedTheme.colors,
          ...paperTheme.colors,
          background: paperTheme.colors.background,
        }
      }
    };
  }, [colorScheme, theme]);

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(NavigationTheme.colors.background);
  }, [NavigationTheme.colors.background]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppProvider>
        <PaperProvider theme={PaperTheme}>
          <ThemeProvider value={NavigationTheme}>
            <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
              <Stack.Screen name="index" />
            </Stack>
            <StatusBar style="auto" />
          </ThemeProvider>
        </PaperProvider>
      </AppProvider>
    </GestureHandlerRootView>
  );
}
