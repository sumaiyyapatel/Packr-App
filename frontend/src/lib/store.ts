import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, TOKEN_KEY, User, Trip, WardrobeItem } from './api';

type State = {
  user: User | null;
  token: string | null;
  hydrated: boolean;
  onboarded: boolean;
  trips: Trip[];
  wardrobe: WardrobeItem[];
  selectedTripId: string | null;

  hydrate: () => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  finishOnboarding: () => Promise<void>;

  refreshAll: () => Promise<void>;
  refreshTrips: () => Promise<void>;
  refreshWardrobe: () => Promise<void>;

  setSelectedTrip: (id: string | null) => void;
  upsertTrip: (t: Trip) => void;
  removeTrip: (id: string) => void;
  upsertWardrobeItem: (i: WardrobeItem) => void;
  removeWardrobeItem: (id: string) => void;
};

export const useStore = create<State>((set, get) => ({
  user: null,
  token: null,
  hydrated: false,
  onboarded: false,
  trips: [],
  wardrobe: [],
  selectedTripId: null,

  hydrate: async () => {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    const onboarded = (await AsyncStorage.getItem('packr.onboarded')) === '1';
    const selectedTripId = await AsyncStorage.getItem('packr.selectedTripId');
    if (token) {
      try {
        const r = await api.get('/auth/me');
        set({ user: r.data, token, onboarded, selectedTripId, hydrated: true });
        await get().refreshAll();
        return;
      } catch {
        await AsyncStorage.removeItem(TOKEN_KEY);
      }
    }
    set({ hydrated: true, onboarded, selectedTripId });
  },

  register: async (email, password, name) => {
    const r = await api.post('/auth/register', { email, password, name });
    await AsyncStorage.setItem(TOKEN_KEY, r.data.token);
    set({ token: r.data.token, user: r.data.user });
    await get().refreshAll();
  },

  login: async (email, password) => {
    const r = await api.post('/auth/login', { email, password });
    await AsyncStorage.setItem(TOKEN_KEY, r.data.token);
    set({ token: r.data.token, user: r.data.user });
    await get().refreshAll();
  },

  logout: async () => {
    await AsyncStorage.removeItem(TOKEN_KEY);
    await AsyncStorage.removeItem('packr.selectedTripId');
    set({ token: null, user: null, trips: [], wardrobe: [], selectedTripId: null });
  },

  finishOnboarding: async () => {
    await AsyncStorage.setItem('packr.onboarded', '1');
    set({ onboarded: true });
  },

  refreshAll: async () => {
    await Promise.all([get().refreshTrips(), get().refreshWardrobe()]);
  },

  refreshTrips: async () => {
    const r = await api.get('/trips');
    const trips: Trip[] = r.data;
    let { selectedTripId } = get();
    if (!selectedTripId && trips.length) {
      selectedTripId = trips[0].id;
      await AsyncStorage.setItem('packr.selectedTripId', selectedTripId);
    }
    set({ trips, selectedTripId });
  },

  refreshWardrobe: async () => {
    const r = await api.get('/wardrobe');
    set({ wardrobe: r.data });
  },

  setSelectedTrip: (id) => {
    set({ selectedTripId: id });
    if (id) AsyncStorage.setItem('packr.selectedTripId', id);
    else AsyncStorage.removeItem('packr.selectedTripId');
  },

  upsertTrip: (t) => {
    const trips = get().trips.filter((x) => x.id !== t.id);
    set({ trips: [...trips, t].sort((a, b) => a.start_date.localeCompare(b.start_date)) });
  },

  removeTrip: (id) => {
    set({ trips: get().trips.filter((x) => x.id !== id) });
  },

  upsertWardrobeItem: (i) => {
    const w = get().wardrobe.filter((x) => x.id !== i.id);
    set({ wardrobe: [i, ...w] });
  },

  removeWardrobeItem: (id) => {
    set({ wardrobe: get().wardrobe.filter((x) => x.id !== id) });
  },
}));
