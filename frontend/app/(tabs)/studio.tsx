import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Modal,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useStore } from '../../src/lib/store';
import { api, getApiErrorMessage, resolveApiAssetUrl, WardrobeItem } from '../../src/lib/api';
import { trackEvent } from '../../src/lib/analytics';
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  TAG_PRESETS,
  parseTags,
  uniqueTags,
  WardrobeCategory,
} from '../../src/lib/wardrobeMeta';

type Filter = 'all' | WardrobeCategory;

export default function Studio() {
  const { c } = useTheme();
  const wardrobe = useStore((s) => s.wardrobe);
  const upsertWardrobeItem = useStore((s) => s.upsertWardrobeItem);
  const removeWardrobeItem = useStore((s) => s.removeWardrobeItem);
  const refreshTrips = useStore((s) => s.refreshTrips);

  const [filter, setFilter] = useState<Filter>('all');
  const [showEditor, setShowEditor] = useState(false);
  const [editingItem, setEditingItem] = useState<WardrobeItem | null>(null);

  const items = useMemo(
    () => (filter === 'all' ? wardrobe : wardrobe.filter((w) => w.category === filter)),
    [wardrobe, filter]
  );

  const openNew = () => {
    setEditingItem(null);
    setShowEditor(true);
  };

  const openEdit = (item: WardrobeItem) => {
    setEditingItem(item);
    setShowEditor(true);
  };

  const closeEditor = () => {
    setShowEditor(false);
    setEditingItem(null);
  };

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
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <View>
            <Text style={[styles.kicker, { color: c.accent }]}>STUDIO</Text>
            <Text style={[styles.h1, { color: c.textPrimary }]}>Wardrobe</Text>
          </View>
          <Pressable testID="studio-add-button" onPress={openNew} style={[styles.addBtn, { backgroundColor: c.accent }]}>
            <Ionicons name="add" size={22} color={c.bg} />
          </Pressable>
        </View>

        <View style={styles.filterRow}>
          {(['all', ...CATEGORY_ORDER] as Filter[]).map((f) => {
            const isActive = filter === f;
            const count = f === 'all' ? wardrobe.length : wardrobe.filter((w) => w.category === f).length;
            const meta = f === 'all' ? null : CATEGORY_META[f];
            const activeColor = meta?.color || c.accent;
            return (
              <Pressable
                testID={`filter-${f}`}
                key={f}
                onPress={() => setFilter(f)}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: isActive ? activeColor : 'transparent',
                    borderColor: isActive ? activeColor : c.borderSubtle,
                  },
                ]}
              >
                {meta ? (
                  <Ionicons name={meta.icon as keyof typeof Ionicons.glyphMap} size={13} color={isActive ? '#000' : meta.color} />
                ) : (
                  <Ionicons name="apps-outline" size={13} color={isActive ? c.bg : c.textSecondary} />
                )}
                <Text style={[styles.filterText, { color: isActive ? '#000' : c.textSecondary }]}>
                  {(meta?.short || 'ALL')} {count}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {items.length === 0 ? (
          <View style={[styles.empty, { borderColor: c.borderSubtle }]}>
            <Ionicons name="shirt-outline" size={36} color={c.textTertiary} />
            <Text style={{ color: c.textSecondary, marginTop: 12, textAlign: 'center' }}>
              No items here yet.
            </Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {items.map((it) => (
              <ItemCard key={it.id} item={it} onPress={() => openEdit(it)} onLong={() => onDelete(it)} />
            ))}
          </View>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>

      <ItemEditorModal
        visible={showEditor}
        item={editingItem}
        onClose={closeEditor}
        onSaved={async (it) => {
          upsertWardrobeItem(it);
          await refreshTrips().catch(() => {});
          closeEditor();
        }}
      />
    </SafeAreaView>
  );
}

function ItemCard({
  item,
  onPress,
  onLong,
}: {
  item: WardrobeItem;
  onPress: () => void;
  onLong: () => void;
}) {
  const { c } = useTheme();
  const meta = CATEGORY_META[item.category];
  return (
    <Pressable
      testID={`wardrobe-item-${item.id}`}
      onPress={onPress}
      onLongPress={onLong}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: c.surface,
          borderColor: pressed ? meta.color : c.borderSubtle,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}
    >
      <View style={[styles.categoryRail, { backgroundColor: meta.color }]} />
      <View style={[styles.imgWrap, { backgroundColor: c.elevated }]}>
        {item.image ? (
          <Image
            source={{ uri: resolveApiAssetUrl(item.image) }}
            style={styles.img}
            contentFit="contain"
          />
        ) : (
          <Ionicons name={meta.icon as keyof typeof Ionicons.glyphMap} size={34} color={meta.color} />
        )}
        <View style={[styles.catTag, { backgroundColor: '#050505', borderColor: meta.color }]}>
          <Ionicons name={meta.icon as keyof typeof Ionicons.glyphMap} size={11} color={meta.color} />
          <Text style={[styles.catTagText, { color: meta.color }]}>{meta.short}</Text>
        </View>
        <View style={[styles.editDot, { backgroundColor: c.bg, borderColor: c.borderSubtle }]}>
          <Ionicons name="create-outline" size={13} color={c.textSecondary} />
        </View>
      </View>
      <View style={styles.cardBody}>
        <Text numberOfLines={1} style={{ color: c.textPrimary, fontWeight: '800', fontSize: 15 }}>
          {item.name}
        </Text>
        <View style={styles.tagPreviewRow}>
          {(item.tags || []).slice(0, 2).map((tag) => (
            <View key={tag} style={[styles.smallTag, { borderColor: c.borderSubtle, backgroundColor: c.elevated }]}>
              <Text style={{ color: c.textTertiary, fontSize: 9, fontWeight: '700' }}>#{tag}</Text>
            </View>
          ))}
        </View>
        <View style={styles.metaRow}>
          <View style={styles.swatchRow}>
            {(item.colors || []).slice(0, 3).map((col, i) => (
              <View key={`${col}-${i}`} style={[styles.swatch, { backgroundColor: col, borderColor: c.borderSubtle }]} />
            ))}
          </View>
          <Text style={{ color: c.textTertiary, fontSize: 11 }}>
            {Number(item.weight_kg || 0).toFixed(1)}kg
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function ItemEditorModal({
  visible,
  item,
  onClose,
  onSaved,
}: {
  visible: boolean;
  item: WardrobeItem | null;
  onClose: () => void;
  onSaved: (i: WardrobeItem) => void | Promise<void>;
}) {
  const { c } = useTheme();
  const editing = Boolean(item);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<WardrobeCategory>('top');
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [imageBase64, setImageBase64] = useState('');
  const [weight, setWeight] = useState('0.3');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagsText, setTagsText] = useState('');
  const [saving, setSaving] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [autoClean, setAutoClean] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName(item?.name || '');
    setCategory(item?.category || 'top');
    setCategoryTouched(Boolean(item));
    setImageBase64(item?.image || '');
    setWeight(String(item?.weight_kg ?? 0.3));
    setSelectedTags(uniqueTags(item?.tags || []));
    setTagsText('');
    setCleaning(false);
    setAutoClean(true);
    setErr(null);
  }, [visible, item]);

  const pickPhoto = async (fromCamera: boolean) => {
    setErr(null);
    const options: ImagePicker.ImagePickerOptions = {
      quality: 0.8,
      allowsEditing: true,
      aspect: [1, 1],
      base64: true,
    };

    if (fromCamera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        setErr('Camera permission denied');
        return;
      }
      const r = await ImagePicker.launchCameraAsync(options);
      if (!r.canceled && r.assets[0]) {
        const asset = r.assets[0];
        const mime = asset.mimeType || 'image/jpeg';
        setImageBase64(`data:${mime};base64,${asset.base64}`);
      }
      return;
    }

    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setErr('Photos permission denied');
      return;
    }
    const r = await ImagePicker.launchImageLibraryAsync(options);
    if (!r.canceled && r.assets[0]) {
      const asset = r.assets[0];
      const mime = asset.mimeType || 'image/jpeg';
      setImageBase64(`data:${mime};base64,${asset.base64}`);
    }
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((current) =>
      current.includes(tag) ? current.filter((item) => item !== tag) : uniqueTags([...current, tag])
    );
  };

  const onSave = async () => {
    setErr(null);
    const cleanName = name.trim();
    if (!cleanName) return setErr('Name required');

    const tags = uniqueTags([...selectedTags, ...parseTags(tagsText)]);
    const imageChanged = imageBase64 !== (item?.image || '');
    let palette = editing ? item?.colors || [] : pickPaletteFromTags(tags);

    setSaving(true);
    try {
      let imageForSave = imageBase64;
      if (imageForSave.startsWith('data:') && imageChanged && autoClean) {
        try {
          setCleaning(true);
          const cr = await api.post('/cutout', { image: imageForSave });
          if (cr.data?.image) {
            imageForSave = cr.data.image;
            setImageBase64(cr.data.image);
          }
        } catch {
          // Keep the original photo if automatic cleanup is not good enough.
        } finally {
          setCleaning(false);
        }
      }

      if (imageForSave && imageChanged) {
        try {
          const pr = await api.post('/palette', { image: imageForSave });
          if (pr.data?.colors?.length) palette = pr.data.colors;
        } catch {
          palette = pickPaletteFromTags(tags);
        }
      }
      if (!palette.length) palette = pickPaletteFromTags(tags);

      let image = imageForSave;
      if (imageForSave.startsWith('data:') && imageChanged) {
        const upload = await api.post('/uploads/wardrobe-image', { image: imageForSave });
        image = upload.data.url;
      }

      const payload = {
        name: cleanName,
        category,
        image,
        colors: palette,
        weight_kg: parseFloat(weight) || 0.3,
        tags,
      };
      const r = editing && item
        ? await api.put(`/wardrobe/${item.id}`, payload)
        : await api.post('/wardrobe', payload);
      trackEvent(editing ? 'wardrobe_item_updated' : 'wardrobe_item_added', { category });
      await onSaved(r.data);
    } catch (e: unknown) {
      setErr(getApiErrorMessage(e, 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  const cleanBackground = async () => {
    if (!imageBase64 || !imageBase64.startsWith('data:')) {
      setErr('Choose a new photo before cleaning the background');
      return;
    }
    setErr(null);
    setCleaning(true);
    try {
      const r = await api.post('/cutout', { image: imageBase64 });
      if (r.data?.image) setImageBase64(r.data.image);
    } catch (e: unknown) {
      setErr(getApiErrorMessage(e, 'Could not remove background'));
    } finally {
      setCleaning(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.editorContainer} keyboardShouldPersistTaps="handled">
            <View style={styles.modalHeader}>
              <View>
                <Text style={[styles.kicker, { color: c.accent }]}>{editing ? 'EDIT ITEM' : 'NEW ITEM'}</Text>
                <Text style={[styles.h1, { color: c.textPrimary }]}>{editing ? 'Details' : 'Add item'}</Text>
              </View>
              <Pressable testID="add-modal-close" onPress={onClose} style={[styles.iconBtn, { borderColor: c.borderSubtle }]}>
                <Ionicons name="close" size={20} color={c.textPrimary} />
              </Pressable>
            </View>

            <View style={styles.photoActions}>
              <Pressable testID="pick-camera" onPress={() => pickPhoto(true)} style={[styles.photoBtn, { borderColor: c.borderActive }]}>
                <Ionicons name="camera-outline" size={18} color={c.textPrimary} />
                <Text style={{ color: c.textPrimary, marginLeft: 8 }}>Camera</Text>
              </Pressable>
              <Pressable testID="pick-library" onPress={() => pickPhoto(false)} style={[styles.photoBtn, { borderColor: c.borderActive }]}>
                <Ionicons name="image-outline" size={18} color={c.textPrimary} />
                <Text style={{ color: c.textPrimary, marginLeft: 8 }}>Library</Text>
              </Pressable>
            </View>

            <View style={[styles.preview, { backgroundColor: c.surface, borderColor: c.borderSubtle }]}>
              {imageBase64 ? (
                <Image
                  source={{ uri: resolveApiAssetUrl(imageBase64) }}
                  style={styles.previewImg}
                  contentFit="contain"
                />
              ) : (
                <Ionicons name={CATEGORY_META[category].icon as keyof typeof Ionicons.glyphMap} size={34} color={CATEGORY_META[category].color} />
              )}
            </View>

            <Pressable
              onPress={cleanBackground}
              disabled={!imageBase64.startsWith('data:') || cleaning}
              style={[styles.cleanBtn, { borderColor: c.borderActive, opacity: !imageBase64.startsWith('data:') ? 0.45 : 1 }]}
            >
              {cleaning ? (
                <ActivityIndicator color={c.textPrimary} />
              ) : (
                <>
                  <Ionicons name="cut-outline" size={16} color={c.textPrimary} />
                  <Text style={{ color: c.textPrimary, fontSize: 12, fontWeight: '800' }}>Remove background</Text>
                </>
              )}
            </Pressable>

            <Pressable
              onPress={() => setAutoClean((current) => !current)}
              style={[styles.autoCleanRow, { borderColor: autoClean ? c.accent : c.borderSubtle, backgroundColor: c.surface }]}
            >
              <Ionicons
                name={autoClean ? 'checkbox-outline' : 'square-outline'}
                size={18}
                color={autoClean ? c.accent : c.textTertiary}
              />
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.textPrimary, fontSize: 13, fontWeight: '800' }}>Auto clean on save</Text>
                <Text style={{ color: c.textTertiary, fontSize: 11, marginTop: 2 }}>
                  Keeps product-style photos optional if the cutout misses.
                </Text>
              </View>
            </Pressable>

            <Text style={[styles.label, { color: c.textTertiary }]}>NAME</Text>
            <TextInput
              testID="item-name-input"
              value={name}
              onChangeText={(value) => {
                setName(value);
                if (!editing && !categoryTouched) {
                  const inferred = inferCategoryFromName(value);
                  if (inferred) setCategory(inferred);
                }
              }}
              placeholder="Black tee"
              placeholderTextColor={c.textTertiary}
              style={[styles.input, { color: c.textPrimary, borderBottomColor: c.borderActive }]}
            />

            <Text style={[styles.label, { color: c.textTertiary }]}>TYPE</Text>
            <View style={styles.categoryPicker}>
              {CATEGORY_ORDER.map((cat) => {
                const meta = CATEGORY_META[cat];
                const active = category === cat;
                return (
                  <Pressable
                    testID={`cat-${cat}`}
                    key={cat}
                    onPress={() => {
                      setCategory(cat);
                      setCategoryTouched(true);
                    }}
                    style={[
                      styles.categoryOption,
                      {
                        borderColor: active ? meta.color : c.borderSubtle,
                        backgroundColor: active ? meta.soft : c.surface,
                      },
                    ]}
                  >
                    <Ionicons name={meta.icon as keyof typeof Ionicons.glyphMap} size={20} color={meta.color} />
                    <Text style={{ color: active ? meta.color : c.textSecondary, fontSize: 12, fontWeight: '800' }}>
                      {meta.short}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.label, { color: c.textTertiary }]}>TAGS</Text>
            <View style={styles.tagBank}>
              {TAG_PRESETS.map((tag) => {
                const active = selectedTags.includes(tag);
                return (
                  <Pressable
                    key={tag}
                    onPress={() => toggleTag(tag)}
                    style={[
                      styles.tagChip,
                      {
                        borderColor: active ? c.accent : c.borderSubtle,
                        backgroundColor: active ? c.accent : 'transparent',
                      },
                    ]}
                  >
                    <Text style={{ color: active ? c.bg : c.textSecondary, fontSize: 11, fontWeight: '700' }}>
                      #{tag}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <TextInput
              testID="item-tags-input"
              value={tagsText}
              onChangeText={setTagsText}
              placeholder="custom tags"
              placeholderTextColor={c.textTertiary}
              autoCapitalize="none"
              style={[styles.input, { color: c.textPrimary, borderBottomColor: c.borderActive, marginTop: 10 }]}
            />

            <Text style={[styles.label, { color: c.textTertiary }]}>WEIGHT KG</Text>
            <TextInput
              testID="item-weight-input"
              value={weight}
              onChangeText={setWeight}
              keyboardType="decimal-pad"
              style={[styles.input, { color: c.textPrimary, borderBottomColor: c.borderActive }]}
            />

            {err ? <Text style={{ color: c.error, marginTop: 12 }}>{err}</Text> : null}

            <Pressable
              testID="save-item-button"
              onPress={onSave}
              disabled={saving}
              style={({ pressed }) => [
                styles.saveBtn,
                { backgroundColor: c.accent, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              {saving ? (
                <ActivityIndicator color={c.bg} />
              ) : (
                <Text style={{ color: c.bg, fontWeight: '800' }}>{editing ? 'Save changes' : 'Save item'}</Text>
              )}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function pickPaletteFromTags(tags: string[]): string[] {
  const map: Record<string, string> = {
    formal: '#1F2937',
    business: '#111827',
    work: '#334155',
    casual: '#9CA3AF',
    beach: '#60A5FA',
    tropical: '#10B981',
    modest: '#6B7280',
    cold: '#93C5FD',
    rain: '#64748B',
    gym: '#EF4444',
    party: '#C084FC',
    denim: '#2563EB',
    linen: '#D6C4A1',
    neutral: '#A3A3A3',
    statement: '#F59E0B',
  };
  const colors: string[] = [];
  for (const tag of tags) {
    const color = map[tag.toLowerCase().replace('#', '')];
    if (color && !colors.includes(color)) colors.push(color);
    if (colors.length >= 3) break;
  }
  return colors.length ? colors : ['#888888'];
}

function inferCategoryFromName(value: string): WardrobeCategory | null {
  const normalized = value.toLowerCase();
  if (/\b(tee|t-shirt|shirt|kurta|tunic|blouse|top|henley|tank|sweater|knit)\b/.test(normalized)) {
    return 'top';
  }
  if (/\b(pants|trouser|trousers|jeans|shorts|skirt|kilt|dhoti|lungi|chinos|bottom)\b/.test(normalized)) {
    return 'bottom';
  }
  if (/\b(jacket|coat|blazer|hoodie|shawl|hijab|kimono|abaya|cardigan|layer|overshirt)\b/.test(normalized)) {
    return 'layer';
  }
  return null;
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 16, paddingBottom: 48 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  kicker: { fontSize: 11, letterSpacing: 2, fontWeight: '700' },
  h1: { fontSize: 32, fontWeight: '800', marginTop: 4 },
  addBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  iconBtn: { width: 38, height: 38, borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 18, marginBottom: 18 },
  filterChip: { height: 34, paddingHorizontal: 11, borderRadius: 8, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  filterText: { fontSize: 11, letterSpacing: 0.8, fontWeight: '800' },
  empty: { borderWidth: 1, borderRadius: 8, padding: 32, alignItems: 'center', borderStyle: 'dashed' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' },
  card: { width: '48%', borderWidth: 1, borderRadius: 8, overflow: 'hidden', position: 'relative' },
  categoryRail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, zIndex: 2 },
  imgWrap: { aspectRatio: 0.9, alignItems: 'center', justifyContent: 'center', position: 'relative', padding: 6 },
  img: { width: '100%', height: '100%' },
  catTag: { position: 'absolute', top: 8, left: 10, borderWidth: 1, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 4 },
  catTagText: { fontSize: 9, letterSpacing: 1, fontWeight: '900' },
  editDot: { position: 'absolute', top: 8, right: 8, width: 27, height: 27, borderWidth: 1, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  cardBody: { padding: 12, gap: 8 },
  tagPreviewRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, minHeight: 18 },
  smallTag: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  swatchRow: { flexDirection: 'row', gap: 4 },
  swatch: { width: 12, height: 12, borderRadius: 6, borderWidth: 1 },
  editorContainer: { padding: 20, paddingBottom: 48 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  photoActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  photoBtn: { flex: 1, height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 8 },
  preview: { width: '100%', aspectRatio: 1, marginTop: 12, borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: 10 },
  previewImg: { width: '100%', height: '100%' },
  cleanBtn: {
    height: 42,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  autoCleanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
  },
  label: { fontSize: 11, letterSpacing: 1.4, marginBottom: 6, marginTop: 16, fontWeight: '800' },
  input: { fontSize: 16, borderBottomWidth: 1, paddingVertical: 9 },
  categoryPicker: { flexDirection: 'row', gap: 8 },
  categoryOption: { flex: 1, minHeight: 62, borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center', gap: 6 },
  tagBank: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  saveBtn: { height: 50, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: 24 },
});
