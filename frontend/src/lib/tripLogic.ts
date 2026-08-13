/**
 * Pure trip logic ported from backend/server.py (compute_trip_stats,
 * score_outfit, retention nudges). Runs entirely on-device over the
 * Firestore-backed store state — no network calls.
 */
import type { OutfitSuggestion, Trip, TripNudge, TripStats, WardrobeItem } from './api';

export const ESSENTIAL_KEYS = ['passport', 'wallet', 'phone-charger', 'toothbrush', 'shampoo', 'deodorant'];

const TOP_SLOTS = [0, 5, 7];
const BOTTOM_SLOTS = [1, 3, 8];
const LAYER_SLOTS = [2, 4, 6];

export type GridOutfit = {
  index: number;
  key: string;
  item_ids: string[];
  slots: number[];
};

export function daysBetween(startDate: string, endDate: string): number {
  const start = Date.parse(startDate);
  const end = Date.parse(endDate);
  if (Number.isNaN(start) || Number.isNaN(end)) return 1;
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

export function gridOutfits(grid: (string | null)[]): GridOutfit[] {
  const allSlots = [...TOP_SLOTS, ...BOTTOM_SLOTS, ...LAYER_SLOTS];
  if (grid.length !== 9 || allSlots.some((slot) => !grid[slot])) return [];
  const outfits: GridOutfit[] = [];
  let index = 0;
  for (const t of TOP_SLOTS) {
    for (const b of BOTTOM_SLOTS) {
      for (const l of LAYER_SLOTS) {
        const ids = [grid[t] as string, grid[b] as string, grid[l] as string];
        outfits.push({ index, key: ids.join('|'), item_ids: ids, slots: [t, b, l] });
        index += 1;
      }
    }
  }
  return outfits;
}

// ---------- stats ----------

export function computeTripStats(trip: Trip, wardrobeById: Record<string, WardrobeItem>): TripStats {
  const grid = trip.grid ?? [];
  const tripDays = daysBetween(trip.start_date, trip.end_date);
  const gridIds = grid.filter((id): id is string => Boolean(id && wardrobeById[id]));
  const completedGrid = gridIds.length === 9;
  const plannedDays = Object.keys(trip.outfit_plan ?? {}).length;
  const checklistState = trip.checklist_state ?? {};
  const extras = trip.extras ?? [];

  const checklistKeys = [
    ...gridIds.map((id) => `grid:${id}`),
    ...ESSENTIAL_KEYS.map((key) => `ess:${key}`),
    ...extras.filter((e) => e.id).map((e) => `ext:${e.id}`),
  ];
  const checked = checklistKeys.filter((key) => checklistState[key]).length;
  const checklistProgress = checklistKeys.length ? checked / checklistKeys.length : 0;

  let totalWeight = gridIds.reduce((sum, id) => sum + (Number(wardrobeById[id]?.weight_kg) || 0), 0);
  totalWeight += extras.reduce((sum, e) => sum + (Number(e.weight_kg) || 0), 0);

  const colorCounts: Record<string, number> = {};
  for (const id of gridIds) {
    for (const color of wardrobeById[id]?.colors ?? []) {
      colorCounts[color] = (colorCounts[color] ?? 0) + 1;
    }
  }
  const mostUsedColor = Object.keys(colorCounts).length
    ? Object.entries(colorCounts).sort((a, b) => b[1] - a[1])[0][0]
    : null;

  const gridScore = (gridIds.length / 9) * 35;
  const planScore = tripDays ? (plannedDays / tripDays) * 25 : 0;
  const checklistScore = checklistProgress * 25;
  const weightScore = totalWeight <= 7 ? 15 : Math.max(0, 15 - (totalWeight - 7) * 5);

  return {
    packing_score: Math.round(Math.min(100, gridScore + planScore + checklistScore + weightScore)),
    items_per_day: tripDays ? Math.round((gridIds.length / tripDays) * 100) / 100 : 0,
    outfit_variety: completedGrid ? 27 : 0,
    most_used_color: mostUsedColor,
    completed_grid: completedGrid,
    planned_days: plannedDays,
    trip_days: tripDays,
    checklist_progress: Math.round(checklistProgress * 100) / 100,
    total_weight_kg: Math.round(totalWeight * 100) / 100,
  };
}

// ---------- outfit suggestions ----------

function itemTags(items: WardrobeItem[]): Set<string> {
  const tags = new Set<string>();
  for (const item of items) {
    for (const tag of item.tags ?? []) tags.add(String(tag).toLowerCase().replace(/#/g, ''));
  }
  return tags;
}

function destinationContextTags(trip: Trip, day?: string | null): Set<string> {
  const destination = (trip.destination ?? '').toLowerCase();
  const context = new Set<string>();
  if (['bali', 'singapore', 'miami', 'phuket', 'dubai', 'beach'].some((w) => destination.includes(w))) {
    context.add('tropical');
    context.add('beach');
  }
  if (['reykjavik', 'iceland', 'alaska', 'ski', 'snow'].some((w) => destination.includes(w))) {
    context.add('snow');
    context.add('cold');
  }
  const target = day || trip.start_date;
  const month = Number(target?.slice(5, 7));
  if ([12, 1, 2].includes(month)) context.add('cold');
  if ([6, 7, 8].includes(month)) context.add('tropical');
  return context;
}

const OCCASION_MATCHES: Record<string, string[]> = {
  formal: ['formal', 'business', 'modest'],
  business: ['formal', 'business'],
  travel: ['casual', 'tropical', 'beach', 'modest'],
  active: ['gym', 'casual'],
  casual: ['casual', 'denim', 'linen'],
  modest: ['modest', 'layer', 'linen'],
};

export function scoreOutfitSuggestions(
  trip: Trip,
  wardrobeById: Record<string, WardrobeItem>,
  day?: string | null,
  occasion?: string | null
): OutfitSuggestion[] {
  const outfits = gridOutfits(trip.grid ?? []);
  const context = destinationContextTags(trip, day);
  const target = (occasion ?? '').toLowerCase();
  const favorites = new Set((trip.favorites ?? []).map(String));

  const suggestions: OutfitSuggestion[] = [];
  for (const outfit of outfits) {
    const items = outfit.item_ids.map((id) => wardrobeById[id]).filter(Boolean) as WardrobeItem[];
    if (items.length !== 3) continue;
    const tags = itemTags(items);
    let score = 55;
    const reasons: string[] = [];

    if (favorites.has(outfit.key)) {
      score += 14;
      reasons.push('favorited');
    }
    if (target) {
      const matches = new Set(OCCASION_MATCHES[target] ?? [target]);
      const hits = [...tags].filter((t) => matches.has(t)).length;
      if (hits) {
        score += Math.min(18, 6 * hits);
        reasons.push(`${target} tags`);
      }
    }
    const climateHits = [...tags].filter((t) => context.has(t)).length;
    if (climateHits) {
      score += Math.min(15, 5 * climateHits);
      reasons.push('destination fit');
    }

    const colorCount: Record<string, number> = {};
    for (const item of items) {
      for (const color of item.colors ?? []) colorCount[color] = (colorCount[color] ?? 0) + 1;
    }
    if (Object.values(colorCount).some((n) => n > 1)) {
      score += 8;
      reasons.push('color repeat');
    }

    const weight = items.reduce((sum, item) => sum + (Number(item.weight_kg) || 0), 0);
    if (weight <= 1.2) {
      score += 5;
      reasons.push('lightweight');
    }
    if (!reasons.length) reasons.push('balanced grid pick');

    suggestions.push({
      outfit_key: outfit.key,
      outfit_index: outfit.index,
      date: day ?? null,
      occasion: occasion || 'Any',
      score: Math.max(0, Math.min(100, score)),
      reason: reasons.slice(0, 3).join(', '),
      item_ids: outfit.item_ids,
      item_names: items.map((item) => item.name || 'Item'),
    });
  }
  suggestions.sort((a, b) => b.score - a.score || a.outfit_index - b.outfit_index);
  return suggestions.slice(0, 5);
}

// ---------- wear-count insights ----------

export type ReflectionRecord = { worn_outfit_keys: string[]; unused_item_ids: string[] };
export type WearInsight = { itemId: string; itemName: string; packedTrips: number; wornTrips: number };

// Ranks items by how rarely they get worn relative to how often they're
// packed — "packed 4 trips, worn once" is the actionable signal (an item
// earning its luggage space vs. one that's dead weight).
export function computeWearInsights(
  trips: Trip[],
  wardrobeById: Record<string, WardrobeItem>,
  reflectionsByTripId: Record<string, ReflectionRecord[]>
): WearInsight[] {
  const stats: Record<string, { packed: number; worn: number }> = {};
  for (const trip of trips) {
    const reflections = reflectionsByTripId[trip.id];
    if (!reflections?.length) continue;
    const wornIds = new Set(reflections.flatMap((r) => r.worn_outfit_keys.flatMap((k) => k.split('|'))));
    const gridIds = (trip.grid ?? []).filter((id): id is string => Boolean(id));
    for (const id of gridIds) {
      if (!wardrobeById[id]) continue;
      const entry = (stats[id] ??= { packed: 0, worn: 0 });
      entry.packed += 1;
      if (wornIds.has(id)) entry.worn += 1;
    }
  }
  return Object.entries(stats)
    .map(([itemId, s]) => ({
      itemId,
      itemName: wardrobeById[itemId]?.name || 'Item',
      packedTrips: s.packed,
      wornTrips: s.worn,
    }))
    .filter((insight) => insight.packedTrips >= 2)
    .sort(
      (a, b) =>
        a.wornTrips / a.packedTrips - b.wornTrips / b.packedTrips || b.packedTrips - a.packedTrips
    );
}

// ---------- retention nudges ----------

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function buildNudges(
  trips: Trip[],
  wardrobe: WardrobeItem[],
  reflectedTripIds: Set<string>
): TripNudge[] {
  const today = localToday();
  const nudges: TripNudge[] = [];

  for (const trip of trips) {
    const daysUntil = Math.round((Date.parse(trip.start_date) - Date.parse(today)) / 86_400_000);
    const filled = (trip.grid ?? []).filter(Boolean).length;
    if (daysUntil >= 0 && daysUntil <= 7 && filled < 9) {
      nudges.push({
        id: `pre-trip-${trip.id}`,
        kind: 'pre_trip',
        trip_id: trip.id,
        title: `${trip.destination} is in ${daysUntil} days`,
        message: 'Your grid is not complete yet. Fill the 9 slots before packing day.',
        action_route: '/(tabs)/grid',
      });
    }
    if (trip.end_date < today && !reflectedTripIds.has(trip.id)) {
      nudges.push({
        id: `post-trip-${trip.id}`,
        kind: 'post_trip',
        trip_id: trip.id,
        title: `Reflect on ${trip.destination}`,
        message: 'Mark what you wore and what stayed unused so Packr learns for your next trip.',
        action_route: '/(tabs)/lookbook',
      });
    }
  }

  if (trips.length >= 3 && wardrobe.length) {
    const layers = wardrobe.filter((item) => item.category === 'layer');
    const name = (layers[0] ?? wardrobe[0])?.name;
    nudges.push({
      id: 'wardrobe-audit',
      kind: 'wardrobe_audit',
      trip_id: null,
      title: 'Wardrobe audit',
      message: `You have enough trip history to review repeats. Start with ${name || 'your most-used layer'} and add alternatives.`,
      action_route: '/(tabs)/studio',
    });
  }

  if (!nudges.length) {
    nudges.push({
      id: 'monthly-challenge',
      kind: 'challenge',
      trip_id: null,
      title: 'Try the monthly challenge',
      message: 'Pack 5 days with only neutrals and share one screenshot to the community feed.',
      action_route: '/(tabs)/community',
    });
  }
  return nudges.slice(0, 5);
}
