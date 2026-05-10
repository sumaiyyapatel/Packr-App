import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useStore } from '../../src/lib/store';
import { api, WardrobeItem } from '../../src/lib/api';
import {
  categoryForSlot,
  checkConflicts,
  isGridComplete,
} from '../../src/lib/sudoku';

type SlotRect = { x: number; y: number; w: number; h: number };

export default function GridScreen() {
  const { c } = useTheme();
  const router = useRouter();
  const trips = useStore((s) => s.trips);
  const wardrobe = useStore((s) => s.wardrobe);
  const selectedTripId = useStore((s) => s.selectedTripId);
  const upsertTrip = useStore((s) => s.upsertTrip);

  const trip = trips.find((t) => t.id === selectedTripId) || trips[0];
  const [grid, setGrid] = useState<(string | null)[]>(trip?.grid || Array(9).fill(null));
  const [saving, setSaving] = useState(false);

  // Slot rects in absolute screen coordinates (set via onLayout + measure)
  const slotRects = useRef<Record<number, SlotRect>>({});

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

  const onSlotTap = (slot: number) => {
    if (grid[slot]) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      const next = [...grid];
      next[slot] = null;
      setGrid(next);
      saveGrid(next);
    }
  };

  // Drop handler: called from worklet via runOnJS
  const handleDrop = (itemId: string, absX: number, absY: number) => {
    const rects = slotRects.current;
    let target: number | null = null;
    for (let s = 0; s < 9; s++) {
      const r = rects[s];
      if (!r) continue;
      if (absX >= r.x && absX <= r.x + r.w && absY >= r.y && absY <= r.y + r.h) {
        target = s;
        break;
      }
    }
    if (target == null) return;

    const item = itemsById[itemId];
    if (!item) return;
    const expected = categoryForSlot(target);
    if (item.category !== expected) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      Alert.alert(
        'Wrong category',
        `Slot ${target + 1} expects a ${expected}. This item is a ${item.category}.`
      );
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const next = [...grid];
    // remove if already in grid (move semantics)
    const existing = next.indexOf(itemId);
    if (existing >= 0) next[existing] = null;
    next[target] = itemId;
    setGrid(next);
    saveGrid(next);
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
            <Text style={[styles.h1, { color: c.textPrimary }]}>Drag to build</Text>
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
          {[0, 1, 2].map((row) => (
            <View key={row} style={styles.gridRow}>
              {[0, 1, 2].map((col) => {
                const i = row * 3 + col;
                const id = grid[i];
                const item = id ? itemsById[id] : null;
                const conflict = conflicts.slotConflicts[i];
                return (
                  <Pressable
                    testID={`grid-slot-${i}`}
                    key={i}
                    onPress={() => onSlotTap(i)}
                    onLayout={(e) => {
                      const target = e.target as any;
                      if (target?.measure) {
                        target.measure(
                          (_x: number, _y: number, w: number, h: number, px: number, py: number) => {
                            slotRects.current[i] = { x: px, y: py, w, h };
                          }
                        );
                      } else {
                        const { x, y, width, height } = e.nativeEvent.layout;
                        slotRects.current[i] = { x, y, w: width, h: height };
                      }
                    }}
                    style={[
                      styles.slot,
                      {
                        borderColor: conflict
                          ? c.warning
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
                        <Text style={[styles.slotIdx, { color: c.textTertiary }]}>{i + 1}</Text>
                        <Text style={[styles.slotCat, { color: c.textTertiary }]}>
                          {categoryForSlot(i).toUpperCase()}
                        </Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          ))}
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
        <Text style={[styles.section, { color: c.textPrimary }]}>WARDROBE · DRAG TO GRID</Text>
        <Text style={{ color: c.textTertiary, fontSize: 11, marginTop: 4 }}>
          Long-press an item, then drag it onto a matching slot. Tap a filled slot to remove.
        </Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingRight: 24, gap: 10 }}
          style={{ marginHorizontal: -24, paddingHorizontal: 24, marginTop: 12 }}
        >
          {wardrobe.length === 0 && (
            <View style={[styles.itemEmpty, { borderColor: c.borderSubtle }]}>
              <Text style={{ color: c.textTertiary, fontSize: 12, textAlign: 'center' }}>
                Add items in Studio first.
              </Text>
            </View>
          )}
          {wardrobe.map((it) => (
            <DraggableItem
              key={it.id}
              item={it}
              inGrid={grid.includes(it.id)}
              onDrop={(absX, absY) => handleDrop(it.id, absX, absY)}
            />
          ))}
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
      </ScrollView>
    </SafeAreaView>
  );
}

function DraggableItem({
  item,
  inGrid,
  onDrop,
}: {
  item: WardrobeItem;
  inGrid: boolean;
  onDrop: (absX: number, absY: number) => void;
}) {
  const { c } = useTheme();
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const dragging = useSharedValue(0);
  const [isDragging, setIsDragging] = useState(false);

  const triggerHaptic = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

  const pan = Gesture.Pan()
    .activateAfterLongPress(220)
    .onStart(() => {
      dragging.value = 1;
      runOnJS(setIsDragging)(true);
      runOnJS(triggerHaptic)();
    })
    .onUpdate((e) => {
      tx.value = e.translationX;
      ty.value = e.translationY;
    })
    .onEnd((e) => {
      runOnJS(onDrop)(e.absoluteX, e.absoluteY);
      tx.value = withSpring(0);
      ty.value = withSpring(0);
      dragging.value = 0;
      runOnJS(setIsDragging)(false);
    })
    .onFinalize(() => {
      tx.value = withSpring(0);
      ty.value = withSpring(0);
      dragging.value = 0;
      runOnJS(setIsDragging)(false);
    });

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: 1 + dragging.value * 0.1 },
    ],
    zIndex: dragging.value ? 999 : 1,
    elevation: dragging.value ? 12 : 0,
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        testID={`drag-item-${item.id}`}
        style={[
          {
            width: 90,
            height: 110,
            borderWidth: 1,
            borderRadius: 6,
            padding: 8,
            alignItems: 'center',
            justifyContent: 'center',
            borderColor: isDragging ? c.accent : inGrid ? c.borderSubtle : c.borderActive,
            backgroundColor: c.surface,
            opacity: inGrid && !isDragging ? 0.4 : 1,
          },
          animStyle,
        ]}
      >
        {item.image ? (
          <Image source={{ uri: item.image }} style={{ width: 56, height: 56, borderRadius: 4 }} />
        ) : (
          <Ionicons name="shirt-outline" size={24} color={c.textPrimary} />
        )}
        <Text numberOfLines={1} style={{ color: c.textPrimary, fontSize: 11, marginTop: 4 }}>
          {item.name}
        </Text>
        <Text style={{ color: c.textTertiary, fontSize: 9, letterSpacing: 1 }}>
          {item.category.toUpperCase()}
        </Text>
      </Animated.View>
    </GestureDetector>
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
    flexDirection: 'column', gap: 8,
  },
  gridRow: { flex: 1, flexDirection: 'row', gap: 8 },
  slot: {
    flex: 1, borderWidth: 1, borderRadius: 6,
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
  itemEmpty: {
    width: 240, height: 110, borderWidth: 1, borderRadius: 6,
    alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed', padding: 16,
  },
  cta: { paddingVertical: 16, borderWidth: 1, borderRadius: 4, alignItems: 'center' },
  ctaText: { fontSize: 13, letterSpacing: 2, fontWeight: '600' },
});
