import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useStore } from '../../src/lib/store';
import { api, WardrobeItem } from '../../src/lib/api';
import {
  categoryForSlot,
  checkConflicts,
  isGridComplete,
} from '../../src/lib/sudoku';

export default function GridScreen() {
  const { c } = useTheme();
  const router = useRouter();
  const trips = useStore((s) => s.trips);
  const wardrobe = useStore((s) => s.wardrobe);
  const selectedTripId = useStore((s) => s.selectedTripId);
  const upsertTrip = useStore((s) => s.upsertTrip);

  const trip = trips.find((t) => t.id === selectedTripId) || trips[0];
  const [grid, setGrid] = useState<(string | null)[]>(trip?.grid || Array(9).fill(null));
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (trip) setGrid(trip.grid);
  }, [trip?.id]);

  const itemsById = useMemo(() => {
    const m: Record<string, WardrobeItem> = {};
    for (const w of wardrobe) m[w.id] = w;
    return m;
  }, [wardrobe]);

  const conflicts = useMemo(() => checkConflicts(grid, itemsById), [grid, itemsById]);

  const filled = grid.filter(Boolean).length;
  const complete = isGridComplete(grid);

  const onSlotPress = async (slot: number) => {
    if (grid[slot]) {
      // unassign
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      const next = [...grid];
      next[slot] = null;
      setGrid(next);
      saveGrid(next);
      return;
    }
    setActiveSlot(slot);
    Haptics.selectionAsync().catch(() => {});
  };

  const onItemPress = (item: WardrobeItem) => {
    if (activeSlot == null) {
      Alert.alert('Pick a slot', 'Tap an empty slot first, then choose an item.');
      return;
    }
    const expected = categoryForSlot(activeSlot);
    if (item.category !== expected) {
      Alert.alert(
        'Wrong category',
        `Slot ${activeSlot + 1} expects a ${expected}. This item is a ${item.category}.`
      );
      return;
    }
    // Avoid duplicates
    if (grid.includes(item.id)) {
      Alert.alert('Already placed', 'This item is already in the grid.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const next = [...grid];
    next[activeSlot] = item.id;
    setGrid(next);
    setActiveSlot(null);
    saveGrid(next);
  };

  const saveGrid = async (g: (string | null)[]) => {
    if (!trip) return;
    setSaving(true);
    try {
      const r = await api.put(`/trips/${trip.id}/grid`, { grid: g });
      upsertTrip(r.data);
    } catch (e: any) {
      Alert.alert('Save failed', e?.response?.data?.detail || 'Could not save grid');
    } finally {
      setSaving(false);
    }
  };

  const onGenerate = () => {
    if (!complete) {
      Alert.alert('Grid not complete', `Fill all 9 slots first (${filled}/9 done).`);
      return;
    }
    if (conflicts.hasConflicts) {
      Alert.alert('Conflicts detected', 'Resolve highlighted conflicts before generating.');
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    router.push('/(tabs)/lookbook');
  };

  // Items available for active slot
  const availableForSlot = useMemo(() => {
    if (activeSlot == null) return wardrobe;
    const expected = categoryForSlot(activeSlot);
    return wardrobe.filter((w) => w.category === expected && !grid.includes(w.id));
  }, [wardrobe, grid, activeSlot]);

  if (!trip) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Text style={{ color: c.textSecondary, textAlign: 'center' }}>
            Create a trip first to start building a grid.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 48 }}>
        <View style={styles.headerRow}>
          <View>
            <Text style={[styles.kicker, { color: c.accent }]}>THE GRID</Text>
            <Text style={[styles.h1, { color: c.textPrimary }]}>Build your 3×3</Text>
          </View>
          {saving && <ActivityIndicator color={c.accent} />}
        </View>
        <Text style={{ color: c.textTertiary, fontSize: 12, marginTop: 4 }}>
          {trip.destination}
        </Text>

        {/* Column headers */}
        <View style={styles.colHeader}>
          {(['TOP', 'BOTTOM', 'LAYER'] as const).map((label) => (
            <Text key={label} style={[styles.colLabel, { color: c.textTertiary }]}>
              {label}
            </Text>
          ))}
        </View>

        {/* 3x3 Grid */}
        <View style={[styles.grid, { borderColor: c.borderSubtle }]}>
          {Array.from({ length: 9 }, (_, i) => i).map((i) => {
            const id = grid[i];
            const item = id ? itemsById[id] : null;
            const isActive = activeSlot === i;
            const conflict = conflicts.slotConflicts[i];
            return (
              <Pressable
                testID={`grid-slot-${i}`}
                key={i}
                onPress={() => onSlotPress(i)}
                style={[
                  styles.slot,
                  {
                    borderColor: conflict
                      ? c.warning
                      : isActive
                      ? c.accent
                      : item
                      ? c.accent
                      : c.borderSubtle,
                    backgroundColor: conflict
                      ? c.warning + '22'
                      : item
                      ? c.elevated
                      : c.surface,
                    borderStyle: item ? 'solid' : 'dashed',
                  },
                ]}
              >
                {item ? (
                  item.image ? (
                    <Image source={{ uri: item.image }} style={styles.slotImg} />
                  ) : (
                    <View style={{ alignItems: 'center', padding: 4 }}>
                      <Ionicons name="shirt-outline" size={20} color={c.textPrimary} />
                      <Text numberOfLines={1} style={{ color: c.textPrimary, fontSize: 10, marginTop: 2 }}>
                        {item.name}
                      </Text>
                    </View>
                  )
                ) : (
                  <View style={{ alignItems: 'center' }}>
                    <Text style={[styles.slotIdx, { color: isActive ? c.accent : c.textTertiary }]}>
                      {i + 1}
                    </Text>
                    <Text style={[styles.slotCat, { color: c.textTertiary }]}>
                      {categoryForSlot(i).toUpperCase()}
                    </Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>

        {conflicts.hasConflicts && (
          <View style={[styles.conflictBox, { borderColor: c.warning, backgroundColor: c.warning + '15' }]}>
            <Ionicons name="warning-outline" size={16} color={c.warning} />
            <Text style={{ color: c.warning, marginLeft: 6, flex: 1, fontSize: 12 }}>
              {Object.values(conflicts.slotConflicts)[0]}
            </Text>
          </View>
        )}

        <View style={{ height: 16 }} />
        <Text style={[styles.section, { color: c.textPrimary }]}>
          {activeSlot != null
            ? `PICK A ${categoryForSlot(activeSlot).toUpperCase()} FOR SLOT ${activeSlot + 1}`
            : 'WARDROBE'}
        </Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingRight: 24, gap: 10 }}
          style={{ marginHorizontal: -24, paddingHorizontal: 24, marginTop: 12 }}
        >
          {availableForSlot.length === 0 && (
            <View style={[styles.itemEmpty, { borderColor: c.borderSubtle }]}>
              <Text style={{ color: c.textTertiary, fontSize: 12, textAlign: 'center' }}>
                {activeSlot != null
                  ? `No more ${categoryForSlot(activeSlot)}s. Add some in Studio.`
                  : 'Add items in Studio.'}
              </Text>
            </View>
          )}
          {availableForSlot.map((it) => {
            const inGrid = grid.includes(it.id);
            return (
              <Pressable
                testID={`drawer-item-${it.id}`}
                key={it.id}
                onPress={() => onItemPress(it)}
                style={[
                  styles.drawerItem,
                  {
                    borderColor: inGrid ? c.borderSubtle : c.borderActive,
                    opacity: inGrid ? 0.4 : 1,
                    backgroundColor: c.surface,
                  },
                ]}
              >
                {it.image ? (
                  <Image source={{ uri: it.image }} style={styles.drawerImg} />
                ) : (
                  <Ionicons name="shirt-outline" size={24} color={c.textPrimary} />
                )}
                <Text numberOfLines={1} style={{ color: c.textPrimary, fontSize: 11, marginTop: 4 }}>
                  {it.name}
                </Text>
                <Text style={{ color: c.textTertiary, fontSize: 9, letterSpacing: 1 }}>
                  {it.category.toUpperCase()}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={{ height: 24 }} />
        <Pressable
          testID="generate-lookbook-button"
          onPress={onGenerate}
          disabled={!complete || conflicts.hasConflicts}
          style={({ pressed }) => [
            styles.cta,
            {
              backgroundColor: complete && !conflicts.hasConflicts ? c.accent : 'transparent',
              borderColor: complete && !conflicts.hasConflicts ? c.accent : c.borderSubtle,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Text
            style={[
              styles.ctaText,
              { color: complete && !conflicts.hasConflicts ? c.bg : c.textTertiary },
            ]}
          >
            {complete ? 'GENERATE 27 OUTFITS' : `GRID ${filled}/9`}
          </Text>
        </Pressable>

        <Text style={{ color: c.textTertiary, fontSize: 11, marginTop: 16, textAlign: 'center' }}>
          Tap a slot, then tap a wardrobe item. Tap a filled slot to remove.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kicker: { fontSize: 11, letterSpacing: 2, fontWeight: '600' },
  h1: { fontSize: 32, fontWeight: '700', letterSpacing: -1, marginTop: 4 },
  colHeader: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 24, marginBottom: 8 },
  colLabel: { fontSize: 10, letterSpacing: 2, fontWeight: '600', flex: 1, textAlign: 'center' },
  grid: {
    aspectRatio: 1, borderWidth: 1, borderRadius: 8, padding: 8,
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
  },
  slot: {
    width: '32%', aspectRatio: 1, borderWidth: 1, borderRadius: 6,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  slotImg: { width: '100%', height: '100%' },
  slotIdx: { fontSize: 18, fontWeight: '700' },
  slotCat: { fontSize: 9, letterSpacing: 1, marginTop: 2 },
  conflictBox: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 6,
    padding: 10, marginTop: 12,
  },
  section: { fontSize: 11, letterSpacing: 2, fontWeight: '600', marginTop: 16 },
  drawerItem: {
    width: 90, height: 110, borderWidth: 1, borderRadius: 6,
    padding: 8, alignItems: 'center', justifyContent: 'center',
  },
  drawerImg: { width: 56, height: 56, borderRadius: 4 },
  itemEmpty: {
    width: 240, height: 110, borderWidth: 1, borderRadius: 6,
    alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed', padding: 16,
  },
  cta: { paddingVertical: 16, borderWidth: 1, borderRadius: 4, alignItems: 'center' },
  ctaText: { fontSize: 13, letterSpacing: 2, fontWeight: '600' },
});
