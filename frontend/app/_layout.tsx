import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';
import { useStore } from '../src/lib/store';
import { View, ActivityIndicator } from 'react-native';

function RootGate() {
  const { c, mode } = useTheme();
  const router = useRouter();
  const segments = useSegments();
  const hydrated = useStore((s) => s.hydrated);
  const user = useStore((s) => s.user);
  const onboarded = useStore((s) => s.onboarded);
  const trips = useStore((s) => s.trips);
  const hydrate = useStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!hydrated) return;
    const inAuth = segments[0] === '(auth)';
    const inOnboarding = segments[0] === 'onboarding';
    const inTabs = segments[0] === '(tabs)';

    if (!user) {
      if (!inAuth) router.replace('/(auth)/login');
      return;
    }
    if (!onboarded) {
      if (segments[0] !== 'onboarding') router.replace('/onboarding/explainer');
      return;
    }
    if (onboarded && trips.length === 0) {
      if (segments[0] !== 'onboarding') router.replace('/onboarding/trip-create');
      return;
    }
    if (!inTabs) router.replace('/(tabs)');
  }, [hydrated, user, onboarded, trips.length, segments, router]);

  if (!hydrated) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="(tabs)" />
      </Stack>
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
