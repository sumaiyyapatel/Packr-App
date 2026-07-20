import React, { useEffect, useState } from 'react';
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
import { getApiErrorMessage } from '../../src/lib/api';
import { fetchDailyForecast, geocodeCity } from '../../src/lib/weather';
import { trackEvent } from '../../src/lib/analytics';

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
  const trips = useStore((s) => s.trips);

  const [destination, setDestination] = useState('');
  const [results, setResults] = useState<GeoResult[]>([]);
  const [picked, setPicked] = useState<GeoResult | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [weatherPreview, setWeatherPreview] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (picked || destination.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        setResults(await geocodeCity(destination));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [destination, picked]);

  useEffect(() => {
    if (!picked || !isValidDate(startDate) || !isValidDate(endDate) || endDate < startDate) {
      setWeatherPreview(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const daily = await fetchDailyForecast(picked.latitude, picked.longitude, startDate, endDate);
        const max = daily?.temperature_2m_max?.[0];
        const min = daily?.temperature_2m_min?.[0];
        const rain = daily?.precipitation_sum?.[0];
        if (alive && max != null && min != null) {
          setWeatherPreview(`${Math.round(min)}C to ${Math.round(max)}C, rain ${Number(rain || 0).toFixed(1)}mm`);
        }
      } catch {
        if (alive) setWeatherPreview(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [picked, startDate, endDate]);

  const showDatePicker = (field: 'start' | 'end') => {
    const current = field === 'start' ? startDate : endDate;
    const value = isValidDate(current) ? new Date(`${current}T00:00:00`) : new Date();
    (async () => {
      try {
        const mod = await import('@react-native-community/datetimepicker');
        const picker = (mod as any).DateTimePickerAndroid ?? (mod as any).default?.DateTimePickerAndroid;
        if (!picker || typeof picker.open !== 'function') {
          throw new Error('native date picker not available');
        }
        picker.open({
          value,
          mode: 'date',
          onChange: (_event: any, selected: Date | undefined) => {
            if (!selected) return;
            const next = formatDate(selected);
            if (field === 'start') setStartDate(next);
            else setEndDate(next);
          },
        });
      } catch {
        // Fallback: simple prompt for YYYY-MM-DD
        const input = prompt('Enter date (YYYY-MM-DD)', value.toISOString().slice(0, 10));
        if (input && isValidDate(input)) {
          if (field === 'start') setStartDate(input);
          else setEndDate(input);
        }
      }
    })();
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
      await useStore.getState().createNewTrip(payload);
      trackEvent('trip_created', { has_weather_location: Boolean(picked) });
      router.replace('/(tabs)');
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } }).response?.status;
      const fallback =
        status === 402 ? 'Trip limit reached for this account.' : 'Failed to create trip';
      setErr(getApiErrorMessage(e, fallback));
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
        <Text style={[styles.kicker, { color: c.accent }]}>STEP 02 - YOUR FIRST TRIP</Text>
        <Text style={[styles.h1, { color: c.textPrimary }]}>Where are you</Text>
        <Text style={[styles.h1, { color: c.textPrimary }]}>going?</Text>

        <View style={{ height: 32 }} />
        <Text style={[styles.label, { color: c.textTertiary }]}>DESTINATION</Text>
        <TextInput
          testID="trip-dest-input"
          value={destination}
          onChangeText={(value) => {
            setDestination(value);
            setPicked(null);
          }}
          placeholder="Tokyo, Lisbon, Mumbai"
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
            <Pressable
              testID="trip-start-input"
              onPress={() => showDatePicker('start')}
              style={[styles.dateButton, { borderBottomColor: c.borderActive }]}
            >
              <Text style={{ color: startDate ? c.textPrimary : c.textTertiary, fontSize: 18 }}>
                {startDate || 'Pick date'}
              </Text>
            </Pressable>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.label, { color: c.textTertiary }]}>END</Text>
            <Pressable
              testID="trip-end-input"
              onPress={() => showDatePicker('end')}
              style={[styles.dateButton, { borderBottomColor: c.borderActive }]}
            >
              <Text style={{ color: endDate ? c.textPrimary : c.textTertiary, fontSize: 18 }}>
                {endDate || 'Pick date'}
              </Text>
            </Pressable>
          </View>
        </View>

        {weatherPreview && (
          <View style={[styles.weatherPreview, { borderColor: c.borderSubtle, backgroundColor: c.surface }]}>
            <Text style={{ color: c.textPrimary, fontSize: 13, fontWeight: '700' }}>Weather preview</Text>
            <Text style={{ color: c.textSecondary, fontSize: 13, marginTop: 4 }}>{weatherPreview}</Text>
          </View>
        )}

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
            <Text style={{ color: c.textSecondary, fontSize: 14 }}>Skip - go to dashboard</Text>
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

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 24, paddingTop: 80, paddingBottom: 48 },
  kicker: { fontSize: 11, letterSpacing: 2, fontWeight: '600' },
  h1: { fontSize: 38, fontWeight: '700', letterSpacing: -1.5, lineHeight: 44 },
  label: { fontSize: 11, letterSpacing: 1.5, marginBottom: 8, marginTop: 8 },
  input: { fontSize: 18, borderBottomWidth: 1, paddingVertical: 8 },
  dateButton: { borderBottomWidth: 1, minHeight: 42, justifyContent: 'center', paddingVertical: 10 },
  weatherPreview: { borderWidth: 1, borderRadius: 8, padding: 12, marginTop: 16 },
  resultBox: { marginTop: 8, borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  resultRow: { padding: 12, borderBottomWidth: 1 },
  btn: { paddingVertical: 16, borderRadius: 4, alignItems: 'center' },
  btnText: { fontSize: 16, fontWeight: '600', letterSpacing: 0.5 },
  error: { marginTop: 12, fontSize: 13 },
});
