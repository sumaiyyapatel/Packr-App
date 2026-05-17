import React, { useMemo, useState } from 'react';
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
import { api, getApiErrorMessage, resolveApiAssetUrl, WardrobeItem } from '../../src/lib/api';
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

  const assignOutfitDay = (outfit: Outfit) => {
    if (!trip) return;
    Alert.alert(
      'Plan outfit',
      'Choose the day for this outfit.',
      [
        ...tripDates.map((day) => ({
          text: day,
          onPress: async () => {
            try {
              const r = await api.put(`/trips/${trip.id}/outfit-plan`, {
                date: day,
                outfit_key: outfit.key,
              });
              upsertTrip(r.data);
            } catch (e: unknown) {
              Alert.alert('Plan failed', getApiErrorMessage(e, 'Could not plan outfit'));
            }
          },
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]
    );
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

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 24, gap: 8, paddingTop: 12 }}
            style={{ flexGrow: 0 }}
          >
            {tripDates.map((day) => {
              const key = trip.outfit_plan?.[day];
              const planned = tagged.find((outfit) => outfit.key === key);
              return (
                <View key={day} style={[styles.dayChip, { borderColor: key ? c.accent : c.borderSubtle }]}>
                  <Text style={{ color: key ? c.accent : c.textSecondary, fontSize: 10, fontWeight: '800' }}>{day.slice(5)}</Text>
                  <Text style={{ color: c.textTertiary, fontSize: 10, marginTop: 2 }}>
                    {planned ? `Outfit ${planned.index + 1}` : 'Unplanned'}
                  </Text>
                </View>
              );
            })}
          </ScrollView>

          <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }} showsVerticalScrollIndicator={false}>
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
}: {
  outfit: Outfit;
  itemsById: Record<string, WardrobeItem>;
  isFav: boolean;
  occasion: string;
  onFav: () => void;
  onSetOccasion: () => void;
  onPlan: () => void;
  plannedDates: string[];
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
            {plannedDates.length ? plannedDates.map((day) => day.slice(5)).join(', ') : 'PLAN DAY'}
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
  dayChip: { minWidth: 92, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
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
