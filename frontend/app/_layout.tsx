import React, { useEffect } from 'react';
import { Stack, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';
import { useStore } from '../src/lib/store';
import { installMonitoring } from '../src/lib/monitoring';
import { View, ActivityIndicator } from 'react-native';

function RootGate() {
  const { c, mode } = useTheme();
  const router = useRouter();
  const segments = useSegments();
  const rootNavigationState = useRootNavigationState();
  const hydrated = useStore((s) => s.hydrated);
  const user = useStore((s) => s.user);
  const onboarded = useStore((s) => s.onboarded);
  const trips = useStore((s) => s.trips);
  const hydrate = useStore((s) => s.hydrate);
  const [fontsLoaded] = useFonts({ ...Ionicons.font });

  useEffect(() => {
    installMonitoring();
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!rootNavigationState?.key || !hydrated || !fontsLoaded) return;
    const inAuth = segments[0] === '(auth)';
    const inTabs = segments[0] === '(tabs)';
    const inTemplates = segments[0] === 'templates';

    if (!user) {
      if (!inAuth) router.replace('/(auth)/login');
      return;
    }
    // Treat existing trips as having completed onboarding
    const isOnboarded = onboarded || trips.length > 0;
    if (!isOnboarded) {
      if (segments[0] !== 'onboarding') router.replace('/onboarding/explainer');
      return;
    }
    if (isOnboarded && trips.length === 0) {
      if (segments[0] !== 'onboarding') router.replace('/onboarding/trip-create');
      return;
    }
    if (!inTabs && !inTemplates && !['settings', 'outfits'].includes(String(segments[0]))) router.replace('/(tabs)');
  }, [rootNavigationState?.key, hydrated, fontsLoaded, user, onboarded, trips.length, segments, router]);

  return (
    <>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="templates" />
        <Stack.Screen name="outfits" />
        <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
      </Stack>
      {(!hydrated || !fontsLoaded) && (
        <View
          pointerEvents="auto"
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            backgroundColor: c.bg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ActivityIndicator color={c.accent} />
        </View>
      )}
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <RootGate />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
