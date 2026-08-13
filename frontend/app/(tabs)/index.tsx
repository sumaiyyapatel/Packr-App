import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/theme/ThemeProvider';
import { type as t, space, radius } from '../../src/theme/tokens';
import { fonts } from '../../src/theme/colors';
import { IconButton, StatTile, TripCard } from '../../src/components/ui';
import { useStore } from '../../src/lib/store';
import { Trip, TripInvite, TripNudge, TripStats, WardrobeItem } from '../../src/lib/api';
import { gridProgress, isGridComplete } from '../../src/lib/sudoku';
import { buildNudges, computeTripStats, computeWearInsights, WearInsight } from '../../src/lib/tripLogic';
import { fetchDailyForecast } from '../../src/lib/weather';
import { listTemplates, listPastTripReflections } from '../../src/lib/firestoreRepo';
import { checkClimateFit } from '../../src/lib/climate';

export default function Dashboard() {
  const { c, mode, toggle } = useTheme();
  const router = useRouter();
  const trips = useStore((s) => s.trips);
  const wardrobe = useStore((s) => s.wardrobe);
  const refreshAll = useStore((s) => s.refreshAll);
  const selectedTripId = useStore((s) => s.selectedTripId);
  const setSelectedTrip = useStore((s) => s.setSelectedTrip);
  const deleteTripRemote = useStore((s) => s.deleteTripRemote);
  const applyTemplateToTrip = useStore((s) => s.applyTemplateToTrip);
  const logout = useStore((s) => s.logout);
  const user = useStore((s) => s.user);

  const [refreshing, setRefreshing] = useState(false);
  const [weather, setWeather] = useState<Record<string, any>>({});
  const [stats, setStats] = useState<TripStats | null>(null);
  const [nudges, setNudges] = useState<TripNudge[]>([]);
  const [wearInsights, setWearInsights] = useState<WearInsight[]>([]);
  const [invites, setInvites] = useState<TripInvite[]>([]);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);

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
      await Promise.all(
        trips
          .filter((t) => t.latitude && t.longitude && !weather[t.id])
          .map(async (t) => {
            const daily = await fetchDailyForecast(
              t.latitude as number,
              t.longitude as number,
              t.start_date,
              t.end_date
            );
            if (daily) next[t.id] = daily;
          })
      );
      if (Object.keys(next).length) setWeather((prev) => ({ ...prev, ...next }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trips]);

  const selected = trips.find((t) => t.id === selectedTripId) || trips[0];

  useEffect(() => {
    if (!selected?.id) {
      setStats(null);
      setInvites([]);
      setNudges([]);
      setWearInsights([]);
      return;
    }
    // Stats and nudges are computed locally from Firestore-backed state.
    const byId: Record<string, WardrobeItem> = {};
    for (const w of wardrobe) byId[w.id] = w;
    setStats(computeTripStats(selected, byId));
    setInvites([]);
    let cancelled = false;
    (async () => {
      let reflected = new Set<string>();
      try {
        if (user?.id) {
          const { reflectedTripIds, byTripId } = await listPastTripReflections(user.id, trips);
          reflected = reflectedTripIds;
          if (!cancelled) setWearInsights(computeWearInsights(trips, byId, byTripId));
        }
      } catch {}
      if (!cancelled) setNudges(buildNudges(trips, wardrobe, reflected));
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, trips, wardrobe, user?.id]);

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
            await deleteTripRemote(t.id);
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
      // Trip invites are paused during the Firebase migration (the accept
      // flow was never built server-side — see IMPROVEMENTS.md §5).
      Alert.alert('Coming soon', 'Trip invites are being rebuilt on the new backend.');
    } finally {
      setInviteBusy(false);
    }
  };

  const openNudge = (nudge: TripNudge) => {
    if (nudge.trip_id) setSelectedTrip(nudge.trip_id);
    router.push(nudge.action_route as any);
  };

  const loadSampleCapsule = async () => {
    if (!selected) return;
    setDemoLoading(true);
    try {
      const officials = await listTemplates({ q: 'Lisbon', source: 'official' });
      const template =
        officials.find((item) => item.title.toLowerCase().includes('lisbon')) ||
        officials[0] ||
        (await listTemplates({ source: 'official' }))[0];
      if (!template) throw new Error('No official templates available');
      await applyTemplateToTrip(selected.id, template.items);
      router.push('/(tabs)/grid');
    } catch {
      Alert.alert('Sample capsule unavailable', 'Try again after templates finish loading.');
    } finally {
      setDemoLoading(false);
    }
  };

  // Once the checklist is fully done it's just dead chrome — stop showing it.
  // While there's still real progress to make, its position swaps with the
  // trip carousel: brand-new users see the guide first (nothing to show in
  // "Upcoming Trips" yet); anyone with an actual trip sees that lead instead,
  // with the guide demoted below it.
  const guideSteps = [
    trips.length > 0,
    wardrobe.filter((w) => w.category === 'top').length >= 3,
    wardrobe.filter((w) => w.category === 'bottom').length >= 3,
    wardrobe.filter((w) => w.category === 'layer').length >= 3,
    Boolean(selected && selected.grid.filter(Boolean).length === 9),
    Boolean(selected && selected.grid.filter(Boolean).length === 9),
  ];
  const guideComplete = guideSteps.every(Boolean);

  const launchGuide = guideComplete ? null : (
    <>
      <View style={[styles.guideBox, { borderColor: c.borderSubtle, backgroundColor: c.surface }]}>
        <Text style={[styles.section, { color: c.textPrimary }]}>LAUNCH GUIDE</Text>
        <GuideStep done={guideSteps[0]} label="Create a trip" />
        <GuideStep done={guideSteps[1]} label="Add 3 tops" />
        <GuideStep done={guideSteps[2]} label="Add 3 bottoms" />
        <GuideStep done={guideSteps[3]} label="Add 3 layers" />
        <GuideStep done={guideSteps[4]} label="Fill the grid" />
        <GuideStep done={guideSteps[5]} label="Review outfits and pack" />
      </View>

      {selected && wardrobe.length === 0 && (
        <>
          <View style={{ height: 12 }} />
          <SampleCapsuleCard onLoadDemo={loadSampleCapsule} loading={demoLoading} />
        </>
      )}

      <View style={{ height: 24 }} />
    </>
  );

  const tripsSection = (
    <>
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
          const tmin = w?.temperature_2m_min?.[0];
          const tmax = w?.temperature_2m_max?.[0];
          const weatherStr = tmax != null ? ` · ${Math.round(tmin)}–${Math.round(tmax)}°` : '';
          return (
            <View key={t.id} style={styles.tripCardWrap}>
              <TripCard
                testID={`trip-card-${t.id}`}
                onPress={() => setSelectedTrip(t.id)}
                onLongPress={() => onDeleteTrip(t)}
                dates={`${t.start_date} – ${t.end_date}`}
                daysLeft={countdown >= 0 ? `${countdown}d left` : 'Started'}
                destination={t.destination}
                meta={`${days}d · ${t.grid.filter(Boolean).length}/9 packed${weatherStr}`}
                progress={gridProgress(t.grid)}
                style={selected?.id === t.id ? { borderColor: c.accent } : undefined}
              />
            </View>
          );
        })}
      </ScrollView>

      <View style={{ height: 24 }} />
    </>
  );

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
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <IconButton
              testID="theme-toggle-button"
              icon={mode === 'dark' ? 'sunny-outline' : 'moon-outline'}
              accessibilityLabel="Toggle theme"
              onPress={toggle}
            />
            <IconButton
              testID="settings-button"
              icon="settings-outline"
              accessibilityLabel="Settings"
              onPress={() => router.push('/settings')}
            />
            <IconButton
              testID="logout-button"
              icon="log-out-outline"
              accessibilityLabel="Sign out"
              onPress={() => {
                Alert.alert('Sign out?', '', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Sign out', style: 'destructive', onPress: () => logout() },
                ]);
              }}
            />
          </View>
        </View>

        <View style={{ height: 24 }} />

        {trips.length > 0 ? (
          <>
            {tripsSection}
            {launchGuide}
          </>
        ) : (
          <>
            {launchGuide}
            {tripsSection}
          </>
        )}

        {/* Stats */}
        <Text style={[styles.section, { color: c.textPrimary }]}>STATS</Text>
        <View style={styles.statsRow}>
          <StatTile value={String(stats?.packing_score ?? totalOutfits)} label={stats ? 'SCORE' : 'OUTFITS'} />
          <StatTile value={`${stats?.planned_days ?? itemsPacked}/${stats?.trip_days ?? 9}`} label={stats ? 'DAYS' : 'ITEMS'} />
          <StatTile value={String(stats?.items_per_day ?? efficiency)} label={stats ? 'ITEMS/DAY' : 'RATIO'} />
        </View>

        {stats && (
          <View style={[styles.scorePanel, { borderColor: c.borderSubtle, backgroundColor: c.surface }]}>
            <View style={styles.scoreHeader}>
              <Text style={[styles.section, { color: c.textPrimary }]}>PACKING SCORE</Text>
              <Text style={{ color: c.accentText, fontSize: 12, fontWeight: '800' }}>{stats.packing_score}/100</Text>
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

        {wearInsights[0] && (
          <>
            <View style={{ height: 24 }} />
            <Text style={[styles.section, { color: c.textPrimary }]}>WEAR INSIGHTS</Text>
            <View style={[styles.wearInsightCard, { borderColor: c.borderSubtle, backgroundColor: c.surface }]}>
              <Ionicons name="analytics-outline" size={20} color={c.accent} />
              <Text style={[t.body, { color: c.textPrimary, flex: 1 }]}>
                <Text style={{ fontWeight: '700' }}>{wearInsights[0].itemName}</Text>: packed{' '}
                {wearInsights[0].packedTrips} trips, worn {wearInsights[0].wornTrips}×
              </Text>
            </View>
          </>
        )}

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
                  <Text style={{ color: c.accentText, fontSize: 16, fontWeight: '900', marginTop: 10 }}>
                    CODE {invites[0].code}
                  </Text>
                )}
              </View>
              <Pressable
                onPress={createInvite}
                disabled={inviteBusy}
                style={[styles.inviteButton, { borderColor: c.accent }]}
              >
                <Ionicons name="person-add-outline" size={16} color={c.accentText} />
                <Text style={{ color: c.accentText, fontSize: 11, fontWeight: '900' }}>
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
              <Ionicons name="checkmark-circle-outline" size={14} color={c.accentText} />
              <Text
                style={{
                  color: c.accentText, fontSize: 11, letterSpacing: 1.5, fontWeight: '600',
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
          <Text style={[styles.ctaText, { color: c.accentText }]}>BUILD THE GRID</Text>
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

function SampleCapsuleCard({ onLoadDemo, loading }: { onLoadDemo: () => void; loading: boolean }) {
  const { c } = useTheme();
  return (
    <View style={[styles.sampleCard, { borderColor: c.borderSubtle, backgroundColor: c.surface }]}>
      <Ionicons name="sparkles-outline" size={30} color={c.accent} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.textPrimary, fontSize: 16, fontWeight: '900' }}>
          Preview a packed trip
        </Text>
        <Text style={{ color: c.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 4 }}>
          Load a sample capsule to see the grid, lookbook, and checklist before adding photos.
        </Text>
      </View>
      <Pressable
        onPress={onLoadDemo}
        disabled={loading}
        style={({ pressed }) => [
          styles.demoBtn,
          { backgroundColor: c.accent, opacity: loading ? 0.6 : pressed ? 0.82 : 1 },
        ]}
      >
        {loading ? (
          <ActivityIndicator color={c.accentInk} />
        ) : (
          <Text style={[t.kicker, { color: c.accentInk, fontSize: 11 }]}>LOAD</Text>
        )}
      </Pressable>
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
      style={[styles.nudgeCard, { borderColor: c.borderSubtle, backgroundColor: c.accentSoft }]}
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
  brand: { fontFamily: fonts.kicker, fontSize: 20, letterSpacing: 4 },
  greet: { fontFamily: fonts.body, fontSize: 11, letterSpacing: 1, marginTop: 4 },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  section: { fontFamily: fonts.kicker, fontSize: 11, letterSpacing: 1.5 },
  subdued: { fontFamily: fonts.kicker, fontSize: 11, letterSpacing: 1 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6,
  },
  addBtnText: { fontFamily: fonts.kicker, fontSize: 11, letterSpacing: 1.5 },
  emptyCard: {
    width: 280, height: 180, borderWidth: 1, borderRadius: radius.sharp,
    alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed',
  },
  tripCardWrap: { width: 280, marginRight: 12 },
  progressTrack: { height: 4, borderRadius: radius.sharp, overflow: 'hidden' },
  progressFill: { height: 4 },
  statsRow: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  scorePanel: { borderWidth: 1, borderRadius: radius.sharp, padding: 14, marginTop: 12 },
  scoreHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  scoreMetaRow: { flexDirection: 'row', marginTop: 12 },
  scoreMeta: { flex: 1, alignItems: 'center' },
  nudgeCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: radius.sharp, padding: 12 },
  nudgeIcon: { width: 34, height: 34, borderRadius: radius.sharp, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  invitePanel: { flexDirection: 'row', gap: 12, borderWidth: 1, borderRadius: radius.sharp, padding: 14, alignItems: 'center' },
  wearInsightCard: { flexDirection: 'row', gap: space.sm, borderWidth: 1, borderRadius: radius.sharp, padding: space.md, marginTop: space.md, alignItems: 'center' },
  inviteButton: { height: 38, borderWidth: 1, borderRadius: radius.sharp, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 5, paddingHorizontal: 10 },
  wardrobeBox: { borderWidth: 1, borderRadius: radius.sharp, padding: 16, marginTop: 12, gap: 12 },
  wardrobeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  catLabel: { fontFamily: fonts.kicker, fontSize: 12, letterSpacing: 1.5, width: 80 },
  dotsRow: { flexDirection: 'row', gap: 6, flex: 1, justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  cta: { borderWidth: 1, borderRadius: radius.sharp, padding: 16, alignItems: 'center' },
  ctaText: { fontFamily: fonts.kicker, fontSize: 13, letterSpacing: 2 },
  climateBox: { borderWidth: 1, borderRadius: radius.sharp, padding: 12, marginTop: 12 },
  guideBox: { borderWidth: 1, borderRadius: radius.sharp, padding: 14, gap: 10 },
  guideStep: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sampleCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: radius.sharp, padding: 14 },
  demoBtn: { minWidth: 68, height: 38, borderRadius: radius.sharp, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
});
