import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useTheme } from '../src/theme/ThemeProvider';

export default function Index() {
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={c.accent} />
    </View>
  );
}
