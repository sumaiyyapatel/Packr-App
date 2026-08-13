import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../src/theme/ThemeProvider';
import { type as t, space, radius } from '../../src/theme/tokens';
import { Kicker, IconButton, Button } from '../../src/components/ui';
import { getApiErrorMessage, Template } from '../../src/lib/api';
import { getTemplate, isTemplateLiked, setTemplateLike } from '../../src/lib/firestoreRepo';
import { useStore } from '../../src/lib/store';

export default function TemplateDetail() {
  const { c } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const trips = useStore((s) => s.trips);
  const selectedTripId = useStore((s) => s.selectedTripId);
  const refreshAll = useStore((s) => s.refreshAll);
  const [tpl, setTpl] = useState<Template | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [liked, setLiked] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setTpl(await getTemplate(String(id)));
        const uid = useStore.getState().user?.id;
        if (uid) setLiked(await isTemplateLiked(uid, String(id)));
      } catch {}
      setLoading(false);
    })();
  }, [id]);

  const onApply = async () => {
    const trip = trips.find((t) => t.id === selectedTripId) || trips[0];
    if (!trip) {
      Alert.alert('No trip', 'Create a trip first.');
      return;
    }
    const doApply = async () => {
      setApplying(true);
      try {
        if (!tpl) throw new Error('Template still loading');
        await useStore.getState().applyTemplateToTrip(trip.id, tpl.items);
        if (Platform.OS !== 'web') Alert.alert('Applied', 'Template loaded into your grid.');
        router.replace('/(tabs)/grid');
      } catch (e: unknown) {
        Alert.alert('Failed', getApiErrorMessage(e, 'Could not apply template'));
      } finally {
        setApplying(false);
      }
    };

    const message = `This will add 9 placeholder items to your wardrobe and overwrite the grid for "${trip.destination}".`;
    if (Platform.OS === 'web') {
      // RN-Web ignores multi-button Alert.alert — use native window.confirm.
      if (typeof window !== 'undefined' && window.confirm(`Apply template?\n${message}`)) {
        await doApply();
      }
      return;
    }
    Alert.alert('Apply template?', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Apply', onPress: doApply },
    ]);
  };

  const onLike = async () => {
    if (liked || !tpl) return;
    setLiked(true);
    try {
      const uid = useStore.getState().user?.id;
      if (!uid) throw new Error('Not signed in');
      await setTemplateLike(uid, tpl.id, true);
      setTpl({ ...tpl, likes: tpl.likes + 1 });
    } catch {
      setLiked(false);
    }
  };

  if (loading || !tpl) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: c.borderSubtle }]}>
        <IconButton testID="template-back" icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} />
        <Kicker>TEMPLATE</Kicker>
      </View>

      <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: space.xxl }}>
        <Text style={[t.h1, { color: c.textPrimary }]}>{tpl.title}</Text>
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md, flexWrap: 'wrap' }}>
          <Tag color={c.accentText} text={tpl.climate.toUpperCase()} />
          <Tag color={c.textSecondary} text={`${tpl.days} DAYS`} />
          <Tag color={c.textSecondary} text={tpl.season.toUpperCase()} />
          {tpl.is_official && <Tag color={c.accentText} text="OFFICIAL" />}
        </View>

        <Text style={[t.micro, { color: c.textTertiary, marginTop: space.md }]}>
          {tpl.destination} · by {tpl.author_name || 'anonymous'} · ❤︎ {tpl.likes}
        </Text>

        <Text style={[t.body, { color: c.textSecondary, marginTop: space.lg }]}>
          {tpl.description}
        </Text>

        <View style={{ height: space.xl }} />
        <Text style={[t.kicker, { color: c.textPrimary, marginBottom: space.sm }]}>THE 9 ITEMS</Text>
        <View style={[styles.gridBox, { borderColor: c.borderSubtle }]}>
          {tpl.items.map((it, idx) => (
            <View
              key={idx}
              style={[styles.itemRow, { borderColor: c.borderSubtle }]}
            >
              <View style={{ flexDirection: 'row', gap: 4 }}>
                {(it.colors || []).slice(0, 3).map((col, j) => (
                  <View
                    key={j}
                    style={[styles.swatch, { backgroundColor: col, borderColor: c.borderSubtle }]}
                  />
                ))}
              </View>
              <View style={{ flex: 1, marginLeft: space.md }}>
                <Text style={[t.title, { color: c.textPrimary }]}>
                  {it.name}
                </Text>
                <Text style={[t.kicker, { color: c.textTertiary, marginTop: 2 }]}>
                  {it.category.toUpperCase()} · SLOT {idx + 1}
                </Text>
              </View>
              {it.tags?.slice(0, 1).map((tag) => (
                <View
                  key={tag}
                  style={[styles.miniTag, { borderColor: c.borderActive }]}
                >
                  <Text style={[t.micro, { color: c.textSecondary }]}>
                    #{tag}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>

        <View style={{ height: space.xl }} />
        <Button
          testID="template-like-button"
          title={liked ? 'Liked' : 'Like'}
          icon={liked ? 'heart' : 'heart-outline'}
          variant="secondary"
          onPress={onLike}
        />

        <View style={{ height: space.md }} />
        <Button
          testID="template-apply-button"
          title="Apply to my trip"
          onPress={onApply}
          loading={applying}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function Tag({ color, text }: { color: string; text: string }) {
  return (
    <View style={[styles.tag, { borderColor: color }]}>
      <Text style={[t.kicker, { color, fontSize: 10 }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderBottomWidth: 1 },
  tag: { borderWidth: 1, paddingHorizontal: space.md, paddingVertical: space.xs, borderRadius: radius.pill },
  gridBox: { borderWidth: 1, borderRadius: radius.sharp, overflow: 'hidden' },
  itemRow: { flexDirection: 'row', alignItems: 'center', padding: space.md, borderBottomWidth: 1 },
  swatch: { width: 14, height: 14, borderRadius: 3, borderWidth: 1 },
  miniTag: { borderWidth: 1, borderRadius: radius.sharp, paddingHorizontal: space.sm, paddingVertical: 2 },
});
