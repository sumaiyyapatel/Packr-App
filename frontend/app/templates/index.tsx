import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/theme/ThemeProvider';
import { api, Template } from '../../src/lib/api';

const CLIMATE_ICON: Record<string, any> = {
  cold: 'snow-outline',
  cool: 'cloud-outline',
  mild: 'partly-sunny-outline',
  warm: 'sunny-outline',
  tropical: 'flower-outline',
};

export default function TemplatesIndex() {
  const { c } = useTheme();
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get('/templates');
        setTemplates(r.data);
      } catch {}
      setLoading(false);
    })();
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: c.borderSubtle }]}>
        <Pressable
          testID="templates-back"
          onPress={() => router.back()}
          style={[styles.iconBtn, { borderColor: c.borderSubtle }]}
        >
          <Ionicons name="chevron-back" size={20} color={c.textPrimary} />
        </Pressable>
        <View style={{ marginLeft: 12 }}>
          <Text style={[styles.kicker, { color: c.accent }]}>COMMUNITY</Text>
          <Text style={[styles.title, { color: c.textPrimary }]}>Templates</Text>
        </View>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={c.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 48, gap: 16 }}>
          {templates.map((t) => (
            <Pressable
              testID={`template-card-${t.id}`}
              key={t.id}
              onPress={() => router.push(`/templates/${t.id}`)}
              style={({ pressed }) => [
                styles.card,
                {
                  backgroundColor: c.surface,
                  borderColor: c.borderSubtle,
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                },
              ]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View
                  style={[
                    styles.climateChip,
                    { backgroundColor: c.elevated, borderColor: c.borderActive },
                  ]}
                >
                  <Ionicons
                    name={CLIMATE_ICON[t.climate] || 'cloud-outline'}
                    size={14}
                    color={c.accent}
                  />
                  <Text style={{ color: c.accent, fontSize: 10, letterSpacing: 1, fontWeight: '600' }}>
                    {t.climate.toUpperCase()}
                  </Text>
                </View>
                {t.is_official && (
                  <View style={[styles.officialChip, { borderColor: c.accent }]}>
                    <Text style={{ color: c.accent, fontSize: 9, letterSpacing: 1, fontWeight: '600' }}>
                      OFFICIAL
                    </Text>
                  </View>
                )}
                <View style={{ flex: 1 }} />
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="heart-outline" size={14} color={c.textTertiary} />
                  <Text style={{ color: c.textTertiary, fontSize: 12, marginLeft: 4 }}>
                    {t.likes}
                  </Text>
                </View>
              </View>

              <Text style={[styles.cardTitle, { color: c.textPrimary }]} numberOfLines={2}>
                {t.title}
              </Text>
              <Text style={{ color: c.textSecondary, fontSize: 13, marginTop: 8 }} numberOfLines={2}>
                {t.description}
              </Text>

              <View style={[styles.swatches, { borderTopColor: c.borderSubtle }]}>
                {t.items.slice(0, 9).map((it, idx) => (
                  <View
                    key={idx}
                    style={[
                      styles.swatch,
                      {
                        backgroundColor: it.colors[0] || c.elevated,
                        borderColor: c.borderSubtle,
                      },
                    ]}
                  />
                ))}
                <View style={{ flex: 1 }} />
                <Text style={{ color: c.textTertiary, fontSize: 11 }}>
                  {t.days}d · {t.season}
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1 },
  iconBtn: { width: 36, height: 36, borderWidth: 1, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  kicker: { fontSize: 11, letterSpacing: 2, fontWeight: '600' },
  title: { fontSize: 24, fontWeight: '700', letterSpacing: -1 },
  card: { borderWidth: 1, borderRadius: 8, padding: 16, gap: 4 },
  climateChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999,
  },
  officialChip: {
    borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, marginLeft: 8,
  },
  cardTitle: { fontSize: 18, fontWeight: '700', letterSpacing: -0.5, marginTop: 12 },
  swatches: {
    flexDirection: 'row', gap: 4, alignItems: 'center', borderTopWidth: 1,
    paddingTop: 12, marginTop: 12,
  },
  swatch: { width: 14, height: 14, borderRadius: 3, borderWidth: 1 },
});
