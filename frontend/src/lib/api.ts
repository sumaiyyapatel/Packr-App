import axios, { AxiosInstance } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || '';

export const TOKEN_KEY = 'packr.token';

export const api: AxiosInstance = axios.create({
  baseURL: `${BASE}/api`,
  timeout: 20000,
});

api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers = config.headers || {};
    (config.headers as any).Authorization = `Bearer ${token}`;
  }
  return config;
});

export type User = {
  id: string;
  email: string;
  name?: string | null;
  is_pro: boolean;
  airline_profiles: { id: string; name: string; max_kg: number }[];
  created_at: string;
};
export type WardrobeItem = {
  id: string;
  user_id: string;
  name: string;
  category: 'top' | 'bottom' | 'layer';
  image: string;
  colors: string[];
  weight_kg: number;
  tags: string[];
  created_at: string;
};
export type Trip = {
  id: string;
  user_id: string;
  destination: string;
  start_date: string;
  end_date: string;
  latitude?: number | null;
  longitude?: number | null;
  grid: (string | null)[];
  favorites: number[];
  occasion_tags: Record<string, string>;
  checklist_state: Record<string, boolean>;
  extras: { id: string; name: string; category: string; weight_kg: number }[];
  created_at: string;
};

export type TemplateItem = {
  name: string;
  category: 'top' | 'bottom' | 'layer';
  colors: string[];
  tags: string[];
  image: string;
};

export type Template = {
  id: string;
  title: string;
  description: string;
  destination: string;
  days: number;
  season: string;
  climate: 'cold' | 'cool' | 'mild' | 'warm' | 'tropical';
  items: TemplateItem[];
  author_id?: string | null;
  author_name?: string | null;
  is_official: boolean;
  likes: number;
  created_at: string;
};
