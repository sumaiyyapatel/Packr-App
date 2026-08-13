import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Trip, User, WardrobeItem } from './api';
import { getToken, setToken, clearToken } from './tokenStorage';
import {
  currentAuthProvider,
  deleteFirebaseUser,
  getCurrentFirebaseToken,
  isFirebaseAuthConfigured,
  loginWithFirebase,
  loginWithGoogleIdToken,
  loginWithNativeGoogle,
  loginWithGooglePopup,
  logoutFirebase,
  registerWithFirebase,
  waitForFirebaseUser,
} from './firebaseAuth';
import * as repo from './firestoreRepo';

const USER_CACHE_KEY = 'packr.user';
const TRIPS_CACHE_KEY = 'packr.trips';
const WARDROBE_CACHE_KEY = 'packr.wardrobe';
const ONBOARDED_KEY = 'packr.onboarded';
const SELECTED_TRIP_KEY = 'packr.selectedTripId';
const SELECTED_AIRLINE_KEY = 'packr.airlineId';
const CAPSULE_OFFERED_KEY = 'packr.capsuleOffered';

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
  capsuleOffered: boolean;
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
  authProvider: () => string | null;
  deleteAccount: (password?: string) => Promise<void>;
  finishOnboarding: () => Promise<void>;
  dismissCapsuleOffer: () => Promise<void>;
  setUser: (u: User) => void;
  setSelectedAirline: (id: string | null) => void;
  saveAirlineProfiles: (profiles: User['airline_profiles']) => Promise<void>;

  refreshAll: () => Promise<void>;
  refreshTrips: () => Promise<void>;
  refreshWardrobe: () => Promise<void>;

  setSelectedTrip: (id: string | null) => void;
  upsertTrip: (t: Trip) => void;
  removeTrip: (id: string) => void;
  upsertWardrobeItem: (i: WardrobeItem) => void;
  removeWardrobeItem: (id: string) => void;
  toggleChecklistOptimistic: (tripId: string, itemKey: string) => void;

  // Firestore mutations (Phase 1)
  createNewTrip: (input: repo.TripInput) => Promise<Trip>;
  deleteTripRemote: (tripId: string) => Promise<void>;
  saveGrid: (tripId: string, grid: (string | null)[]) => Promise<void>;
  toggleFavorite: (tripId: string, outfitKey: string, isFavorite: boolean) => Promise<void>;
  tagOccasion: (tripId: string, outfitKey: string, occasion: string) => Promise<void>;
  planOutfit: (tripId: string, date: string, outfitKey: string | null) => Promise<void>;
  addTripExtra: (tripId: string, extra: { name: string; category: string; weight_kg: number }) => Promise<void>;
  removeTripExtra: (tripId: string, extraId: string) => Promise<void>;
  saveWardrobe: (input: repo.WardrobeItemInput, itemId?: string) => Promise<WardrobeItem>;
  deleteWardrobe: (itemId: string) => Promise<void>;
  saveReflection: (tripId: string, worn: string[], unused: string[]) => Promise<void>;
  applyTemplateToTrip: (tripId: string, items: Parameters<typeof repo.applyTemplate>[2]) => Promise<void>;
};

function requireUid(user: User | null): string {
  if (!user?.id) throw new Error('Not signed in');
  return user.id;
}

export const useStore = create<State>((set, get) => {
  async function completeSignIn(firebaseToken: string): Promise<void> {
    await setToken(firebaseToken);
    const firebaseUser = await waitForFirebaseUser();
    if (!firebaseUser) throw new Error('Sign-in did not complete');
    const user = await repo.ensureUserDoc({
      uid: firebaseUser.uid,
      email: (firebaseUser.email ?? `${firebaseUser.uid}@firebase.local`).toLowerCase(),
      name: firebaseUser.displayName,
    });
    writeJson(USER_CACHE_KEY, user);
    set({ token: firebaseToken, user });
    await get().refreshAll();
  }

  async function tripById(tripId: string): Promise<Trip> {
    const trip = get().trips.find((t) => t.id === tripId);
    if (!trip) throw new Error('Trip not found');
    return trip;
  }

  async function clearLocalState(): Promise<void> {
    await clearToken();
    await AsyncStorage.multiRemove([
      USER_CACHE_KEY,
      TRIPS_CACHE_KEY,
      WARDROBE_CACHE_KEY,
      SELECTED_TRIP_KEY,
      SELECTED_AIRLINE_KEY,
    ]);
    set({ token: null, user: null, trips: [], wardrobe: [], selectedTripId: null, selectedAirlineId: null });
  }

  return {
    user: null,
    token: null,
    hydrated: false,
    onboarded: false,
    capsuleOffered: false,
    trips: [],
    wardrobe: [],
    selectedTripId: null,
    selectedAirlineId: null,

    hydrate: async () => {
      const onboarded = (await AsyncStorage.getItem(ONBOARDED_KEY)) === '1';
      const capsuleOffered = (await AsyncStorage.getItem(CAPSULE_OFFERED_KEY)) === '1';
      const selectedTripId = await AsyncStorage.getItem(SELECTED_TRIP_KEY);
      const selectedAirlineId = await AsyncStorage.getItem(SELECTED_AIRLINE_KEY);
      const [cachedUser, cachedTrips, cachedWardrobe] = await Promise.all([
        readJson<User>(USER_CACHE_KEY),
        readJson<Trip[]>(TRIPS_CACHE_KEY),
        readJson<WardrobeItem[]>(WARDROBE_CACHE_KEY),
      ]);

      const firebaseUser = await waitForFirebaseUser();
      if (!firebaseUser) {
        await clearToken();
        set({ hydrated: true, onboarded, capsuleOffered, selectedTripId, selectedAirlineId });
        return;
      }

      let token = await getCurrentFirebaseToken();
      if (token) await setToken(token);
      else token = await getToken();

      // Show cached data immediately, then refresh from Firestore.
      set({
        user: cachedUser,
        token,
        onboarded,
        capsuleOffered,
        selectedTripId,
        selectedAirlineId,
        trips: cachedTrips || [],
        wardrobe: cachedWardrobe || [],
        hydrated: true,
      });
      try {
        const user = await repo.ensureUserDoc({
          uid: firebaseUser.uid,
          email: (firebaseUser.email ?? `${firebaseUser.uid}@firebase.local`).toLowerCase(),
          name: firebaseUser.displayName,
        });
        writeJson(USER_CACHE_KEY, user);
        set({ user });
        await get().refreshAll();
      } catch {
        // Offline or rules not deployed yet — cached data stays visible.
      }
    },

    register: async (email, password, name) => {
      if (!isFirebaseAuthConfigured()) throw new Error('Firebase Auth is not configured');
      const firebaseToken = await registerWithFirebase(email, password, name);
      if (!firebaseToken) throw new Error('Registration failed');
      await completeSignIn(firebaseToken);
    },

    login: async (email, password) => {
      if (!isFirebaseAuthConfigured()) throw new Error('Firebase Auth is not configured');
      const firebaseToken = await loginWithFirebase(email, password);
      if (!firebaseToken) throw new Error('Login failed');
      await completeSignIn(firebaseToken);
    },

    loginWithGoogle: async (googleIdToken) => {
      const firebaseToken = await loginWithGoogleIdToken(googleIdToken);
      if (!firebaseToken) throw new Error('Firebase Google sign-in is not configured');
      await completeSignIn(firebaseToken);
    },

    loginWithGoogleWeb: async () => {
      const firebaseToken = await loginWithGooglePopup();
      if (!firebaseToken) throw new Error('Firebase Google sign-in is not configured');
      await completeSignIn(firebaseToken);
    },

    loginWithGoogleNative: async () => {
      const firebaseToken = await loginWithNativeGoogle();
      if (!firebaseToken) throw new Error('Native Google sign-in is not configured for this platform');
      await completeSignIn(firebaseToken);
    },

    logout: async () => {
      await logoutFirebase().catch(() => {});
      await clearLocalState();
    },

    authProvider: () => currentAuthProvider(),

    deleteAccount: async (password) => {
      const uid = requireUid(get().user);
      // Firestore rules key every write on request.auth.uid, so the wipe
      // must finish while still authenticated — Auth deletion goes last.
      await repo.wipeAllUserData(uid);
      await deleteFirebaseUser(password);
      await clearLocalState();
    },

    finishOnboarding: async () => {
      await AsyncStorage.setItem(ONBOARDED_KEY, '1');
      set({ onboarded: true });
    },

    dismissCapsuleOffer: async () => {
      await AsyncStorage.setItem(CAPSULE_OFFERED_KEY, '1');
      set({ capsuleOffered: true });
    },

    refreshAll: async () => {
      await Promise.all([get().refreshTrips(), get().refreshWardrobe()]);
    },

    refreshTrips: async () => {
      const uid = requireUid(get().user);
      const trips = await repo.listTrips(uid);
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
      const uid = requireUid(get().user);
      const wardrobe = await repo.listWardrobe(uid);
      writeJson(WARDROBE_CACHE_KEY, wardrobe);
      set({ wardrobe });
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

    saveAirlineProfiles: async (profiles) => {
      const uid = requireUid(get().user);
      await repo.updateAirlineProfiles(uid, profiles);
      const user = get().user;
      if (user) get().setUser({ ...user, airline_profiles: profiles });
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
      const user = get().user;
      if (!target || !user) return;
      const previous = get().trips;
      const checked = !target.checklist_state[itemKey];
      const trips = previous.map((trip) =>
        trip.id === tripId
          ? { ...trip, checklist_state: { ...trip.checklist_state, [itemKey]: checked } }
          : trip
      );
      writeJson(TRIPS_CACHE_KEY, trips);
      set({ trips });
      repo.setChecklistItem(user.id, tripId, itemKey, checked).catch(() => {
        // Roll back if the write failed (previously this failed silently).
        writeJson(TRIPS_CACHE_KEY, previous);
        set({ trips: previous });
      });
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

    // ---------- Firestore mutations ----------

    createNewTrip: async (input) => {
      const uid = requireUid(get().user);
      const trip = await repo.createTrip(uid, input);
      get().upsertTrip(trip);
      get().setSelectedTrip(trip.id);
      return trip;
    },

    deleteTripRemote: async (tripId) => {
      const uid = requireUid(get().user);
      await repo.deleteTrip(uid, tripId);
      get().removeTrip(tripId);
    },

    saveGrid: async (tripId, grid) => {
      const uid = requireUid(get().user);
      const trip = await tripById(tripId);
      await repo.updateGrid(uid, trip, grid, get().wardrobe);
      await get().refreshTrips();
    },

    toggleFavorite: async (tripId, outfitKey, isFavorite) => {
      const uid = requireUid(get().user);
      const trip = await tripById(tripId);
      await repo.setFavorite(uid, trip, outfitKey, isFavorite);
      await get().refreshTrips();
    },

    tagOccasion: async (tripId, outfitKey, occasion) => {
      const uid = requireUid(get().user);
      await repo.setOccasion(uid, tripId, outfitKey, occasion);
      await get().refreshTrips();
    },

    planOutfit: async (tripId, date, outfitKey) => {
      const uid = requireUid(get().user);
      const trip = await tripById(tripId);
      await repo.setOutfitPlan(uid, trip, date, outfitKey);
      await get().refreshTrips();
    },

    addTripExtra: async (tripId, extra) => {
      const uid = requireUid(get().user);
      const trip = await tripById(tripId);
      await repo.addExtra(uid, tripId, extra, trip.extras ?? []);
      await get().refreshTrips();
    },

    removeTripExtra: async (tripId, extraId) => {
      const uid = requireUid(get().user);
      const trip = await tripById(tripId);
      await repo.removeExtra(uid, tripId, extraId, trip.extras ?? []);
      await get().refreshTrips();
    },

    saveWardrobe: async (input, itemId) => {
      const uid = requireUid(get().user);
      if (itemId) {
        await repo.updateWardrobeItem(uid, itemId, input);
        await Promise.all([get().refreshWardrobe(), get().refreshTrips()]);
        const updated = get().wardrobe.find((w) => w.id === itemId);
        if (!updated) throw new Error('Item not found after update');
        return updated;
      }
      const item = await repo.createWardrobeItem(uid, input);
      get().upsertWardrobeItem(item);
      return item;
    },

    deleteWardrobe: async (itemId) => {
      const uid = requireUid(get().user);
      await repo.deleteWardrobeItem(uid, itemId);
      get().removeWardrobeItem(itemId);
      await get().refreshTrips();
    },

    saveReflection: async (tripId, worn, unused) => {
      const uid = requireUid(get().user);
      const trip = await tripById(tripId);
      await repo.createReflection(uid, trip, {
        worn_outfit_keys: worn,
        unused_item_ids: unused,
        notes: 'Saved from post-trip reflection',
      });
    },

    applyTemplateToTrip: async (tripId, items) => {
      const uid = requireUid(get().user);
      const trip = await tripById(tripId);
      await repo.applyTemplate(uid, trip, items);
      await get().refreshAll();
    },
  };
});
