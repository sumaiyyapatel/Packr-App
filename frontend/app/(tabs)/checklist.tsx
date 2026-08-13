import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../src/theme/ThemeProvider';
import { type as t, space, radius } from '../../src/theme/tokens';
import { ScreenHeader, Chip, TextField, Button, ProgressRing, ActionBar } from '../../src/components/ui';
import { useStore } from '../../src/lib/store';
import { WardrobeItem } from '../../src/lib/api';
import { trackEvent } from '../../src/lib/analytics';

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysFromToday(dateIso: string): number {
  const target = new Date(`${dateIso}T00:00:00`).getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today.getTime()) / 86_400_000);
}

const ESSENTIAL_DEFAULTS: { key: string; name: string; weight: number; category: string }[] = [
  { key: 'passport', name: 'Passport', weight: 0.05, category: 'documents' },
  { key: 'wallet', name: 'Wallet', weight: 0.15, category: 'documents' },
  { key: 'phone-charger', name: 'Phone charger', weight: 0.15, category: 'chargers' },
  { key: 'toothbrush', name: 'Toothbrush + paste', weight: 0.1, category: 'toiletries' },
  { key: 'shampoo', name: 'Shampoo (travel)', weight: 0.1, category: 'toiletries' },
  { key: 'deodorant', name: 'Deodorant', weight: 0.05, category: 'toiletries' },
];

export default function Checklist() {
  const { c } = useTheme();
  const trips = useStore((s) => s.trips);
  const wardrobe = useStore((s) => s.wardrobe);
  const user = useStore((s) => s.user);
  const selectedTripId = useStore((s) => s.selectedTripId);
  const selectedAirlineId = useStore((s) => s.selectedAirlineId);
  const setSelectedAirline = useStore((s) => s.setSelectedAirline);
  const toggleChecklistOptimistic = useStore((s) => s.toggleChecklistOptimistic);
  const addTripExtra = useStore((s) => s.addTripExtra);
  const removeTripExtra = useStore((s) => s.removeTripExtra);
  const trip = trips.find((t) => t.id === selectedTripId) || trips[0];
  const [showAdd, setShowAdd] = useState(false);

  const airlines = user?.airline_profiles || [
    { id: 'carry-on', name: 'Carry-on', max_kg: 7.0 },
  ];
  const selectedAirline =
    airlines.find((a) => a.id === selectedAirlineId) || airlines[0];
  const carryOnLimitKg = selectedAirline?.max_kg ?? 7.0;

  const itemsById = useMemo(() => {
    const m: Record<string, WardrobeItem> = {};
    for (const w of wardrobe) m[w.id] = w;
    return m;
  }, [wardrobe]);

  const gridItems = trip
    ? (trip.grid
        .map((id, i) => ({ id, i }))
        .filter((x) => x.id) as { id: string; i: number }[])
    : [];

  const onToggle = (key: string) => {
    if (!trip) return;
    Haptics.selectionAsync().catch(() => {});
    toggleChecklistOptimistic(trip.id, key);
  };

  const onRemoveExtra = async (id: string) => {
    if (!trip) return;
    try {
      await removeTripExtra(trip.id, id);
    } catch {}
  };

  // Aggregate weights
  let totalWeight = 0;
  let checkedCount = 0;
  let totalCount = 0;

  for (const g of gridItems) {
    const item = itemsById[g.id];
    if (!item) continue;
    const key = `grid:${g.id}`;
    const legacyKey = `grid:${g.i}`;
    const checked = !!(trip?.checklist_state[key] || trip?.checklist_state[legacyKey]);
    totalCount += 1;
    totalWeight += item.weight_kg || 0;
    if (checked) checkedCount += 1;
  }

  const allEssentials = trip
    ? [
        ...ESSENTIAL_DEFAULTS.map((d) => ({ key: `ess:${d.key}`, name: d.name, weight: d.weight, category: d.category, removable: false, eid: '' })),
        ...trip.extras.map((e) => ({ key: `ext:${e.id}`, name: e.name, weight: e.weight_kg, category: e.category, removable: true, eid: e.id })),
      ]
    : [];

  for (const e of allEssentials) {
    totalCount += 1;
    totalWeight += e.weight || 0;
    if (trip?.checklist_state[e.key]) {
      checkedCount += 1;
    }
  }

  const overLimit = totalWeight > carryOnLimitKg;
  const categoryProgress = ['top', 'bottom', 'layer'].map((category) => {
    const rows = gridItems
      .map(({ id }) => itemsById[id])
      .filter((item) => item?.category === category);
    const done = rows.filter((item) => !!trip?.checklist_state[`grid:${item.id}`]).length;
    return { category, done, total: rows.length };
  });

  useEffect(() => {
    if (trip?.id && totalCount > 0 && checkedCount === totalCount) {
      trackEvent('checklist_completed', { trip_id: trip.id, total_weight: totalWeight });
    }
  }, [checkedCount, totalCount, totalWeight, trip?.id]);

  // "11 · Packing day" — same screen, reframed as the trip gets close:
  // within 2 days of departure (through the trip itself) and still
  // unfinished, the header/copy switches to the packing-day framing and a
  // bulk "mark all packed" action appears.
  const daysUntilStart = trip ? daysFromToday(trip.start_date) : null;
  const tripInProgressOrSoon =
    trip != null && daysUntilStart != null && daysUntilStart <= 2 && trip.end_date >= todayIso();
  const isPackingDay = tripInProgressOrSoon && totalCount > 0 && checkedCount < totalCount;

  const notifiedTripsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!trip || !isPackingDay || notifiedTripsRef.current.has(trip.id)) return;
    (async () => {
      try {
        const Notifications = await import('expo-notifications').catch(() => null);
        if (!Notifications || typeof Notifications.scheduleNotificationAsync !== 'function') return;
        let perms = await Notifications.getPermissionsAsync();
        if (perms.status !== 'granted') perms = await Notifications.requestPermissionsAsync();
        if (perms.status !== 'granted') return;
        await Notifications.scheduleNotificationAsync({
          content: {
            title: `Packing day for ${trip.destination}`,
            body: `${totalCount - checkedCount} item${totalCount - checkedCount === 1 ? '' : 's'} still unchecked. Finish before you go.`,
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
            seconds: 60 * 60 * 12,
            repeats: false,
          },
        });
        notifiedTripsRef.current.add(trip.id);
      } catch {
        // expo-notifications not installed yet (run `npx expo install
        // expo-notifications`), or the platform doesn't support it — no-op.
      }
    })();
  }, [trip, isPackingDay, totalCount, checkedCount]);

  const markAllPacked = () => {
    if (!trip) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const keys = [
      ...gridItems.map(({ id }) => `grid:${id}`),
      ...allEssentials.map((e) => e.key),
    ];
    for (const key of keys) {
      if (!trip.checklist_state[key]) toggleChecklistOptimistic(trip.id, key);
    }
  };

  if (!trip) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Text style={{ color: c.textSecondary }}>Create a trip first.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 96 }}>
        <ScreenHeader
          kicker={isPackingDay ? `PACKING DAY · ${trip.destination.toUpperCase()}` : 'PACK'}
          title={isPackingDay ? 'Ready to pack?' : 'Final check'}
          subtitle={isPackingDay ? `${checkedCount} of ${totalCount} packed` : trip.destination}
        />

        <View style={{ alignItems: 'center', marginTop: space.xl }}>
          <ProgressRing progress={totalCount ? checkedCount / totalCount : 0} size={128} strokeWidth={10}>
            <Text style={[t.display, { color: c.textPrimary }]}>
              {totalCount ? Math.round((checkedCount / totalCount) * 100) : 0}%
            </Text>
            <Text style={[t.kicker, { color: c.textTertiary }]}>PACKED</Text>
          </ProgressRing>
        </View>

        {/* Airline picker */}
        <Text style={[t.kicker, { color: c.textPrimary, marginTop: space.xl }]}>AIRLINE</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingRight: 24 }}
          style={{ marginTop: 8, marginHorizontal: -24, paddingHorizontal: 24 }}
        >
          {airlines.map((a) => {
            const isActive = selectedAirline?.id === a.id;
            return (
              <Pressable
                testID={`airline-chip-${a.id}`}
                key={a.id}
                onPress={() => setSelectedAirline(a.id)}
                style={[
                  styles.airlineChip,
                  {
                    backgroundColor: isActive ? c.accent : 'transparent',
                    borderColor: isActive ? c.accent : c.borderSubtle,
                  },
                ]}
              >
                <Text style={[t.label, { color: isActive ? c.accentInk : c.textPrimary }]}>
                  {a.name}
                </Text>
                <Text style={[t.micro, { color: isActive ? c.accentInk : c.textTertiary, marginTop: 2 }]}>
                  {a.max_kg.toFixed(1)} kg
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Essentials first — small, easy-to-forget items travelers check first. */}
        <View style={styles.sectionRow}>
          <Text style={[t.kicker, { color: c.textPrimary }]}>ESSENTIALS</Text>
          <Pressable
            testID="add-extra-button"
            onPress={() => setShowAdd(true)}
            style={[styles.smallBtn, { borderColor: c.borderActive }]}
          >
            <Ionicons name="add" size={14} color={c.textPrimary} />
            <Text style={[t.kicker, { color: c.textPrimary, fontSize: 11 }]}>
              ADD
            </Text>
          </Pressable>
        </View>

        <View style={[styles.box, { borderColor: c.borderSubtle }]}>
          {allEssentials.map((e) => {
            const checked = !!trip.checklist_state[e.key];
            return (
              <CheckRow
                key={e.key}
                testID={`check-${e.key}`}
                checked={checked}
                onToggle={() => onToggle(e.key)}
                title={e.name}
                subtitle={e.category.toUpperCase()}
                weight={e.weight}
                onRemove={e.removable ? () => onRemoveExtra(e.eid) : undefined}
              />
            );
          })}
        </View>

        {/* Grid items section */}
        <View style={styles.sectionRow}>
          <Text style={[t.kicker, { color: c.textPrimary }]}>
            THE GRID ({gridItems.length}/9)
          </Text>
        </View>

        <View style={[styles.progressPanel, { borderColor: c.borderSubtle, backgroundColor: c.surface }]}>
          {categoryProgress.map((item) => (
            <View key={item.category} style={styles.progressLine}>
              <Text style={[t.label, { color: c.textSecondary, width: 70 }]}>
                {item.category.toUpperCase()}
              </Text>
              <View style={[styles.progressTrack, { backgroundColor: c.elevated }]}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      backgroundColor: c.accent,
                      width: `${item.total ? (item.done / item.total) * 100 : 0}%`,
                    },
                  ]}
                />
              </View>
              <Text style={[t.micro, { color: c.textTertiary, width: 34, textAlign: 'right' }]}>
                {item.done}/{item.total}
              </Text>
            </View>
          ))}
        </View>

        <View style={[styles.box, { borderColor: c.borderSubtle }]}>
          {gridItems.length === 0 && (
            <Text style={[t.body, { color: c.textTertiary, padding: space.lg }]}>Build the grid first.</Text>
          )}
          {gridItems.map(({ id, i }) => {
            const item = itemsById[id];
            if (!item) return null;
            const key = `grid:${id}`;
            const legacyKey = `grid:${i}`;
            const checked = !!(trip.checklist_state[key] || trip.checklist_state[legacyKey]);
            return (
              <CheckRow
                key={key}
                testID={`check-grid-${i}`}
                checked={checked}
                onToggle={() => onToggle(key)}
                title={item.name}
                subtitle={`${item.category.toUpperCase()} · slot ${i + 1}`}
                weight={item.weight_kg}
              />
            );
          })}
        </View>

        {overLimit && (
          <View style={[styles.limitWarning, { borderColor: c.error, backgroundColor: c.error + '12' }]}>
            <Ionicons name="warning-outline" size={17} color={c.error} />
            <Text style={[t.bodySm, { color: c.textPrimary, flex: 1 }]}>
              You are over the selected carry-on limit. Remove extras, swap heavier grid items, or choose another airline profile.
            </Text>
          </View>
        )}

        {isPackingDay && (
          <View style={{ marginTop: space.xl }}>
            <ActionBar testID="mark-all-packed-button" title="Mark all packed" onPress={markAllPacked} />
          </View>
        )}
      </ScrollView>

      {/* Sticky weight bar */}
      <View style={[styles.weightBar, { backgroundColor: c.bg, borderTopColor: c.borderSubtle }]}>
        <View style={{ flex: 1 }}>
          <Text style={[t.kicker, { color: c.textTertiary }]}>
            TOTAL · {checkedCount}/{totalCount} CHECKED
          </Text>
          <Text style={[t.display, { color: overLimit ? c.error : c.textPrimary, marginTop: 2 }]}>
            {totalWeight.toFixed(2)} kg
            <Text style={[t.body, { color: c.textTertiary }]}> / {carryOnLimitKg.toFixed(1)} kg</Text>
          </Text>
        </View>
        <View style={[styles.weightCircle, { borderColor: overLimit ? c.error : c.accent }]}>
          <Ionicons
            name={overLimit ? 'warning-outline' : 'checkmark'}
            size={20}
            color={overLimit ? c.error : c.accent}
          />
        </View>
      </View>

      <AddExtraModal
        visible={showAdd}
        onClose={() => setShowAdd(false)}
        onCreated={() => setShowAdd(false)}
        onSubmit={(extra) => addTripExtra(trip.id, extra)}
      />
    </SafeAreaView>
  );
}

function CheckRow({
  testID,
  checked,
  onToggle,
  title,
  subtitle,
  weight,
  onRemove,
}: {
  testID: string;
  checked: boolean;
  onToggle: () => void;
  title: string;
  subtitle: string;
  weight: number;
  onRemove?: () => void;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onToggle}
      style={({ pressed }) => [
        styles.row,
        { borderColor: c.borderSubtle, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <View
        style={[
          styles.box2,
          {
            borderColor: checked ? c.accent : c.borderActive,
            backgroundColor: checked ? c.accent : 'transparent',
          },
        ]}
      >
        {checked && <Ionicons name="checkmark" size={14} color={c.accentInk} />}
      </View>
      <View style={{ flex: 1, marginLeft: space.md }}>
        <Text style={[t.body, { color: c.textPrimary, textDecorationLine: checked ? 'line-through' : 'none' }]}>
          {title}
        </Text>
        <Text style={[t.kicker, { color: c.textTertiary, marginTop: 2 }]}>
          {subtitle}
        </Text>
      </View>
      <Text style={[t.micro, { color: c.textSecondary, marginRight: space.sm }]}>{weight.toFixed(2)}kg</Text>
      {onRemove && (
        <Pressable onPress={onRemove} hitSlop={8}>
          <Ionicons name="close" size={16} color={c.textTertiary} />
        </Pressable>
      )}
    </Pressable>
  );
}

function AddExtraModal({
  visible,
  onClose,
  onCreated,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
  onSubmit: (extra: { name: string; category: string; weight_kg: number }) => Promise<void>;
}) {
  const { c } = useTheme();
  const [name, setName] = useState('');
  const [weight, setWeight] = useState('0.1');
  const [cat, setCat] = useState('other');
  const [saving, setSaving] = useState(false);

  const onSave = async () => {
    setSaving(true);
    try {
      await onSubmit({
        name: name.trim(),
        weight_kg: parseFloat(weight) || 0.1,
        category: cat,
      });
      onCreated();
      setName('');
      setWeight('0.1');
      setCat('other');
    } catch {
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={[styles.modalCard, { backgroundColor: c.surface, borderColor: c.borderSubtle }]}>
          <Text style={[t.h2, { color: c.textPrimary }]}>Add essential</Text>

          <View style={{ marginTop: space.md }}>
            <TextField testID="extra-name-input" label="NAME" value={name} onChangeText={setName} placeholder="Sunglasses" />
          </View>

          <Text style={[t.kicker, { color: c.textTertiary, marginTop: space.md, marginBottom: space.sm }]}>CATEGORY</Text>
          <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
            {['toiletries', 'documents', 'chargers', 'other'].map((x) => (
              <Chip key={x} testID={`extra-cat-${x}`} label={x.toUpperCase()} active={cat === x} onPress={() => setCat(x)} />
            ))}
          </View>

          <View style={{ marginTop: space.md }}>
            <TextField testID="extra-weight-input" label="WEIGHT (KG)" value={weight} onChangeText={setWeight} keyboardType="decimal-pad" />
          </View>

          <View style={{ height: space.lg }} />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button testID="extra-cancel" title="Cancel" variant="secondary" onPress={onClose} style={{ flex: 1 }} />
            <Button
              testID="extra-save"
              title="Save"
              onPress={onSave}
              disabled={!name.trim()}
              loading={saving}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.xl },
  smallBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: radius.pill,
    paddingHorizontal: space.md, paddingVertical: space.xs,
  },
  box: { borderWidth: 1, borderRadius: radius.sharp, marginTop: space.md, overflow: 'hidden' },
  progressPanel: { borderWidth: 1, borderRadius: radius.sharp, padding: space.md, marginTop: space.md, gap: space.sm },
  progressLine: { gap: 6 },
  progressTrack: { height: 5, borderRadius: radius.sharp, overflow: 'hidden' },
  progressFill: { height: 5, borderRadius: radius.sharp },
  limitWarning: { borderWidth: 1, borderRadius: radius.sharp, padding: space.md, marginTop: space.md },
  row: {
    flexDirection: 'row', alignItems: 'center', padding: space.lg, borderBottomWidth: 1,
  },
  box2: { width: 22, height: 22, borderWidth: 1, borderRadius: radius.sharp, alignItems: 'center', justifyContent: 'center' },
  weightBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.lg,
    borderTopWidth: 1, flexDirection: 'row', alignItems: 'center', gap: space.md,
  },
  weightCircle: {
    width: 44, height: 44, borderRadius: radius.pill, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  modalCard: {
    padding: space.xl, paddingBottom: 36, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet,
    borderWidth: 1, borderBottomWidth: 0,
  },
  airlineChip: {
    paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.sharp, borderWidth: 1,
    minWidth: 110,
  },
});
