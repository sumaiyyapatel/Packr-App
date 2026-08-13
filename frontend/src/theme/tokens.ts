import { StyleSheet, TextStyle } from 'react-native';
import { fonts } from './colors';

// Spacing scale — matches DESIGN_SYSTEM.md
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const gutter = space.xl; // 24 — standard screen side padding

export const radius = {
  sharp: 15, // plates, cards, buttons
  sheet: 25, // modals, sheets
  pill: 100, // chips only
} as const;

// Type styles — each maps to a loaded font family + size/line-height.
// Use as: <Text style={type.h1}>…</Text> then apply color separately.
export const type = StyleSheet.create({
  displayXl: { fontFamily: fonts.display, fontSize: 40, lineHeight: 44 },
  display: { fontFamily: fonts.display, fontSize: 30, lineHeight: 34 },
  h1: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30 },
  h2: { fontFamily: fonts.display, fontSize: 18, lineHeight: 24 },
  title: { fontFamily: fonts.title, fontSize: 16, lineHeight: 22 },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22 },
  label: { fontFamily: fonts.bodyMedium, fontSize: 13, lineHeight: 18 },
  bodySm: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },
  micro: { fontFamily: fonts.body, fontSize: 11, lineHeight: 14 },
  kicker: {
    fontFamily: fonts.kicker,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.5, // 0.14em @ 11px
    textTransform: 'uppercase',
  } as TextStyle,
  mono: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 16 },
});

export type TypeName = keyof typeof type;
