export const colors = {
  dark: {
    bg: '#000000',
    surface: '#0F0F0F',
    elevated: '#1A1A1A',
    accent: '#8DA399',
    accentHover: '#A9C1B5',
    textPrimary: '#FFFFFF',
    textSecondary: '#8B8B8B',
    textTertiary: '#555555',
    borderSubtle: '#222222',
    borderActive: '#444444',
    warning: '#FFB347',
    success: '#8DA399',
    error: '#FF6B6B',
  },
  light: {
    bg: '#FFFFFF',
    surface: '#F7F7F7',
    elevated: '#FFFFFF',
    accent: '#6A8276',
    accentHover: '#546A5E',
    textPrimary: '#111111',
    textSecondary: '#666666',
    textTertiary: '#AAAAAA',
    borderSubtle: '#EAEAEA',
    borderActive: '#CCCCCC',
    warning: '#F5A623',
    success: '#6A8276',
    error: '#E13232',
  },
};

export type ThemeMode = 'dark' | 'light';
export type ThemeColors = typeof colors.dark;

export const fonts = {
  // System fonts on RN; "Inter" suggested but we use system to avoid loading
  regular: undefined as unknown as string,
  mono: 'Courier',
};
