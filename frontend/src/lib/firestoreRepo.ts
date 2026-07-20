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
  increment,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  Timestamp,
} from 'firebase/firestore';
import { getDb } from './firebase';
import type { Template, Trip, User, WardrobeItem } from './api';

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
  const itemRef = doc(getDb(), 'users', uid, 'wardrobe', itemId);
  const snapshot = await getDoc(itemRef);
  const imageUrl = snapshot.exists() ? String(snapshot.data().image ?? '') : '';
  await deleteDoc(itemRef);
  if (imageUrl) {
    // Best-effort Storage cleanup; never blocks the delete.
    import('./storage').then(({ deleteImageByUrl }) => deleteImageByUrl(imageUrl)).catch(() => {});
  }
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

// ---------- reflections ----------

export async function createReflection(
  uid: string,
  trip: Trip,
  input: { worn_outfit_keys: string[]; unused_item_ids: string[]; notes?: string; rating?: number | null }
): Promise<void> {
  const gridIds = new Set((trip.grid ?? []).filter(Boolean));
  const validKeys = validOutfitKeys(trip.grid ?? []);
  if (validKeys.size && input.worn_outfit_keys.some((key) => !validKeys.has(key))) {
    throw new Error('worn_outfit_keys must match this trip grid');
  }
  if (input.unused_item_ids.some((id) => !gridIds.has(id))) {
    throw new Error('unused_item_ids must come from this trip grid');
  }
  await setDoc(doc(getDb(), 'users', uid, 'trips', trip.id, 'reflections', newId()), {
    worn_outfit_keys: input.worn_outfit_keys,
    unused_item_ids: input.unused_item_ids,
    notes: (input.notes ?? '').slice(0, 1000),
    rating: input.rating ?? null,
    created_at: serverTimestamp(),
  });
}

export async function listReflectedTripIds(uid: string, trips: Trip[]): Promise<Set<string>> {
  const today = new Date().toISOString().slice(0, 10);
  const past = trips.filter((trip) => trip.end_date < today);
  const reflected = new Set<string>();
  await Promise.all(
    past.map(async (trip) => {
      const snapshot = await getDocs(collection(getDb(), 'users', uid, 'trips', trip.id, 'reflections'));
      if (!snapshot.empty) reflected.add(trip.id);
    })
  );
  return reflected;
}

// ---------- templates (apply backend/community template into Firestore) ----------

export async function applyTemplate(
  uid: string,
  trip: Trip,
  templateItems: Array<{ name?: string; category?: string; image?: string; colors?: string[]; tags?: string[] }>
): Promise<void> {
  if (templateItems.length !== 9) throw new Error('Template must include exactly 9 items');
  templateItems.forEach((item, slot) => {
    if (item.category !== CATEGORY_BY_SLOT[slot]) {
      throw new Error('Template item order is invalid');
    }
  });

  const db = getDb();
  const batch = writeBatch(db);

  // Clean up from-template clones referenced by this trip's previous grid
  // and unused by other trips (mirrors server.py apply cleanup).
  const priorIds = (trip.grid ?? []).filter((x): x is string => Boolean(x));
  if (priorIds.length) {
    const [wardrobe, trips] = await Promise.all([listWardrobe(uid), listTrips(uid)]);
    const byId = new Map(wardrobe.map((w) => [w.id, w]));
    for (const itemId of priorIds) {
      const item = byId.get(itemId);
      if (!item || !(item.tags ?? []).includes('from-template')) continue;
      const stillUsed = trips.some((t) => t.id !== trip.id && (t.grid ?? []).includes(itemId));
      if (!stillUsed) batch.delete(doc(db, 'users', uid, 'wardrobe', itemId));
    }
  }

  const newGrid: (string | null)[] = Array(9).fill(null);
  templateItems.forEach((raw, slot) => {
    const id = newId();
    batch.set(doc(db, 'users', uid, 'wardrobe', id), {
      name: raw.name ?? `Item ${slot + 1}`,
      category: CATEGORY_BY_SLOT[slot],
      image: raw.image ?? '',
      colors: raw.colors ?? [],
      weight_kg: 0.3,
      tags: [...new Set([...(raw.tags ?? []), 'from-template'])],
      created_at: serverTimestamp(),
    });
    newGrid[slot] = id;
  });

  batch.update(doc(db, 'users', uid, 'trips', trip.id), {
    grid: newGrid,
    ...cleanOutfitStateForGrid(trip, newGrid),
    checklist_state: cleanChecklistStateForGrid(trip, newGrid),
  });
  await batch.commit();
}

// ---------- templates collection ----------

function toTemplate(id: string, data: Record<string, unknown>): Template {
  return { ...(data as unknown as Template), id, created_at: toIso(data.created_at) };
}

export type TemplateFilters = {
  q?: string;
  climate?: string;
  daysMin?: number;
  daysMax?: number;
  source?: 'official' | 'community' | 'all';
};

export async function listTemplates(filters: TemplateFilters = {}): Promise<Template[]> {
  const snapshot = await getDocs(
    query(collection(getDb(), 'templates'), orderBy('likes', 'desc'), limit(200))
  );
  let templates = snapshot.docs.map((d) => toTemplate(d.id, d.data()));
  const q = filters.q?.trim().toLowerCase();
  if (q) {
    templates = templates.filter((t) =>
      [t.title, t.description, t.destination, t.season].some((v) => (v ?? '').toLowerCase().includes(q))
    );
  }
  if (filters.climate) templates = templates.filter((t) => t.climate === filters.climate);
  if (filters.daysMin != null) templates = templates.filter((t) => t.days >= (filters.daysMin as number));
  if (filters.daysMax != null) templates = templates.filter((t) => t.days <= (filters.daysMax as number));
  if (filters.source === 'official') templates = templates.filter((t) => t.is_official);
  if (filters.source === 'community') templates = templates.filter((t) => !t.is_official);
  // Official first, then by likes (query already sorted by likes).
  return templates.sort((a, b) => Number(b.is_official) - Number(a.is_official));
}

export async function getTemplate(id: string): Promise<Template> {
  const snapshot = await getDoc(doc(getDb(), 'templates', id));
  if (!snapshot.exists()) throw new Error('Template not found');
  return toTemplate(snapshot.id, snapshot.data());
}

export async function publishTemplate(
  uid: string,
  data: Omit<Template, 'id' | 'author_id' | 'author_name' | 'is_official' | 'likes' | 'created_at'>
): Promise<Template> {
  if (data.items.length !== 9) throw new Error('Template must include exactly 9 items');
  const id = newId();
  const docData = {
    ...data,
    author_id: uid,
    author_name: 'anonymous',
    is_official: false,
    likes: 0,
    created_at: serverTimestamp(),
  };
  await setDoc(doc(getDb(), 'templates', id), docData);
  return { ...docData, id, created_at: new Date().toISOString() } as Template;
}

export async function isTemplateLiked(uid: string, templateId: string): Promise<boolean> {
  const snapshot = await getDoc(doc(getDb(), 'templates', templateId, 'likes', uid));
  return snapshot.exists();
}

export async function setTemplateLike(uid: string, templateId: string, liked: boolean): Promise<void> {
  const db = getDb();
  const likeRef = doc(db, 'templates', templateId, 'likes', uid);
  const templateRef = doc(db, 'templates', templateId);
  await runTransaction(db, async (tx) => {
    const existing = await tx.get(likeRef);
    if (liked && !existing.exists()) {
      tx.set(likeRef, { user_id: uid, created_at: serverTimestamp() });
      tx.update(templateRef, { likes: increment(1) });
    } else if (!liked && existing.exists()) {
      tx.delete(likeRef);
      tx.update(templateRef, { likes: increment(-1) });
    }
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
