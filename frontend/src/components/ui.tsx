import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  PressableProps,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';

export function Screen({
  children,
  scroll = true,
}: {
  children: React.ReactNode;
  scroll?: boolean;
}) {
  const { c } = useTheme();
  if (!scroll) {
    return <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>{children}</SafeAreaView>;
  }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={styles.screen} showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({ children, style }: ViewProps) {
  const { c } = useTheme();
  return <View style={[styles.card, { borderColor: c.borderSubtle, backgroundColor: c.surface }, style]}>{children}</View>;
}

export function Button({
  title,
  icon,
  variant = 'primary',
  disabled,
  ...props
}: PressableProps & {
  title: string;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}) {
  const { c } = useTheme();
  const isPrimary = variant === 'primary';
  const color = variant === 'danger' ? c.error : isPrimary ? c.bg : c.textPrimary;
  const backgroundColor = isPrimary ? c.accent : 'transparent';
  const borderColor = variant === 'danger' ? c.error : isPrimary ? c.accent : c.borderActive;
  return (
    <Pressable
      {...props}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor, borderColor, opacity: disabled ? 0.45 : pressed ? 0.82 : 1 },
      ]}
    >
      {icon ? <Ionicons name={icon} size={17} color={color} /> : null}
      <Text style={[styles.buttonText, { color }]}>{title}</Text>
    </Pressable>
  );
}

export function IconButton({
  icon,
  ...props
}: PressableProps & {
  icon: keyof typeof Ionicons.glyphMap;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      {...props}
      style={({ pressed }) => [
        styles.iconButton,
        { borderColor: c.borderSubtle, opacity: pressed ? 0.75 : 1 },
      ]}
    >
      <Ionicons name={icon} size={18} color={c.textPrimary} />
    </Pressable>
  );
}

export function TextField(props: TextInputProps) {
  const { c } = useTheme();
  return (
    <TextInput
      placeholderTextColor={c.textTertiary}
      {...props}
      style={[styles.input, { color: c.textPrimary, borderBottomColor: c.borderActive }, props.style]}
    />
  );
}

export function Chip({
  label,
  active,
  icon,
  onPress,
}: {
  label: string;
  active?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: active ? c.accent : 'transparent',
          borderColor: active ? c.accent : c.borderSubtle,
        },
      ]}
    >
      {icon ? <Ionicons name={icon} size={14} color={active ? c.bg : c.textSecondary} /> : null}
      <Text style={[styles.chipText, { color: active ? c.bg : c.textSecondary }]}>{label}</Text>
    </Pressable>
  );
}

export function EmptyState({ icon = 'cube-outline', title, body }: { icon?: keyof typeof Ionicons.glyphMap; title: string; body?: string }) {
  const { c } = useTheme();
  return (
    <View style={[styles.empty, { borderColor: c.borderSubtle }]}>
      <Ionicons name={icon} size={34} color={c.textTertiary} />
      <Text style={{ color: c.textPrimary, fontSize: 16, fontWeight: '800', marginTop: 12 }}>{title}</Text>
      {body ? <Text style={{ color: c.textSecondary, textAlign: 'center', marginTop: 6 }}>{body}</Text> : null}
    </View>
  );
}

export function LoadingState() {
  const { c } = useTheme();
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={c.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 24, paddingBottom: 48 },
  card: { borderWidth: 1, borderRadius: 8, padding: 16 },
  button: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
  },
  buttonText: { fontSize: 13, letterSpacing: 0.8, fontWeight: '800' },
  iconButton: { width: 38, height: 38, borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  input: { fontSize: 17, borderBottomWidth: 1, paddingVertical: 8 },
  chip: { minHeight: 34, borderRadius: 8, borderWidth: 1, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipText: { fontSize: 11, letterSpacing: 0.8, fontWeight: '800' },
  empty: { borderWidth: 1, borderRadius: 8, padding: 28, alignItems: 'center', borderStyle: 'dashed' },
  loading: { minHeight: 180, alignItems: 'center', justifyContent: 'center' },
});
