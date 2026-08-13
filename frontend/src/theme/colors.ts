// Packr palette — warm neutrals + powder-blue accent.
// "dark" = Charcoal theme, "light" = Bone theme (names kept for back-compat).
export const colors = {
  dark: {
    // Charcoal
    bg: '#161412',
    surface: '#1E1B18',
    elevated: '#26221E',
    plate: '#26221E',
    accent: '#9FC4D6',
    accentHover: '#B7D5E4',
    accentInk: '#161412',
    accentSoft: '#013A56',
    // Accent is fills-only on Bone (raw #9FC4D6 on #FAF8F4 is ~1.5:1, far under
    // WCAG AA) — this is the readable-as-text stand-in, themed per mode. Reuses
    // the same darker-blue value already used for `success` on light, since
    // that token solved the identical problem.
    accentText: '#9FC4D6',
    textPrimary: '#F5F1EA',
    textSecondary: '#B5AC9F',
    textTertiary: '#857D71',
    borderSubtle: '#2E2924',
    borderActive: '#453E36',
    warning: '#E0A15A',
    success: '#9FC4D6',
    error: '#AC1313',
  },
  light: {
    // Bone
    bg: '#FAF8F4',
    surface: '#F3F0EA',
    elevated: '#FFFFFF',
    plate: '#EFECE5',
    accent: '#9FC4D6',
    accentHover: '#8AB6CB',
    accentInk: '#1A1713',
    accentSoft: '#CEE4DE',
    accentText: '#4E7A8C',
    textPrimary: '#1A1713',
    textSecondary: '#5C564E',
    textTertiary: '#767066',
    borderSubtle: '#E5E0D6',
    borderActive: '#C9C2B4',
    warning: '#B4791B',
    success: '#4E7A8C',
    error: '#CE4C36',
  },
};

export type ThemeMode = 'dark' | 'light';
export type ThemeColors = typeof colors.dark;

// DM Sans (display/headings/numerals), Inter (body/UI), DM Mono (kickers/metadata) — per Figma v2 tokens.
export const fonts = {
  display: 'DMSans_700Bold',
  heading: 'DMSans_700Bold',
  title: 'Inter_600SemiBold',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemiBold: 'Inter_600SemiBold',
  kicker: 'DMMono_500Medium',
  mono: 'DMMono_400Regular',
};
