import { create } from 'axios';
import type { AxiosInstance } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const getBackendUrl = () => {
  const configuredUrl = process.env.EXPO_PUBLIC_BACKEND_URL || '';
  const androidUrl = process.env.EXPO_PUBLIC_BACKEND_URL_ANDROID || '';
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction && !configuredUrl) {
    throw new Error('Missing EXPO_PUBLIC_BACKEND_URL');
  }
  if (isProduction && configuredUrl && !configuredUrl.startsWith('https://')) {
    throw new Error('EXPO_PUBLIC_BACKEND_URL must use HTTPS in production');
  }

  if (Platform.OS === 'web') {
    return configuredUrl || 'http://localhost:8000';
  }

  if (Platform.OS === 'android') {
    return androidUrl || configuredUrl || 'http://localhost:8000';
  }

  return configuredUrl || 'http://localhost:8000';
};

const BASE = getBackendUrl();
export const API_BASE_URL = `${BASE}/api`;

export const TOKEN_KEY = 'packr.token';

export const api: AxiosInstance = create({
  baseURL: API_BASE_URL,
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

function formatErrorLocation(loc: unknown) {
  if (!Array.isArray(loc)) return '';
  return loc
    .map(String)
    .filter((part) => !['body', 'query', 'path'].includes(part))
    .join('.');
}

function formatErrorDetail(detail: unknown, fallback: string): string {
  if (!detail) return fallback;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => formatErrorDetail(item, ''))
      .filter(Boolean);
    return messages.length ? messages.join('\n') : fallback;
  }
  if (typeof detail === 'object') {
    const value = detail as { loc?: unknown; message?: unknown; msg?: unknown };
    const message =
      typeof value.msg === 'string'
        ? value.msg
        : typeof value.message === 'string'
          ? value.message
          : '';
    const location = formatErrorLocation(value.loc);
    if (message) return location ? `${location}: ${message}` : message;
  }
  return fallback;
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  const value = error as {
    message?: unknown;
    response?: { data?: { detail?: unknown; message?: unknown } };
  };
  const detail = value.response?.data?.detail ?? value.response?.data?.message ?? value.message;
  return formatErrorDetail(detail, fallback);
}

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
  favorites: (number | string)[];
  occasion_tags: Record<string, string>;
  checklist_state: Record<string, boolean>;
  extras: { id: string; name: string; category: string; weight_kg: number }[];
  outfit_plan: Record<string, string>;
  created_at: string;
};

export type UploadImageResponse = {
  url: string;
  width: number;
  height: number;
  content_type: string;
};

export function resolveApiAssetUrl(url: string) {
  if (!url || url.startsWith('data:') || /^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) return `${BASE}${url}`;
  return url;
}

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

export type CommunitySnapshotItem = {
  slot: number;
  name: string;
  category: 'top' | 'bottom' | 'layer';
  image: string;
  colors: string[];
  tags: string[];
  weight_kg: number;
};

export type CommunityComment = {
  id: string;
  post_id: string;
  user_id: string;
  user_name: string;
  text: string;
  created_at: string;
};

export type CommunityPost = {
  id: string;
  author_id: string;
  author_name: string;
  trip_id: string;
  title: string;
  caption: string;
  visibility: 'public' | 'followers' | 'private';
  destination: string;
  start_date: string;
  end_date: string;
  days: number;
  image_url: string;
  image_width: number;
  image_height: number;
  dominant_colors: string[];
  grid: (string | null)[];
  items_snapshot: CommunitySnapshotItem[];
  likes_count: number;
  comments_count: number;
  saves_count: number;
  is_liked: boolean;
  is_saved: boolean;
  is_following_author: boolean;
  latest_comments: CommunityComment[];
  created_at: string;
};

export type SocialProfile = {
  id: string;
  name?: string | null;
  is_following: boolean;
  is_friend: boolean;
  followers_count: number;
  following_count: number;
  posts_count: number;
};

export type OutfitSuggestion = {
  outfit_key: string;
  outfit_index: number;
  date?: string | null;
  occasion: string;
  score: number;
  reason: string;
  item_ids: string[];
  item_names: string[];
};

export type TripStats = {
  packing_score: number;
  items_per_day: number;
  outfit_variety: number;
  most_used_color?: string | null;
  completed_grid: boolean;
  planned_days: number;
  trip_days: number;
  checklist_progress: number;
  total_weight_kg: number;
};

export type TripNudge = {
  id: string;
  kind: 'pre_trip' | 'wardrobe_audit' | 'post_trip' | 'challenge';
  trip_id?: string | null;
  title: string;
  message: string;
  action_route: string;
};

export type TripReflection = {
  id: string;
  trip_id: string;
  user_id: string;
  worn_outfit_keys: string[];
  unused_item_ids: string[];
  notes: string;
  rating?: number | null;
  created_at: string;
};

export type CommunityChallenge = {
  id: string;
  month: string;
  title: string;
  prompt: string;
  destination?: string | null;
  climate?: string | null;
  posts_count: number;
  votes_count: number;
};

export type TripInvite = {
  id: string;
  trip_id: string;
  owner_id: string;
  code: string;
  companion_name?: string | null;
  status: 'pending' | 'accepted';
  created_at: string;
};
