/**
 * Firestore data layer — replaces the FastAPI/Mongo REST calls feature by
 * feature (see FIRESTORE_MIGRATION.md at the repo root for the phase plan).
 *
 * Data model:
 *   users/{uid}                     profile (is_pro is server-managed, see rules)
 *   users/{uid}/wardrobe/{itemId}   WardrobeItem
 *   users/{uid}/trips/{tripId}      Trip (grid/favorites/checklist/plan inline)
 *
 * All validation that used to live in server.py (slot categories, unique
 * grid items, safe keys, date checks) is ported here. Firestore security
 * rules enforce ownership; this module enforces shape.
 */
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  Timestamp,
} from 'firebase/firestore';
import { getDb } from './firebase';
import type { Trip, User, WardrobeItem } from './api';

// ---------- shared helpers ----------

export const CATEGORY_BY_SLOT = [
  'top', 'bottom', 'layer', 'bottom', 'layer', 'top', 'layer', 'top', 'bottom',
] as const;

const SAFE_STATE_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9:_\-|]{0,127}$/;

function assertSafeKey(key: string, field: string): void {
  if (!SAFE_STATE_KEY_RE.test(key)) {
    throw new Error(`${field} contains unsupported characters`);
  }
}

function assertIsoDate(value: string, field = 'date'): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${field} must use YYYY-MM-DD format`);
  }
}

function newId(): string {
  // Firestore auto-ids; keep string uuid-ish shape the rest of the app expects.
  return doc(collection(getDb(), '_ids')).id;
}

function toIso(value: unknown): string {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === 'string') return value;
  return new Date().toISOString();
}

// ---------- user profile ----------

export async function ensureUserDoc(params: {
  uid: string;
  email: string;
  name?: string | null;
}): Promise<User> {
  const db = getDb();
  const ref = doc(db, 'users', params.uid);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) {
    const profile = {
      id: params.uid,
      email: params.email,
      name: params.name ?? null,
      is_pro: false,
      airline_profiles: [
        { id: 'carry-on', name: 'Generic Carry-on', max_kg: 7.0 },
        { id: 'iata', name: 'IATA Standard', max_kg: 7.0 },
      ],
      created_at: serverTimestamp(),
    };
    await setDoc(ref, profile);
    return { ...profile, created_at: new Date().toISOString() } as User;
  }
  const data = snapshot.data();
  return { ...data, created_at: toIso(data.created_at) } as User;
}

// ---------- wardrobe ----------

export type WardrobeItemInput = {
  name: string;
  category: 'top' | 'bottom' | 'layer';
  image: string;
  colors?: string[];
  weight_kg?: number;
  tags?: string[];
};

function normalizeWardrobeInput(input: WardrobeItemInput) {
  const name = input.name.trim().replace(/\s+/g, ' ').slice(0, 80);
  if (!name) throw new Error('Name cannot be empty');
  if (!['top', 'bottom', 'layer'].includes(input.category)) {
    throw new Error('category must be top, bottom, or layer');
  }
  const tags = (input.tags ?? [])
    .map((t) => t.toLowerCase().replace(/#/g, '').replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24))
    .filter((t, i, arr) => t && arr.indexOf(t) === i)
    .slice(0, 12);
  const colors = (input.colors ?? [])
    .map((c) => c.trim().slice(0, 32))
    .filter((c, i, arr) => c && arr.indexOf(c) === i)
    .slice(0, 6);
  const weight = Math.min(Math.max(input.weight_kg ?? 0.3, 0), 50);
  return { name, category: input.category, image: input.image, colors, weight_kg: weight, tags };
}

export async function listWardrobe(uid: string): Promise<WardrobeItem[]> {
  const snapshot = await getDocs(
    query(collection(getDb(), 'users', uid, 'wardrobe'), orderBy('created_at', 'desc'))
  );
  return snapshot.docs.map((d) => {
    const data = d.data();
    return { ...data, id: d.id, user_id: uid, created_at: toIso(data.created_at) } as WardrobeItem;
  });
}

export async function createWardrobeItem(uid: string, input: WardrobeItemInput): Promise<WardrobeItem> {
  const data = normalizeWardrobeInput(input);
  const id = newId();
  await setDoc(doc(getDb(), 'users', uid, 'wardrobe', id), {
    ...data,
    created_at: serverTimestamp(),
  });
  return { ...data, id, user_id: uid, created_at: new Date().toISOString() };
}

export async function updateWardrobeItem(
  uid: string,
  itemId: string,
  patch: Partial<WardrobeItemInput>
): Promise<void> {
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined || patch.category !== undefined) {
    // Re-run normalization on the merged doc for correctness.
    const current = (await getDoc(doc(getDb(), 'users', uid, 'wardrobe', itemId))).data();
    if (!current) throw new Error('Item not found');
    const merged = normalizeWardrobeInput({ ...(current as WardrobeItemInput), ...patch });
    Object.assign(update, merged);
    if (merged.category !== current.category) {
      await clearInvalidGridSlotsForItem(uid, itemId, merged.category);
    }
  } else {
    if (patch.image !== undefined) update.image = patch.image;
    if (patch.colors !== undefined) update.colors = patch.colors.slice(0, 6);
    if (patch.tags !== undefined) update.tags = patch.tags.slice(0, 12);
    if (patch.weight_kg !== undefined) update.weight_kg = Math.min(Math.max(patch.weight_kg, 0), 50);
  }
  if (Object.keys(update).length) {
    await updateDoc(doc(getDb(), 'users', uid, 'wardrobe', itemId), update);
  }
}

export async function deleteWardrobeItem(uid: string, itemId: string): Promise<void> {
  await deleteDoc(doc(getDb(), 'users', uid, 'wardrobe', itemId));
  // Remove the item from any trip grids (mirrors server.py delete cleanup).
  const trips = await listTrips(uid);
  const batch = writeBatch(getDb());
  for (const trip of trips) {
    if (!trip.grid.includes(itemId)) continue;
    const grid = trip.grid.map((slot) => (slot === itemId ? null : slot));
    batch.update(doc(getDb(), 'users', uid, 'trips', trip.id), {
      grid,
      ...cleanOutfitStateForGrid(trip, grid),
      checklist_state: cleanChecklistStateForGrid(trip, grid),
    });
  }
  await batch.commit();
}

async function clearInvalidGridSlotsForItem(
  uid: string,
  itemId: string,
  category: string
): Promise<void> {
  const trips = await listTrips(uid);
  const batch = writeBatch(getDb());
  let dirty = false;
  for (const trip of trips) {
    let changed = false;
    const grid = trip.grid.map((slot, index) => {
      if (slot === itemId && CATEGORY_BY_SLOT[index] !== category) {
        changed = true;
        return null;
      }
      return slot;
    });
    if (!changed) continue;
    dirty = true;
    batch.update(doc(getDb(), 'users', uid, 'trips', trip.id), {
      grid,
      ...cleanOutfitStateForGrid(trip, grid),
      checklist_state: cleanChecklistStateForGrid(trip, grid),
    });
  }
  if (dirty) await batch.commit();
}

// ---------- trips ----------

export type TripInput = {
  destination: string;
  start_date: string;
  end_date: string;
  latitude?: number | null;
  longitude?: number | null;
};

export async function listTrips(uid: string): Promise<Trip[]> {
  const snapshot = await getDocs(
    query(collection(getDb(), 'users', uid, 'trips'), orderBy('start_date', 'asc'))
  );
  return snapshot.docs.map((d) => {
    const data = d.data();
    return { ...data, id: d.id, user_id: uid, created_at: toIso(data.created_at) } as Trip;
  });
}

export async function createTrip(uid: string, input: TripInput): Promise<Trip> {
  assertIsoDate(input.start_date, 'start_date');
  assertIsoDate(input.end_date, 'end_date');
  if (input.end_date < input.start_date) {
    throw new Error('Trip end date must be on or after start date');
  }
  const id = newId();
  const trip = {
    destination: input.destination.trim().slice(0, 120),
    start_date: input.start_date,
    end_date: input.end_date,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    grid: Array(9).fill(null) as (string | null)[],
    favorites: [] as string[],
    occasion_tags: {} as Record<string, string>,
    checklist_state: {} as Record<string, boolean>,
    extras: [] as Trip['extras'],
    outfit_plan: {} as Record<string, string>,
  };
  await setDoc(doc(getDb(), 'users', uid, 'trips', id), {
    ...trip,
    created_at: serverTimestamp(),
  });
  return { ...trip, id, user_id: uid, created_at: new Date().toISOString() };
}

export async function deleteTrip(uid: string, tripId: string): Promise<void> {
  await deleteDoc(doc(getDb(), 'users', uid, 'trips', tripId));
}

export async function updateGrid(
  uid: string,
  trip: Trip,
  grid: (string | null)[],
  wardrobe: WardrobeItem[]
): Promise<void> {
  if (grid.length !== 9) throw new Error('Grid must have exactly 9 slots');
  const ids = grid.filter((x): x is string => Boolean(x));
  if (new Set(ids).size !== ids.length) throw new Error('Each grid item can only be used once');
  const byId = new Map(wardrobe.map((w) => [w.id, w]));
  grid.forEach((itemId, slot) => {
    if (!itemId) return;
    const item = byId.get(itemId);
    if (!item) throw new Error('Grid contains items outside your wardrobe');
    if (item.category !== CATEGORY_BY_SLOT[slot]) {
      throw new Error(`Slot ${slot + 1} expects ${CATEGORY_BY_SLOT[slot]}, found ${item.category}`);
    }
  });
  await updateDoc(doc(getDb(), 'users', uid, 'trips', trip.id), {
    grid,
    ...cleanOutfitStateForGrid(trip, grid),
    checklist_state: cleanChecklistStateForGrid(trip, grid),
  });
}

export async function setChecklistItem(
  uid: string,
  tripId: string,
  itemKey: string,
  checked: boolean
): Promise<void> {
  assertSafeKey(itemKey, 'item_key');
  await updateDoc(doc(getDb(), 'users', uid, 'trips', tripId), {
    [`checklist_state.${itemKey}`]: checked,
  });
}

export async function setFavorite(
  uid: string,
  trip: Trip,
  outfitKey: string,
  isFavorite: boolean
): Promise<void> {
  assertSafeKey(outfitKey, 'outfit_key');
  const favorites = new Set((trip.favorites ?? []).map(String));
  if (isFavorite) favorites.add(outfitKey);
  else favorites.delete(outfitKey);
  await updateDoc(doc(getDb(), 'users', uid, 'trips', trip.id), {
    favorites: [...favorites].sort(),
  });
}

export async function setOccasion(
  uid: string,
  tripId: string,
  outfitKey: string,
  occasion: string
): Promise<void> {
  assertSafeKey(outfitKey, 'outfit_key');
  await updateDoc(doc(getDb(), 'users', uid, 'trips', tripId), {
    [`occasion_tags.${outfitKey}`]: occasion.slice(0, 40),
  });
}

export async function setOutfitPlan(
  uid: string,
  trip: Trip,
  date: string,
  outfitKey: string | null
): Promise<void> {
  assertIsoDate(date);
  if (date < trip.start_date || date > trip.end_date) {
    throw new Error('date must be within the trip dates');
  }
  if (outfitKey) {
    assertSafeKey(outfitKey, 'outfit_key');
    await updateDoc(doc(getDb(), 'users', uid, 'trips', trip.id), {
      [`outfit_plan.${date}`]: outfitKey,
    });
  } else {
    await updateDoc(doc(getDb(), 'users', uid, 'trips', trip.id), {
      [`outfit_plan.${date}`]: deleteField(),
    });
  }
}

export async function addExtra(
  uid: string,
  tripId: string,
  extra: { name: string; category: string; weight_kg: number },
  currentExtras: Trip['extras']
): Promise<void> {
  const next = [...currentExtras, { id: newId(), ...extra }];
  await updateDoc(doc(getDb(), 'users', uid, 'trips', tripId), { extras: next });
}

export async function removeExtra(
  uid: string,
  tripId: string,
  extraId: string,
  currentExtras: Trip['extras']
): Promise<void> {
  await updateDoc(doc(getDb(), 'users', uid, 'trips', tripId), {
    extras: currentExtras.filter((e) => e.id !== extraId),
  });
}

// ---------- grid/outfit state cleanup (ported from server.py) ----------

const TOP_SLOTS = [0, 5, 7];
const BOTTOM_SLOTS = [1, 3, 8];
const LAYER_SLOTS = [2, 4, 6];

export function validOutfitKeys(grid: (string | null)[]): Set<string> {
  const keys = new Set<string>();
  const allSlots = [...TOP_SLOTS, ...BOTTOM_SLOTS, ...LAYER_SLOTS];
  if (grid.length !== 9 || allSlots.some((slot) => !grid[slot])) return keys;
  for (const t of TOP_SLOTS) {
    for (const b of BOTTOM_SLOTS) {
      for (const l of LAYER_SLOTS) {
        keys.add([grid[t], grid[b], grid[l]].join('|'));
      }
    }
  }
  return keys;
}

function cleanOutfitStateForGrid(trip: Trip, grid: (string | null)[]) {
  const valid = validOutfitKeys(grid);
  if (!valid.size) {
    return { favorites: [], occasion_tags: {}, outfit_plan: {} };
  }
  return {
    favorites: (trip.favorites ?? []).filter((f): f is string => typeof f === 'string' && valid.has(f)),
    occasion_tags: Object.fromEntries(
      Object.entries(trip.occasion_tags ?? {}).filter(([key]) => valid.has(key))
    ),
    outfit_plan: Object.fromEntries(
      Object.entries(trip.outfit_plan ?? {}).filter(([, key]) => valid.has(key))
    ),
  };
}

function cleanChecklistStateForGrid(trip: Trip, grid: (string | null)[]) {
  const validGridKeys = new Set(grid.filter(Boolean).map((id) => `grid:${id}`));
  const cleaned: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(trip.checklist_state ?? {})) {
    if (key.startsWith('grid:') && !validGridKeys.has(key)) continue;
    cleaned[key] = Boolean(value);
  }
  return cleaned;
}
