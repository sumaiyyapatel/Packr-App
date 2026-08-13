import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  Pressable,
  Modal,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useStore } from '../../src/lib/store';
import { api, getApiErrorMessage, OutfitSuggestion, resolveApiAssetUrl, Trip, WardrobeItem } from '../../src/lib/api';
import { scoreOutfitSuggestions, computeWearInsights, WearInsight } from '../../src/lib/tripLogic';
import { publishTemplate, savePrivateTemplate, listPastTripReflections, ReflectionRecord } from '../../src/lib/firestoreRepo';
import { CalendarPlanner } from '../../src/components/CalendarPlanner';
import { generate27Outfits, isGridComplete, suggestOccasion, Outfit } from '../../src/lib/sudoku';
import { CATEGORY_META } from '../../src/lib/wardrobeMeta';

const OCCASIONS = ['All', 'Favorites', 'Casual', 'Formal', 'Travel', 'Active', 'Modest'];

export default function Lookbook() {
  const { c } = useTheme();
  const router = useRouter();
  const trips = useStore((s) => s.trips);
  const wardrobe = useStore((s) => s.wardrobe);
  const selectedTripId = useStore((s) => s.selectedTripId);
  const toggleFavoriteRemote = useStore((s) => s.toggleFavorite);
  const tagOccasionRemote = useStore((s) => s.tagOccasion);
  const planOutfitRemote = useStore((s) => s.planOutfit);
  const trip = trips.find((t) => t.id === selectedTripId) || trips[0];
  const [filter, setFilter] = useState<string>('All');
  const [suggestions, setSuggestions] = useState<OutfitSuggestion[]>([]);
  const [suggestionDate, setSuggestionDate] = useState<string | null>(null);
  const [lastReflection, setLastReflection] = useState<ReflectionRecord | null>(null);
  const [showRepack, setShowRepack] = useState(false);
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [showReflection, setShowReflection] = useState(false);

  const itemsById = useMemo(() => {
    const map: Record<string, WardrobeItem> = {};
    for (const item of wardrobe) map[item.id] = item;
    return map;
  }, [wardrobe]);

  const outfits = useMemo(() => (trip ? generate27Outfits(trip.grid) : []), [trip]);

  const tagged = useMemo(() => {
    return outfits.map((outfit) => {
      const legacyIndexKey = String(outfit.index);
      const occasion =
        trip?.occasion_tags?.[outfit.key] ||
        trip?.occasion_tags?.[legacyIndexKey] ||
        suggestOccasion(outfit, itemsById);
      const isFav =
        trip?.favorites?.includes(outfit.key) || trip?.favorites?.includes(outfit.index) || false;
      return { ...outfit, occasion, isFav };
    });
  }, [outfits, trip, itemsById]);

  const filtered = tagged.filter((outfit) => {
    if (filter === 'All') return true;
    if (filter === 'Favorites') return outfit.isFav;
    return outfit.occasion === filter;
  });

  const tripDates = useMemo(
    () => (trip ? dateRange(trip.start_date, trip.end_date) : []),
    [trip]
  );

  useEffect(() => {
    if (!tripDates.length) return;
    setSuggestionDate((current) => current && tripDates.includes(current) ? current : tripDates[0]);
  }, [tripDates]);

  useEffect(() => {
    if (!trip || !suggestionDate || !isGridComplete(trip.grid)) {
      setSuggestions([]);
      return;
    }
    try {
      setSuggestions(
        scoreOutfitSuggestions(
          trip,
          itemsById,
          suggestionDate,
          filter !== 'All' && filter !== 'Favorites' ? filter : undefined
        )
      );
    } catch {
      setSuggestions([]);
    }
  }, [trip, suggestionDate, filter, itemsById]);

  useEffect(() => {
    if (!trip) {
      setLastReflection(null);
      return;
    }
    const tripEndedCheck = new Date(`${trip.end_date}T23:59:59`).getTime() < Date.now();
    if (!tripEndedCheck) {
      setLastReflection(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const uid = useStore.getState().user?.id;
      if (!uid) return;
      try {
        const { byTripId } = await listPastTripReflections(uid, [trip]);
        const records = byTripId[trip.id];
        if (!cancelled) setLastReflection(records?.[records.length - 1] ?? null);
      } catch {
        if (!cancelled) setLastReflection(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id, trip?.end_date]);

  const toggleFav = async (outfit: Outfit & { isFav: boolean }) => {
    if (!trip) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      await toggleFavoriteRemote(trip.id, outfit.key, !outfit.isFav);
    } catch {}
  };

  const setOccasion = async (outfit: Outfit) => {
    if (!trip) return;
    Alert.alert(
      'Set occasion',
      undefined,
      OCCASIONS.filter((occasion) => occasion !== 'All' && occasion !== 'Favorites').map((occasion) => ({
        text: occasion,
        onPress: async () => {
          try {
            await tagOccasionRemote(trip.id, outfit.key, occasion);
          } catch {}
        },
      }))
    );
  };

  const assignOutfitDay = async (outfit: Outfit) => {
    const day = suggestionDate || tripDates[0];
    if (!trip || !day) return;
    try {
      await planOutfitRemote(trip.id, day, outfit.key);
    } catch (e: unknown) {
      Alert.alert('Plan failed', getApiErrorMessage(e, 'Could not plan outfit'));
    }
  };

  // Worn outfit-keys still come from what was actually planned/favorited
  // (that's the strongest signal Packr has for *which combination* was
  // worn); "unused" starts from the same heuristic but the reflection
  // modal lets the user correct it item-by-item before saving.
  const reflectionDefaults = useMemo(() => {
    if (!trip) return { wornOutfitKeys: [] as string[], defaultUnusedIds: new Set<string>() };
    const planned = Object.values(trip.outfit_plan || {});
    const favoriteKeys = (trip.favorites || []).filter(
      (item): item is string => typeof item === 'string' && item.includes('|')
    );
    const wornOutfitKeys = planned.length ? planned : favoriteKeys;
    const used = new Set(wornOutfitKeys.flatMap((key) => key.split('|')));
    const defaultUnusedIds = new Set(trip.grid.filter((id): id is string => Boolean(id && !used.has(id))));
    return { wornOutfitKeys, defaultUnusedIds };
  }, [trip]);

  if (!trip) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Text style={{ color: c.textSecondary }}>Create a trip first.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const complete = isGridComplete(trip.grid);
  const tripEnded = new Date(`${trip.end_date}T23:59:59`).getTime() < Date.now();

  const handlePublishTemplate = async () => {
    if (!complete) return;
    const items = trip.grid
      .map((id) => (id ? itemsById[id] : null))
      .filter(Boolean)
      .map((item) => ({
        name: item!.name,
        category: item!.category,
        colors: item!.colors,
        tags: item!.tags,
        image: item!.image,
      }));

    try {
      const uid = useStore.getState().user?.id;
      if (!uid) throw new Error('Not signed in');
      await publishTemplate(uid, {
        title: `${trip.destination} Packing Grid`,
        description: `Community grid for ${trip.destination}.`,
        destination: trip.destination,
        days: tripDays(trip.start_date, trip.end_date),
        season: 'Custom',
        climate: 'mild',
        items,
      });
      Alert.alert('Published', 'Template shared with the community.');
    } catch (e: unknown) {
      Alert.alert('Publish failed', getApiErrorMessage(e, 'Could not publish template'));
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <View style={{ padding: 24, paddingBottom: 8 }}>
        <Text style={[styles.kicker, { color: c.accentText }]}>OUTFITS</Text>
        <Text style={[styles.h1, { color: c.textPrimary }]}>27 outfits</Text>
        <Text style={{ color: c.textTertiary, fontSize: 12, marginTop: 4 }}>{trip.destination}</Text>
      </View>

      {!complete ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Ionicons name="grid-outline" size={36} color={c.textTertiary} />
          <Text style={{ color: c.textSecondary, textAlign: 'center', marginTop: 12 }}>
            Fill the 3x3 Grid first to generate 27 outfits.
          </Text>
        </View>
      ) : (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 24, gap: 8 }}
            style={{ flexGrow: 0 }}
          >
            {OCCASIONS.map((occasion) => {
              const active = filter === occasion;
              return (
                <Pressable
                  testID={`filter-${occasion}`}
                  key={occasion}
                  onPress={() => setFilter(occasion)}
                  style={[
                    styles.chip,
                    {
                      borderColor: active ? c.accent : c.borderSubtle,
                      backgroundColor: active ? c.accent : 'transparent',
                    },
                  ]}
                >
                  <Text style={{ color: active ? c.bg : c.textSecondary, fontSize: 11, letterSpacing: 1, fontWeight: '600' }}>
                    {occasion.toUpperCase()}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={{ paddingHorizontal: 24, paddingTop: 12 }}>
            <Pressable
              testID="publish-template-button"
              onPress={handlePublishTemplate}
              style={[styles.publishBtn, { borderColor: c.borderActive }]}
            >
              <Ionicons name="cloud-upload-outline" size={16} color={c.textPrimary} />
              <Text style={{ color: c.textPrimary, fontSize: 12, letterSpacing: 1, fontWeight: '600' }}>
                PUBLISH TEMPLATE
              </Text>
            </Pressable>
          </View>

          <View style={{ paddingHorizontal: 24, paddingTop: 14 }}>
            <Text style={[styles.ribbonLabel, { color: c.textTertiary, paddingHorizontal: 0, marginBottom: 12 }]}>
              ASSIGN OUTFIT TO DAY
            </Text>
            <CalendarPlanner
              startDate={trip.start_date}
              endDate={trip.end_date}
              selectedDate={suggestionDate}
              plannedDates={trip.outfit_plan || {}}
              onSelectDay={(date) => setSuggestionDate(date)}
            />
          </View>

          <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }} showsVerticalScrollIndicator={false}>
            {suggestions.length > 0 && (
              <View style={[styles.smartPanel, { borderColor: c.borderSubtle, backgroundColor: c.surface }]}>
                <View style={styles.smartHeader}>
                  <View>
                    <Text style={[styles.kicker, { color: c.accentText }]}>SMART PICKS</Text>
                    <Text style={{ color: c.textSecondary, fontSize: 12, marginTop: 4 }}>
                      Top 5 for {suggestionDate?.slice(5)} {filter !== 'All' && filter !== 'Favorites' ? `- ${filter}` : ''}
                    </Text>
                  </View>
                  <Ionicons name="sparkles-outline" size={18} color={c.accent} />
                </View>
                <View style={{ gap: 8, marginTop: 12 }}>
                  {suggestions.map((pick) => {
                    const outfit = tagged.find((item) => item.key === pick.outfit_key);
                    if (!outfit) return null;
                    return (
                      <Pressable
                        key={pick.outfit_key}
                        onPress={() => assignOutfitDay(outfit)}
                        style={[styles.smartRow, { borderColor: c.borderSubtle, backgroundColor: c.elevated }]}
                      >
                        <View style={[styles.scoreDot, { borderColor: c.accent }]}>
                          <Text style={{ color: c.accentText, fontSize: 11, fontWeight: '900' }}>{pick.score}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: c.textPrimary, fontSize: 13, fontWeight: '900' }}>
                            Outfit {outfit.index + 1}
                          </Text>
                          <Text style={{ color: c.textTertiary, fontSize: 11, marginTop: 2 }} numberOfLines={1}>
                            {pick.reason} - {pick.item_names.join(', ')}
                          </Text>
                        </View>
                        <Ionicons name="calendar-outline" size={16} color={c.textSecondary} />
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}

            {tripEnded && (
              <View style={[styles.reflectionPanel, { borderColor: c.borderSubtle, backgroundColor: c.surface }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.kicker, { color: c.accentText }]}>POST-TRIP</Text>
                  <Text style={{ color: c.textPrimary, fontSize: 15, fontWeight: '900', marginTop: 4 }}>
                    Record what worked
                  </Text>
                  <Text style={{ color: c.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 4 }}>
                    Saves planned or favorite outfits as worn and marks the rest for audit.
                  </Text>
                </View>
                <Pressable
                  testID="open-reflection-button"
                  onPress={() => setShowReflection(true)}
                  style={[styles.reflectionButton, { borderColor: c.accent }]}
                >
                  <Ionicons name="checkmark-circle-outline" size={15} color={c.accentText} />
                  <Text style={{ color: c.accentText, fontSize: 11, fontWeight: '900' }}>REVIEW</Text>
                </Pressable>
              </View>
            )}

            {tripEnded && (
              <View style={[styles.reflectionPanel, { borderColor: c.borderSubtle, backgroundColor: c.surface, flexWrap: 'wrap' }]}>
                <View style={{ flex: 1, minWidth: 180 }}>
                  <Text style={[styles.kicker, { color: c.accentText }]}>REPACK</Text>
                  <Text style={{ color: c.textPrimary, fontSize: 15, fontWeight: '900', marginTop: 4 }}>
                    Going back to {trip.destination}?
                  </Text>
                  {lastReflection && lastReflection.unused_item_ids.length > 0 ? (
                    <Text style={{ color: c.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 4 }}>
                      {lastReflection.unused_item_ids.length} item(s) went unused last time — a duplicate
                      trip will leave those slots empty so you can rethink them.
                    </Text>
                  ) : (
                    <Text style={{ color: c.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 4 }}>
                      Duplicate this grid into a new trip, or save it as a private template for later.
                    </Text>
                  )}
                </View>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <Pressable
                    testID="repack-duplicate-button"
                    onPress={() => setShowRepack(true)}
                    style={[styles.reflectionButton, { borderColor: c.accent }]}
                  >
                    <Ionicons name="copy-outline" size={15} color={c.accentText} />
                    <Text style={{ color: c.accentText, fontSize: 11, fontWeight: '900' }}>DUPLICATE</Text>
                  </Pressable>
                  <Pressable
                    testID="repack-save-template-button"
                    onPress={() => setShowSaveTemplate(true)}
                    disabled={!complete}
                    style={[styles.reflectionButton, { borderColor: c.borderActive, opacity: complete ? 1 : 0.4 }]}
                  >
                    <Ionicons name="bookmark-outline" size={15} color={c.textPrimary} />
                    <Text style={{ color: c.textPrimary, fontSize: 11, fontWeight: '900' }}>SAVE TEMPLATE</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {filtered.length === 0 && (
              <Text style={{ color: c.textTertiary, textAlign: 'center', marginTop: 24 }}>
                No outfits match this filter.
              </Text>
            )}
            {filtered.map((outfit) => (
              <OutfitCard
                key={outfit.key}
                outfit={outfit}
                itemsById={itemsById}
                isFav={outfit.isFav}
                occasion={outfit.occasion}
                onFav={() => toggleFav(outfit)}
                onSetOccasion={() => setOccasion(outfit)}
                onPlan={() => assignOutfitDay(outfit)}
                onStyleIt={() =>
                  router.push({
                    pathname: '/style-it',
                    params: { tripId: trip.id, outfitKey: outfit.key, occasion: outfit.occasion },
                  })
                }
                plannedDates={tripDates.filter((day) => trip.outfit_plan?.[day] === outfit.key)}
                selectedDateLabel={suggestionDate ? `PLAN DAY ${tripDates.indexOf(suggestionDate) + 1}` : 'PLAN DAY'}
              />
            ))}
          </ScrollView>
        </>
      )}

      <RepackModal
        visible={showRepack}
        trip={trip}
        excludeItemIds={lastReflection?.unused_item_ids || []}
        onClose={() => setShowRepack(false)}
        onDone={(newTripId) => {
          setShowRepack(false);
          useStore.getState().setSelectedTrip(newTripId);
          router.push('/(tabs)/grid');
        }}
      />
      <SaveTemplateModal
        visible={showSaveTemplate}
        trip={trip}
        itemsById={itemsById}
        onClose={() => setShowSaveTemplate(false)}
      />
      <ReflectionModal
        visible={showReflection}
        trip={trip}
        itemsById={itemsById}
        defaults={reflectionDefaults}
        onClose={() => setShowReflection(false)}
        onSaved={() => setShowReflection(false)}
      />
    </SafeAreaView>
  );
}

// "15 · Post-trip" — a per-item worn/unworn questionnaire rather than a
// single auto-save button, so the wear-count insight shown on the dashboard
// (packed N trips, worn once) reflects what the traveler actually says
// happened instead of just the plan/favorites heuristic.
function ReflectionModal({
  visible,
  trip,
  itemsById,
  defaults,
  onClose,
  onSaved,
}: {
  visible: boolean;
  trip: Trip;
  itemsById: Record<string, WardrobeItem>;
  defaults: { wornOutfitKeys: string[]; defaultUnusedIds: Set<string> };
  onClose: () => void;
  onSaved: () => void;
}) {
  const { c } = useTheme();
  const saveReflectionRemote = useStore((s) => s.saveReflection);
  const [unworn, setUnworn] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [insight, setInsight] = useState<WearInsight | null>(null);

  const gridItems = useMemo(
    () => trip.grid.filter((id): id is string => Boolean(id && itemsById[id])),
    [trip.grid, itemsById]
  );

  useEffect(() => {
    if (!visible) return;
    setUnworn(new Set(defaults.defaultUnusedIds));
    setInsight(null);
    (async () => {
      const uid = useStore.getState().user?.id;
      if (!uid) return;
      try {
        const { byTripId } = await listPastTripReflections(uid, useStore.getState().trips);
        const insights = computeWearInsights(useStore.getState().trips, itemsById, byTripId);
        const relevant = insights.find((i) => gridItems.includes(i.itemId));
        setInsight(relevant || insights[0] || null);
      } catch {
        setInsight(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const toggle = (id: string) => {
    Haptics.selectionAsync().catch(() => {});
    setUnworn((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onSave = async () => {
    setSaving(true);
    try {
      await saveReflectionRemote(trip.id, defaults.wornOutfitKeys, [...unworn]);
      Alert.alert('Reflection saved', 'This trip is reflected in your wear insights.');
      onSaved();
    } catch (e: unknown) {
      Alert.alert('Reflection failed', getApiErrorMessage(e, 'Could not save reflection'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={saving ? undefined : onClose} />
        <View style={[styles.modalCard, { backgroundColor: c.bg, borderColor: c.borderSubtle }]}>
          <Text style={{ color: c.accentText, fontSize: 11, letterSpacing: 2, fontWeight: '700' }}>
            WELCOME BACK
          </Text>
          <Text style={{ color: c.textPrimary, fontSize: 26, fontWeight: '800', marginTop: 4 }}>
            How did {trip.destination.split(',')[0]} go?
          </Text>
          <Text style={{ color: c.textTertiary, fontSize: 11, marginTop: 4 }}>
            30-second review — improves your next pack
          </Text>

          <Text style={{ color: c.textPrimary, fontSize: 18, fontWeight: '700', marginTop: 20, marginBottom: 10 }}>
            Which pieces never left the bag?
          </Text>

          <ScrollView style={{ maxHeight: 260 }} contentContainerStyle={{ gap: 8 }}>
            {gridItems.map((id) => {
              const item = itemsById[id];
              const isUnworn = unworn.has(id);
              return (
                <Pressable
                  key={id}
                  testID={`reflection-row-${id}`}
                  onPress={() => toggle(id)}
                  style={[styles.reflectionRow, { backgroundColor: c.accentSoft }]}
                >
                  <View style={[styles.reflectionPlate, { backgroundColor: c.plate }]}>
                    {item.image ? (
                      <Image
                        source={{ uri: resolveApiAssetUrl(item.image) }}
                        style={{ width: '100%', height: '100%' }}
                        contentFit="cover"
                      />
                    ) : null}
                  </View>
                  <Text style={{ color: c.textPrimary, fontSize: 13, fontWeight: '500', flex: 1 }} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text
                    style={{
                      color: isUnworn ? c.error : c.textSecondary,
                      fontSize: 11,
                      letterSpacing: 2,
                      fontWeight: '600',
                    }}
                  >
                    {isUnworn ? 'UNWORN' : 'WORN'}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {insight && (
            <View style={[styles.insightBox, { backgroundColor: c.surface }]}>
              <Text style={{ color: c.accentText, fontSize: 11, letterSpacing: 2, fontWeight: '700' }}>
                PATTERN SPOTTED
              </Text>
              <Text style={{ color: c.textSecondary, fontSize: 11, marginTop: 4 }}>
                {`${insight.itemName} has travelled ${insight.packedTrips} trip${insight.packedTrips === 1 ? '' : 's'} and been worn ${insight.wornTrips === 0 ? 'never' : `${insight.wornTrips}×`}.`}
              </Text>
            </View>
          )}

          <View style={{ height: 16 }} />
          <Pressable
            testID="save-reflection-button"
            onPress={onSave}
            disabled={saving}
            style={[styles.modalBtn, { backgroundColor: c.accent, opacity: saving ? 0.6 : 1 }]}
          >
            {saving ? <ActivityIndicator color={c.accentInk} /> : <Text style={{ color: c.accentInk, fontWeight: '700' }}>Save reflection</Text>}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function RepackModal({
  visible,
  trip,
  excludeItemIds,
  onClose,
  onDone,
}: {
  visible: boolean;
  trip: Trip;
  excludeItemIds: string[];
  onClose: () => void;
  onDone: (newTripId: string) => void;
}) {
  const { c } = useTheme();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setStartDate('');
    setEndDate('');
    setErr(null);
  }, [visible]);

  const onCreate = async () => {
    setErr(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return setErr('Start date must be YYYY-MM-DD');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return setErr('End date must be YYYY-MM-DD');
    if (endDate < startDate) return setErr('End must be after start');
    setSaving(true);
    try {
      const excluded = new Set(excludeItemIds);
      const grid = trip.grid.map((id) => (id && !excluded.has(id) ? id : null));
      const newTrip = await useStore.getState().createNewTrip({
        destination: trip.destination,
        start_date: startDate,
        end_date: endDate,
        latitude: trip.latitude,
        longitude: trip.longitude,
      });
      await useStore.getState().saveGrid(newTrip.id, grid);
      onDone(newTrip.id);
    } catch (e: unknown) {
      setErr(getApiErrorMessage(e, 'Could not duplicate trip'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={saving ? undefined : onClose} />
        <View style={[styles.modalCard, { backgroundColor: c.surface, borderColor: c.borderSubtle }]}>
          <Text style={{ color: c.textPrimary, fontSize: 20, fontWeight: '800' }}>New dates for {trip.destination}</Text>
          <Text style={{ color: c.textTertiary, fontSize: 12, marginTop: 4 }}>
            Copies the grid{excludeItemIds.length ? `, skipping ${excludeItemIds.length} unused item(s)` : ''}.
          </Text>
          <Text style={[styles.modalLabel, { color: c.textTertiary }]}>START (YYYY-MM-DD)</Text>
          <TextInput
            value={startDate}
            onChangeText={setStartDate}
            placeholder="2026-09-01"
            placeholderTextColor={c.textTertiary}
            style={[styles.modalInput, { color: c.textPrimary, borderColor: c.borderActive }]}
          />
          <Text style={[styles.modalLabel, { color: c.textTertiary }]}>END (YYYY-MM-DD)</Text>
          <TextInput
            value={endDate}
            onChangeText={setEndDate}
            placeholder="2026-09-07"
            placeholderTextColor={c.textTertiary}
            style={[styles.modalInput, { color: c.textPrimary, borderColor: c.borderActive }]}
          />
          {err ? <Text style={{ color: c.error, fontSize: 12, marginTop: 8 }}>{err}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
            <Pressable onPress={onClose} disabled={saving} style={[styles.modalBtn, { borderColor: c.borderActive, flex: 1 }]}>
              <Text style={{ color: c.textPrimary }}>Cancel</Text>
            </Pressable>
            <Pressable onPress={onCreate} disabled={saving} style={[styles.modalBtn, { backgroundColor: c.accent, flex: 1 }]}>
              {saving ? <ActivityIndicator color={c.accentInk} /> : <Text style={{ color: c.accentInk, fontWeight: '700' }}>Create trip</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SaveTemplateModal({
  visible,
  trip,
  itemsById,
  onClose,
}: {
  visible: boolean;
  trip: Trip;
  itemsById: Record<string, WardrobeItem>;
  onClose: () => void;
}) {
  const { c } = useTheme();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName(`${trip.destination} grid`);
    setErr(null);
  }, [visible, trip.destination]);

  const onSave = async () => {
    setErr(null);
    setSaving(true);
    try {
      const uid = useStore.getState().user?.id;
      if (!uid) throw new Error('Not signed in');
      const items = trip.grid
        .map((id) => (id ? itemsById[id] : null))
        .filter((item): item is WardrobeItem => Boolean(item))
        .map((item) => ({ name: item.name, category: item.category, colors: item.colors, tags: item.tags, image: item.image }));
      await savePrivateTemplate(uid, name, items);
      onClose();
      Alert.alert('Saved', 'Find it under My Templates in Studio.');
    } catch (e: unknown) {
      setErr(getApiErrorMessage(e, 'Could not save template'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={saving ? undefined : onClose} />
        <View style={[styles.modalCard, { backgroundColor: c.surface, borderColor: c.borderSubtle }]}>
          <Text style={{ color: c.textPrimary, fontSize: 20, fontWeight: '800' }}>Save as template</Text>
          <Text style={[styles.modalLabel, { color: c.textTertiary }]}>NAME</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholderTextColor={c.textTertiary}
            style={[styles.modalInput, { color: c.textPrimary, borderColor: c.borderActive }]}
          />
          {err ? <Text style={{ color: c.error, fontSize: 12, marginTop: 8 }}>{err}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
            <Pressable onPress={onClose} disabled={saving} style={[styles.modalBtn, { borderColor: c.borderActive, flex: 1 }]}>
              <Text style={{ color: c.textPrimary }}>Cancel</Text>
            </Pressable>
            <Pressable onPress={onSave} disabled={saving || !name.trim()} style={[styles.modalBtn, { backgroundColor: c.accent, flex: 1 }]}>
              {saving ? <ActivityIndicator color={c.accentInk} /> : <Text style={{ color: c.accentInk, fontWeight: '700' }}>Save</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function tripDays(startDate: string, endDate: string) {
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
}

function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateRange(startDate: string, endDate: string) {
  // Pure local-date arithmetic. toISOString() here would convert local
  // midnight to UTC and shift every day back by one for UTC+ timezones.
  const days: string[] = [];
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
    days.push(formatLocalDate(new Date(t)));
  }
  return days;
}

function OutfitCard({
  outfit,
  itemsById,
  isFav,
  occasion,
  onFav,
  onSetOccasion,
  onPlan,
  onStyleIt,
  plannedDates,
  selectedDateLabel,
}: {
  outfit: Outfit;
  itemsById: Record<string, WardrobeItem>;
  isFav: boolean;
  occasion: string;
  onFav: () => void;
  onSetOccasion: () => void;
  onPlan: () => void;
  onStyleIt: () => void;
  plannedDates: string[];
  selectedDateLabel: string;
}) {
  const { c } = useTheme();
  const top = outfit.topId ? itemsById[outfit.topId] : null;
  const bottom = outfit.bottomId ? itemsById[outfit.bottomId] : null;
  const layer = outfit.layerId ? itemsById[outfit.layerId] : null;

  return (
    <View
      testID={`outfit-card-${outfit.index}`}
      style={[styles.card, { backgroundColor: c.surface, borderColor: c.borderSubtle }]}
    >
      <View style={styles.cardHeader}>
        <Text style={[styles.outfitNum, { color: c.textTertiary }]}>
          OUTFIT {String(outfit.index + 1).padStart(2, '0')}/27
        </Text>
        <Pressable testID={`fav-${outfit.index}`} onPress={onFav} style={styles.iconBtn}>
          <Ionicons name={isFav ? 'heart' : 'heart-outline'} size={20} color={isFav ? c.accent : c.textSecondary} />
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', gap: 8, padding: 12 }}>
        {[top, bottom, layer].map((item, index) => {
          const category = (['top', 'bottom', 'layer'] as const)[index];
          const meta = CATEGORY_META[category];
          return (
          <View key={category} style={[styles.outfitSlot, { backgroundColor: meta.soft, borderColor: meta.color }]}>
            <View style={[styles.outfitAccent, { backgroundColor: meta.color }]} />
            {item?.image ? (
              <Image
                source={{ uri: resolveApiAssetUrl(item.image) }}
                style={{ width: '100%', height: '100%' }}
                contentFit="contain"
              />
            ) : (
              <View style={{ alignItems: 'center', padding: 4 }}>
                <Ionicons name={meta.icon as keyof typeof Ionicons.glyphMap} size={20} color={meta.color} />
                <Text numberOfLines={1} style={{ color: c.textPrimary, fontSize: 10, marginTop: 4 }}>
                  {item?.name || '-'}
                </Text>
              </View>
            )}
            <View style={[styles.slotLabel, { backgroundColor: c.bg + 'CC', borderColor: meta.color }]}>
              <Text style={{ color: meta.color, fontSize: 9, letterSpacing: 1, fontWeight: '900' }}>
                {meta.short}
              </Text>
            </View>
          </View>
        );
        })}
      </View>

      <View style={[styles.cardFooter, { borderTopColor: c.borderSubtle }]}>
        <Pressable testID={`occasion-${outfit.index}`} onPress={onSetOccasion} style={[styles.tag, { borderColor: c.borderActive }]}>
          <Text style={{ color: c.textPrimary, fontSize: 11, letterSpacing: 1, fontWeight: '600' }}>
            #{occasion.toUpperCase()}
          </Text>
        </Pressable>
        <Pressable onPress={onPlan} style={[styles.tag, { borderColor: plannedDates.length ? c.accent : c.borderActive }]}>
          <Text style={{ color: plannedDates.length ? c.accentText : c.textPrimary, fontSize: 11, letterSpacing: 1, fontWeight: '600' }}>
            {plannedDates.length ? plannedDates.map((day) => day.slice(5)).join(', ') : selectedDateLabel}
          </Text>
        </Pressable>
        <Text style={{ color: c.textTertiary, fontSize: 11 }}>
          S{outfit.topSlot + 1} / S{outfit.bottomSlot + 1} / S{outfit.layerSlot + 1}
        </Text>
        <Pressable
          testID={`style-it-${outfit.index}`}
          onPress={onStyleIt}
          style={[styles.tag, { borderColor: c.accent, flexDirection: 'row', alignItems: 'center', gap: 4 }]}
        >
          <Ionicons name="sparkles-outline" size={12} color={c.accentText} />
          <Text style={{ color: c.accentText, fontSize: 11, letterSpacing: 1, fontWeight: '600' }}>STYLE IT</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  modalCard: {
    padding: 24, paddingBottom: 36, borderTopLeftRadius: 16, borderTopRightRadius: 16,
    borderWidth: 1, borderBottomWidth: 0,
  },
  modalLabel: { fontSize: 11, letterSpacing: 1.5, marginBottom: 6, marginTop: 12 },
  modalInput: { fontSize: 16, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  modalBtn: { paddingVertical: 14, borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  kicker: { fontSize: 11, letterSpacing: 2, fontWeight: '600' },
  h1: { fontSize: 32, fontWeight: '700', letterSpacing: -1, marginTop: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, height: 32, justifyContent: 'center' },
  publishBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1, borderRadius: 4, paddingVertical: 12,
  },
  ribbonContainer: { paddingTop: 14 },
  ribbonLabel: { fontSize: 9, letterSpacing: 1.5, fontWeight: '800', marginBottom: 8, paddingHorizontal: 24 },
  dayChip: {
    minWidth: 72,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
    position: 'relative',
  },
  indicatorDot: { position: 'absolute', bottom: 4, width: 4, height: 4, borderRadius: 2 },
  smartPanel: { borderWidth: 1, borderRadius: 8, padding: 14 },
  smartHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  smartRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 8, padding: 10 },
  scoreDot: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  reflectionPanel: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 8, padding: 14 },
  reflectionButton: { height: 36, borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 5, paddingHorizontal: 10 },
  reflectionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 40, borderRadius: 15, paddingLeft: 3, paddingRight: 12 },
  reflectionPlate: { width: 35, height: 35, borderRadius: 13, overflow: 'hidden' },
  insightBox: { borderRadius: 15, padding: 16, marginTop: 16 },
  card: { borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  cardHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 12,
  },
  outfitNum: { fontSize: 11, letterSpacing: 2, fontWeight: '600' },
  iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  outfitSlot: {
    flex: 1, aspectRatio: 1, borderWidth: 1, borderRadius: 6,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative',
  },
  slotLabel: {
    position: 'absolute', bottom: 4, left: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3, borderWidth: 1,
  },
  outfitAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, zIndex: 2 },
  cardFooter: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 12, borderTopWidth: 1, gap: 8, flexWrap: 'wrap',
  },
  tag: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 10, paddingVertical: 5 },
});
