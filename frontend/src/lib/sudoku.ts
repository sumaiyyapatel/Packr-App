import { WardrobeItem } from './api';

/**
 * Slots follow the rotating Sudoku packing layout:
 *   row 1 = top, bottom, layer
 *   row 2 = bottom, layer, top
 *   row 3 = layer, top, bottom
 *
 * This keeps every row, column, and diagonal category-complete while still
 * allowing 3 * 3 * 3 = 27 generated outfits.
 */

export type GridCategory = 'top' | 'bottom' | 'layer';

export type Outfit = {
  index: number;
  key: string;
  topId: string | null;
  bottomId: string | null;
  layerId: string | null;
  topSlot: number;
  bottomSlot: number;
  layerSlot: number;
};

export const CATEGORY_BY_SLOT: GridCategory[] = [
  'top',
  'bottom',
  'layer',
  'bottom',
  'layer',
  'top',
  'layer',
  'top',
  'bottom',
];

export function slotIndex(row: number, col: number) {
  return row * 3 + col;
}

export function categoryForSlot(slot: number): GridCategory {
  return CATEGORY_BY_SLOT[slot];
}

export function generate27Outfits(grid: (string | null)[]): Outfit[] {
  const tops = [0, 5, 7].map((slot) => ({ id: grid[slot] ?? null, slot }));
  const bottoms = [1, 3, 8].map((slot) => ({ id: grid[slot] ?? null, slot }));
  const layers = [2, 4, 6].map((slot) => ({ id: grid[slot] ?? null, slot }));

  const outfits: Outfit[] = [];
  let idx = 0;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) {
        const topId = tops[i].id;
        const bottomId = bottoms[j].id;
        const layerId = layers[k].id;
        outfits.push({
          index: idx++,
          key: [topId, bottomId, layerId].map((id) => id || 'empty').join('|'),
          topId,
          bottomId,
          layerId,
          topSlot: tops[i].slot,
          bottomSlot: bottoms[j].slot,
          layerSlot: layers[k].slot,
        });
      }
    }
  }
  return outfits;
}

export function isGridComplete(grid: (string | null)[]) {
  return grid.length === 9 && grid.every((s) => !!s);
}

export function gridProgress(grid: (string | null)[]) {
  const filled = grid.filter((s) => !!s).length;
  return filled / 9;
}

const OPPOSITE_TAGS: Record<string, string[]> = {
  formal: ['beach', 'gym'],
  beach: ['formal', 'business'],
  gym: ['formal', 'business'],
  business: ['beach', 'gym'],
  tropical: ['snow'],
  snow: ['tropical', 'beach'],
};

export type ConflictReport = {
  slotConflicts: Record<number, string>;
  hasConflicts: boolean;
};

export function checkConflicts(
  grid: (string | null)[],
  itemsById: Record<string, WardrobeItem>
): ConflictReport {
  const slotConflicts: Record<number, string> = {};

  for (let slot = 0; slot < 9; slot++) {
    const id = grid[slot];
    if (!id) continue;
    const item = itemsById[id];
    if (!item) continue;
    const expected = categoryForSlot(slot);
    if (item.category !== expected) {
      slotConflicts[slot] = `Expected ${expected}, found ${item.category}`;
    }
  }

  const filled = grid
    .map((id, slot) => ({ id, slot }))
    .filter((x) => x.id) as { id: string; slot: number }[];

  for (const a of filled) {
    const ai = itemsById[a.id];
    if (!ai) continue;
    const aCategory = categoryForSlot(a.slot);
    const aTags = (ai.tags || []).map((tag) => tag.toLowerCase().replace('#', ''));
    for (const b of filled) {
      if (b.slot === a.slot) continue;
      const bi = itemsById[b.id];
      if (!bi) continue;
      if (aCategory === categoryForSlot(b.slot)) continue;
      const bTags = (bi.tags || []).map((tag) => tag.toLowerCase().replace('#', ''));
      for (const tag of aTags) {
        const opposites = OPPOSITE_TAGS[tag] || [];
        if (bTags.some((otherTag) => opposites.includes(otherTag))) {
          slotConflicts[a.slot] =
            slotConflicts[a.slot] || `#${tag} not compatible with ${bi.name}`;
        }
      }
    }
  }

  return { slotConflicts, hasConflicts: Object.keys(slotConflicts).length > 0 };
}

export function suggestOccasion(
  outfit: Outfit,
  itemsById: Record<string, WardrobeItem>
): string {
  const ids = [outfit.topId, outfit.bottomId, outfit.layerId].filter(Boolean) as string[];
  const tags = ids
    .flatMap((id) => itemsById[id]?.tags || [])
    .map((tag) => tag.toLowerCase().replace('#', ''));
  if (tags.includes('formal') || tags.includes('business')) return 'Formal';
  if (tags.includes('beach') || tags.includes('tropical')) return 'Travel';
  if (tags.includes('gym')) return 'Active';
  if (tags.includes('modest')) return 'Modest';
  return 'Casual';
}
