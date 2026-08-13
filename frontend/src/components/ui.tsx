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
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';
import { type as t, space, radius, gutter } from '../theme/tokens';

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

// Brand mark — 3×3 grid of rounded squares, colours transcribed from uploads/LOGO.svg.
const LOGO_CELLS: [number, number, string][] = [
  [0, 0, '#006DA3'], [1, 0, '#CE4C36'], [2, 0, '#9FC4D6'],
  [0, 1, '#9FC4D6'], [1, 1, '#006DA3'], [2, 1, '#CE4C36'],
  [0, 2, '#CE4C36'], [1, 2, '#9FC4D6'], [2, 2, '#006DA3'],
];
export function Logo({ size = 48 }: { size?: number }) {
  const gap = size * 0.03125;
  const cell = size * 0.3125;
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="Packr"
      style={{ width: size, height: size, flexDirection: 'row', flexWrap: 'wrap', gap }}
    >
      {LOGO_CELLS.map(([col, row, fill], i) => (
        <View
          key={i}
          style={{ width: cell, height: cell, borderRadius: cell * 0.15, backgroundColor: fill }}
        />
      ))}
    </View>
  );
}

// Circular progress indicator — packing-day completion, etc. `progress` is 0–1.
export function ProgressRing({
  progress,
  size = 120,
  strokeWidth = 10,
  children,
}: {
  progress: number;
  size?: number;
  strokeWidth?: number;
  children?: React.ReactNode;
}) {
  const { c } = useTheme();
  const clamped = Math.max(0, Math.min(1, progress));
  const radiusPx = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radiusPx;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radiusPx}
          stroke={c.borderSubtle}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radiusPx}
          stroke={c.accent}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - clamped)}
          fill="none"
        />
      </Svg>
      {children}
    </View>
  );
}

export function Kicker({ children }: { children: React.ReactNode }) {
  const { c } = useTheme();
  return <Text style={[t.kicker, { color: c.accentText }]}>{children}</Text>;
}

export function Title({ children }: { children: React.ReactNode }) {
  const { c } = useTheme();
  return <Text style={[t.h1, { color: c.textPrimary }]}>{children}</Text>;
}

export function ScreenHeader({
  kicker,
  title,
  subtitle,
  right,
}: {
  kicker?: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  const { c } = useTheme();
  return (
    <View style={styles.header}>
      <View style={{ flex: 1, gap: space.xs }}>
        {kicker ? <Kicker>{kicker}</Kicker> : null}
        <Text style={[t.h1, { color: c.textPrimary }]}>{title}</Text>
        {subtitle ? <Text style={[t.micro, { color: c.textTertiary }]}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function Card({ children, style }: ViewProps) {
  const { c } = useTheme();
  return (
    <View style={[styles.card, { borderColor: c.borderSubtle, backgroundColor: c.elevated }, style]}>
      {children}
    </View>
  );
}

export function Button({
  title,
  icon,
  variant = 'primary',
  disabled,
  loading,
  style,
  ...props
}: PressableProps & {
  title: string;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
}) {
  const { c } = useTheme();
  const isPrimary = variant === 'primary';
  const color = variant === 'danger' ? c.error : isPrimary ? c.accentInk : c.textPrimary;
  const backgroundColor = isPrimary ? c.accent : variant === 'ghost' ? 'transparent' : c.elevated;
  const borderColor = variant === 'danger' ? c.error : isPrimary ? c.accent : c.borderActive;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      {...props}
      disabled={disabled || loading}
      style={(pressState) =>
        [
          styles.button,
          { backgroundColor, borderColor, opacity: disabled ? 0.45 : pressState.pressed ? 0.85 : 1 },
          typeof style === 'function' ? style(pressState) : style,
        ] as ViewStyle[]
      }
    >
      {loading ? (
        <ActivityIndicator color={color} size="small" />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={16} color={color} /> : null}
          <Text style={[t.label, { color }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

// Editorial action bar — label left, accent arrow block right (design-system primary CTA).
export function ActionBar({
  title,
  onPress,
  disabled,
  loading,
  testID,
}: {
  title: string;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.actionBar,
        { borderColor: c.textPrimary, backgroundColor: c.elevated, opacity: disabled ? 0.5 : pressed ? 0.9 : 1 },
      ]}
    >
      <View style={styles.actionBarLabel}>
        <Text style={[t.label, { color: c.textPrimary }]}>{title}</Text>
      </View>
      <View style={[styles.actionBarArrow, { backgroundColor: c.accent }]}>
        {loading ? (
          <ActivityIndicator color={c.accentInk} size="small" />
        ) : (
          <Ionicons name="arrow-forward" size={16} color={c.accentInk} />
        )}
      </View>
    </Pressable>
  );
}

export function IconButton({
  icon,
  accessibilityLabel,
  ...props
}: PressableProps & {
  icon: keyof typeof Ionicons.glyphMap;
  accessibilityLabel?: string;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || 'button'}
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

export function TextField(props: TextInputProps & { label?: string }) {
  const { c } = useTheme();
  const { label, ...rest } = props;
  return (
    <View style={{ gap: space.xs }}>
      {label ? <Text style={[t.kicker, { color: c.textTertiary }]}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={c.textTertiary}
        {...rest}
        style={[
          styles.input,
          { color: c.textPrimary, borderColor: c.borderActive, backgroundColor: c.elevated },
          rest.style,
        ]}
      />
    </View>
  );
}

export function Chip({
  label,
  active,
  icon,
  onPress,
  testID,
}: {
  label: string;
  active?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  testID?: string;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active }}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: active ? c.accent : 'transparent',
          borderColor: active ? c.accent : c.borderActive,
        },
      ]}
    >
      {icon ? <Ionicons name={icon} size={13} color={active ? c.accentInk : c.textSecondary} /> : null}
      <Text style={[t.label, { color: active ? c.accentInk : c.textSecondary }]}>{label}</Text>
    </Pressable>
  );
}

// Accent-fill pill for status markers ("PRO", "NEW").
export function Badge({ text = 'PRO' }: { text?: string }) {
  const { c } = useTheme();
  return (
    <View style={[styles.badge, { backgroundColor: c.accent }]}>
      <Text style={[t.label, { color: c.accentInk }]}>{text}</Text>
    </View>
  );
}

// 44×26 pill switch — on = accent fill, knob elevated.
export function Toggle({
  value,
  onValueChange,
  label,
}: {
  value: boolean;
  onValueChange: (v: boolean) => void;
  label?: string;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label || 'toggle'}
      accessibilityState={{ checked: value }}
      onPress={() => onValueChange(!value)}
      style={styles.toggleRow}
    >
      {label ? <Text style={[t.body, { color: c.textPrimary, flex: 1 }]}>{label}</Text> : null}
      <View
        style={[
          styles.toggleTrack,
          {
            backgroundColor: value ? c.accent : c.surface,
            borderColor: value ? c.accent : c.borderActive,
            justifyContent: value ? 'flex-end' : 'flex-start',
          },
        ]}
      >
        <View style={[styles.toggleKnob, { backgroundColor: c.elevated }]} />
      </View>
    </Pressable>
  );
}

// Wardrobe item as a museum-catalog card: plate + name + monochrome meta.
export function CatalogCard({
  name,
  meta,
  image,
  onPress,
}: {
  name: string;
  meta?: string;
  image?: React.ReactNode;
  onPress?: () => void;
}) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={name} style={styles.catalog}>
      <View style={[styles.plate, { backgroundColor: c.plate }]}>{image}</View>
      <Text style={[t.label, { color: c.textPrimary }]} numberOfLines={1}>{name}</Text>
      {meta ? <Text style={[t.micro, { color: c.textTertiary }]} numberOfLines={1}>{meta}</Text> : null}
    </Pressable>
  );
}

// 3×3 wardrobe grid unit — empty = dashed hairline + "+"; filled = plate + item name.
export function GridSlot({
  category,
  itemName,
  image,
  onPress,
}: {
  category: string;
  itemName?: string;
  image?: React.ReactNode;
  onPress?: () => void;
}) {
  const { c } = useTheme();
  const filled = !!itemName;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={filled ? `${category}: ${itemName}` : `Add ${category}`}
      style={[
        styles.gridSlot,
        filled
          ? { backgroundColor: c.plate, borderColor: c.borderActive, borderStyle: 'solid' }
          : { borderColor: c.borderSubtle, borderStyle: 'dashed' },
      ]}
    >
      {filled && image}
      <Text style={[t.label, { color: c.textTertiary }]}>{category}</Text>
      {filled ? (
        <Text style={[t.micro, { color: c.textPrimary }]} numberOfLines={1}>{itemName}</Text>
      ) : (
        <Text style={[t.h2, { color: c.borderActive }]}>+</Text>
      )}
    </Pressable>
  );
}

// Three plates side by side + name + occasion/weight kicker. Used in the lookbook and calendar sheet.
export function OutfitCard({
  images,
  name,
  meta,
  onPress,
}: {
  images: React.ReactNode[];
  name: string;
  meta?: string;
  onPress?: () => void;
}) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={name} style={styles.outfitCard}>
      <View style={styles.outfitPlates}>
        {images.map((img, i) => (
          <View key={i} style={[styles.outfitPlate, { backgroundColor: c.plate }]}>{img}</View>
        ))}
      </View>
      <Text style={[t.label, { color: c.textPrimary }]} numberOfLines={1}>{name}</Text>
      {meta ? <Text style={[t.micro, { color: c.textTertiary }]} numberOfLines={1}>{meta}</Text> : null}
    </Pressable>
  );
}

// Trip summary card: dates + days-left, destination in display type, meta line, progress bar.
export function TripCard({
  dates,
  daysLeft,
  destination,
  meta,
  progress,
  onPress,
  onLongPress,
  style,
  testID,
}: {
  dates: string;
  daysLeft?: string;
  destination: string;
  meta?: string;
  progress?: number;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: ViewProps['style'];
  testID?: string;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={destination}
      style={[styles.tripCard, { backgroundColor: c.elevated, borderColor: c.borderSubtle }, style]}
    >
      <View style={styles.tripCardTop}>
        <Text style={[t.label, { color: c.textTertiary, flex: 1 }]}>{dates}</Text>
        {daysLeft ? <Text style={[t.micro, { color: c.accentText }]}>{daysLeft}</Text> : null}
      </View>
      <Text style={[t.display, { color: c.textPrimary }]}>{destination}</Text>
      {meta ? <Text style={[t.micro, { color: c.textSecondary }]}>{meta}</Text> : null}
      {progress != null ? (
        <View style={[styles.tripProgressTrack, { backgroundColor: c.borderSubtle }]}>
          <View style={[styles.tripProgressFill, { backgroundColor: c.accent, width: `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%` }]} />
        </View>
      ) : null}
    </Pressable>
  );
}

// Receipt-style row: label left, value right, bottom hairline.
export function ReceiptRow({
  label,
  value,
  onPress,
}: {
  label: string;
  value?: React.ReactNode;
  onPress?: () => void;
}) {
  const { c } = useTheme();
  const inner = (
    <View style={[styles.receiptRow, { borderBottomColor: c.borderSubtle }]}>
      <Text style={[t.body, { color: c.textPrimary, flex: 1 }]}>{label}</Text>
      {typeof value === 'string' ? <Text style={[t.micro, { color: c.textTertiary }]}>{value}</Text> : value}
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>{inner}</Pressable>
  ) : inner;
}

export function StatTile({ value, label }: { value: string; label: string }) {
  const { c } = useTheme();
  return (
    <View style={[styles.statTile, { backgroundColor: c.surface }]}>
      <Text style={[t.display, { color: c.textPrimary }]}>{value}</Text>
      <Text style={[t.kicker, { color: c.textTertiary }]}>{label}</Text>
    </View>
  );
}

export function EmptyState({
  icon = 'cube-outline',
  title,
  body,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  body?: string;
}) {
  const { c } = useTheme();
  return (
    <View style={[styles.empty, { borderColor: c.borderSubtle }]}>
      <View style={[styles.emptyIcon, { backgroundColor: c.accentSoft }]}>
        <Ionicons name={icon} size={22} color={c.textPrimary} />
      </View>
      <Text style={[t.h2, { color: c.textPrimary }]}>{title}</Text>
      {body ? <Text style={[t.micro, { color: c.textTertiary, textAlign: 'center' }]}>{body}</Text> : null}
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
  screen: { padding: gutter, paddingBottom: space.xxxl },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  card: { borderWidth: 1, borderRadius: radius.sharp, padding: space.lg },
  button: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radius.sharp,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: space.sm,
    paddingHorizontal: space.lg,
  },
  actionBar: {
    height: 52,
    borderWidth: 1,
    borderRadius: radius.sharp,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  actionBarLabel: { flex: 1, height: '100%', justifyContent: 'center', paddingHorizontal: space.lg },
  actionBarArrow: { width: 52, height: '100%', alignItems: 'center', justifyContent: 'center' },
  iconButton: {
    width: 44,
    height: 44,
    borderWidth: 1,
    borderRadius: radius.sharp,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radius.sharp,
    paddingHorizontal: space.lg,
    fontSize: 15,
  },
  chip: {
    minHeight: 34,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  catalog: { flex: 1, gap: space.sm },
  plate: { width: '100%', aspectRatio: 1, borderRadius: radius.sharp, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  badge: { alignSelf: 'flex-start', borderRadius: radius.sharp, paddingHorizontal: space.sm, paddingVertical: space.xs },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  toggleTrack: {
    width: 44,
    height: 26,
    borderRadius: radius.pill,
    borderWidth: 1,
    padding: 3,
    flexDirection: 'row',
    alignItems: 'center',
  },
  toggleKnob: { width: 20, height: 20, borderRadius: radius.pill },
  gridSlot: {
    width: 100,
    height: 100,
    borderRadius: radius.sharp,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    overflow: 'hidden',
  },
  outfitCard: { width: 163, gap: space.sm },
  outfitPlates: { flexDirection: 'row', gap: space.xs, height: 120 },
  outfitPlate: { flex: 1, borderRadius: radius.sharp, overflow: 'hidden' },
  tripCard: { width: '100%', borderWidth: 1, borderRadius: radius.sharp, padding: space.lg, gap: space.sm },
  tripCardTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  tripProgressTrack: { height: 4, borderRadius: radius.sharp, overflow: 'hidden', width: '100%' },
  tripProgressFill: { height: 4, borderRadius: radius.sharp },
  receiptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.md,
    borderBottomWidth: 1,
  },
  statTile: { flex: 1, padding: space.md, borderRadius: radius.sharp, gap: space.xs },
  empty: {
    borderWidth: 1,
    borderRadius: radius.sharp,
    padding: space.xxl,
    alignItems: 'center',
    borderStyle: 'dashed',
    gap: space.md,
  },
  emptyIcon: { width: 48, height: 48, borderRadius: radius.sharp, alignItems: 'center', justifyContent: 'center' },
  loading: { minHeight: 180, alignItems: 'center', justifyContent: 'center' },
});
