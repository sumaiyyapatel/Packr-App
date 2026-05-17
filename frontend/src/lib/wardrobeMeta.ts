import type { WardrobeItem } from './api';

export type WardrobeCategory = WardrobeItem['category'];

export const CATEGORY_ORDER: WardrobeCategory[] = ['top', 'bottom', 'layer'];

export const CATEGORY_META: Record<
  WardrobeCategory,
  { label: string; short: string; color: string; soft: string; icon: string }
> = {
  top: {
    label: 'Top',
    short: 'TOP',
    color: '#60A5FA',
    soft: '#60A5FA22',
    icon: 'shirt-outline',
  },
  bottom: {
    label: 'Bottom',
    short: 'BOTTOM',
    color: '#C084FC',
    soft: '#C084FC22',
    icon: 'walk-outline',
  },
  layer: {
    label: 'Layer',
    short: 'LAYER',
    color: '#F59E0B',
    soft: '#F59E0B22',
    icon: 'layers-outline',
  },
};

export const TAG_PRESETS = [
  'casual',
  'formal',
  'work',
  'travel',
  'modest',
  'gym',
  'party',
  'beach',
  'tropical',
  'cold',
  'rain',
  'denim',
  'linen',
  'neutral',
  'statement',
  'layer-friendly',
];

export function normalizeTag(tag: string) {
  const value = tag.trim().toLowerCase().replace('#', '');
  return value
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
}

export function parseTags(value: string) {
  return value
    .split(/[,\s]+/)
    .map(normalizeTag)
    .filter(Boolean);
}

export function uniqueTags(tags: string[]) {
  const seen: string[] = [];
  for (const tag of tags.map(normalizeTag).filter(Boolean)) {
    if (!seen.includes(tag)) seen.push(tag);
    if (seen.length >= 12) break;
  }
  return seen;
}
