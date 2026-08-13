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
import { type as t, space, radius } from '../../src/theme/tokens';
import { ScreenHeader, IconButton } from '../../src/components/ui';
import { useStore } from '../../src/lib/store';
import { getApiErrorMessage, resolveApiAssetUrl, WardrobeItem } from '../../src/lib/api';
import { captureRef } from 'react-native-view-shot';
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
  const saveGridRemote = useStore((s) => s.saveGrid);

  const trip = trips.find((t) => t.id === selectedTripId) || trips[0];
  const [grid, setGrid] = useState<(string | null)[]>(trip?.grid || Array(9).fill(null));
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  const [completeMoment, setCompleteMoment] = useState(false);
  const [activeDragCategory, setActiveDragCategory] = useState<WardrobeItem['category'] | null>(null);

  // Slot rects stay relative to the grid wrapper; the wrapper is measured at drop time.
  const slotRects = useRef<Record<number, SlotRect>>({});
  const gridRef = useRef<View | null>(null);
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

  const shareGrid = async () => {
    if (!gridRef.current) return;
    setSharing(true);
    try {
      // Loaded lazily and validated: on an app build without the native
      // module, the button explains instead of crashing the route.
      const Sharing = await import('expo-sharing').catch(() => null);
      const available =
        Sharing && typeof Sharing.shareAsync === 'function'
          ? await Sharing.isAvailableAsync().catch(() => false)
          : false;
      if (!Sharing || !available) {
        Alert.alert(
          'Update needed',
          'Sharing needs the latest app build. Rebuild and reinstall the dev client (or use Expo Go).'
        );
        return;
      }
      const uri = await captureRef(gridRef, { format: 'jpg', quality: 0.92, result: 'tmpfile' });
      await Sharing.shareAsync(uri, {
        mimeType: 'image/jpeg',
        dialogTitle: 'Share your Packr grid',
      });
    } catch {
      Alert.alert('Share failed', 'Could not capture the grid image.');
    } finally {
      setSharing(false);
    }
  };

  const saveGrid = async (g: (string | null)[]) => {
    if (!trip) return;
    setSaving(true);
    try {
      await saveGridRemote(trip.id, g);
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
  const resolveDrop = (itemId: string, localX: number, localY: number) => {
    const rects = slotRects.current;
    let target: number | null = null;
    for (let s = 0; s < 9; s++) {
      const r = rects[s];
      if (!r) continue;
      if (localX >= r.x && localX <= r.x + r.w && localY >= r.y && localY <= r.y + r.h) {
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

  const handleDrop = (itemId: string, absX: number, absY: number) => {
    if (!gridRef.current?.measure) return;
    gridRef.current.measure((_x, _y, _w, _h, pageX, pageY) => {
      resolveDrop(itemId, absX - pageX, absY - pageY);
    });
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
        <ScreenHeader
          kicker="THE GRID"
          title="Tap or drag"
          subtitle={trip.destination}
          right={saving ? <ActivityIndicator color={c.accent} /> : undefined}
        />

        <Text style={[styles.layoutHint, { color: c.textTertiary }]}>
          ROTATING SUDOKU LAYOUT
        </Text>

        {/* 3x3 Grid */}
        <View ref={gridRef} style={[styles.grid, { borderColor: c.borderSubtle }]}>
          {[0, 1, 2].map((row) => (
            <View key={row} style={styles.gridRow}>
              {[0, 1, 2].map((col) => {
                const i = row * 3 + col;
                const id = grid[i];
                const item = id ? itemsById[id] : null;
                const conflict = conflicts.slotConflicts[i];
                const expected = categoryForSlot(i);
                const slotMeta = CATEGORY_META[item?.category || expected];
                const isGuidingDrag = Boolean(activeDragCategory);
                const isValidDragTarget = activeDragCategory === expected;
                return (
                  <Pressable
                    testID={`grid-slot-${i}`}
                    key={i}
                    onPress={() => onSlotTap(i)}
                    onLayout={(e) => {
                      const { x, y, width, height } = e.nativeEvent.layout;
                      slotRects.current[i] = { x, y, w: width, h: height };
                    }}
                    style={[
                      styles.slot,
                      {
                        borderColor: conflict
                          ? c.warning
                          : isValidDragTarget
                          ? c.accent
                          : item
                          ? c.borderActive
                          : c.borderSubtle,
                        borderWidth: isValidDragTarget ? 2 : 1,
                        backgroundColor: conflict
                          ? c.warning + '22'
                          : isValidDragTarget
                          ? c.accentSoft
                          : item
                          ? c.plate
                          : 'transparent',
                        borderStyle: item ? 'solid' : 'dashed',
                        opacity: isGuidingDrag && !isValidDragTarget ? 0.3 : 1,
                        transform: [{ scale: isValidDragTarget ? 1.02 : 1 }],
                      },
                    ]}
                  >
                    {item ? (
                      item.image ? (
                        <Image
                          source={{ uri: resolveApiAssetUrl(item.image) }}
                          style={styles.slotImg}
                          contentFit="contain"
                        />
                      ) : (
                        <View style={{ alignItems: 'center', padding: 4 }}>
                          <Ionicons name={slotMeta.icon as keyof typeof Ionicons.glyphMap} size={20} color={c.textTertiary} />
                          <Text numberOfLines={1} style={[t.micro, { color: c.textPrimary, marginTop: 2 }]}>
                            {item.name}
                          </Text>
                        </View>
                      )
                    ) : (
                      <View style={{ alignItems: 'center', gap: 2 }}>
                        <Text style={[t.label, { color: c.textTertiary }]}>{slotMeta.short}</Text>
                        <Text style={[t.h2, { color: c.borderActive }]}>+</Text>
                      </View>
                    )}
                    {item ? (
                      <View style={[styles.slotBadge, { backgroundColor: c.bg, borderColor: c.borderSubtle }]}>
                        <Text style={[styles.slotBadgeText, { color: c.textTertiary }]}>{slotMeta.short}</Text>
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>

        {conflicts.hasConflicts && (
          <View style={[styles.conflictBox, { borderColor: c.warning, backgroundColor: c.warning + '15' }]}>
            <Ionicons name="warning-outline" size={16} color={c.warning} />
            <Text style={[t.micro, { color: c.warning, marginLeft: 6, flex: 1 }]}>
              {Object.values(conflicts.slotConflicts)[0]}
            </Text>
          </View>
        )}

        {completeMoment && !conflicts.hasConflicts && (
          <View style={[styles.completeBox, { borderColor: c.accent, backgroundColor: c.accentSoft }]}>
            <View style={styles.completeDots}>
              {[0, 1, 2, 3, 4].map((dot) => (
                <View key={dot} style={[styles.completeDot, { backgroundColor: c.accent, opacity: 1 - dot * 0.12 }]} />
              ))}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[t.title, { color: c.textPrimary }]}>Grid complete</Text>
              <Text style={[t.micro, { color: c.textSecondary, marginTop: 2 }]}>
                9 items can now make 27 outfits.
              </Text>
            </View>
          </View>
        )}

        {complete && !conflicts.hasConflicts && (
          <Pressable
            onPress={shareGrid}
            disabled={sharing}
            accessibilityRole="button"
            accessibilityLabel="Share your packing grid"
            style={[styles.shareBtn, { borderColor: c.accent, opacity: sharing ? 0.6 : 1 }]}
          >
            {sharing ? (
              <ActivityIndicator color={c.accentText} size="small" />
            ) : (
              <Ionicons name="share-social-outline" size={16} color={c.accentText} />
            )}
            <Text style={[t.label, { color: c.accentText, marginLeft: 8 }]}>
              SHARE GRID (INSTAGRAM & MORE)
            </Text>
          </Pressable>
        )}

        <View style={{ height: 16 }} />
        <Text style={[t.kicker, { color: c.textPrimary }]}>WARDROBE - TAP OR DRAG</Text>
        <Text style={[t.micro, { color: c.textTertiary, marginTop: 4 }]}>
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
              <Text style={[t.micro, { color: c.textTertiary, textAlign: 'center' }]}>
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
              onDragStart={() => setActiveDragCategory(it.category)}
              onDragEnd={() => setActiveDragCategory(null)}
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
              t.kicker,
              { color: complete && !conflicts.hasConflicts ? c.accentInk : c.textTertiary, letterSpacing: 2 },
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
              <Text style={[t.kicker, { color: c.accentText }]}>SLOT {slot + 1}</Text>
              <Text style={[t.h1, { color: c.textPrimary }]}>Choose {category}</Text>
            </View>
            <IconButton icon="close" accessibilityLabel="Close" onPress={onClose} />
          </View>
          <ScrollView contentContainerStyle={{ gap: space.sm, paddingTop: space.lg }}>
            {choices.length === 0 ? (
              <Text style={[t.body, { color: c.textSecondary }]}>Add a {category} in Studio first.</Text>
            ) : (
              choices.map((item) => {
                const used = inGrid.includes(item.id);
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => onPick(slot, item)}
                    style={[styles.pickRow, { borderColor: used ? c.borderSubtle : c.borderActive, backgroundColor: c.elevated }]}
                  >
                    {item.image ? (
                      <Image source={{ uri: resolveApiAssetUrl(item.image) }} style={styles.pickImage} contentFit="contain" />
                    ) : (
                      <Ionicons name={meta.icon as keyof typeof Ionicons.glyphMap} size={24} color={c.textTertiary} />
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={[t.title, { color: c.textPrimary }]}>{item.name}</Text>
                      <Text style={[t.micro, { color: c.textTertiary, marginTop: 2 }]}>
                        {used ? 'Currently in grid - will move here' : `${Number(item.weight_kg || 0).toFixed(1)}kg`}
                      </Text>
                    </View>
                    <Ionicons name="add-circle-outline" size={20} color={c.accent} />
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
  onDragStart,
  onDragEnd,
}: {
  item: WardrobeItem;
  inGrid: boolean;
  onDrop: (absX: number, absY: number) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
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
      runOnJS(onDragStart)();
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
      runOnJS(onDragEnd)();
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
            borderRadius: radius.sharp,
            padding: space.sm,
            alignItems: 'center',
            justifyContent: 'center',
            borderColor: isDragging ? c.accent : c.borderActive,
            backgroundColor: inGrid && !isDragging ? c.surface : c.plate,
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
          <Ionicons name={meta.icon as keyof typeof Ionicons.glyphMap} size={24} color={c.textTertiary} />
        )}
        <Text numberOfLines={1} style={[t.micro, { color: c.textPrimary, marginTop: 4 }]}>
          {item.name}
        </Text>
        <Text style={[t.kicker, { color: c.textTertiary, fontSize: 9 }]}>
          {meta.short}
        </Text>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  layoutHint: { fontSize: 10, letterSpacing: 2, fontWeight: '600', marginTop: space.xl, marginBottom: space.sm },
  grid: {
    aspectRatio: 1, borderWidth: 1, borderRadius: radius.sharp, padding: space.sm,
    flexDirection: 'column', gap: space.sm,
  },
  gridRow: { flex: 1, flexDirection: 'row', gap: space.sm },
  slot: {
    flex: 1, borderWidth: 1, borderRadius: radius.sharp,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative',
  },
  slotImg: { width: '100%', height: '100%' },
  slotBadge: {
    position: 'absolute', right: 4, bottom: 4, borderWidth: 1,
    borderRadius: radius.sharp, paddingHorizontal: 4, paddingVertical: 2,
  },
  slotBadgeText: { fontSize: 7, letterSpacing: 0.8, fontWeight: '900' },
  conflictBox: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radius.sharp,
    padding: space.sm, marginTop: space.md,
  },
  completeBox: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    borderWidth: 1, borderRadius: radius.sharp, padding: space.md, marginTop: space.md,
  },
  completeDots: { flexDirection: 'row', gap: 4 },
  shareBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderRadius: radius.sharp, paddingVertical: space.md, marginTop: space.md,
  },
  completeDot: { width: 7, height: 7, borderRadius: 4 },
  itemEmpty: {
    width: 240, height: 110, borderWidth: 1, borderRadius: radius.sharp,
    alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed', padding: space.lg,
  },
  dragImage: { width: 58, height: 58, borderRadius: radius.sharp },
  cta: { paddingVertical: space.lg, borderWidth: 1, borderRadius: radius.sharp, alignItems: 'center' },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.62)' },
  pickerSheet: {
    maxHeight: '78%',
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderWidth: 1,
    borderBottomWidth: 0,
    padding: space.xl,
    paddingBottom: 34,
  },
  pickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderWidth: 1, borderRadius: radius.sharp, padding: space.sm },
  pickImage: { width: 54, height: 54, borderRadius: radius.sharp },
});
