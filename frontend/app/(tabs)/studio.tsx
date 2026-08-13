import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Modal,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/theme/ThemeProvider';
import { type as t, space, radius } from '../../src/theme/tokens';
import { ScreenHeader, IconButton, Chip, CatalogCard, TextField, Button } from '../../src/components/ui';
import { useStore } from '../../src/lib/store';
import { api, getApiErrorMessage, resolveApiAssetUrl, WardrobeItem } from '../../src/lib/api';
import { trackEvent } from '../../src/lib/analytics';
import { uploadWardrobeImage } from '../../src/lib/storage';
import { downscaleToDataUri, ensureFirestoreSafeImage, cropRegionDataUri, CropRegion } from '../../src/lib/images';
import { listPrivateTemplates, deletePrivateTemplate, PrivateTemplate } from '../../src/lib/firestoreRepo';
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
  const refreshTrips = useStore((s) => s.refreshTrips);

  const [filter, setFilter] = useState<Filter>('all');
  const [showEditor, setShowEditor] = useState(false);
  const [editingItem, setEditingItem] = useState<WardrobeItem | null>(null);
  const [showBatchImport, setShowBatchImport] = useState(false);
  const [showMyTemplates, setShowMyTemplates] = useState(false);

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
            await useStore.getState().deleteWardrobe(item.id);
          } catch {}
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <ScreenHeader
          kicker="STUDIO"
          title="Wardrobe"
          right={
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <IconButton
                testID="studio-templates-button"
                icon="bookmark-outline"
                accessibilityLabel="My templates"
                onPress={() => setShowMyTemplates(true)}
              />
              <IconButton
                testID="studio-batch-button"
                icon="images-outline"
                accessibilityLabel="Add multiple photos"
                onPress={() => setShowBatchImport(true)}
              />
              <Pressable testID="studio-add-button" onPress={openNew} style={[styles.addBtn, { backgroundColor: c.accent }]}>
                <Ionicons name="add" size={22} color={c.accentInk} />
              </Pressable>
            </View>
          }
        />

        <View style={styles.filterRow}>
          {(['all', ...CATEGORY_ORDER] as Filter[]).map((f) => {
            const isActive = filter === f;
            const count = f === 'all' ? wardrobe.length : wardrobe.filter((w) => w.category === f).length;
            const meta = f === 'all' ? null : CATEGORY_META[f];
            return (
              <Chip
                key={f}
                testID={`filter-${f}`}
                label={`${meta?.short || 'ALL'} ${count}`}
                icon={(meta?.icon || 'apps-outline') as keyof typeof Ionicons.glyphMap}
                active={isActive}
                onPress={() => setFilter(f)}
              />
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

      <BatchImportModal
        visible={showBatchImport}
        onClose={() => setShowBatchImport(false)}
        onItemSaved={upsertWardrobeItem}
      />

      <MyTemplatesModal visible={showMyTemplates} onClose={() => setShowMyTemplates(false)} />
    </SafeAreaView>
  );
}

// Repack flow, part 2: apply or manage the private templates saved from Lookbook's
// "Save as template" action (users/{uid}/private_templates — owner-only, never public).
function MyTemplatesModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { c } = useTheme();
  const selectedTripId = useStore((s) => s.selectedTripId);
  const applyTemplateToTrip = useStore((s) => s.applyTemplateToTrip);
  const [templates, setTemplates] = useState<PrivateTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    const uid = useStore.getState().user?.id;
    if (!uid) return;
    setLoading(true);
    listPrivateTemplates(uid)
      .then(setTemplates)
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false));
  }, [visible]);

  const onApply = async (tpl: PrivateTemplate) => {
    if (!selectedTripId) {
      Alert.alert('No trip selected', 'Create or select a trip first.');
      return;
    }
    setApplyingId(tpl.id);
    try {
      await applyTemplateToTrip(selectedTripId, tpl.items);
      onClose();
      Alert.alert('Applied', `${tpl.name} loaded into your grid.`);
    } catch (e: unknown) {
      Alert.alert('Could not apply template', getApiErrorMessage(e, 'Try again'));
    } finally {
      setApplyingId(null);
    }
  };

  const onDelete = (tpl: PrivateTemplate) => {
    Alert.alert('Delete template?', tpl.name, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const uid = useStore.getState().user?.id;
          if (!uid) return;
          await deletePrivateTemplate(uid, tpl.id).catch(() => {});
          setTemplates((prev) => prev.filter((x) => x.id !== tpl.id));
        },
      },
    ]);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
        <View style={[styles.editorContainer, { flex: 1 }]}>
          <ScreenHeader
            kicker="REPACK"
            title="My templates"
            right={<IconButton icon="close" accessibilityLabel="Close" onPress={onClose} />}
          />

          {loading ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color={c.accent} />
            </View>
          ) : templates.length === 0 ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.xl }}>
              <Ionicons name="bookmark-outline" size={32} color={c.textTertiary} />
              <Text style={[t.body, { color: c.textSecondary, textAlign: 'center' }]}>
                Save a completed grid as a template from the Lookbook screen after a trip ends.
              </Text>
            </View>
          ) : (
            <View style={{ gap: space.sm, marginTop: space.lg }}>
              {templates.map((tpl) => (
                <View key={tpl.id} style={[styles.templateRow, { borderColor: c.borderSubtle, backgroundColor: c.elevated }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[t.title, { color: c.textPrimary }]}>{tpl.name}</Text>
                    <Text style={[t.micro, { color: c.textTertiary, marginTop: 2 }]}>{tpl.items.length} items</Text>
                  </View>
                  <Button
                    title="Apply"
                    onPress={() => onApply(tpl)}
                    loading={applyingId === tpl.id}
                    disabled={applyingId != null}
                  />
                  <Pressable onPress={() => onDelete(tpl)} hitSlop={8} style={{ marginLeft: space.sm }}>
                    <Ionicons name="trash-outline" size={18} color={c.textTertiary} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

// Museum-catalog card per the v2 design system: plate + name + monochrome meta.
// Category colour is retired here — only the physical garment's own colours (swatches) remain.
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
    <Pressable testID={`wardrobe-item-${item.id}`} onLongPress={onLong} style={styles.card}>
      <CatalogCard
        name={item.name}
        meta={`${meta.short} · ${Number(item.weight_kg || 0).toFixed(1)} kg`}
        onPress={onPress}
        image={
          item.image ? (
            <Image source={{ uri: resolveApiAssetUrl(item.image) }} style={styles.img} contentFit="contain" />
          ) : (
            <Ionicons name={meta.icon as keyof typeof Ionicons.glyphMap} size={34} color={c.textTertiary} />
          )
        }
      />
      {(item.colors || []).length > 0 || (item.tags || []).length > 0 ? (
        <View style={styles.metaRow}>
          <View style={styles.swatchRow}>
            {(item.colors || []).slice(0, 3).map((col, i) => (
              <View key={`${col}-${i}`} style={[styles.swatch, { backgroundColor: col, borderColor: c.borderSubtle }]} />
            ))}
          </View>
          {item.tags?.[0] ? <Text style={[t.micro, { color: c.textTertiary }]}>#{item.tags[0]}</Text> : null}
        </View>
      ) : null}
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
      quality: 0.9,
      allowsEditing: true,
      aspect: [1, 1],
    };

    const applyAsset = async (asset: ImagePicker.ImagePickerAsset) => {
      try {
        // Downscale immediately: small enough to embed in Firestore,
        // and makes cutout/palette calls much faster too.
        setImageBase64(await downscaleToDataUri(asset.uri));
      } catch {
        setErr('Could not process that photo. Try another one.');
      }
    };

    if (fromCamera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        setErr('Camera permission denied');
        return;
      }
      const r = await ImagePicker.launchCameraAsync(options);
      if (!r.canceled && r.assets[0]) await applyAsset(r.assets[0]);
      return;
    }

    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setErr('Photos permission denied');
      return;
    }
    const r = await ImagePicker.launchImageLibraryAsync(options);
    if (!r.canceled && r.assets[0]) await applyAsset(r.assets[0]);
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
          const cr = await api.post('/cutout', { image: imageForSave }, { timeout: 8000 });
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
          const pr = await api.post('/palette', { image: imageForSave }, { timeout: 4000 });
          if (pr.data?.colors?.length) palette = pr.data.colors;
        } catch {
          palette = pickPaletteFromTags(tags);
        }
      }
      if (!palette.length) palette = pickPaletteFromTags(tags);

      let image = imageForSave;
      if (imageForSave.startsWith('data:') && imageChanged) {
        const uid = useStore.getState().user?.id;
        if (!uid) throw new Error('Not signed in');
        try {
          image = await uploadWardrobeImage(uid, imageForSave);
        } catch {
          // Spark plan (no Cloud Storage): embed the downscaled image
          // directly in the Firestore document instead.
          image = await ensureFirestoreSafeImage(imageForSave);
        }
      }

      const payload = {
        name: cleanName,
        category,
        image,
        colors: palette,
        weight_kg: parseFloat(weight) || 0.3,
        tags,
      };
      const saved = await useStore
        .getState()
        .saveWardrobe(payload, editing && item ? item.id : undefined);
      trackEvent(editing ? 'wardrobe_item_updated' : 'wardrobe_item_added', { category });
      await onSaved(saved);
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
            <ScreenHeader
              kicker={editing ? 'EDIT ITEM' : 'NEW ITEM'}
              title={editing ? 'Details' : 'Add item'}
              right={<IconButton testID="add-modal-close" icon="close" accessibilityLabel="Close" onPress={onClose} />}
            />

            <View style={styles.photoActions}>
              <Button testID="pick-camera" title="Camera" icon="camera-outline" variant="secondary" onPress={() => pickPhoto(true)} style={{ flex: 1 }} />
              <Button testID="pick-library" title="Library" icon="image-outline" variant="secondary" onPress={() => pickPhoto(false)} style={{ flex: 1 }} />
            </View>

            <View style={[styles.preview, { backgroundColor: c.surface, borderColor: c.borderSubtle }]}>
              {imageBase64 ? (
                <Image
                  source={{ uri: resolveApiAssetUrl(imageBase64) }}
                  style={styles.previewImg}
                  contentFit="contain"
                />
              ) : (
                <Ionicons name={CATEGORY_META[category].icon as keyof typeof Ionicons.glyphMap} size={34} color={c.textTertiary} />
              )}
            </View>

            <Button
              title="Remove background"
              icon="cut-outline"
              variant="secondary"
              onPress={cleanBackground}
              disabled={!imageBase64.startsWith('data:')}
              loading={cleaning}
              style={{ marginTop: space.sm }}
            />

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
                <Text style={[t.title, { color: c.textPrimary }]}>Auto clean on save</Text>
                <Text style={[t.micro, { color: c.textTertiary, marginTop: 2 }]}>
                  Keeps product-style photos optional if the cutout misses.
                </Text>
              </View>
            </Pressable>

            <View style={{ marginTop: space.lg }}>
              <TextField
                testID="item-name-input"
                label="NAME"
                value={name}
                onChangeText={(value) => {
                  setName(value);
                  if (!editing && !categoryTouched) {
                    const inferred = inferCategoryFromName(value);
                    if (inferred) setCategory(inferred);
                  }
                }}
                placeholder="Black tee"
              />
            </View>

            <Text style={[t.kicker, { color: c.textTertiary, marginTop: space.lg, marginBottom: space.sm }]}>TYPE</Text>
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
                        borderColor: active ? c.accent : c.borderSubtle,
                        backgroundColor: active ? c.accentSoft : c.surface,
                      },
                    ]}
                  >
                    <Ionicons name={meta.icon as keyof typeof Ionicons.glyphMap} size={20} color={active ? c.accent : c.textTertiary} />
                    <Text style={[t.label, { color: active ? c.textPrimary : c.textSecondary }]}>
                      {meta.short}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[t.kicker, { color: c.textTertiary, marginTop: space.lg, marginBottom: space.sm }]}>TAGS</Text>
            <View style={styles.tagBank}>
              {TAG_PRESETS.map((tag) => (
                <Chip key={tag} label={`#${tag}`} active={selectedTags.includes(tag)} onPress={() => toggleTag(tag)} />
              ))}
            </View>

            <View style={{ marginTop: space.md }}>
              <TextField
                testID="item-tags-input"
                value={tagsText}
                onChangeText={setTagsText}
                placeholder="custom tags"
                autoCapitalize="none"
              />
            </View>

            <View style={{ marginTop: space.lg }}>
              <TextField
                testID="item-weight-input"
                label="WEIGHT KG"
                value={weight}
                onChangeText={setWeight}
                keyboardType="decimal-pad"
              />
            </View>

            {err ? <Text style={[t.micro, { color: c.error, marginTop: 12 }]}>{err}</Text> : null}

            <Button
              testID="save-item-button"
              title={editing ? 'Save changes' : 'Save item'}
              onPress={onSave}
              loading={saving}
              style={{ marginTop: space.xl }}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// Batch import: multi-select → downscale → one-tap category triage.
// Deliberately skips cutout/palette calls (those are per-item polish via the
// normal editor) so N photos don't block on N sequential network round-trips.
function BatchImportModal({
  visible,
  onClose,
  onItemSaved,
}: {
  visible: boolean;
  onClose: () => void;
  onItemSaved: (item: WardrobeItem) => void;
}) {
  const { c } = useTheme();
  const [phase, setPhase] = useState<'pick' | 'preparing' | 'triage' | 'done'>('pick');
  const [queue, setQueue] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [savedCount, setSavedCount] = useState(0);
  const [savedByCategory, setSavedByCategory] = useState<Record<WardrobeCategory, number>>({
    top: 0,
    bottom: 0,
    layer: 0,
  });
  const [saving, setSaving] = useState<WardrobeCategory | null>(null);
  const [cropping, setCropping] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setPhase('pick');
    setQueue([]);
    setIndex(0);
    setSavedCount(0);
    setSavedByCategory({ top: 0, bottom: 0, layer: 0 });
    setErr(null);
  }, [visible]);

  const pickPhotos = async () => {
    setErr(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setErr('Photos permission denied');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      quality: 0.9,
      allowsMultipleSelection: true,
      selectionLimit: 0,
    });
    if (result.canceled || !result.assets.length) return;

    setPhase('preparing');
    try {
      const dataUris = await Promise.all(result.assets.map((a) => downscaleToDataUri(a.uri)));
      setQueue(dataUris);
      setIndex(0);
      setPhase('triage');
    } catch {
      setErr('Could not process one or more photos. Try again.');
      setPhase('pick');
    }
  };

  const advance = () => {
    if (index + 1 >= queue.length) setPhase('done');
    else setIndex((i) => i + 1);
  };

  // A photo showing several garments (a catalog screenshot, a flat-lay) would
  // otherwise become a single mislabeled wardrobe item — this is the guardrail.
  const crop = async (region: CropRegion) => {
    setCropping(true);
    setErr(null);
    try {
      const cropped = await cropRegionDataUri(queue[index], region);
      setQueue((prev) => prev.map((uri, i) => (i === index ? cropped : uri)));
    } catch {
      setErr('Could not crop this photo. You can still continue with the full image.');
    } finally {
      setCropping(false);
    }
  };

  const assign = async (category: WardrobeCategory) => {
    const dataUri = queue[index];
    setSaving(category);
    setErr(null);
    try {
      const uid = useStore.getState().user?.id;
      if (!uid) throw new Error('Not signed in');
      let image = dataUri;
      try {
        image = await uploadWardrobeImage(uid, dataUri);
      } catch {
        image = await ensureFirestoreSafeImage(dataUri);
      }
      const label = `New ${category}`;
      const count = savedByCategory[category] + 1;
      const saved = await useStore.getState().saveWardrobe({
        name: count > 1 ? `${label} ${count}` : label,
        category,
        image,
        colors: [],
        weight_kg: 0.3,
        tags: [],
      });
      onItemSaved(saved);
      setSavedByCategory((prev) => ({ ...prev, [category]: count }));
      setSavedCount((n) => n + 1);
      trackEvent('wardrobe_item_added', { category, source: 'batch_import' });
      advance();
    } catch (e: unknown) {
      setErr(getApiErrorMessage(e, 'Could not save this item'));
    } finally {
      setSaving(null);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
        <View style={[styles.editorContainer, { flex: 1 }]}>
          <ScreenHeader
            kicker="BATCH IMPORT"
            title={phase === 'triage' ? 'Assign category' : 'Add multiple items'}
            subtitle={phase === 'triage' ? `${index + 1} of ${queue.length}` : undefined}
            right={<IconButton icon="close" accessibilityLabel="Close" onPress={onClose} />}
          />

          {phase === 'pick' ? (
            <View style={{ marginTop: space.xxl, gap: space.md }}>
              <Text style={[t.body, { color: c.textSecondary }]}>
                Select several photos at once, then tap a category for each one. You can rename and
                polish them later from the wardrobe grid.
              </Text>
              <Button title="Choose photos" icon="images-outline" onPress={pickPhotos} style={{ marginTop: space.sm }} />
            </View>
          ) : null}

          {phase === 'preparing' ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color={c.accent} />
              <Text style={[t.micro, { color: c.textTertiary, marginTop: space.md }]}>Preparing photos…</Text>
            </View>
          ) : null}

          {phase === 'triage' && queue[index] ? (
            <View style={{ flex: 1 }}>
              <Text style={[t.bodySm, { color: c.textSecondary, marginTop: space.lg }]}>
                Make sure this photo shows one item — crop it first if it&apos;s a multi-item photo
                (a catalog screenshot, a flat-lay of several pieces).
              </Text>
              <View style={[styles.preview, { backgroundColor: c.surface, borderColor: c.borderSubtle, marginTop: space.md }]}>
                {cropping ? (
                  <ActivityIndicator color={c.accent} />
                ) : (
                  <Image source={{ uri: queue[index] }} style={styles.previewImg} contentFit="contain" />
                )}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md }}>
                {(['center', 'left', 'right', 'top', 'bottom'] as CropRegion[]).map((region) => (
                  <Chip
                    key={region}
                    label={region.toUpperCase()}
                    onPress={() => crop(region)}
                  />
                ))}
              </View>
              <View style={{ gap: space.sm, marginTop: space.lg }}>
                {CATEGORY_ORDER.map((cat) => (
                  <Button
                    key={cat}
                    title={CATEGORY_META[cat].short}
                    icon={CATEGORY_META[cat].icon as keyof typeof Ionicons.glyphMap}
                    onPress={() => assign(cat)}
                    loading={saving === cat}
                    disabled={saving != null || cropping}
                  />
                ))}
                <Button title="Skip this photo" variant="ghost" onPress={advance} disabled={saving != null || cropping} />
              </View>
            </View>
          ) : null}

          {phase === 'done' ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md }}>
              <Ionicons name="checkmark-circle-outline" size={40} color={c.accent} />
              <Text style={[t.h2, { color: c.textPrimary }]}>
                Added {savedCount} item{savedCount === 1 ? '' : 's'}
              </Text>
              <Button title="Import more" variant="secondary" onPress={() => setPhase('pick')} />
              <Button title="Done" onPress={onClose} />
            </View>
          ) : null}

          {err ? <Text style={[t.bodySm, { color: c.error, marginTop: space.md }]}>{err}</Text> : null}
        </View>
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
  addBtn: { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.lg, marginBottom: space.lg },
  empty: { borderWidth: 1, borderRadius: radius.sharp, padding: space.xxl, alignItems: 'center', borderStyle: 'dashed' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, justifyContent: 'space-between' },
  card: { width: '48%', gap: space.xs },
  img: { width: '100%', height: '100%' },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  swatchRow: { flexDirection: 'row', gap: 4 },
  swatch: { width: 12, height: 12, borderRadius: 6, borderWidth: 1 },
  editorContainer: { padding: 20, paddingBottom: 48 },
  photoActions: { flexDirection: 'row', gap: space.sm, marginTop: space.lg },
  preview: { width: '100%', aspectRatio: 1, marginTop: space.md, borderWidth: 1, borderRadius: radius.sharp, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: 10 },
  previewImg: { width: '100%', height: '100%' },
  autoCleanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: 1,
    borderRadius: radius.sharp,
    padding: space.md,
    marginTop: space.sm,
  },
  categoryPicker: { flexDirection: 'row', gap: space.sm },
  categoryOption: { flex: 1, minHeight: 62, borderWidth: 1, borderRadius: radius.sharp, alignItems: 'center', justifyContent: 'center', gap: space.xs },
  tagBank: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  templateRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radius.sharp, padding: space.md },
});
