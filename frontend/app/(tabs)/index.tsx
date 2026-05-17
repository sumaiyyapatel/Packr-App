import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useStore } from '../../src/lib/store';
import { api, Trip, TripInvite, TripNudge, TripStats, WardrobeItem } from '../../src/lib/api';
import { gridProgress, isGridComplete } from '../../src/lib/sudoku';
import { checkClimateFit } from '../../src/lib/climate';

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
  const [stats, setStats] = useState<TripStats | null>(null);
  const [nudges, setNudges] = useState<TripNudge[]>([]);
  const [invites, setInvites] = useState<TripInvite[]>([]);
  const [inviteBusy, setInviteBusy] = useState(false);

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
              params: {
                latitude: t.latitude,
                longitude: t.longitude,
                start_date: t.start_date,
                end_date: t.end_date,
              },
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

  useEffect(() => {
    if (!selected?.id) {
      setStats(null);
      setInvites([]);
      return;
    }
    (async () => {
      try {
        const [statsResponse, invitesResponse, nudgesResponse] = await Promise.all([
          api.get(`/trips/${selected.id}/stats`),
          api.get(`/trips/${selected.id}/invites`),
          api.get('/retention/nudges'),
        ]);
        setStats(statsResponse.data);
        setInvites(invitesResponse.data);
        setNudges(nudgesResponse.data);
      } catch {
        setStats(null);
      }
    })();
  }, [selected?.id]);

  const itemsById = useMemo(() => {
    const m: Record<string, WardrobeItem> = {};
    for (const w of wardrobe) m[w.id] = w;
    return m;
  }, [wardrobe]);

  const climateFit = useMemo(() => {
    if (!selected) return null;
    return checkClimateFit(selected.grid, itemsById, weather[selected.id]);
  }, [selected, itemsById, weather]);

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

  const createInvite = async () => {
    if (!selected) return;
    setInviteBusy(true);
    try {
      const r = await api.post(`/trips/${selected.id}/invites`, {});
      setInvites((current) => [r.data, ...current]);
    } catch {
      Alert.alert('Invite failed', 'Could not create an invite code.');
    } finally {
      setInviteBusy(false);
    }
  };

  const openNudge = (nudge: TripNudge) => {
    if (nudge.trip_id) setSelectedTrip(nudge.trip_id);
    router.push(nudge.action_route as any);
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
            <Pressable testID="settings-button" onPress={() => router.push('/settings')} style={[styles.iconBtn, { borderColor: c.borderSubtle }]}>
              <Ionicons name="settings-outline" size={18} color={c.textPrimary} />
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

        <View style={[styles.guideBox, { borderColor: c.borderSubtle, backgroundColor: c.surface }]}>
          <Text style={[styles.section, { color: c.textPrimary }]}>LAUNCH GUIDE</Text>
          <GuideStep done={trips.length > 0} label="Create a trip" />
          <GuideStep done={wardrobe.filter((w) => w.category === 'top').length >= 3} label="Add 3 tops" />
          <GuideStep done={wardrobe.filter((w) => w.category === 'bottom').length >= 3} label="Add 3 bottoms" />
          <GuideStep done={wardrobe.filter((w) => w.category === 'layer').length >= 3} label="Add 3 layers" />
          <GuideStep done={Boolean(selected && selected.grid.filter(Boolean).length === 9)} label="Fill the grid" />
          <GuideStep done={Boolean(selected && selected.grid.filter(Boolean).length === 9)} label="Review outfits and pack" />
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
                  {`${t.start_date} -> ${t.end_date} - ${days}d`}
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
                  PACKING - {t.grid.filter(Boolean).length}/9
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
            <Text style={[styles.statValue, { color: c.textPrimary }]}>{stats?.packing_score ?? totalOutfits}</Text>
            <Text style={[styles.statName, { color: c.textTertiary }]}>{stats ? 'SCORE' : 'OUTFITS'}</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: c.borderSubtle }]} />
          <View style={styles.statCell}>
            <Text style={[styles.statValue, { color: c.textPrimary }]}>{stats?.planned_days ?? itemsPacked}/{stats?.trip_days ?? 9}</Text>
            <Text style={[styles.statName, { color: c.textTertiary }]}>{stats ? 'DAYS' : 'ITEMS'}</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: c.borderSubtle }]} />
          <View style={styles.statCell}>
            <Text style={[styles.statValue, { color: c.textPrimary }]}>{stats?.items_per_day ?? efficiency}</Text>
            <Text style={[styles.statName, { color: c.textTertiary }]}>{stats ? 'ITEMS/DAY' : 'RATIO'}</Text>
          </View>
        </View>

        {stats && (
          <View style={[styles.scorePanel, { borderColor: c.borderSubtle, backgroundColor: c.surface }]}>
            <View style={styles.scoreHeader}>
              <Text style={[styles.section, { color: c.textPrimary }]}>PACKING SCORE</Text>
              <Text style={{ color: c.accent, fontSize: 12, fontWeight: '800' }}>{stats.packing_score}/100</Text>
            </View>
            <View style={[styles.progressTrack, { backgroundColor: c.elevated, marginTop: 10 }]}>
              <View style={[styles.progressFill, { backgroundColor: c.accent, width: `${stats.packing_score}%` }]} />
            </View>
            <View style={styles.scoreMetaRow}>
              <ScoreMeta label="Variety" value={String(stats.outfit_variety)} />
              <ScoreMeta label="Checklist" value={`${Math.round(stats.checklist_progress * 100)}%`} />
              <ScoreMeta label="Weight" value={`${stats.total_weight_kg.toFixed(1)}kg`} />
            </View>
          </View>
        )}

        <View style={{ height: 24 }} />

        <View style={styles.sectionRow}>
          <Text style={[styles.section, { color: c.textPrimary }]}>SMART NUDGES</Text>
          <Text style={[styles.subdued, { color: c.textTertiary }]}>{nudges.length} ACTIVE</Text>
        </View>
        <View style={{ gap: 10, marginTop: 12 }}>
          {nudges.map((nudge) => (
            <NudgeCard key={nudge.id} nudge={nudge} onPress={() => openNudge(nudge)} />
          ))}
        </View>

        {selected && (
          <>
            <View style={{ height: 24 }} />
            <View style={[styles.invitePanel, { borderColor: c.borderSubtle, backgroundColor: c.surface }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.section, { color: c.textPrimary }]}>PACK TOGETHER</Text>
                <Text style={{ color: c.textSecondary, fontSize: 13, marginTop: 6, lineHeight: 18 }}>
                  Invite a travel companion to build their own matching grid for this trip.
                </Text>
                {invites[0] && (
                  <Text style={{ color: c.accent, fontSize: 16, fontWeight: '900', marginTop: 10 }}>
                    CODE {invites[0].code}
                  </Text>
                )}
              </View>
              <Pressable
                onPress={createInvite}
                disabled={inviteBusy}
                style={[styles.inviteButton, { borderColor: c.accent }]}
              >
                <Ionicons name="person-add-outline" size={16} color={c.accent} />
                <Text style={{ color: c.accent, fontSize: 11, fontWeight: '900' }}>
                  {invites[0] ? 'NEW' : 'INVITE'}
                </Text>
              </Pressable>
            </View>
          </>
        )}

        {climateFit && climateFit.warnings.length > 0 && (
          <View
            testID="climate-warning"
            style={[
              styles.climateBox,
              { borderColor: c.warning, backgroundColor: c.warning + '15' },
            ]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
              <Ionicons name="warning-outline" size={14} color={c.warning} />
              <Text
                style={{
                  color: c.warning, fontSize: 11, letterSpacing: 1.5, fontWeight: '600',
                  marginLeft: 6,
                }}
              >
                CLIMATE FIT - {climateFit.climate.toUpperCase()}
              </Text>
            </View>
            {climateFit.warnings.map((w, i) => (
              <Text key={i} style={{ color: c.textPrimary, fontSize: 12, marginTop: 2 }}>
                - {w}
              </Text>
            ))}
          </View>
        )}

        {climateFit && climateFit.warnings.length === 0 && climateFit.climate !== 'unknown' && itemsPacked > 0 && (
          <View
            testID="climate-ok"
            style={[styles.climateBox, { borderColor: c.accent, backgroundColor: c.accent + '12' }]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="checkmark-circle-outline" size={14} color={c.accent} />
              <Text
                style={{
                  color: c.accent, fontSize: 11, letterSpacing: 1.5, fontWeight: '600',
                  marginLeft: 6,
                }}
              >
                CLIMATE FIT - {climateFit.climate.toUpperCase()} - LOOKS GOOD
              </Text>
            </View>
          </View>
        )}

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
          <Text style={[styles.ctaText, { color: c.accent }]}>BUILD THE GRID</Text>
        </Pressable>

        <View style={{ height: 12 }} />
        <Pressable
          testID="dashboard-templates-button"
          onPress={() => router.push('/templates')}
          style={({ pressed }) => [
            styles.cta,
            { borderColor: c.borderActive, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={[styles.ctaText, { color: c.textPrimary }]}>BROWSE TEMPLATES</Text>
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

function GuideStep({ done, label }: { done: boolean; label: string }) {
  const { c } = useTheme();
  return (
    <View style={styles.guideStep}>
      <Ionicons name={done ? 'checkmark-circle' : 'ellipse-outline'} size={17} color={done ? c.accent : c.textTertiary} />
      <Text style={{ color: done ? c.textPrimary : c.textSecondary, fontSize: 13 }}>{label}</Text>
    </View>
  );
}

function ScoreMeta({ label, value }: { label: string; value: string }) {
  const { c } = useTheme();
  return (
    <View style={styles.scoreMeta}>
      <Text style={{ color: c.textPrimary, fontSize: 15, fontWeight: '900' }}>{value}</Text>
      <Text style={{ color: c.textTertiary, fontSize: 9, letterSpacing: 1, marginTop: 2 }}>{label.toUpperCase()}</Text>
    </View>
  );
}

function NudgeCard({ nudge, onPress }: { nudge: TripNudge; onPress: () => void }) {
  const { c } = useTheme();
  const icon: Record<TripNudge['kind'], keyof typeof Ionicons.glyphMap> = {
    pre_trip: 'notifications-outline',
    wardrobe_audit: 'shirt-outline',
    post_trip: 'sparkles-outline',
    challenge: 'trophy-outline',
  };
  return (
    <Pressable
      onPress={onPress}
      style={[styles.nudgeCard, { borderColor: c.borderSubtle, backgroundColor: c.surface }]}
    >
      <View style={[styles.nudgeIcon, { borderColor: c.accent }]}>
        <Ionicons name={icon[nudge.kind]} size={16} color={c.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.textPrimary, fontSize: 14, fontWeight: '900' }}>{nudge.title}</Text>
        <Text style={{ color: c.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 3 }}>
          {nudge.message}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={c.textTertiary} />
    </Pressable>
  );
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
  scorePanel: { borderWidth: 1, borderRadius: 8, padding: 14, marginTop: 12 },
  scoreHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  scoreMetaRow: { flexDirection: 'row', marginTop: 12 },
  scoreMeta: { flex: 1, alignItems: 'center' },
  nudgeCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 8, padding: 12 },
  nudgeIcon: { width: 34, height: 34, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  invitePanel: { flexDirection: 'row', gap: 12, borderWidth: 1, borderRadius: 8, padding: 14, alignItems: 'center' },
  inviteButton: { height: 38, borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 5, paddingHorizontal: 10 },
  wardrobeBox: { borderWidth: 1, borderRadius: 8, padding: 16, marginTop: 12, gap: 12 },
  wardrobeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  catLabel: { fontSize: 12, letterSpacing: 1.5, fontWeight: '600', width: 80 },
  dotsRow: { flexDirection: 'row', gap: 6, flex: 1, justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  cta: { borderWidth: 1, borderRadius: 4, padding: 16, alignItems: 'center' },
  ctaText: { fontSize: 13, letterSpacing: 2, fontWeight: '600' },
  climateBox: { borderWidth: 1, borderRadius: 8, padding: 12, marginTop: 12 },
  guideBox: { borderWidth: 1, borderRadius: 8, padding: 14, gap: 10 },
  guideStep: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  proBadge: {
    flexDirection: 'row', alignItems: 'center',
    height: 36, paddingHorizontal: 12, borderRadius: 4, borderWidth: 1,
  },
});
