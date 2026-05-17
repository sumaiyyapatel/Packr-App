import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/theme/ThemeProvider';
import { api, getApiErrorMessage, Template } from '../../src/lib/api';
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
        const r = await api.get(`/templates/${id}`);
        setTpl(r.data);
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
        await api.post(`/templates/${id}/apply`, { trip_id: trip.id });
        await refreshAll();
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
      const r = await api.post(`/templates/${id}/like`);
      setTpl(r.data);
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
        <Pressable
          testID="template-back"
          onPress={() => router.back()}
          style={[styles.iconBtn, { borderColor: c.borderSubtle }]}
        >
          <Ionicons name="chevron-back" size={20} color={c.textPrimary} />
        </Pressable>
        <Text style={[styles.kicker, { color: c.accent, marginLeft: 12 }]}>TEMPLATE</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 32 }}>
        <Text style={[styles.title, { color: c.textPrimary }]}>{tpl.title}</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <Tag color={c.accent} text={tpl.climate.toUpperCase()} />
          <Tag color={c.textSecondary} text={`${tpl.days} DAYS`} />
          <Tag color={c.textSecondary} text={tpl.season.toUpperCase()} />
          {tpl.is_official && <Tag color={c.accent} text="OFFICIAL" />}
        </View>

        <Text style={{ color: c.textTertiary, fontSize: 12, marginTop: 12 }}>
          {tpl.destination} · by {tpl.author_name || 'anonymous'} · ❤︎ {tpl.likes}
        </Text>

        <Text style={{ color: c.textSecondary, fontSize: 14, marginTop: 16, lineHeight: 22 }}>
          {tpl.description}
        </Text>

        <View style={{ height: 24 }} />
        <Text style={[styles.section, { color: c.textPrimary }]}>THE 9 ITEMS</Text>
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
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={{ color: c.textPrimary, fontSize: 14, fontWeight: '600' }}>
                  {it.name}
                </Text>
                <Text style={{ color: c.textTertiary, fontSize: 11, letterSpacing: 1, marginTop: 2 }}>
                  {it.category.toUpperCase()} · SLOT {idx + 1}
                </Text>
              </View>
              {it.tags?.slice(0, 1).map((t) => (
                <View
                  key={t}
                  style={[styles.miniTag, { borderColor: c.borderActive }]}
                >
                  <Text style={{ color: c.textSecondary, fontSize: 10, letterSpacing: 0.5 }}>
                    #{t}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>

        <View style={{ height: 24 }} />
        <Pressable
          testID="template-like-button"
          onPress={onLike}
          style={[styles.likeBtn, { borderColor: c.borderActive }]}
        >
          <Ionicons name={liked ? 'heart' : 'heart-outline'} size={16} color={liked ? c.accent : c.textPrimary} />
          <Text style={{ color: liked ? c.accent : c.textPrimary, marginLeft: 8 }}>
            {liked ? 'Liked' : 'Like'}
          </Text>
        </Pressable>

        <View style={{ height: 12 }} />
        <Pressable
          testID="template-apply-button"
          onPress={onApply}
          disabled={applying}
          style={({ pressed }) => [
            styles.applyBtn,
            { backgroundColor: c.accent, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          {applying ? (
            <ActivityIndicator color={c.bg} />
          ) : (
            <Text style={{ color: c.bg, fontSize: 15, fontWeight: '600', letterSpacing: 0.5 }}>
              APPLY TO MY TRIP
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Tag({ color, text }: { color: string; text: string }) {
  return (
    <View style={[styles.tag, { borderColor: color }]}>
      <Text style={{ color, fontSize: 10, letterSpacing: 1.5, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1 },
  iconBtn: { width: 36, height: 36, borderWidth: 1, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  kicker: { fontSize: 11, letterSpacing: 2, fontWeight: '600' },
  title: { fontSize: 28, fontWeight: '700', letterSpacing: -1 },
  tag: { borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4 },
  section: { fontSize: 11, letterSpacing: 2, fontWeight: '600', marginBottom: 8 },
  gridBox: { borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  itemRow: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1 },
  swatch: { width: 14, height: 14, borderRadius: 3, borderWidth: 1 },
  miniTag: { borderWidth: 1, borderRadius: 3, paddingHorizontal: 6, paddingVertical: 2 },
  likeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 4, paddingVertical: 14 },
  applyBtn: { paddingVertical: 16, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
});
