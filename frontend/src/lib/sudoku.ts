import { WardrobeItem } from './api';

/**
 * The 3x3 grid:
 *  Rows are indexed 0..2 (each row has 3 slots), but in our app each slot
 *  holds a wardrobe item of a fixed CATEGORY by column:
 *    col 0 = top, col 1 = bottom, col 2 = layer
 *  So row r = an outfit (top, bottom, layer).
 *
 * The "Sudoku method" produces 27 outfits by picking one row of each column
 * cell — i.e., for each combination (top_i, bottom_j, layer_k), we get an outfit.
 * That is 3 * 3 * 3 = 27 unique outfits.
 */

export type Outfit = {
  index: number; // 0..26
  topId: string | null;
  bottomId: string | null;
  layerId: string | null;
  // row/col indices (1-based in display)
  topRow: number;
  bottomRow: number;
  layerRow: number;
};

export const CATEGORY_BY_COL: Array<'top' | 'bottom' | 'layer'> = ['top', 'bottom', 'layer'];

export function slotIndex(row: number, col: number) {
  return row * 3 + col;
}

export function categoryForSlot(slot: number): 'top' | 'bottom' | 'layer' {
  return CATEGORY_BY_COL[slot % 3];
}

export function generate27Outfits(grid: (string | null)[]): Outfit[] {
  // grid is a flat array of 9: [r0c0,r0c1,r0c2, r1c0,r1c1,r1c2, r2c0,r2c1,r2c2]
  const tops = [grid[0], grid[3], grid[6]]; // col 0
  const bottoms = [grid[1], grid[4], grid[7]]; // col 1
  const layers = [grid[2], grid[5], grid[8]]; // col 2

  const outfits: Outfit[] = [];
  let idx = 0;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) {
        outfits.push({
          index: idx++,
          topId: tops[i] ?? null,
          bottomId: bottoms[j] ?? null,
          layerId: layers[k] ?? null,
          topRow: i + 1,
          bottomRow: j + 1,
          layerRow: k + 1,
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

/**
 * Conflict checker:
 *  - Each column must hold its expected category (top/bottom/layer).
 *    If a wrong-category item is placed, mark it as a conflict.
 *  - "Strict compatibility" warning: surface items whose tag set is
 *    incompatible with another item (e.g., #Formal vs #Beach).
 *    For MVP we use an opposites map.
 */
const OPPOSITE_TAGS: Record<string, string[]> = {
  formal: ['beach', 'gym'],
  beach: ['formal', 'business'],
  gym: ['formal', 'business'],
  business: ['beach', 'gym'],
  tropical: ['snow'],
  snow: ['tropical', 'beach'],
};

export type ConflictReport = {
  slotConflicts: Record<number, string>; // slot index -> reason
  hasConflicts: boolean;
};

export function checkConflicts(
  grid: (string | null)[],
  itemsById: Record<string, WardrobeItem>
): ConflictReport {
  const slotConflicts: Record<number, string> = {};

  // Wrong category check
  for (let s = 0; s < 9; s++) {
    const id = grid[s];
    if (!id) continue;
    const item = itemsById[id];
    if (!item) continue;
    const expected = categoryForSlot(s);
    if (item.category !== expected) {
      slotConflicts[s] = `Expected ${expected}, found ${item.category}`;
    }
  }

  // Tag compatibility (only between filled items)
  const filled = grid
    .map((id, slot) => ({ id, slot }))
    .filter((x) => x.id) as { id: string; slot: number }[];

  for (const a of filled) {
    const ai = itemsById[a.id];
    if (!ai) continue;
    const aTags = (ai.tags || []).map((t) => t.toLowerCase().replace('#', ''));
    for (const b of filled) {
      if (b.slot === a.slot) continue;
      const bi = itemsById[b.id];
      if (!bi) continue;
      const bTags = (bi.tags || []).map((t) => t.toLowerCase().replace('#', ''));
      for (const t of aTags) {
        const opps = OPPOSITE_TAGS[t] || [];
        if (bTags.some((bt) => opps.includes(bt))) {
          slotConflicts[a.slot] = slotConflicts[a.slot] || `#${t} not compatible with another item`;
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
  const tags = ids.flatMap((id) => itemsById[id]?.tags || []).map((t) => t.toLowerCase().replace('#', ''));
  if (tags.includes('formal') || tags.includes('business')) return 'Formal';
  if (tags.includes('beach') || tags.includes('tropical')) return 'Travel';
  if (tags.includes('gym')) return 'Active';
  if (tags.includes('modest')) return 'Modest';
  return 'Casual';
}
