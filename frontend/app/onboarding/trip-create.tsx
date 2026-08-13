import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/theme/ThemeProvider';
import { type as t, space, radius } from '../../src/theme/tokens';
import { Kicker, TextField, Button } from '../../src/components/ui';
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
        <Kicker>STEP 02 - YOUR FIRST TRIP</Kicker>
        <Text style={[t.displayXl, { color: c.textPrimary, marginTop: space.xs }]}>Where are you</Text>
        <Text style={[t.displayXl, { color: c.textPrimary }]}>going?</Text>

        <View style={{ height: space.xxl }} />
        <TextField
          testID="trip-dest-input"
          label="DESTINATION"
          value={destination}
          onChangeText={(value) => {
            setDestination(value);
            setPicked(null);
          }}
          placeholder="Tokyo, Lisbon, Mumbai"
        />

        {searching && <ActivityIndicator color={c.accent} style={{ marginTop: space.sm }} />}
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
                <Text style={[t.body, { color: c.textPrimary }]}>{r.name}</Text>
                <Text style={[t.micro, { color: c.textTertiary }]}>
                  {[r.admin1, r.country].filter(Boolean).join(', ')}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        <View style={{ height: space.xl }} />
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <Text style={[t.kicker, { color: c.textTertiary, marginBottom: space.sm }]}>START</Text>
            <Pressable
              testID="trip-start-input"
              onPress={() => showDatePicker('start')}
              style={[styles.dateButton, { borderColor: c.borderActive, backgroundColor: c.elevated }]}
            >
              <Text style={[t.body, { color: startDate ? c.textPrimary : c.textTertiary }]}>
                {startDate || 'Pick date'}
              </Text>
            </Pressable>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[t.kicker, { color: c.textTertiary, marginBottom: space.sm }]}>END</Text>
            <Pressable
              testID="trip-end-input"
              onPress={() => showDatePicker('end')}
              style={[styles.dateButton, { borderColor: c.borderActive, backgroundColor: c.elevated }]}
            >
              <Text style={[t.body, { color: endDate ? c.textPrimary : c.textTertiary }]}>
                {endDate || 'Pick date'}
              </Text>
            </Pressable>
          </View>
        </View>

        {weatherPreview && (
          <View style={[styles.weatherPreview, { borderColor: c.borderSubtle, backgroundColor: c.surface }]}>
            <Text style={[t.title, { color: c.textPrimary }]}>Weather preview</Text>
            <Text style={[t.bodySm, { color: c.textSecondary, marginTop: space.xs }]}>{weatherPreview}</Text>
          </View>
        )}

        {err && <Text style={[t.bodySm, { color: c.error, marginTop: space.md }]}>{err}</Text>}

        <View style={{ height: space.xxxl }} />
        <Button testID="trip-create-button" title="Create Trip" onPress={onCreate} loading={loading} />

        {trips.length > 0 && (
          <Pressable
            testID="trip-skip-button"
            onPress={() => router.replace('/(tabs)')}
            style={{ paddingVertical: space.md, alignItems: 'center', marginTop: space.sm }}
          >
            <Text style={[t.body, { color: c.textSecondary }]}>Skip - go to dashboard</Text>
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
  container: { flexGrow: 1, padding: space.xl, paddingTop: 80, paddingBottom: space.xxxl },
  dateButton: { borderWidth: 1, borderRadius: radius.sharp, minHeight: 48, justifyContent: 'center', paddingHorizontal: space.lg },
  weatherPreview: { borderWidth: 1, borderRadius: radius.sharp, padding: space.md, marginTop: space.lg },
  resultBox: { marginTop: space.sm, borderWidth: 1, borderRadius: radius.sharp, overflow: 'hidden' },
  resultRow: { padding: space.md, borderBottomWidth: 1 },
});
