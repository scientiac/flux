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

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { theme } = useMaterial3Theme();

  const { NavigationTheme, PaperTheme } = useMemo(() => {
    const isDark = colorScheme === 'dark';

    // Adapt navigation theme to Material 3
    const { LightTheme: NavLightTheme, DarkTheme: NavDarkTheme } = adaptNavigationTheme({
      reactNavigationLight: DefaultTheme,
      reactNavigationDark: DarkTheme,
    });

    const paperTheme = isDark
      ? { ...MD3DarkTheme, colors: theme.dark }
      : { ...MD3LightTheme, colors: theme.light };

    const navTheme = isDark ? NavDarkTheme : NavLightTheme;

    return {
      PaperTheme: paperTheme,
      NavigationTheme: {
        ...navTheme,
        colors: {
          ...navTheme.colors,
          ...paperTheme.colors,
        }
      }
    };
  }, [colorScheme, theme]);

  return (
    <AppProvider>
      <PaperProvider theme={PaperTheme}>
        <ThemeProvider value={PaperTheme.dark ? DarkTheme : DefaultTheme}>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
          </Stack>
          <StatusBar style="auto" />
        </ThemeProvider>
      </PaperProvider>
    </AppProvider>
  );
}
