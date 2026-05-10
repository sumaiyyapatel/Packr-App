import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useStore } from '../../src/lib/store';
import { api } from '../../src/lib/api';

type GeoResult = {
  name: string;
  country?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
};

export default function TripCreate() {
  const { c } = useTheme();
  const router = useRouter();
  const upsertTrip = useStore((s) => s.upsertTrip);
  const setSelectedTrip = useStore((s) => s.setSelectedTrip);
  const trips = useStore((s) => s.trips);

  const [destination, setDestination] = useState('');
  const [results, setResults] = useState<GeoResult[]>([]);
  const [picked, setPicked] = useState<GeoResult | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const search = async (q: string) => {
    setDestination(q);
    setPicked(null);
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const r = await api.get('/geocode', { params: { q } });
      setResults(r.data.results || []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const onCreate = async () => {
    setErr(null);
    if (!destination.trim()) return setErr('Destination is required');
    if (!isValidDate(startDate)) return setErr('Start date must be YYYY-MM-DD');
    if (!isValidDate(endDate)) return setErr('End date must be YYYY-MM-DD');
    if (endDate < startDate) return setErr('End must be after start');

    setLoading(true);
    try {
      const payload: any = {
        destination: picked ? formatLoc(picked) : destination.trim(),
        start_date: startDate,
        end_date: endDate,
      };
      if (picked) {
        payload.latitude = picked.latitude;
        payload.longitude = picked.longitude;
      }
      const r = await api.post('/trips', payload);
      upsertTrip(r.data);
      setSelectedTrip(r.data.id);
      router.replace('/(tabs)');
    } catch (e: any) {
      setErr(e?.response?.data?.detail || 'Failed to create trip');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: c.bg }}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={[styles.kicker, { color: c.accent }]}>STEP 02 · YOUR FIRST TRIP</Text>
        <Text style={[styles.h1, { color: c.textPrimary }]}>Where are you</Text>
        <Text style={[styles.h1, { color: c.textPrimary }]}>going?</Text>

        <View style={{ height: 32 }} />
        <Text style={[styles.label, { color: c.textTertiary }]}>DESTINATION</Text>
        <TextInput
          testID="trip-dest-input"
          value={destination}
          onChangeText={search}
          placeholder="Tokyo, Lisbon, Mumbai…"
          placeholderTextColor={c.textTertiary}
          style={[styles.input, { color: c.textPrimary, borderBottomColor: c.borderActive }]}
        />

        {searching && <ActivityIndicator color={c.accent} style={{ marginTop: 8 }} />}
        {!picked && results.length > 0 && (
          <View style={[styles.resultBox, { borderColor: c.borderSubtle, backgroundColor: c.surface }]}>
            {results.map((r, idx) => (
              <Pressable
                key={idx}
                testID={`geo-result-${idx}`}
                onPress={() => {
                  setPicked(r);
                  setDestination(formatLoc(r));
                  setResults([]);
                }}
                style={({ pressed }) => [
                  styles.resultRow,
                  { borderColor: c.borderSubtle, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text style={{ color: c.textPrimary, fontSize: 15 }}>{r.name}</Text>
                <Text style={{ color: c.textTertiary, fontSize: 12 }}>
                  {[r.admin1, r.country].filter(Boolean).join(', ')}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        <View style={{ height: 24 }} />
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.label, { color: c.textTertiary }]}>START</Text>
            <TextInput
              testID="trip-start-input"
              value={startDate}
              onChangeText={setStartDate}
              placeholder="2026-04-01"
              placeholderTextColor={c.textTertiary}
              autoCapitalize="none"
              style={[styles.input, { color: c.textPrimary, borderBottomColor: c.borderActive }]}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.label, { color: c.textTertiary }]}>END</Text>
            <TextInput
              testID="trip-end-input"
              value={endDate}
              onChangeText={setEndDate}
              placeholder="2026-04-08"
              placeholderTextColor={c.textTertiary}
              autoCapitalize="none"
              style={[styles.input, { color: c.textPrimary, borderBottomColor: c.borderActive }]}
            />
          </View>
        </View>

        {err && <Text style={[styles.error, { color: c.error }]}>{err}</Text>}

        <View style={{ height: 40 }} />
        <Pressable
          testID="trip-create-button"
          onPress={onCreate}
          disabled={loading}
          style={({ pressed }) => [
            styles.btn,
            { backgroundColor: c.accent, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          {loading ? (
            <ActivityIndicator color={c.bg} />
          ) : (
            <Text style={[styles.btnText, { color: c.bg }]}>Create Trip</Text>
          )}
        </Pressable>

        {trips.length > 0 && (
          <Pressable
            testID="trip-skip-button"
            onPress={() => router.replace('/(tabs)')}
            style={{ paddingVertical: 12, alignItems: 'center', marginTop: 8 }}
          >
            <Text style={{ color: c.textSecondary, fontSize: 14 }}>Skip — go to dashboard</Text>
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function formatLoc(r: GeoResult) {
  return [r.name, r.admin1, r.country].filter(Boolean).join(', ');
}

function isValidDate(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 24, paddingTop: 80, paddingBottom: 48 },
  kicker: { fontSize: 11, letterSpacing: 2, fontWeight: '600' },
  h1: { fontSize: 38, fontWeight: '700', letterSpacing: -1.5, lineHeight: 44 },
  label: { fontSize: 11, letterSpacing: 1.5, marginBottom: 8, marginTop: 8 },
  input: { fontSize: 18, borderBottomWidth: 1, paddingVertical: 8 },
  resultBox: { marginTop: 8, borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  resultRow: { padding: 12, borderBottomWidth: 1 },
  btn: { paddingVertical: 16, borderRadius: 4, alignItems: 'center' },
  btnText: { fontSize: 16, fontWeight: '600', letterSpacing: 0.5 },
  error: { marginTop: 12, fontSize: 13 },
});
