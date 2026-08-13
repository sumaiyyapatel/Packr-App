import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/theme/ThemeProvider';
import { type as t, space, radius } from '../../src/theme/tokens';
import { Kicker, Title, IconButton, Chip, TextField } from '../../src/components/ui';
import { Template } from '../../src/lib/api';
import { listTemplates } from '../../src/lib/firestoreRepo';

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
  const [q, setQ] = useState('');
  const [climate, setClimate] = useState('');
  const [source, setSource] = useState<'all' | 'official' | 'community'>('all');
  const [daysRange, setDaysRange] = useState<{ label: string; min?: number; max?: number }>({ label: 'any length' });

  useEffect(() => {
    const timer = setTimeout(() => {
    (async () => {
      try {
        setTemplates(
          await listTemplates({
            q: q.trim() || undefined,
            climate: climate || undefined,
            source,
            daysMin: daysRange.min,
            daysMax: daysRange.max,
          })
        );
      } catch {}
      setLoading(false);
    })();
    }, 250);
    return () => clearTimeout(timer);
  }, [q, climate, source, daysRange]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: c.borderSubtle }]}>
        <IconButton testID="templates-back" icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} />
        <View style={{ marginLeft: space.md }}>
          <Kicker>COMMUNITY</Kicker>
          <Title>Templates</Title>
        </View>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={c.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: space.xxxl, gap: space.lg }}>
          <TextField
            value={q}
            onChangeText={setQ}
            placeholder="Search destination, season, style"
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
            {(['all', 'official', 'community'] as const).map((item) => (
              <Chip key={item} label={item.toUpperCase()} active={source === item} onPress={() => setSource(item)} />
            ))}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
            {['', 'cold', 'cool', 'mild', 'warm', 'tropical'].map((item) => (
              <Chip
                key={item || 'any'}
                label={(item || 'any climate').toUpperCase()}
                active={climate === item}
                onPress={() => setClimate(item)}
              />
            ))}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
            {[
              { label: 'any length' },
              { label: 'weekend', min: 1, max: 3 },
              { label: '4-6 days', min: 4, max: 6 },
              { label: '1 week', min: 7, max: 8 },
              { label: '9+ days', min: 9 },
            ].map((item) => (
              <Chip
                key={item.label}
                label={item.label.toUpperCase()}
                active={daysRange.label === item.label}
                onPress={() => setDaysRange(item)}
              />
            ))}
          </ScrollView>
          {templates.map((tpl) => (
            <Pressable
              testID={`template-card-${tpl.id}`}
              key={tpl.id}
              onPress={() => router.push(`/templates/${tpl.id}`)}
              style={({ pressed }) => [
                styles.card,
                {
                  backgroundColor: c.elevated,
                  borderColor: c.borderSubtle,
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                },
              ]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View
                  style={[
                    styles.climateChip,
                    { backgroundColor: c.surface, borderColor: c.borderActive },
                  ]}
                >
                  <Ionicons
                    name={CLIMATE_ICON[tpl.climate] || 'cloud-outline'}
                    size={14}
                    color={c.accentText}
                  />
                  <Text style={[t.micro, { color: c.accentText }]}>
                    {tpl.climate.toUpperCase()}
                  </Text>
                </View>
                {tpl.is_official && (
                  <View style={[styles.officialChip, { borderColor: c.accentText }]}>
                    <Text style={[t.micro, { color: c.accentText }]}>
                      OFFICIAL
                    </Text>
                  </View>
                )}
                <View style={{ flex: 1 }} />
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="heart-outline" size={14} color={c.textTertiary} />
                  <Text style={[t.micro, { color: c.textTertiary, marginLeft: 4 }]}>
                    {tpl.likes}
                  </Text>
                </View>
              </View>

              <Text style={[t.h2, { color: c.textPrimary, marginTop: space.md }]} numberOfLines={2}>
                {tpl.title}
              </Text>
              <Text style={[t.bodySm, { color: c.textSecondary, marginTop: space.sm }]} numberOfLines={2}>
                {tpl.description}
              </Text>

              <View style={[styles.swatches, { borderTopColor: c.borderSubtle }]}>
                {tpl.items.slice(0, 9).map((it, idx) => (
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
                <Text style={[t.micro, { color: c.textTertiary }]}>
                  {tpl.days}d - {tpl.season}
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
  header: { flexDirection: 'row', alignItems: 'center', padding: space.lg, borderBottomWidth: 1 },
  card: { borderWidth: 1, borderRadius: radius.sharp, padding: space.lg },
  climateChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, paddingHorizontal: space.sm, paddingVertical: space.xs, borderRadius: radius.pill,
  },
  officialChip: {
    borderWidth: 1, paddingHorizontal: space.sm, paddingVertical: space.xs, borderRadius: radius.pill, marginLeft: space.sm,
  },
  swatches: {
    flexDirection: 'row', gap: 4, alignItems: 'center', borderTopWidth: 1,
    paddingTop: space.md, marginTop: space.md,
  },
  swatch: { width: 14, height: 14, borderRadius: 3, borderWidth: 1 },
});
