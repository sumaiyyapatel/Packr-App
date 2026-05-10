import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useStore } from '../../src/lib/store';
import { api, WardrobeItem } from '../../src/lib/api';
import { generate27Outfits, isGridComplete, suggestOccasion, Outfit } from '../../src/lib/sudoku';

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
    const m: Record<string, WardrobeItem> = {};
    for (const w of wardrobe) m[w.id] = w;
    return m;
  }, [wardrobe]);

  const outfits = useMemo(() => (trip ? generate27Outfits(trip.grid) : []), [trip]);

  const tagged = useMemo(() => {
    return outfits.map((o) => {
      const occasion = trip?.occasion_tags?.[String(o.index)] || suggestOccasion(o, itemsById);
      const isFav = trip?.favorites?.includes(o.index) || false;
      return { ...o, occasion, isFav };
    });
  }, [outfits, trip, itemsById]);

  const filtered = tagged.filter((o) => {
    if (filter === 'All') return true;
    if (filter === 'Favorites') return o.isFav;
    return o.occasion === filter;
  });

  const toggleFav = async (idx: number, current: boolean) => {
    if (!trip) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      const r = await api.put(`/trips/${trip.id}/favorite`, {
        outfit_index: idx,
        is_favorite: !current,
      });
      upsertTrip(r.data);
    } catch {}
  };

  const setOccasion = async (idx: number) => {
    if (!trip) return;
    Alert.alert(
      'Set occasion',
      undefined,
      OCCASIONS.filter((o) => o !== 'All' && o !== 'Favorites').map((o) => ({
        text: o,
        onPress: async () => {
          try {
            const r = await api.put(`/trips/${trip.id}/occasion`, {
              outfit_index: idx,
              occasion: o,
            });
            upsertTrip(r.data);
          } catch {}
        },
      }))
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <View style={{ padding: 24, paddingBottom: 8 }}>
        <Text style={[styles.kicker, { color: c.accent }]}>LOOKBOOK</Text>
        <Text style={[styles.h1, { color: c.textPrimary }]}>27 outfits</Text>
        <Text style={{ color: c.textTertiary, fontSize: 12, marginTop: 4 }}>{trip.destination}</Text>
      </View>

      {!complete ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Ionicons name="grid-outline" size={36} color={c.textTertiary} />
          <Text style={{ color: c.textSecondary, textAlign: 'center', marginTop: 12 }}>
            Fill the 3×3 Grid first to generate 27 outfits.
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
            {OCCASIONS.map((o) => {
              const active = filter === o;
              return (
                <Pressable
                  testID={`filter-${o}`}
                  key={o}
                  onPress={() => setFilter(o)}
                  style={[
                    styles.chip,
                    {
                      borderColor: active ? c.accent : c.borderSubtle,
                      backgroundColor: active ? c.accent : 'transparent',
                    },
                  ]}
                >
                  <Text style={{ color: active ? c.bg : c.textSecondary, fontSize: 11, letterSpacing: 1, fontWeight: '600' }}>
                    {o.toUpperCase()}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }} showsVerticalScrollIndicator={false}>
            {filtered.length === 0 && (
              <Text style={{ color: c.textTertiary, textAlign: 'center', marginTop: 24 }}>
                No outfits match this filter.
              </Text>
            )}
            {filtered.map((o) => (
              <OutfitCard
                key={o.index}
                outfit={o}
                itemsById={itemsById}
                isFav={o.isFav}
                occasion={o.occasion}
                onFav={() => toggleFav(o.index, o.isFav)}
                onSetOccasion={() => setOccasion(o.index)}
              />
            ))}
          </ScrollView>
        </>
      )}
    </SafeAreaView>
  );
}

function OutfitCard({
  outfit,
  itemsById,
  isFav,
  occasion,
  onFav,
  onSetOccasion,
}: {
  outfit: Outfit;
  itemsById: Record<string, WardrobeItem>;
  isFav: boolean;
  occasion: string;
  onFav: () => void;
  onSetOccasion: () => void;
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
        {[top, bottom, layer].map((it, i) => (
          <View key={i} style={[styles.outfitSlot, { backgroundColor: c.elevated, borderColor: c.borderSubtle }]}>
            {it?.image ? (
              <Image source={{ uri: it.image }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            ) : (
              <View style={{ alignItems: 'center', padding: 4 }}>
                <Ionicons name="shirt-outline" size={20} color={c.textTertiary} />
                <Text numberOfLines={1} style={{ color: c.textPrimary, fontSize: 10, marginTop: 4 }}>
                  {it?.name || '—'}
                </Text>
              </View>
            )}
            <View style={[styles.slotLabel, { backgroundColor: c.bg + 'CC' }]}>
              <Text style={{ color: c.textPrimary, fontSize: 9, letterSpacing: 1 }}>
                {['TOP', 'BOTTOM', 'LAYER'][i]}
              </Text>
            </View>
          </View>
        ))}
      </View>

      <View style={[styles.cardFooter, { borderTopColor: c.borderSubtle }]}>
        <Pressable testID={`occasion-${outfit.index}`} onPress={onSetOccasion} style={[styles.tag, { borderColor: c.borderActive }]}>
          <Text style={{ color: c.textPrimary, fontSize: 11, letterSpacing: 1, fontWeight: '600' }}>
            #{occasion.toUpperCase()}
          </Text>
        </Pressable>
        <Text style={{ color: c.textTertiary, fontSize: 11 }}>
          R{outfit.topRow} · R{outfit.bottomRow} · R{outfit.layerRow}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  kicker: { fontSize: 11, letterSpacing: 2, fontWeight: '600' },
  h1: { fontSize: 32, fontWeight: '700', letterSpacing: -1, marginTop: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, height: 32, justifyContent: 'center' },
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
    position: 'absolute', bottom: 4, left: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3,
  },
  cardFooter: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 12, borderTopWidth: 1,
  },
  tag: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 10, paddingVertical: 5 },
});
