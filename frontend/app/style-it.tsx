import React, { useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated';
import { captureRef } from 'react-native-view-shot';
import { useTheme } from '../src/theme/ThemeProvider';
import { type as t, space, radius } from '../src/theme/tokens';
import { Kicker, IconButton, ActionBar } from '../src/components/ui';
import { useStore } from '../src/lib/store';
import { resolveApiAssetUrl, WardrobeItem } from '../src/lib/api';
import { trackEvent } from '../src/lib/analytics';

const CANVAS_H = 420;
const IMAGE_SIZE = 150;

// "10 · Style it (canvas)" — collage view entered from a Lookbook outfit
// card: drag/pinch/rotate the three garment images, then share the capture
// to Instagram (or any share-sheet target) via expo-sharing.
export default function StyleIt() {
  const { c } = useTheme();
  const router = useRouter();
  const { tripId, outfitKey, occasion } = useLocalSearchParams<{
    tripId: string;
    outfitKey: string;
    occasion?: string;
  }>();
  const trips = useStore((s) => s.trips);
  const wardrobe = useStore((s) => s.wardrobe);
  const trip = trips.find((x) => x.id === tripId);

  const itemsById = useMemo(() => {
    const m: Record<string, WardrobeItem> = {};
    for (const w of wardrobe) m[w.id] = w;
    return m;
  }, [wardrobe]);

  const ids = useMemo(() => (outfitKey ? String(outfitKey).split('|') : []), [outfitKey]);
  const items = ids.map((id) => itemsById[id]).filter(Boolean) as WardrobeItem[];

  const [zOrder, setZOrder] = useState<number[]>(items.map((_, i) => i));
  const [sharing, setSharing] = useState(false);
  const canvasRef = useRef<View | null>(null);

  const bringToFront = (index: number) => {
    setZOrder((current) => [...current.filter((i) => i !== index), index]);
  };

  // Fixed starting layout: offset the three garments so they overlap
  // legibly (top slightly left, layer top-right, bottom centered/lower) —
  // matches the Figma reference composition.
  const startPositions = [
    { x: -50, y: -50 },
    { x: 40, y: -40 },
    { x: -6, y: 60 },
  ];

  const layerRefs = useRef<{ nudgeRotate: () => void; cycleScale: () => void }[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const onLayer = () => bringToFront(activeIndex);
  const onRotate = () => layerRefs.current[activeIndex]?.nudgeRotate();
  const onScale = () => layerRefs.current[activeIndex]?.cycleScale();
  const onRemoveBg = () =>
    Alert.alert('Packr Pro', 'Automatic background removal is a Pro feature, coming soon.');

  const onShare = async () => {
    if (!canvasRef.current) return;
    setSharing(true);
    try {
      const Sharing = await import('expo-sharing').catch(() => null);
      const available =
        Sharing && typeof Sharing.shareAsync === 'function'
          ? await Sharing.isAvailableAsync().catch(() => false)
          : false;
      if (!Sharing || !available) {
        Alert.alert('Update needed', 'Sharing needs the latest app build. Rebuild the dev client to enable it.');
        return;
      }
      const uri = await captureRef(canvasRef, { format: 'jpg', quality: 0.95, result: 'tmpfile' });
      trackEvent('style_it_shared', { trip_id: tripId, item_count: items.length });
      await Sharing.shareAsync(uri, { mimeType: 'image/jpeg', dialogTitle: 'Share your outfit' });
    } catch {
      Alert.alert('Share failed', 'Could not capture this outfit.');
    } finally {
      setSharing(false);
    }
  };

  if (!trip || items.length !== 3) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl }}>
          <Text style={{ color: c.textSecondary, textAlign: 'center' }}>
            Couldn&apos;t load this outfit. Go back and try again.
          </Text>
          <View style={{ height: space.lg }} />
          <Pressable onPress={() => router.back()}>
            <Text style={{ color: c.accentText }}>Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Kicker>STYLE IT</Kicker>
            <Text style={[t.h1, { color: c.textPrimary, marginTop: 2 }]}>
              {occasion ? String(occasion) : trip.destination}
            </Text>
            <Text style={[t.micro, { color: c.textTertiary, marginTop: 2 }]}>Drag, pinch, layer — then share</Text>
          </View>
          <IconButton icon="close" accessibilityLabel="Close" onPress={() => router.back()} />
        </View>

        <View ref={canvasRef} style={[styles.canvas, { backgroundColor: c.surface }]}>
          {items.map((item, index) => (
            <StyleLayer
              key={item.id}
              ref={(handle) => {
                layerRefs.current[index] = handle as any;
              }}
              item={item}
              start={startPositions[index]}
              zIndex={zOrder.indexOf(index)}
              onFocus={() => {
                setActiveIndex(index);
                bringToFront(index);
              }}
            />
          ))}
        </View>

        <View style={styles.toolbar}>
          {[
            { label: 'Layer', onPress: onLayer },
            { label: 'Rotate', onPress: onRotate },
            { label: 'Scale', onPress: onScale },
            { label: 'Remove bg', onPress: onRemoveBg },
          ].map((tool) => (
            <Pressable
              key={tool.label}
              testID={`style-tool-${tool.label.toLowerCase().replace(' ', '-')}`}
              onPress={tool.onPress}
              style={({ pressed }) => [styles.toolBtn, { backgroundColor: c.accent, opacity: pressed ? 0.85 : 1 }]}
            >
              <Text style={[t.micro, { color: c.accentInk }]}>{tool.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={{ flex: 1 }} />

        {sharing ? (
          <View style={[styles.shareLoading]}>
            <ActivityIndicator color={c.accent} />
          </View>
        ) : (
          <ActionBar testID="style-share-button" title="Share to Instagram" onPress={onShare} />
        )}
        <View style={{ height: space.lg }} />
      </View>
    </SafeAreaView>
  );
}

const StyleLayer = React.forwardRef<
  { nudgeRotate: () => void; cycleScale: () => void },
  { item: WardrobeItem; start: { x: number; y: number }; zIndex: number; onFocus: () => void }
>(function StyleLayer({ item, start, zIndex, onFocus }, ref) {
  const { c } = useTheme();
  const baseX = useSharedValue(start.x);
  const baseY = useSharedValue(start.y);
  const x = useSharedValue(start.x);
  const y = useSharedValue(start.y);
  const baseScale = useSharedValue(1);
  const scale = useSharedValue(1);
  const baseRotation = useSharedValue(0);
  const rotation = useSharedValue(0);

  React.useImperativeHandle(ref, () => ({
    nudgeRotate: () => {
      const next = baseRotation.value + Math.PI / 6;
      baseRotation.value = next;
      rotation.value = next;
    },
    cycleScale: () => {
      const steps = [0.85, 1, 1.2];
      const current = steps.reduce((closest, s) =>
        Math.abs(s - baseScale.value) < Math.abs(closest - baseScale.value) ? s : closest
      );
      const next = steps[(steps.indexOf(current) + 1) % steps.length];
      baseScale.value = next;
      scale.value = next;
    },
  }));

  const pan = Gesture.Pan()
    .onStart(() => runOnJS(onFocus)())
    .onUpdate((e) => {
      x.value = baseX.value + e.translationX;
      y.value = baseY.value + e.translationY;
    })
    .onEnd(() => {
      baseX.value = x.value;
      baseY.value = y.value;
    });

  const pinch = Gesture.Pinch()
    .onStart(() => runOnJS(onFocus)())
    .onUpdate((e) => {
      scale.value = Math.max(0.4, Math.min(2.5, baseScale.value * e.scale));
    })
    .onEnd(() => {
      baseScale.value = scale.value;
    });

  const rotate = Gesture.Rotation()
    .onStart(() => runOnJS(onFocus)())
    .onUpdate((e) => {
      rotation.value = baseRotation.value + e.rotation;
    })
    .onEnd(() => {
      baseRotation.value = rotation.value;
    });

  const composed = Gesture.Simultaneous(pan, pinch, rotate);

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      { translateY: y.value },
      { scale: scale.value },
      { rotate: `${rotation.value}rad` },
    ],
    zIndex,
  }));

  return (
    <GestureDetector gesture={composed}>
      <Animated.View
        testID={`style-layer-${item.id}`}
        style={[
          styles.layer,
          { left: CANVAS_H / 2 - IMAGE_SIZE / 2, top: CANVAS_H / 2 - IMAGE_SIZE / 2, backgroundColor: c.plate },
          animStyle,
        ]}
      >
        {item.image ? (
          <Image source={{ uri: resolveApiAssetUrl(item.image) }} style={styles.layerImg} contentFit="contain" />
        ) : (
          <Text style={[t.micro, { color: c.textTertiary, textAlign: 'center', padding: space.sm }]}>
            {item.name}
          </Text>
        )}
      </Animated.View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1, padding: space.xl },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  canvas: {
    height: CANVAS_H,
    borderRadius: radius.sharp,
    marginTop: space.lg,
    overflow: 'hidden',
  },
  layer: {
    position: 'absolute',
    width: IMAGE_SIZE,
    height: IMAGE_SIZE,
    borderRadius: radius.sharp,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  layerImg: { width: '100%', height: '100%' },
  toolbar: { flexDirection: 'row', gap: space.sm, marginTop: space.lg },
  toolBtn: { flex: 1, height: 44, borderRadius: radius.sharp, alignItems: 'center', justifyContent: 'center' },
  shareLoading: { height: 52, alignItems: 'center', justifyContent: 'center' },
});
