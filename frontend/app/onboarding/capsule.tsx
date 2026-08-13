import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/theme/ThemeProvider';
import { type as t, space, radius } from '../../src/theme/tokens';
import { Kicker, ActionBar } from '../../src/components/ui';
import { useStore } from '../../src/lib/store';
import { listTemplates } from '../../src/lib/firestoreRepo';
import { Template } from '../../src/lib/api';
import { getApiErrorMessage } from '../../src/lib/api';
import { trackEvent } from '../../src/lib/analytics';

// "03 · First run" in Figma — offer a ready-made 9-piece capsule so a brand
// new trip doesn't start from an empty studio. Applies straight to the
// wardrobe + this trip's grid (repo.applyTemplate handles both).
export default function CapsuleFirstRun() {
  const { c } = useTheme();
  const router = useRouter();
  const trips = useStore((s) => s.trips);
  const selectedTripId = useStore((s) => s.selectedTripId);
  const dismissCapsuleOffer = useStore((s) => s.dismissCapsuleOffer);
  const applyTemplateToTrip = useStore((s) => s.applyTemplateToTrip);

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const officials = await listTemplates({ source: 'official' });
        setTemplates(officials.slice(0, 3));
      } catch {
        setTemplates([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const trip = trips.find((x) => x.id === selectedTripId) || trips[0];
  const selected = templates.find((x) => x.id === selectedId) || null;

  const useCapsule = async () => {
    if (!selected || !trip) return;
    setApplying(true);
    try {
      await applyTemplateToTrip(trip.id, selected.items);
      await dismissCapsuleOffer();
      trackEvent('capsule_first_run_applied', { template_id: selected.id });
      router.replace('/(tabs)/grid');
    } catch (e: unknown) {
      Alert.alert('Could not apply capsule', getApiErrorMessage(e, 'Try again in a moment.'));
    } finally {
      setApplying(false);
    }
  };

  const buildFromScratch = async () => {
    await dismissCapsuleOffer();
    trackEvent('capsule_first_run_skipped', {});
    router.replace('/(tabs)/studio');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <View style={styles.container}>
        <Kicker>STEP 1 OF 2</Kicker>
        <Text style={[t.h1, { color: c.textPrimary, marginTop: space.xs }]}>Start with a capsule</Text>
        <Text style={[t.body, { color: c.textSecondary, marginTop: space.sm }]}>
          Borrow a ready-made 9-piece grid, or build yours from scratch.
        </Text>

        <View style={{ height: space.xl }} />

        {loading ? (
          <ActivityIndicator color={c.accent} style={{ marginTop: space.xxl }} />
        ) : templates.length === 0 ? (
          <Text style={[t.bodySm, { color: c.textTertiary, marginTop: space.md }]}>
            No ready-made capsules are available right now — no problem, build your own below.
          </Text>
        ) : (
          <View style={{ gap: space.sm }}>
            {templates.map((tpl) => {
              const active = tpl.id === selectedId;
              return (
                <Pressable
                  key={tpl.id}
                  testID={`capsule-option-${tpl.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={tpl.title}
                  accessibilityState={{ selected: active }}
                  onPress={() => setSelectedId(tpl.id)}
                  style={[
                    styles.row,
                    {
                      backgroundColor: c.elevated,
                      borderColor: active ? c.accent : c.borderSubtle,
                      borderWidth: active ? 2 : 1,
                    },
                  ]}
                >
                  <View style={styles.swatches}>
                    {tpl.items.slice(0, 3).map((item, i) => (
                      <View key={i} style={[styles.swatch, { backgroundColor: item.colors?.[0] || c.plate }]} />
                    ))}
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[t.label, { color: c.textPrimary }]} numberOfLines={1}>
                      {tpl.title}
                    </Text>
                    <Text style={[t.micro, { color: c.textTertiary }]} numberOfLines={1}>
                      {tpl.days} days · {tpl.climate} · {tpl.description}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}

        <View style={{ flex: 1 }} />

        <ActionBar
          testID="capsule-use-button"
          title={applying ? 'Applying…' : 'Use this capsule'}
          onPress={useCapsule}
          disabled={!selected || applying}
          loading={applying}
        />
        <Pressable
          testID="capsule-skip-button"
          onPress={buildFromScratch}
          disabled={applying}
          style={{ paddingVertical: space.md, alignItems: 'center' }}
        >
          <Text style={[t.label, { color: c.textTertiary }]}>Build from scratch instead</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: space.xl, paddingBottom: space.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.sharp,
  },
  swatches: { flexDirection: 'row', gap: 2 },
  swatch: { width: 40, height: 40, borderRadius: radius.sharp },
});
