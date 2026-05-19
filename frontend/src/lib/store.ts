import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, TOKEN_KEY, User, Trip, WardrobeItem } from './api';
import {
  getCurrentFirebaseToken,
  isFirebaseAuthConfigured,
  loginWithFirebase,
  loginWithGoogleIdToken,
  loginWithNativeGoogle,
  loginWithGooglePopup,
  logoutFirebase,
  registerWithFirebase,
} from './firebaseAuth';

const USER_CACHE_KEY = 'packr.user';
const TRIPS_CACHE_KEY = 'packr.trips';
const WARDROBE_CACHE_KEY = 'packr.wardrobe';
const ONBOARDED_KEY = 'packr.onboarded';
const SELECTED_TRIP_KEY = 'packr.selectedTripId';
const SELECTED_AIRLINE_KEY = 'packr.airlineId';

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => {});
}

type State = {
  user: User | null;
  token: string | null;
  hydrated: boolean;
  onboarded: boolean;
  trips: Trip[];
  wardrobe: WardrobeItem[];
  selectedTripId: string | null;
  selectedAirlineId: string | null;

  hydrate: () => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: (googleIdToken: string) => Promise<void>;
  loginWithGoogleNative: () => Promise<void>;
  loginWithGoogleWeb: () => Promise<void>;
  logout: () => Promise<void>;
  finishOnboarding: () => Promise<void>;
  setUser: (u: User) => void;
  setSelectedAirline: (id: string | null) => void;

  refreshAll: () => Promise<void>;
  refreshTrips: () => Promise<void>;
  refreshWardrobe: () => Promise<void>;

  setSelectedTrip: (id: string | null) => void;
  upsertTrip: (t: Trip) => void;
  removeTrip: (id: string) => void;
  upsertWardrobeItem: (i: WardrobeItem) => void;
  removeWardrobeItem: (id: string) => void;
  toggleChecklistOptimistic: (tripId: string, itemKey: string) => void;
};

export const useStore = create<State>((set, get) => ({
  user: null,
  token: null,
  hydrated: false,
  onboarded: false,
  trips: [],
  wardrobe: [],
  selectedTripId: null,
  selectedAirlineId: null,

  hydrate: async () => {
    let token = await AsyncStorage.getItem(TOKEN_KEY);
    const firebaseToken = await getCurrentFirebaseToken();
    if (firebaseToken) {
      token = firebaseToken;
      await AsyncStorage.setItem(TOKEN_KEY, firebaseToken);
    }
    const onboarded = (await AsyncStorage.getItem(ONBOARDED_KEY)) === '1';
    const selectedTripId = await AsyncStorage.getItem(SELECTED_TRIP_KEY);
    const selectedAirlineId = await AsyncStorage.getItem(SELECTED_AIRLINE_KEY);
    const [cachedUser, cachedTrips, cachedWardrobe] = await Promise.all([
      readJson<User>(USER_CACHE_KEY),
      readJson<Trip[]>(TRIPS_CACHE_KEY),
      readJson<WardrobeItem[]>(WARDROBE_CACHE_KEY),
    ]);
    if (token) {
      if (cachedUser || cachedTrips || cachedWardrobe) {
        set({
          user: cachedUser,
          token,
          onboarded,
          selectedTripId,
          selectedAirlineId,
          trips: cachedTrips || [],
          wardrobe: cachedWardrobe || [],
          hydrated: true,
        });
      }
      try {
        const r = await api.get('/auth/me');
        writeJson(USER_CACHE_KEY, r.data);
        set({ user: r.data, token, onboarded, selectedTripId, selectedAirlineId, hydrated: true });
        await get().refreshAll();
        return;
      } catch (e: any) {
        if (e?.response?.status === 401 || e?.response?.status === 403) {
          await AsyncStorage.multiRemove([TOKEN_KEY, USER_CACHE_KEY]);
        } else if (cachedUser) {
          return;
        }
      }
    }
    set({ hydrated: true, onboarded, selectedTripId, selectedAirlineId });
  },

  register: async (email, password, name) => {
    if (isFirebaseAuthConfigured()) {
      let firebaseToken: string | null = null;
      try {
        firebaseToken = await registerWithFirebase(email, password, name);
      } catch {
        // If Firebase auth fails in development, fall back to backend
      }
      if (firebaseToken) {
        await AsyncStorage.setItem(TOKEN_KEY, firebaseToken);
        const r = await api.get('/auth/me');
        writeJson(USER_CACHE_KEY, r.data);
        set({ token: firebaseToken, user: r.data });
        await get().refreshAll();
        return;
      }
    }
    const r = await api.post('/auth/register', { email, password, name });
    await AsyncStorage.setItem(TOKEN_KEY, r.data.token);
    writeJson(USER_CACHE_KEY, r.data.user);
    set({ token: r.data.token, user: r.data.user });
    await get().refreshAll();
  },

  login: async (email, password) => {
    if (isFirebaseAuthConfigured()) {
      let firebaseToken: string | null = null;
      try {
        firebaseToken = await loginWithFirebase(email, password);
      } catch {
        // Firebase login failed; fall back to backend auth
      }
      if (firebaseToken) {
        await AsyncStorage.setItem(TOKEN_KEY, firebaseToken);
        const r = await api.get('/auth/me');
        writeJson(USER_CACHE_KEY, r.data);
        set({ token: firebaseToken, user: r.data });
        await get().refreshAll();
        return;
      }
    }
    const r = await api.post('/auth/login', { email, password });
    await AsyncStorage.setItem(TOKEN_KEY, r.data.token);
    writeJson(USER_CACHE_KEY, r.data.user);
    set({ token: r.data.token, user: r.data.user });
    await get().refreshAll();
  },

  loginWithGoogle: async (googleIdToken) => {
    try {
      const firebaseToken = await loginWithGoogleIdToken(googleIdToken);
      if (!firebaseToken) throw new Error('Firebase Google sign-in is not configured');
      await AsyncStorage.setItem(TOKEN_KEY, firebaseToken);
      const r = await api.get('/auth/me');
      writeJson(USER_CACHE_KEY, r.data);
      set({ token: firebaseToken, user: r.data });
      await get().refreshAll();
      return;
    } catch (err) {
      // If Google/Firebase auth fails, surface an error to caller
      throw err;
    }
  },

  loginWithGoogleWeb: async () => {
    const firebaseToken = await loginWithGooglePopup();
    if (!firebaseToken) throw new Error('Firebase Google sign-in is not configured');
    await AsyncStorage.setItem(TOKEN_KEY, firebaseToken);
    const r = await api.get('/auth/me');
    writeJson(USER_CACHE_KEY, r.data);
    set({ token: firebaseToken, user: r.data });
    await get().refreshAll();
  },

  loginWithGoogleNative: async () => {
    const firebaseToken = await loginWithNativeGoogle();
    if (!firebaseToken) throw new Error('Native Google sign-in is not configured for this platform');
    await AsyncStorage.setItem(TOKEN_KEY, firebaseToken);
    const r = await api.get('/auth/me');
    writeJson(USER_CACHE_KEY, r.data);
    set({ token: firebaseToken, user: r.data });
    await get().refreshAll();
  },

  logout: async () => {
    await logoutFirebase().catch(() => {});
    await AsyncStorage.multiRemove([
      TOKEN_KEY,
      USER_CACHE_KEY,
      TRIPS_CACHE_KEY,
      WARDROBE_CACHE_KEY,
      SELECTED_TRIP_KEY,
      SELECTED_AIRLINE_KEY,
    ]);
    set({ token: null, user: null, trips: [], wardrobe: [], selectedTripId: null, selectedAirlineId: null });
  },

  finishOnboarding: async () => {
    await AsyncStorage.setItem(ONBOARDED_KEY, '1');
    set({ onboarded: true });
  },

  refreshAll: async () => {
    await Promise.all([get().refreshTrips(), get().refreshWardrobe()]);
  },

  refreshTrips: async () => {
    const r = await api.get('/trips');
    const trips: Trip[] = r.data;
    let { selectedTripId } = get();
    if (selectedTripId && !trips.some((trip) => trip.id === selectedTripId)) {
      selectedTripId = trips[0]?.id || null;
    }
    if (!selectedTripId && trips.length) {
      selectedTripId = trips[0].id;
    }
    if (selectedTripId) await AsyncStorage.setItem(SELECTED_TRIP_KEY, selectedTripId);
    else await AsyncStorage.removeItem(SELECTED_TRIP_KEY);
    writeJson(TRIPS_CACHE_KEY, trips);
    set({ trips, selectedTripId });
  },

  refreshWardrobe: async () => {
    const r = await api.get('/wardrobe');
    writeJson(WARDROBE_CACHE_KEY, r.data);
    set({ wardrobe: r.data });
  },

  setSelectedTrip: (id) => {
    set({ selectedTripId: id });
    if (id) AsyncStorage.setItem(SELECTED_TRIP_KEY, id);
    else AsyncStorage.removeItem(SELECTED_TRIP_KEY);
  },

  setSelectedAirline: (id) => {
    set({ selectedAirlineId: id });
    if (id) AsyncStorage.setItem(SELECTED_AIRLINE_KEY, id);
    else AsyncStorage.removeItem(SELECTED_AIRLINE_KEY);
  },

  setUser: (u) => {
    writeJson(USER_CACHE_KEY, u);
    set({ user: u });
  },

  upsertTrip: (t) => {
    const trips = get().trips.filter((x) => x.id !== t.id);
    const next = [...trips, t].sort((a, b) => a.start_date.localeCompare(b.start_date));
    writeJson(TRIPS_CACHE_KEY, next);
    set({ trips: next });
  },

  removeTrip: (id) => {
    const next = get().trips.filter((x) => x.id !== id);
    writeJson(TRIPS_CACHE_KEY, next);
    set({ trips: next });
  },

  toggleChecklistOptimistic: (tripId, itemKey) => {
    const target = get().trips.find((trip) => trip.id === tripId);
    if (!target) return;
    const checked = !Boolean(target.checklist_state[itemKey]);
    const trips = get().trips.map((trip) =>
      trip.id === tripId
        ? {
            ...trip,
            checklist_state: {
              ...trip.checklist_state,
              [itemKey]: checked,
            },
          }
        : trip
    );
    writeJson(TRIPS_CACHE_KEY, trips);
    set({ trips });

    api
      .put(`/trips/${tripId}/checklist`, { item_key: itemKey, checked })
      .then((r) => get().upsertTrip(r.data))
      .catch(() => {});
  },

  upsertWardrobeItem: (i) => {
    const w = get().wardrobe.filter((x) => x.id !== i.id);
    const next = [i, ...w];
    writeJson(WARDROBE_CACHE_KEY, next);
    set({ wardrobe: next });
  },

  removeWardrobeItem: (id) => {
    const next = get().wardrobe.filter((x) => x.id !== id);
    const trips = get().trips.map((trip) => ({
      ...trip,
      grid: trip.grid.map((slot) => (slot === id ? null : slot)),
      favorites: trip.favorites.filter((favorite) => typeof favorite !== 'string' || !favorite.includes(id)),
      occasion_tags: Object.fromEntries(
        Object.entries(trip.occasion_tags).filter(([key]) => !key.includes(id))
      ),
      checklist_state: Object.fromEntries(
        Object.entries(trip.checklist_state).filter(([key]) => key !== `grid:${id}`)
      ),
    }));
    writeJson(WARDROBE_CACHE_KEY, next);
    writeJson(TRIPS_CACHE_KEY, trips);
    set({ wardrobe: next, trips });
  },
}));
