import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../src/theme/ThemeProvider';

export default function ProScreen() {
  const { c } = useTheme();
  const router = useRouter();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: c.borderSubtle }]}>
        <Pressable
          testID="pro-back"
          onPress={() => router.back()}
          style={[styles.iconBtn, { borderColor: c.borderSubtle }]}
        >
          <Ionicons name="chevron-back" size={20} color={c.textPrimary} />
        </Pressable>
      </View>

      <View style={styles.body}>
        <Text style={[styles.kicker, { color: c.accent }]}>SUBSCRIPTIONS</Text>
        <Text style={[styles.h1, { color: c.textPrimary }]}>Not available in this release</Text>
        <Text style={[styles.copy, { color: c.textSecondary }]}>
          Packr public launch does not include paid plans. All core trip, wardrobe, grid, packing,
          template, and community features are available without a subscription.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1 },
  iconBtn: { width: 36, height: 36, borderWidth: 1, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, padding: 24, justifyContent: 'center' },
  kicker: { fontSize: 11, letterSpacing: 2, fontWeight: '600' },
  h1: { fontSize: 32, fontWeight: '700', marginTop: 8 },
  copy: { fontSize: 15, lineHeight: 23, marginTop: 12 },
});
