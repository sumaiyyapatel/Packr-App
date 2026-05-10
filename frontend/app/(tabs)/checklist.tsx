import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useStore } from '../../src/lib/store';
import { api, WardrobeItem, Trip } from '../../src/lib/api';

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
  const upsertTrip = useStore((s) => s.upsertTrip);
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

  if (!trip) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Text style={{ color: c.textSecondary }}>Create a trip first.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const gridItems = trip.grid
    .map((id, i) => ({ id, i }))
    .filter((x) => x.id) as { id: string; i: number }[];

  const onToggle = async (key: string, checked: boolean) => {
    Haptics.selectionAsync().catch(() => {});
    try {
      const r = await api.put(`/trips/${trip.id}/checklist`, {
        item_key: key,
        checked: !checked,
      });
      upsertTrip(r.data);
    } catch {}
  };

  const onRemoveExtra = async (id: string) => {
    try {
      const r = await api.delete(`/trips/${trip.id}/extras/${id}`);
      upsertTrip(r.data);
    } catch {}
  };

  // Aggregate weights
  let totalWeight = 0;
  let checkedCount = 0;
  let totalCount = 0;

  for (const g of gridItems) {
    const item = itemsById[g.id];
    if (!item) continue;
    const key = `grid:${g.i}`;
    totalCount += 1;
    if (trip.checklist_state[key]) {
      totalWeight += item.weight_kg || 0;
      checkedCount += 1;
    }
  }

  const allEssentials = [
    ...ESSENTIAL_DEFAULTS.map((d) => ({ key: `ess:${d.key}`, name: d.name, weight: d.weight, category: d.category, removable: false, eid: '' })),
    ...trip.extras.map((e) => ({ key: `ext:${e.id}`, name: e.name, weight: e.weight_kg, category: e.category, removable: true, eid: e.id })),
  ];

  for (const e of allEssentials) {
    totalCount += 1;
    if (trip.checklist_state[e.key]) {
      totalWeight += e.weight || 0;
      checkedCount += 1;
    }
  }

  const overLimit = totalWeight > carryOnLimitKg;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 96 }}>
        <Text style={[styles.kicker, { color: c.accent }]}>PACK</Text>
        <Text style={[styles.h1, { color: c.textPrimary }]}>Final check</Text>
        <Text style={{ color: c.textTertiary, fontSize: 12, marginTop: 4 }}>{trip.destination}</Text>

        {/* Airline picker */}
        <Text style={[styles.section, { color: c.textPrimary, marginTop: 24 }]}>AIRLINE</Text>
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
                <Text style={{ color: isActive ? c.bg : c.textPrimary, fontSize: 12, fontWeight: '600' }}>
                  {a.name}
                </Text>
                <Text style={{ color: isActive ? c.bg : c.textTertiary, fontSize: 10, marginTop: 2 }}>
                  {a.max_kg.toFixed(1)} kg
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Grid items section */}
        <View style={styles.sectionRow}>
          <Text style={[styles.section, { color: c.textPrimary }]}>
            THE GRID ({gridItems.length}/9)
          </Text>
        </View>

        <View style={[styles.box, { borderColor: c.borderSubtle }]}>
          {gridItems.length === 0 && (
            <Text style={{ color: c.textTertiary, padding: 16 }}>Build the grid first.</Text>
          )}
          {gridItems.map(({ id, i }) => {
            const item = itemsById[id];
            if (!item) return null;
            const key = `grid:${i}`;
            const checked = !!trip.checklist_state[key];
            return (
              <CheckRow
                key={key}
                testID={`check-grid-${i}`}
                checked={checked}
                onToggle={() => onToggle(key, checked)}
                title={item.name}
                subtitle={`${item.category.toUpperCase()} · slot ${i + 1}`}
                weight={item.weight_kg}
              />
            );
          })}
        </View>

        <View style={styles.sectionRow}>
          <Text style={[styles.section, { color: c.textPrimary }]}>ESSENTIALS</Text>
          <Pressable
            testID="add-extra-button"
            onPress={() => setShowAdd(true)}
            style={[styles.smallBtn, { borderColor: c.borderActive }]}
          >
            <Ionicons name="add" size={14} color={c.textPrimary} />
            <Text style={{ color: c.textPrimary, fontSize: 11, letterSpacing: 1, fontWeight: '600' }}>
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
                onToggle={() => onToggle(e.key, checked)}
                title={e.name}
                subtitle={e.category.toUpperCase()}
                weight={e.weight}
                onRemove={e.removable ? () => onRemoveExtra(e.eid) : undefined}
              />
            );
          })}
        </View>
      </ScrollView>

      {/* Sticky weight bar */}
      <View style={[styles.weightBar, { backgroundColor: c.bg, borderTopColor: c.borderSubtle }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.weightLabel, { color: c.textTertiary }]}>
            TOTAL · {checkedCount}/{totalCount} CHECKED
          </Text>
          <Text style={[styles.weightValue, { color: overLimit ? c.error : c.textPrimary }]}>
            {totalWeight.toFixed(2)} kg
            <Text style={{ color: c.textTertiary, fontSize: 14 }}> / {carryOnLimitKg.toFixed(1)} kg</Text>
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
        onCreated={(t) => {
          upsertTrip(t);
          setShowAdd(false);
        }}
        tripId={trip.id}
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
        {checked && <Ionicons name="checkmark" size={14} color={c.bg} />}
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={{ color: c.textPrimary, fontSize: 15, textDecorationLine: checked ? 'line-through' : 'none' }}>
          {title}
        </Text>
        <Text style={{ color: c.textTertiary, fontSize: 11, letterSpacing: 1, marginTop: 2 }}>
          {subtitle}
        </Text>
      </View>
      <Text style={{ color: c.textSecondary, fontSize: 12, marginRight: 8 }}>{weight.toFixed(2)}kg</Text>
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
  tripId,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (t: Trip) => void;
  tripId: string;
}) {
  const { c } = useTheme();
  const [name, setName] = useState('');
  const [weight, setWeight] = useState('0.1');
  const [cat, setCat] = useState('other');
  const [saving, setSaving] = useState(false);

  const onSave = async () => {
    setSaving(true);
    try {
      const r = await api.post(`/trips/${tripId}/extras`, {
        name: name.trim(),
        weight_kg: parseFloat(weight) || 0.1,
        category: cat,
      });
      onCreated(r.data);
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
          <Text style={[styles.h2, { color: c.textPrimary }]}>Add essential</Text>

          <Text style={[styles.label, { color: c.textTertiary }]}>NAME</Text>
          <TextInput
            testID="extra-name-input"
            value={name}
            onChangeText={setName}
            placeholder="Sunglasses"
            placeholderTextColor={c.textTertiary}
            style={[styles.input, { color: c.textPrimary, borderBottomColor: c.borderActive }]}
          />

          <View style={{ height: 8 }} />
          <Text style={[styles.label, { color: c.textTertiary }]}>CATEGORY</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {['toiletries', 'documents', 'chargers', 'other'].map((x) => (
              <Pressable
                testID={`extra-cat-${x}`}
                key={x}
                onPress={() => setCat(x)}
                style={[
                  styles.miniChip,
                  {
                    borderColor: cat === x ? c.accent : c.borderSubtle,
                    backgroundColor: cat === x ? c.accent : 'transparent',
                  },
                ]}
              >
                <Text style={{ color: cat === x ? c.bg : c.textSecondary, fontSize: 10, letterSpacing: 1, fontWeight: '600' }}>
                  {x.toUpperCase()}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={{ height: 8 }} />
          <Text style={[styles.label, { color: c.textTertiary }]}>WEIGHT (KG)</Text>
          <TextInput
            testID="extra-weight-input"
            value={weight}
            onChangeText={setWeight}
            keyboardType="decimal-pad"
            style={[styles.input, { color: c.textPrimary, borderBottomColor: c.borderActive }]}
          />

          <View style={{ height: 16 }} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              testID="extra-cancel"
              onPress={onClose}
              style={[styles.modalBtn, { borderColor: c.borderActive, flex: 1 }]}
            >
              <Text style={{ color: c.textPrimary }}>Cancel</Text>
            </Pressable>
            <Pressable
              testID="extra-save"
              onPress={onSave}
              disabled={!name.trim() || saving}
              style={[styles.modalBtn, { backgroundColor: c.accent, flex: 1, opacity: !name.trim() ? 0.5 : 1 }]}
            >
              {saving ? <ActivityIndicator color={c.bg} /> : <Text style={{ color: c.bg, fontWeight: '600' }}>Save</Text>}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  kicker: { fontSize: 11, letterSpacing: 2, fontWeight: '600' },
  h1: { fontSize: 32, fontWeight: '700', letterSpacing: -1, marginTop: 4 },
  h2: { fontSize: 20, fontWeight: '700' },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 24 },
  section: { fontSize: 11, letterSpacing: 2, fontWeight: '600' },
  smallBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 4,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  box: { borderWidth: 1, borderRadius: 8, marginTop: 12, overflow: 'hidden' },
  row: {
    flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1,
  },
  box2: { width: 22, height: 22, borderWidth: 1, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  weightBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16,
    borderTopWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  weightLabel: { fontSize: 10, letterSpacing: 2, fontWeight: '600' },
  weightValue: { fontSize: 22, fontWeight: '700', marginTop: 4 },
  weightCircle: {
    width: 44, height: 44, borderRadius: 22, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  modalCard: {
    padding: 24, paddingBottom: 36, borderTopLeftRadius: 16, borderTopRightRadius: 16,
    borderWidth: 1, borderBottomWidth: 0,
  },
  label: { fontSize: 11, letterSpacing: 1.5, marginBottom: 6, marginTop: 12 },
  input: { fontSize: 16, borderBottomWidth: 1, paddingVertical: 6 },
  miniChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  airlineChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6, borderWidth: 1,
    minWidth: 110,
  },
  modalBtn: {
    paddingVertical: 14, borderWidth: 1, borderRadius: 4, alignItems: 'center', justifyContent: 'center',
  },
});
