import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useStore } from '../../src/lib/store';
import { trackEvent } from '../../src/lib/analytics';

const SLOT_CATEGORIES = ['top', 'bottom', 'layer', 'bottom', 'layer', 'top', 'layer', 'top', 'bottom'] as const;
const CATEGORY_LABELS = {
  top: 'T',
  bottom: 'B',
  layer: 'L',
};

export default function Explainer() {
  const { c } = useTheme();
  const router = useRouter();
  const finishOnboarding = useStore((s) => s.finishOnboarding);
  const { height } = useWindowDimensions();
  const [filled, setFilled] = useState<boolean[]>(Array(9).fill(false));

  const counts = useMemo(() => {
    return SLOT_CATEGORIES.reduce(
      (acc, category, index) => {
        if (filled[index]) acc[category] += 1;
        return acc;
      },
      { top: 0, bottom: 0, layer: 0 }
    );
  }, [filled]);

  const complete = filled.every(Boolean);

  const fillSlot = (index: number) => {
    if (filled[index]) return;
    Haptics.selectionAsync().catch(() => {});
    setFilled((current) => current.map((value, i) => (i === index ? true : value)));
  };

  const reset = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setFilled(Array(9).fill(false));
  };

  const handleNext = async () => {
    await finishOnboarding();
    trackEvent('onboarding_completed', { mode: 'interactive_grid' });
    router.replace('/onboarding/trip-create');
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={[styles.container, { minHeight: height }]}>
      <Text style={[styles.kicker, { color: c.accentText }]}>PACKR METHOD</Text>
      <Text style={[styles.h1, { color: c.textPrimary }]}>Fill the grid.</Text>
      <Text style={[styles.body, { color: c.textSecondary }]}>
        Tap each slot once. Three tops, three bottoms, and three layers unlock 27 outfit combinations.
      </Text>

      <View style={[styles.gridWrap, { borderColor: c.borderSubtle }]}>
        {SLOT_CATEGORIES.map((category, index) => {
          const active = filled[index];
          return (
            <Pressable
              testID={`onboarding-slot-${index}`}
              key={`${category}-${index}`}
              onPress={() => fillSlot(index)}
              style={[
                styles.gridCell,
                {
                  borderColor: active ? c.accent : c.borderSubtle,
                  backgroundColor: active ? c.accent + '22' : c.surface,
                },
              ]}
            >
              <Text style={{ color: active ? c.accentText : c.textTertiary, fontSize: 26, fontWeight: '900' }}>
                {CATEGORY_LABELS[category]}
              </Text>
              <Text style={{ color: c.textTertiary, fontSize: 10, marginTop: 4 }}>{index + 1}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={[styles.statRow, { borderColor: c.borderSubtle }]}>
        <ProgressStat label="Tops" value={counts.top} done={counts.top === 3} />
        <ProgressStat label="Bottoms" value={counts.bottom} done={counts.bottom === 3} />
        <ProgressStat label="Layers" value={counts.layer} done={counts.layer === 3} />
      </View>

      {complete ? (
        <View style={[styles.completeBox, { borderColor: c.accent, backgroundColor: c.accent + '16' }]}>
          <Ionicons name="sparkles-outline" size={18} color={c.accent} />
          <Text style={{ color: c.textPrimary, fontSize: 14, fontWeight: '900', flex: 1 }}>
            9 items can become 27 outfits.
          </Text>
        </View>
      ) : (
        <Pressable onPress={reset} style={[styles.resetBtn, { borderColor: c.borderSubtle }]}>
          <Ionicons name="refresh-outline" size={15} color={c.textSecondary} />
          <Text style={{ color: c.textSecondary, fontSize: 12, fontWeight: '800' }}>RESET</Text>
        </Pressable>
      )}

      <View style={{ flex: 1 }} />
      <Pressable
        testID="onboarding-start-button"
        onPress={handleNext}
        disabled={!complete}
        style={({ pressed }) => [
          styles.btn,
          { backgroundColor: complete ? c.accent : c.borderActive, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <Text style={[styles.btnText, { color: complete ? c.accentInk : c.textPrimary }]}>{complete ? 'Create trip' : 'Fill all slots'}</Text>
      </Pressable>
    </ScrollView>
  );
}

function ProgressStat({ label, value, done }: { label: string; value: number; done: boolean }) {
  const { c } = useTheme();
  return (
    <View style={styles.stat}>
      <Ionicons name={done ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={done ? c.accent : c.textTertiary} />
      <Text style={[styles.statNum, { color: c.textPrimary }]}>{value}/3</Text>
      <Text style={[styles.statLabel, { color: c.textTertiary }]}>{label.toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 72, paddingBottom: 48 },
  kicker: { fontSize: 11, letterSpacing: 2, marginBottom: 14, fontWeight: '800' },
  h1: { fontSize: 42, fontWeight: '900', lineHeight: 46 },
  body: { fontSize: 15, lineHeight: 22, marginTop: 12 },
  gridWrap: {
    aspectRatio: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderWidth: 1,
    borderRadius: 8,
    padding: 6,
    gap: 6,
    marginTop: 28,
  },
  gridCell: {
    width: '31.9%',
    aspectRatio: 1,
    borderWidth: 1,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statRow: { flexDirection: 'row', borderWidth: 1, borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 18 },
  stat: { flex: 1, alignItems: 'center', gap: 4 },
  statNum: { fontSize: 20, fontWeight: '900' },
  statLabel: { fontSize: 10, letterSpacing: 1 },
  completeBox: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 8, padding: 12, marginTop: 14 },
  resetBtn: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, marginTop: 14 },
  btn: { paddingVertical: 16, borderRadius: 8, alignItems: 'center' },
  btnText: { fontSize: 16, fontWeight: '900', letterSpacing: 0.5 },
});
