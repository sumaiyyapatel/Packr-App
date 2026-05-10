import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
  TextInput,
  Modal,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useStore } from '../../src/lib/store';
import { api, WardrobeItem } from '../../src/lib/api';

type Cat = 'top' | 'bottom' | 'layer';
type Filter = 'all' | Cat;

export default function Studio() {
  const { c } = useTheme();
  const wardrobe = useStore((s) => s.wardrobe);
  const upsertWardrobeItem = useStore((s) => s.upsertWardrobeItem);
  const removeWardrobeItem = useStore((s) => s.removeWardrobeItem);

  const [filter, setFilter] = useState<Filter>('all');
  const [showAdd, setShowAdd] = useState(false);

  const items = useMemo(
    () => (filter === 'all' ? wardrobe : wardrobe.filter((w) => w.category === filter)),
    [wardrobe, filter]
  );

  const onDelete = (item: WardrobeItem) => {
    Alert.alert('Delete item?', item.name, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/wardrobe/${item.id}`);
            removeWardrobeItem(item.id);
          } catch {}
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <View>
            <Text style={[styles.kicker, { color: c.accent }]}>STUDIO</Text>
            <Text style={[styles.h1, { color: c.textPrimary }]}>Your wardrobe</Text>
          </View>
          <Pressable
            testID="studio-add-button"
            onPress={() => setShowAdd(true)}
            style={[styles.addBtn, { backgroundColor: c.accent }]}
          >
            <Ionicons name="add" size={22} color={c.bg} />
          </Pressable>
        </View>

        <View style={{ height: 16 }} />

        {/* Filter chips */}
        <View style={styles.filterRow}>
          {(['all', 'top', 'bottom', 'layer'] as Filter[]).map((f) => {
            const isActive = filter === f;
            const count =
              f === 'all' ? wardrobe.length : wardrobe.filter((w) => w.category === f).length;
            return (
              <Pressable
                testID={`filter-${f}`}
                key={f}
                onPress={() => setFilter(f)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: isActive ? c.accent : 'transparent',
                    borderColor: isActive ? c.accent : c.borderSubtle,
                  },
                ]}
              >
                <Text style={[styles.chipText, { color: isActive ? c.bg : c.textSecondary }]}>
                  {f.toUpperCase()} · {count}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ height: 24 }} />

        {items.length === 0 ? (
          <View style={[styles.empty, { borderColor: c.borderSubtle }]}>
            <Ionicons name="shirt-outline" size={36} color={c.textTertiary} />
            <Text style={{ color: c.textSecondary, marginTop: 12, textAlign: 'center' }}>
              No items yet. Add your first garment using the + button.
            </Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {items.map((it) => (
              <ItemCard key={it.id} item={it} onLong={() => onDelete(it)} />
            ))}
          </View>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>

      <AddItemModal
        visible={showAdd}
        onClose={() => setShowAdd(false)}
        onCreated={(it) => {
          upsertWardrobeItem(it);
          setShowAdd(false);
        }}
      />
    </SafeAreaView>
  );
}

function ItemCard({ item, onLong }: { item: WardrobeItem; onLong: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      testID={`wardrobe-item-${item.id}`}
      onLongPress={onLong}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: c.surface,
          borderColor: c.borderSubtle,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}
    >
      <View style={[styles.imgWrap, { backgroundColor: c.elevated }]}>
        {item.image ? (
          <Image source={{ uri: item.image }} style={styles.img} resizeMode="cover" />
        ) : (
          <Ionicons name="shirt-outline" size={32} color={c.textTertiary} />
        )}
        <View style={[styles.catTag, { backgroundColor: c.bg, borderColor: c.borderActive }]}>
          <Text style={[styles.catTagText, { color: c.textPrimary }]}>{item.category.toUpperCase()}</Text>
        </View>
      </View>
      <View style={{ padding: 10 }}>
        <Text numberOfLines={1} style={{ color: c.textPrimary, fontWeight: '600' }}>
          {item.name}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 4 }}>
          {(item.colors || []).slice(0, 3).map((col, i) => (
            <View key={i} style={[styles.swatch, { backgroundColor: col, borderColor: c.borderSubtle }]} />
          ))}
          <Text style={{ color: c.textTertiary, fontSize: 11, marginLeft: 'auto' }}>
            {item.weight_kg}kg
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function AddItemModal({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (i: WardrobeItem) => void;
}) {
  const { c } = useTheme();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<Cat>('top');
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [weight, setWeight] = useState('0.3');
  const [tagsText, setTagsText] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reset = () => {
    setName('');
    setCategory('top');
    setImageBase64(null);
    setWeight('0.3');
    setTagsText('');
    setErr(null);
  };

  const pickPhoto = async (fromCamera: boolean) => {
    setErr(null);
    if (fromCamera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        setErr('Camera permission denied');
        return;
      }
      const r = await ImagePicker.launchCameraAsync({
        quality: 0.6,
        base64: true,
        allowsEditing: true,
        aspect: [1, 1],
      });
      if (!r.canceled && r.assets[0]?.base64) {
        setImageBase64(`data:image/jpeg;base64,${r.assets[0].base64}`);
      }
    } else {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setErr('Photos permission denied');
        return;
      }
      const r = await ImagePicker.launchImageLibraryAsync({
        quality: 0.6,
        base64: true,
        allowsEditing: true,
        aspect: [1, 1],
      });
      if (!r.canceled && r.assets[0]?.base64) {
        setImageBase64(`data:image/jpeg;base64,${r.assets[0].base64}`);
      }
    }
  };

  const onSave = async () => {
    setErr(null);
    if (!name.trim()) return setErr('Name required');
    setSaving(true);
    try {
      const tags = tagsText
        .split(/[,\s]+/)
        .map((t) => t.trim())
        .filter(Boolean);
      const r = await api.post('/wardrobe', {
        name: name.trim(),
        category,
        image: imageBase64 || '',
        colors: pickPaletteFromTags(tags),
        weight_kg: parseFloat(weight) || 0.3,
        tags,
      });
      onCreated(r.data);
      reset();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={[styles.h1, { color: c.textPrimary }]}>Add item</Text>
              <Pressable testID="add-modal-close" onPress={onClose} style={[styles.iconBtn, { borderColor: c.borderSubtle }]}>
                <Ionicons name="close" size={20} color={c.textPrimary} />
              </Pressable>
            </View>

            <View style={{ height: 16 }} />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Pressable
                testID="pick-camera"
                onPress={() => pickPhoto(true)}
                style={[styles.photoBtn, { borderColor: c.borderActive }]}
              >
                <Ionicons name="camera-outline" size={18} color={c.textPrimary} />
                <Text style={{ color: c.textPrimary, marginLeft: 8 }}>Camera</Text>
              </Pressable>
              <Pressable
                testID="pick-library"
                onPress={() => pickPhoto(false)}
                style={[styles.photoBtn, { borderColor: c.borderActive }]}
              >
                <Ionicons name="image-outline" size={18} color={c.textPrimary} />
                <Text style={{ color: c.textPrimary, marginLeft: 8 }}>Library</Text>
              </Pressable>
            </View>

            <View style={[styles.preview, { backgroundColor: c.surface, borderColor: c.borderSubtle }]}>
              {imageBase64 ? (
                <Image source={{ uri: imageBase64 }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
              ) : (
                <Text style={{ color: c.textTertiary }}>No photo selected (optional)</Text>
              )}
            </View>

            <Text style={[styles.label, { color: c.textTertiary }]}>NAME</Text>
            <TextInput
              testID="item-name-input"
              value={name}
              onChangeText={setName}
              placeholder="e.g., Black tee"
              placeholderTextColor={c.textTertiary}
              style={[styles.input, { color: c.textPrimary, borderBottomColor: c.borderActive }]}
            />

            <View style={{ height: 12 }} />
            <Text style={[styles.label, { color: c.textTertiary }]}>CATEGORY</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['top', 'bottom', 'layer'] as Cat[]).map((cat) => {
                const active = category === cat;
                return (
                  <Pressable
                    testID={`cat-${cat}`}
                    key={cat}
                    onPress={() => setCategory(cat)}
                    style={[
                      styles.chip,
                      { borderColor: active ? c.accent : c.borderSubtle, backgroundColor: active ? c.accent : 'transparent', flex: 1 },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: active ? c.bg : c.textSecondary, textAlign: 'center' }]}>
                      {cat.toUpperCase()}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={{ height: 12 }} />
            <Text style={[styles.label, { color: c.textTertiary }]}>WEIGHT (KG)</Text>
            <TextInput
              testID="item-weight-input"
              value={weight}
              onChangeText={setWeight}
              keyboardType="decimal-pad"
              style={[styles.input, { color: c.textPrimary, borderBottomColor: c.borderActive }]}
            />

            <View style={{ height: 12 }} />
            <Text style={[styles.label, { color: c.textTertiary }]}>TAGS (comma-separated)</Text>
            <TextInput
              testID="item-tags-input"
              value={tagsText}
              onChangeText={setTagsText}
              placeholder="formal, modest, tropical"
              placeholderTextColor={c.textTertiary}
              autoCapitalize="none"
              style={[styles.input, { color: c.textPrimary, borderBottomColor: c.borderActive }]}
            />

            {err && <Text style={{ color: c.error, marginTop: 12 }}>{err}</Text>}

            <View style={{ height: 24 }} />
            <Pressable
              testID="save-item-button"
              onPress={onSave}
              disabled={saving}
              style={({ pressed }) => [
                styles.saveBtn,
                { backgroundColor: c.accent, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              {saving ? <ActivityIndicator color={c.bg} /> : <Text style={{ color: c.bg, fontWeight: '600' }}>Save Item</Text>}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function pickPaletteFromTags(tags: string[]): string[] {
  // Quick deterministic palette stub from tags (color extraction is Phase 2)
  const map: Record<string, string> = {
    formal: '#1F2937',
    business: '#111827',
    casual: '#9CA3AF',
    beach: '#60A5FA',
    tropical: '#10B981',
    modest: '#6B7280',
    snow: '#E5E7EB',
    gym: '#EF4444',
  };
  const colors: string[] = [];
  for (const t of tags) {
    const v = map[t.toLowerCase().replace('#', '')];
    if (v && !colors.includes(v)) colors.push(v);
    if (colors.length >= 3) break;
  }
  if (colors.length === 0) colors.push('#888888');
  return colors;
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 16, paddingBottom: 48 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  kicker: { fontSize: 11, letterSpacing: 2, fontWeight: '600' },
  h1: { fontSize: 32, fontWeight: '700', letterSpacing: -1, marginTop: 4 },
  addBtn: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
  },
  iconBtn: { width: 36, height: 36, borderWidth: 1, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
  chipText: { fontSize: 11, letterSpacing: 1, fontWeight: '600' },
  empty: { borderWidth: 1, borderRadius: 8, padding: 32, alignItems: 'center', borderStyle: 'dashed' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' },
  card: { width: '48%', borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  imgWrap: { aspectRatio: 1, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  img: { width: '100%', height: '100%' },
  catTag: { position: 'absolute', top: 8, left: 8, borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  catTagText: { fontSize: 9, letterSpacing: 1, fontWeight: '600' },
  swatch: { width: 12, height: 12, borderRadius: 6, borderWidth: 1 },
  photoBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 4, padding: 12 },
  preview: {
    width: '100%', aspectRatio: 1, marginTop: 12,
    borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  label: { fontSize: 11, letterSpacing: 1.5, marginBottom: 6, marginTop: 16 },
  input: { fontSize: 16, borderBottomWidth: 1, paddingVertical: 8 },
  saveBtn: { paddingVertical: 16, borderRadius: 4, alignItems: 'center' },
});
