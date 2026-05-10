import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, ThemeMode, ThemeColors } from './colors';

type Ctx = {
  mode: ThemeMode;
  c: ThemeColors;
  toggle: () => void;
};

const ThemeCtx = createContext<Ctx>({ mode: 'dark', c: colors.dark, toggle: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>('dark');

  useEffect(() => {
    AsyncStorage.getItem('packr.theme').then((v) => {
      if (v === 'light' || v === 'dark') setMode(v);
    });
  }, []);

  const toggle = () => {
    const next: ThemeMode = mode === 'dark' ? 'light' : 'dark';
    setMode(next);
    AsyncStorage.setItem('packr.theme', next);
  };

  const c = mode === 'dark' ? colors.dark : colors.light;
  return <ThemeCtx.Provider value={{ mode, c, toggle }}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);
