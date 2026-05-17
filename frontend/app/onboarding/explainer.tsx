import React from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useStore } from '../../src/lib/store';
import { trackEvent } from '../../src/lib/analytics';

function MiniGrid({ accent, border }: { accent: string; border: string }) {
  const cells = Array.from({ length: 9 }, (_, i) => i);
  return (
    <View style={[styles.gridWrap, { borderColor: border }]}>
      {cells.map((i) => {
        const col = i % 3;
        return (
          <View
            key={i}
            style={[
              styles.gridCell,
              { borderColor: border },
              col === 0 && { backgroundColor: accent + '22' },
              col === 1 && { backgroundColor: accent + '15' },
              col === 2 && { backgroundColor: accent + '08' },
            ]}
          >
            <Text style={[styles.gridLabel, { color: accent }]}>
              {col === 0 ? 'T' : col === 1 ? 'B' : 'L'}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export default function Explainer() {
  const { c } = useTheme();
  const router = useRouter();
  const finishOnboarding = useStore((s) => s.finishOnboarding);
  const { height } = useWindowDimensions();

  const handleNext = async () => {
    await finishOnboarding();
    trackEvent('onboarding_completed');
    router.replace('/onboarding/trip-create');
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={[styles.container, { minHeight: height }]}>
      <Text style={[styles.kicker, { color: c.accent }]}>THE METHOD</Text>
      <Text style={[styles.h1, { color: c.textPrimary }]}>9 items.</Text>
      <Text style={[styles.h1, { color: c.textPrimary }]}>27 outfits.</Text>

      <View style={{ height: 32 }} />
      <MiniGrid accent={c.accent} border={c.borderSubtle} />

      <View style={{ height: 32 }} />
      <Text style={[styles.body, { color: c.textSecondary }]}>
        Pick 3 tops, 3 bottoms, and 3 layers. The Sudoku rule lets every column combine with every other,
        producing 3 x 3 x 3 = 27 unique outfits.
      </Text>

      <View style={{ height: 24 }} />
      <View style={[styles.statRow, { borderColor: c.borderSubtle }]}>
        <View style={styles.stat}>
          <Text style={[styles.statNum, { color: c.textPrimary }]}>9</Text>
          <Text style={[styles.statLabel, { color: c.textTertiary }]}>ITEMS</Text>
        </View>
        <View style={[styles.divider, { backgroundColor: c.borderSubtle }]} />
        <View style={styles.stat}>
          <Text style={[styles.statNum, { color: c.textPrimary }]}>27</Text>
          <Text style={[styles.statLabel, { color: c.textTertiary }]}>OUTFITS</Text>
        </View>
        <View style={[styles.divider, { backgroundColor: c.borderSubtle }]} />
        <View style={styles.stat}>
          <Text style={[styles.statNum, { color: c.textPrimary }]}>3.0</Text>
          <Text style={[styles.statLabel, { color: c.textTertiary }]}>EFFICIENCY</Text>
        </View>
      </View>

      <View style={{ flex: 1 }} />
      <View style={{ height: 32 }} />

      <Pressable
        testID="onboarding-start-button"
        onPress={handleNext}
        style={({ pressed }) => [
          styles.btn,
          { backgroundColor: c.accent, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <Text style={[styles.btnText, { color: c.bg }]}>Get Started</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 80, paddingBottom: 48 },
  kicker: { fontSize: 11, letterSpacing: 2, marginBottom: 16, fontWeight: '600' },
  h1: { fontSize: 44, fontWeight: '700', letterSpacing: -2, lineHeight: 48 },
  body: { fontSize: 15, lineHeight: 22 },
  gridWrap: {
    aspectRatio: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderWidth: 1,
    borderRadius: 8,
    padding: 4,
    gap: 4,
  },
  gridCell: {
    width: '32.5%',
    aspectRatio: 1,
    borderWidth: 1,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridLabel: { fontSize: 18, fontWeight: '600' },
  statRow: { flexDirection: 'row', borderWidth: 1, borderRadius: 8, padding: 16, alignItems: 'center' },
  stat: { flex: 1, alignItems: 'center' },
  divider: { width: 1, height: 32 },
  statNum: { fontSize: 22, fontWeight: '700' },
  statLabel: { fontSize: 10, letterSpacing: 1, marginTop: 4 },
  btn: { paddingVertical: 16, borderRadius: 4, alignItems: 'center' },
  btnText: { fontSize: 16, fontWeight: '600', letterSpacing: 0.5 },
});
