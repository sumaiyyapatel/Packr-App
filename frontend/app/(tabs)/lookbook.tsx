import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useStore } from '../../src/lib/store';
import { api, getApiErrorMessage, OutfitSuggestion, resolveApiAssetUrl, WardrobeItem } from '../../src/lib/api';
import { generate27Outfits, isGridComplete, suggestOccasion, Outfit } from '../../src/lib/sudoku';
import { CATEGORY_META } from '../../src/lib/wardrobeMeta';

const OCCASIONS = ['All', 'Favorites', 'Casual', 'Formal', 'Travel', 'Active', 'Modest'];

export default function Lookbook() {
  const { c } = useTheme();
  const trips = useStore((s) => s.trips);
  const wardrobe = useStore((s) => s.wardrobe);
  const selectedTripId = useStore((s) => s.selectedTripId);
  const upsertTrip = useStore((s) => s.upsertTrip);
  const trip = trips.find((t) => t.id === selectedTripId) || trips[0];
  const [filter, setFilter] = useState<string>('All');
  const [suggestions, setSuggestions] = useState<OutfitSuggestion[]>([]);
  const [suggestionDate, setSuggestionDate] = useState<string | null>(null);
  const [reflecting, setReflecting] = useState(false);

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
    (async () => {
      try {
        const r = await api.get(`/trips/${trip.id}/outfit-suggestions`, {
          params: {
            date: suggestionDate,
            occasion: filter !== 'All' && filter !== 'Favorites' ? filter : undefined,
          },
        });
        setSuggestions(r.data);
      } catch {
        setSuggestions([]);
      }
    })();
  }, [trip, suggestionDate, filter]);

  const toggleFav = async (outfit: Outfit & { isFav: boolean }) => {
    if (!trip) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      const r = await api.put(`/trips/${trip.id}/favorite`, {
        outfit_index: outfit.index,
        outfit_key: outfit.key,
        is_favorite: !outfit.isFav,
      });
      upsertTrip(r.data);
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
            const r = await api.put(`/trips/${trip.id}/occasion`, {
              outfit_index: outfit.index,
              outfit_key: outfit.key,
              occasion,
            });
            upsertTrip(r.data);
          } catch {}
        },
      }))
    );
  };

  const assignOutfitDay = async (outfit: Outfit) => {
    const day = suggestionDate || tripDates[0];
    if (!trip || !day) return;
    try {
      const r = await api.put(`/trips/${trip.id}/outfit-plan`, {
        date: day,
        outfit_key: outfit.key,
      });
      upsertTrip(r.data);
    } catch (e: unknown) {
      Alert.alert('Plan failed', getApiErrorMessage(e, 'Could not plan outfit'));
    }
  };

  const savePostTripReflection = async () => {
    if (!trip) return;
    const planned = Object.values(trip.outfit_plan || {});
    const favoriteKeys = (trip.favorites || []).filter((item): item is string => typeof item === 'string' && item.includes('|'));
    const worn = planned.length ? planned : favoriteKeys;
    const used = new Set(worn.flatMap((key) => key.split('|')));
    const unused = trip.grid.filter((id): id is string => Boolean(id && !used.has(id)));
    setReflecting(true);
    try {
      await api.post(`/trips/${trip.id}/reflections`, {
        worn_outfit_keys: worn,
        unused_item_ids: unused,
        notes: 'Saved from post-trip reflection',
        rating: null,
      });
      Alert.alert('Reflection saved', 'Unused items and worn outfits were recorded.');
    } catch (e: unknown) {
      Alert.alert('Reflection failed', getApiErrorMessage(e, 'Could not save reflection'));
    } finally {
      setReflecting(false);
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

  const complete = isGridComplete(trip.grid);
  const tripEnded = new Date(`${trip.end_date}T23:59:59`).getTime() < Date.now();

  const publishTemplate = async () => {
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
      await api.post('/templates', {
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
        <Text style={[styles.kicker, { color: c.accent }]}>OUTFITS</Text>
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
              onPress={publishTemplate}
              style={[styles.publishBtn, { borderColor: c.borderActive }]}
            >
              <Ionicons name="cloud-upload-outline" size={16} color={c.textPrimary} />
              <Text style={{ color: c.textPrimary, fontSize: 12, letterSpacing: 1, fontWeight: '600' }}>
                PUBLISH TEMPLATE
              </Text>
            </Pressable>
          </View>

          <View style={styles.ribbonContainer}>
            <Text style={[styles.ribbonLabel, { color: c.textTertiary }]}>ASSIGN OUTFIT TO DAY</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 24, gap: 8 }}
              style={{ flexGrow: 0 }}
            >
              {tripDates.map((day, index) => {
                const key = trip.outfit_plan?.[day];
                const planned = tagged.find((outfit) => outfit.key === key);
                const active = suggestionDate === day;
                return (
                  <Pressable
                    key={day}
                    onPress={() => setSuggestionDate(day)}
                    style={[
                      styles.dayChip,
                      {
                        borderColor: active || key ? c.accent : c.borderSubtle,
                        backgroundColor: active ? c.accent : key ? c.surface : 'transparent',
                      },
                    ]}
                  >
                    <Text style={{ color: active ? c.bg : key ? c.accent : c.textPrimary, fontSize: 14, fontWeight: '800' }}>
                      Day {index + 1}
                    </Text>
                    <Text style={{ color: active ? c.bg : c.textTertiary, fontSize: 10, marginTop: 2 }}>
                      {day.slice(5)}
                    </Text>
                    {planned && !active ? <View style={[styles.indicatorDot, { backgroundColor: c.accent }]} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }} showsVerticalScrollIndicator={false}>
            {suggestions.length > 0 && (
              <View style={[styles.smartPanel, { borderColor: c.borderSubtle, backgroundColor: c.surface }]}>
                <View style={styles.smartHeader}>
                  <View>
                    <Text style={[styles.kicker, { color: c.accent }]}>SMART PICKS</Text>
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
                          <Text style={{ color: c.accent, fontSize: 11, fontWeight: '900' }}>{pick.score}</Text>
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
                  <Text style={[styles.kicker, { color: c.accent }]}>POST-TRIP</Text>
                  <Text style={{ color: c.textPrimary, fontSize: 15, fontWeight: '900', marginTop: 4 }}>
                    Record what worked
                  </Text>
                  <Text style={{ color: c.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 4 }}>
                    Saves planned or favorite outfits as worn and marks the rest for audit.
                  </Text>
                </View>
                <Pressable
                  onPress={savePostTripReflection}
                  disabled={reflecting}
                  style={[styles.reflectionButton, { borderColor: c.accent }]}
                >
                  <Ionicons name="checkmark-circle-outline" size={15} color={c.accent} />
                  <Text style={{ color: c.accent, fontSize: 11, fontWeight: '900' }}>SAVE</Text>
                </Pressable>
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
                plannedDates={tripDates.filter((day) => trip.outfit_plan?.[day] === outfit.key)}
                selectedDateLabel={suggestionDate ? `PLAN DAY ${tripDates.indexOf(suggestionDate) + 1}` : 'PLAN DAY'}
              />
            ))}
          </ScrollView>
        </>
      )}
    </SafeAreaView>
  );
}

function tripDays(startDate: string, endDate: string) {
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
}

function dateRange(startDate: string, endDate: string) {
  const days: string[] = [];
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
    days.push(new Date(t).toISOString().slice(0, 10));
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
          <Text style={{ color: plannedDates.length ? c.accent : c.textPrimary, fontSize: 11, letterSpacing: 1, fontWeight: '600' }}>
            {plannedDates.length ? plannedDates.map((day) => day.slice(5)).join(', ') : selectedDateLabel}
          </Text>
        </Pressable>
        <Text style={{ color: c.textTertiary, fontSize: 11 }}>
          S{outfit.topSlot + 1} / S{outfit.bottomSlot + 1} / S{outfit.layerSlot + 1}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
