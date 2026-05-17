import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import { Image } from 'expo-image';
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
import { api, getApiErrorMessage, resolveApiAssetUrl, WardrobeItem } from '../../src/lib/api';
import {
  categoryForSlot,
  checkConflicts,
  isGridComplete,
} from '../../src/lib/sudoku';
import { CATEGORY_META } from '../../src/lib/wardrobeMeta';

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
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  const [completeMoment, setCompleteMoment] = useState(false);

  // Slot rects in absolute screen coordinates (set via onLayout + measure)
  const slotRects = useRef<Record<number, SlotRect>>({});
  const wasComplete = useRef(false);

  useEffect(() => {
    if (trip) setGrid(trip.grid);
  }, [trip]);

  const itemsById = useMemo(() => {
    const m: Record<string, WardrobeItem> = {};
    for (const w of wardrobe) m[w.id] = w;
    return m;
  }, [wardrobe]);

  const conflicts = useMemo(() => checkConflicts(grid, itemsById), [grid, itemsById]);

  const filled = grid.filter(Boolean).length;
  const complete = isGridComplete(grid);

  useEffect(() => {
    if (complete && !wasComplete.current) {
      setCompleteMoment(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      const timer = setTimeout(() => setCompleteMoment(false), 2200);
      wasComplete.current = true;
      return () => clearTimeout(timer);
    }
    if (!complete) wasComplete.current = false;
    return undefined;
  }, [complete]);

  const saveGrid = async (g: (string | null)[]) => {
    if (!trip) return;
    setSaving(true);
    try {
      const r = await api.put(`/trips/${trip.id}/grid`, { grid: g });
      upsertTrip(r.data);
    } catch (e: unknown) {
      Alert.alert('Save failed', getApiErrorMessage(e, 'Could not save grid'));
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
      return;
    }
    setPickerSlot(slot);
  };

  const fillSlot = (slot: number, item: WardrobeItem) => {
    const expected = categoryForSlot(slot);
    if (item.category !== expected) return;
    const next = [...grid];
    const existing = next.indexOf(item.id);
    if (existing >= 0) next[existing] = null;
    next[slot] = item.id;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setGrid(next);
    setPickerSlot(null);
    saveGrid(next);
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
    router.push('/outfits');
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
            <Text style={[styles.h1, { color: c.textPrimary }]}>Tap or drag</Text>
          </View>
          {saving && <ActivityIndicator color={c.accent} />}
        </View>
        <Text style={{ color: c.textTertiary, fontSize: 12, marginTop: 4 }}>
          {trip.destination}
        </Text>

        <Text style={[styles.layoutHint, { color: c.textTertiary }]}>
          ROTATING SUDOKU LAYOUT
        </Text>

        {/* 3x3 Grid */}
        <View style={[styles.grid, { borderColor: c.borderSubtle }]}>
          {[0, 1, 2].map((row) => (
            <View key={row} style={styles.gridRow}>
              {[0, 1, 2].map((col) => {
                const i = row * 3 + col;
                const id = grid[i];
                const item = id ? itemsById[id] : null;
                const conflict = conflicts.slotConflicts[i];
                const expected = categoryForSlot(i);
                const slotMeta = CATEGORY_META[item?.category || expected];
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
                          ? slotMeta.color
                          : slotMeta.color + '88',
                        backgroundColor: conflict
                          ? c.warning + '22'
                          : item
                          ? slotMeta.soft
                          : c.surface,
                        borderStyle: item ? 'solid' : 'dashed',
                      },
                    ]}
                  >
                    <View style={[styles.slotAccent, { backgroundColor: slotMeta.color }]} />
                    {item ? (
                      item.image ? (
                        <Image
                          source={{ uri: resolveApiAssetUrl(item.image) }}
                          style={styles.slotImg}
                          contentFit="contain"
                        />
                      ) : (
                        <View style={{ alignItems: 'center', padding: 4 }}>
                          <Ionicons name={slotMeta.icon as keyof typeof Ionicons.glyphMap} size={20} color={slotMeta.color} />
                          <Text numberOfLines={1} style={{ color: c.textPrimary, fontSize: 10, marginTop: 2 }}>
                            {item.name}
                          </Text>
                        </View>
                      )
                    ) : (
                      <View style={{ alignItems: 'center' }}>
                        <Text style={[styles.slotIdx, { color: c.textTertiary }]}>{i + 1}</Text>
                        <Text style={[styles.slotCat, { color: slotMeta.color }]}>{slotMeta.short}</Text>
                      </View>
                    )}
                    <View style={[styles.slotBadge, { backgroundColor: c.bg, borderColor: slotMeta.color }]}>
                      <Text style={[styles.slotBadgeText, { color: slotMeta.color }]}>{slotMeta.short}</Text>
                    </View>
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

        {completeMoment && !conflicts.hasConflicts && (
          <View style={[styles.completeBox, { borderColor: c.accent, backgroundColor: c.accent + '18' }]}>
            <View style={styles.completeDots}>
              {[0, 1, 2, 3, 4].map((dot) => (
                <View key={dot} style={[styles.completeDot, { backgroundColor: c.accent, opacity: 1 - dot * 0.12 }]} />
              ))}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.textPrimary, fontSize: 14, fontWeight: '900' }}>Grid complete</Text>
              <Text style={{ color: c.textSecondary, fontSize: 12, marginTop: 2 }}>
                9 items can now make 27 outfits.
              </Text>
            </View>
          </View>
        )}

        <View style={{ height: 16 }} />
        <Text style={[styles.section, { color: c.textPrimary }]}>WARDROBE - TAP OR DRAG</Text>
        <Text style={{ color: c.textTertiary, fontSize: 11, marginTop: 4 }}>
          Tap an empty slot to pick a matching item. Long-press an item to drag it.
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
      <SlotPickerModal
        visible={pickerSlot != null}
        slot={pickerSlot}
        items={wardrobe}
        inGrid={grid}
        onClose={() => setPickerSlot(null)}
        onPick={(slot, item) => fillSlot(slot, item)}
      />
    </SafeAreaView>
  );
}

function SlotPickerModal({
  visible,
  slot,
  items,
  inGrid,
  onClose,
  onPick,
}: {
  visible: boolean;
  slot: number | null;
  items: WardrobeItem[];
  inGrid: (string | null)[];
  onClose: () => void;
  onPick: (slot: number, item: WardrobeItem) => void;
}) {
  const { c } = useTheme();
  if (slot == null) return null;
  const category = categoryForSlot(slot);
  const choices = items.filter((item) => item.category === category);
  const meta = CATEGORY_META[category];
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={[styles.pickerSheet, { backgroundColor: c.surface, borderColor: c.borderSubtle }]}>
          <View style={styles.pickerHeader}>
            <View>
              <Text style={[styles.kicker, { color: meta.color }]}>SLOT {slot + 1}</Text>
              <Text style={{ color: c.textPrimary, fontSize: 22, fontWeight: '800' }}>Choose {category}</Text>
            </View>
            <Pressable onPress={onClose} style={[styles.closeBtn, { borderColor: c.borderSubtle }]}>
              <Ionicons name="close" size={18} color={c.textPrimary} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ gap: 10, paddingTop: 16 }}>
            {choices.length === 0 ? (
              <Text style={{ color: c.textSecondary }}>Add a {category} in Studio first.</Text>
            ) : (
              choices.map((item) => {
                const used = inGrid.includes(item.id);
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => onPick(slot, item)}
                    style={[styles.pickRow, { borderColor: used ? c.borderSubtle : meta.color, backgroundColor: c.elevated }]}
                  >
                    {item.image ? (
                      <Image source={{ uri: resolveApiAssetUrl(item.image) }} style={styles.pickImage} contentFit="contain" />
                    ) : (
                      <Ionicons name={meta.icon as keyof typeof Ionicons.glyphMap} size={24} color={meta.color} />
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: c.textPrimary, fontSize: 15, fontWeight: '800' }}>{item.name}</Text>
                      <Text style={{ color: c.textTertiary, fontSize: 11, marginTop: 2 }}>
                        {used ? 'Currently in grid - will move here' : `${Number(item.weight_kg || 0).toFixed(1)}kg`}
                      </Text>
                    </View>
                    <Ionicons name="add-circle-outline" size={20} color={meta.color} />
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
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
  const meta = CATEGORY_META[item.category];

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
            borderColor: isDragging ? meta.color : inGrid ? c.borderSubtle : meta.color,
            backgroundColor: inGrid && !isDragging ? c.surface : meta.soft,
            opacity: inGrid && !isDragging ? 0.4 : 1,
          },
          animStyle,
        ]}
      >
        {item.image ? (
          <Image
            source={{ uri: resolveApiAssetUrl(item.image) }}
            style={styles.dragImage}
            contentFit="contain"
          />
        ) : (
          <Ionicons name={meta.icon as keyof typeof Ionicons.glyphMap} size={24} color={meta.color} />
        )}
        <Text numberOfLines={1} style={{ color: c.textPrimary, fontSize: 11, marginTop: 4 }}>
          {item.name}
        </Text>
        <Text style={{ color: meta.color, fontSize: 9, letterSpacing: 1, fontWeight: '800' }}>
          {meta.short}
        </Text>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kicker: { fontSize: 11, letterSpacing: 2, fontWeight: '600' },
  h1: { fontSize: 32, fontWeight: '700', letterSpacing: -1, marginTop: 4 },
  layoutHint: { fontSize: 10, letterSpacing: 2, fontWeight: '600', marginTop: 24, marginBottom: 8 },
  grid: {
    aspectRatio: 1, borderWidth: 1, borderRadius: 8, padding: 8,
    flexDirection: 'column', gap: 8,
  },
  gridRow: { flex: 1, flexDirection: 'row', gap: 8 },
  slot: {
    flex: 1, borderWidth: 1, borderRadius: 6,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative',
  },
  slotAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, zIndex: 3 },
  slotImg: { width: '100%', height: '100%' },
  slotIdx: { fontSize: 18, fontWeight: '700' },
  slotCat: { fontSize: 9, letterSpacing: 1, marginTop: 2, fontWeight: '800' },
  slotBadge: {
    position: 'absolute', right: 4, bottom: 4, borderWidth: 1,
    borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2,
  },
  slotBadgeText: { fontSize: 7, letterSpacing: 0.8, fontWeight: '900' },
  conflictBox: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 6,
    padding: 10, marginTop: 12,
  },
  completeBox: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderRadius: 8, padding: 12, marginTop: 12,
  },
  completeDots: { flexDirection: 'row', gap: 4 },
  completeDot: { width: 7, height: 7, borderRadius: 4 },
  section: { fontSize: 11, letterSpacing: 2, fontWeight: '600', marginTop: 16 },
  itemEmpty: {
    width: 240, height: 110, borderWidth: 1, borderRadius: 6,
    alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed', padding: 16,
  },
  dragImage: { width: 58, height: 58, borderRadius: 4 },
  cta: { paddingVertical: 16, borderWidth: 1, borderRadius: 4, alignItems: 'center' },
  ctaText: { fontSize: 13, letterSpacing: 2, fontWeight: '600' },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.62)' },
  pickerSheet: {
    maxHeight: '78%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    borderBottomWidth: 0,
    padding: 20,
    paddingBottom: 34,
  },
  pickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  closeBtn: { width: 38, height: 38, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 8, padding: 10 },
  pickImage: { width: 54, height: 54, borderRadius: 6 },
});
