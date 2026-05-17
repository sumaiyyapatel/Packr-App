import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/theme/ThemeProvider';

export default function TabsLayout() {
  const { c } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.textTertiary,
        tabBarStyle: {
          backgroundColor: c.bg,
          borderTopColor: c.borderSubtle,
          borderTopWidth: 1,
          height: 64,
          paddingTop: 6,
          paddingBottom: 8,
        },
        tabBarLabelStyle: { fontSize: 10, letterSpacing: 1, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'HOME',
          tabBarIcon: ({ color }) => <Ionicons name="home-outline" size={20} color={color} />,
        }}
      />
      <Tabs.Screen
        name="studio"
        options={{
          title: 'STUDIO',
          tabBarIcon: ({ color }) => <Ionicons name="shirt-outline" size={20} color={color} />,
        }}
      />
      <Tabs.Screen
        name="grid"
        options={{
          title: 'GRID',
          tabBarIcon: ({ color }) => <Ionicons name="grid-outline" size={20} color={color} />,
        }}
      />
      <Tabs.Screen
        name="lookbook"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="community"
        options={{
          title: 'COMMUNITY',
          tabBarIcon: ({ color }) => <Ionicons name="people-outline" size={20} color={color} />,
        }}
      />
      <Tabs.Screen
        name="checklist"
        options={{
          title: 'PACK',
          tabBarIcon: ({ color }) => <Ionicons name="checkmark-circle-outline" size={20} color={color} />,
        }}
      />
    </Tabs>
  );
}
