import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useStore } from '../../src/lib/store';
import { api, Trip } from '../../src/lib/api';
import { gridProgress, isGridComplete } from '../../src/lib/sudoku';

const WEATHER_ICON: Record<number, string> = {
  0: 'sunny-outline',
  1: 'partly-sunny-outline',
  2: 'partly-sunny-outline',
  3: 'cloudy-outline',
  45: 'cloud-outline',
  48: 'cloud-outline',
  51: 'rainy-outline',
  61: 'rainy-outline',
  63: 'rainy-outline',
  65: 'rainy-outline',
  71: 'snow-outline',
  73: 'snow-outline',
  75: 'snow-outline',
  80: 'rainy-outline',
  95: 'thunderstorm-outline',
};

export default function Dashboard() {
  const { c, mode, toggle } = useTheme();
  const router = useRouter();
  const trips = useStore((s) => s.trips);
  const wardrobe = useStore((s) => s.wardrobe);
  const refreshAll = useStore((s) => s.refreshAll);
  const selectedTripId = useStore((s) => s.selectedTripId);
  const setSelectedTrip = useStore((s) => s.setSelectedTrip);
  const removeTrip = useStore((s) => s.removeTrip);
  const logout = useStore((s) => s.logout);
  const user = useStore((s) => s.user);

  const [refreshing, setRefreshing] = useState(false);
  const [weather, setWeather] = useState<Record<string, any>>({});

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshAll();
    } finally {
      setRefreshing(false);
    }
  }, [refreshAll]);

  useEffect(() => {
    (async () => {
      const next: Record<string, any> = {};
      for (const t of trips) {
        if (t.latitude && t.longitude && !weather[t.id]) {
          try {
            const r = await api.get('/weather', {
              params: { latitude: t.latitude, longitude: t.longitude },
            });
            next[t.id] = r.data?.daily;
          } catch {}
        }
      }
      if (Object.keys(next).length) setWeather((prev) => ({ ...prev, ...next }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trips]);

  const selected = trips.find((t) => t.id === selectedTripId) || trips[0];

  const totalOutfits = selected && isGridComplete(selected.grid) ? 27 : 0;
  const itemsPacked = selected ? selected.grid.filter(Boolean).length : 0;
  const efficiency = selected && itemsPacked > 0 ? (totalOutfits / itemsPacked).toFixed(1) : '0.0';

  const onDeleteTrip = (t: Trip) => {
    Alert.alert('Delete trip?', t.destination, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/trips/${t.id}`);
            removeTrip(t.id);
            if (selectedTripId === t.id) setSelectedTrip(null);
          } catch {}
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} />}
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <View>
            <Text style={[styles.brand, { color: c.textPrimary }]}>PACKR</Text>
            <Text style={[styles.greet, { color: c.textTertiary }]}>
              {user?.name ? user.name.toUpperCase() : (user?.email || '').split('@')[0].toUpperCase()}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Pressable testID="theme-toggle-button" onPress={toggle} style={[styles.iconBtn, { borderColor: c.borderSubtle }]}>
              <Ionicons name={mode === 'dark' ? 'sunny-outline' : 'moon-outline'} size={18} color={c.textPrimary} />
            </Pressable>
            <Pressable
              testID="logout-button"
              onPress={() => {
                Alert.alert('Sign out?', '', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Sign out', style: 'destructive', onPress: () => logout() },
                ]);
              }}
              style={[styles.iconBtn, { borderColor: c.borderSubtle }]}
            >
              <Ionicons name="log-out-outline" size={18} color={c.textPrimary} />
            </Pressable>
          </View>
        </View>

        <View style={{ height: 24 }} />

        {/* Trips */}
        <View style={styles.sectionRow}>
          <Text style={[styles.section, { color: c.textPrimary }]}>UPCOMING TRIPS</Text>
          <Pressable
            testID="add-trip-button"
            onPress={() => router.push('/onboarding/trip-create')}
            style={({ pressed }) => [styles.addBtn, { borderColor: c.borderActive, opacity: pressed ? 0.7 : 1 }]}
          >
            <Ionicons name="add" size={14} color={c.textPrimary} />
            <Text style={[styles.addBtnText, { color: c.textPrimary }]}>NEW</Text>
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingRight: 24 }}
          style={{ marginHorizontal: -24, paddingHorizontal: 24, marginTop: 12 }}
        >
          {trips.length === 0 && (
            <View style={[styles.emptyCard, { borderColor: c.borderSubtle }]}>
              <Text style={{ color: c.textSecondary }}>No trips yet. Tap NEW to create one.</Text>
            </View>
          )}
          {trips.map((t) => {
            const days = daysBetween(t.start_date, t.end_date);
            const countdown = daysFromNow(t.start_date);
            const w = weather[t.id];
            const wcode = w?.weather_code?.[0];
            const tmin = w?.temperature_2m_min?.[0];
            const tmax = w?.temperature_2m_max?.[0];
            const isSelected = selected?.id === t.id;
            return (
              <Pressable
                testID={`trip-card-${t.id}`}
                key={t.id}
                onPress={() => setSelectedTrip(t.id)}
                onLongPress={() => onDeleteTrip(t)}
                style={({ pressed }) => [
                  styles.tripCard,
                  {
                    backgroundColor: c.surface,
                    borderColor: isSelected ? c.accent : c.borderSubtle,
                    transform: [{ scale: pressed ? 0.98 : 1 }],
                  },
                ]}
              >
                <Text style={[styles.tripCountdown, { color: c.accent }]}>
                  {countdown >= 0 ? `IN ${countdown}D` : `STARTED`}
                </Text>
                <Text style={[styles.tripDest, { color: c.textPrimary }]} numberOfLines={2}>
                  {t.destination}
                </Text>
                <Text style={[styles.tripDates, { color: c.textTertiary }]}>
                  {t.start_date} → {t.end_date} · {days}d
                </Text>

                <View style={[styles.weatherRow, { borderColor: c.borderSubtle }]}>
                  <Ionicons
                    name={(WEATHER_ICON[wcode as number] as any) || 'cloud-outline'}
                    size={16}
                    color={c.textSecondary}
                  />
                  <Text style={{ color: c.textSecondary, fontSize: 12, marginLeft: 6 }}>
                    {tmax != null ? `${Math.round(tmin)}° / ${Math.round(tmax)}°` : 'No weather'}
                  </Text>
                </View>

                <View style={{ height: 12 }} />
                <Text style={[styles.gridLabel, { color: c.textTertiary }]}>
                  PACKING · {t.grid.filter(Boolean).length}/9
                </Text>
                <View style={[styles.progressTrack, { backgroundColor: c.elevated }]}>
                  <View
                    style={[
                      styles.progressFill,
                      { backgroundColor: c.accent, width: `${gridProgress(t.grid) * 100}%` },
                    ]}
                  />
                </View>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={{ height: 24 }} />

        {/* Stats */}
        <Text style={[styles.section, { color: c.textPrimary }]}>STATS</Text>
        <View style={[styles.statBox, { borderColor: c.borderSubtle }]}>
          <View style={styles.statCell}>
            <Text style={[styles.statValue, { color: c.textPrimary }]}>{totalOutfits}</Text>
            <Text style={[styles.statName, { color: c.textTertiary }]}>OUTFITS</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: c.borderSubtle }]} />
          <View style={styles.statCell}>
            <Text style={[styles.statValue, { color: c.textPrimary }]}>{itemsPacked}/9</Text>
            <Text style={[styles.statName, { color: c.textTertiary }]}>ITEMS</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: c.borderSubtle }]} />
          <View style={styles.statCell}>
            <Text style={[styles.statValue, { color: c.textPrimary }]}>{efficiency}</Text>
            <Text style={[styles.statName, { color: c.textTertiary }]}>RATIO</Text>
          </View>
        </View>

        <View style={{ height: 24 }} />

        {/* Wardrobe summary */}
        <View style={styles.sectionRow}>
          <Text style={[styles.section, { color: c.textPrimary }]}>WARDROBE</Text>
          <Text style={[styles.subdued, { color: c.textTertiary }]}>{wardrobe.length} ITEMS</Text>
        </View>
        <View style={[styles.wardrobeBox, { borderColor: c.borderSubtle }]}>
          {(['top', 'bottom', 'layer'] as const).map((cat) => {
            const count = wardrobe.filter((w) => w.category === cat).length;
            return (
              <View key={cat} style={styles.wardrobeRow}>
                <Text style={[styles.catLabel, { color: c.textSecondary }]}>{cat.toUpperCase()}</Text>
                <View style={[styles.dotsRow]}>
                  {Array.from({ length: 5 }, (_, i) => (
                    <View
                      key={i}
                      style={[
                        styles.dot,
                        { backgroundColor: i < Math.min(count, 5) ? c.accent : c.borderSubtle },
                      ]}
                    />
                  ))}
                </View>
                <Text style={{ color: c.textTertiary, width: 28, textAlign: 'right' }}>{count}</Text>
              </View>
            );
          })}
        </View>

        <View style={{ height: 16 }} />
        <Pressable
          testID="quick-go-grid-button"
          onPress={() => router.push('/(tabs)/grid')}
          style={({ pressed }) => [
            styles.cta,
            { borderColor: c.accent, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={[styles.ctaText, { color: c.accent }]}>BUILD THE GRID →</Text>
        </Pressable>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function daysBetween(a: string, b: string) {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  return Math.max(1, Math.round((db - da) / 86400000) + 1);
}

function daysFromNow(d: string) {
  const target = new Date(d).getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today.getTime()) / 86400000);
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 16, paddingBottom: 48 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  brand: { fontSize: 22, fontWeight: '700', letterSpacing: 4 },
  greet: { fontSize: 11, letterSpacing: 1, marginTop: 4 },
  iconBtn: { width: 36, height: 36, borderWidth: 1, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  section: { fontSize: 11, letterSpacing: 2, fontWeight: '600' },
  subdued: { fontSize: 11, letterSpacing: 1 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderRadius: 4, paddingHorizontal: 10, paddingVertical: 6,
  },
  addBtnText: { fontSize: 11, letterSpacing: 1.5, fontWeight: '600' },
  emptyCard: {
    width: 280, height: 180, borderWidth: 1, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed',
  },
  tripCard: {
    width: 280, padding: 16, borderWidth: 1, borderRadius: 8, marginRight: 12,
  },
  tripCountdown: { fontSize: 11, letterSpacing: 2, fontWeight: '600', marginBottom: 8 },
  tripDest: { fontSize: 22, fontWeight: '700', letterSpacing: -0.5 },
  tripDates: { fontSize: 12, marginTop: 4 },
  weatherRow: {
    flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingTop: 12, borderTopWidth: 1,
  },
  gridLabel: { fontSize: 10, letterSpacing: 1.5, marginBottom: 6 },
  progressTrack: { height: 4, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 4 },
  statBox: {
    flexDirection: 'row', borderWidth: 1, borderRadius: 8, padding: 16, marginTop: 12, alignItems: 'center',
  },
  statCell: { flex: 1, alignItems: 'center' },
  statDivider: { width: 1, height: 36 },
  statValue: { fontSize: 26, fontWeight: '700', letterSpacing: -1 },
  statName: { fontSize: 10, letterSpacing: 1.5, marginTop: 4 },
  wardrobeBox: { borderWidth: 1, borderRadius: 8, padding: 16, marginTop: 12, gap: 12 },
  wardrobeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  catLabel: { fontSize: 12, letterSpacing: 1.5, fontWeight: '600', width: 80 },
  dotsRow: { flexDirection: 'row', gap: 6, flex: 1, justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  cta: { borderWidth: 1, borderRadius: 4, padding: 16, alignItems: 'center' },
  ctaText: { fontSize: 13, letterSpacing: 2, fontWeight: '600' },
});
