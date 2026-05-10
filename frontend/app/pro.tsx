import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../src/theme/ThemeProvider';
import { useStore } from '../src/lib/store';
import { api } from '../src/lib/api';

const PERKS = [
  { icon: 'infinite', text: 'Unlimited trips (free is capped at 2)' },
  { icon: 'cloud-upload-outline', text: 'Publish your grids as community templates' },
  { icon: 'airplane-outline', text: 'Custom airline weight profiles' },
  { icon: 'sparkles-outline', text: 'AI-powered conflict suggestions (Phase 2)' },
  { icon: 'cut-outline', text: 'On-device background-removal cutouts (Phase 2)' },
];

export default function ProScreen() {
  const { c } = useTheme();
  const router = useRouter();
  const user = useStore((s) => s.user);
  const setUser = useStore((s) => s.setUser);

  const [loading, setLoading] = useState(false);
  const [airlineName, setAirlineName] = useState('');
  const [airlineKg, setAirlineKg] = useState('7.0');

  const isPro = !!user?.is_pro;

  const onUpgrade = async () => {
    setLoading(true);
    try {
      const r = await api.post('/me/pro');
      setUser(r.data);
    } catch (e: any) {
      Alert.alert('Failed', e?.response?.data?.detail || 'Upgrade failed');
    } finally {
      setLoading(false);
    }
  };

  const onDowngrade = async () => {
    setLoading(true);
    try {
      const r = await api.delete('/me/pro');
      setUser(r.data);
    } catch (e: any) {
      Alert.alert('Failed', e?.response?.data?.detail || 'Downgrade failed');
    } finally {
      setLoading(false);
    }
  };

  const onAddAirline = async () => {
    if (!airlineName.trim()) return;
    try {
      const r = await api.post('/me/airlines', {
        name: airlineName.trim(),
        max_kg: parseFloat(airlineKg) || 7.0,
      });
      setUser(r.data);
      setAirlineName('');
      setAirlineKg('7.0');
    } catch (e: any) {
      Alert.alert('Failed', e?.response?.data?.detail || 'Could not add airline');
    }
  };

  const onRemoveAirline = async (id: string) => {
    try {
      const r = await api.delete(`/me/airlines/${id}`);
      setUser(r.data);
    } catch {}
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <View style={[styles.header, { borderBottomColor: c.borderSubtle }]}>
          <Pressable
            testID="pro-back"
            onPress={() => router.back()}
            style={[styles.iconBtn, { borderColor: c.borderSubtle }]}
          >
            <Ionicons name="chevron-back" size={20} color={c.textPrimary} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 48 }}>
          <Text style={[styles.kicker, { color: c.accent }]}>
            {isPro ? 'PACKR PRO · ACTIVE' : 'UPGRADE'}
          </Text>
          <Text style={[styles.h1, { color: c.textPrimary }]}>
            {isPro ? 'Welcome back, traveller.' : 'Packr Pro'}
          </Text>
          <Text style={{ color: c.textSecondary, fontSize: 14, marginTop: 8, lineHeight: 22 }}>
            {isPro
              ? 'You have unlimited everything. Custom airline profiles below.'
              : 'For ₹199/month or ₹1,499/year. Cancel any time.'}
          </Text>

          {!isPro && (
            <View style={[styles.priceCard, { borderColor: c.accent, backgroundColor: c.accent + '10' }]}>
              <Text style={{ color: c.accent, fontSize: 13, letterSpacing: 1.5, fontWeight: '600' }}>
                MONTHLY
              </Text>
              <Text style={[styles.price, { color: c.textPrimary }]}>
                ₹199
                <Text style={{ color: c.textTertiary, fontSize: 14 }}> / month</Text>
              </Text>
              <Text style={{ color: c.textSecondary, fontSize: 12 }}>
                Or ₹1,499/yr (saves ₹889)
              </Text>
            </View>
          )}

          <View style={{ height: 24 }} />
          <Text style={[styles.section, { color: c.textPrimary }]}>WHAT'S INCLUDED</Text>
          <View style={[styles.perksBox, { borderColor: c.borderSubtle }]}>
            {PERKS.map((p, i) => (
              <View
                key={p.text}
                style={[
                  styles.perkRow,
                  { borderBottomColor: c.borderSubtle, borderBottomWidth: i === PERKS.length - 1 ? 0 : 1 },
                ]}
              >
                <Ionicons name={p.icon as any} size={18} color={c.accent} />
                <Text style={{ color: c.textPrimary, marginLeft: 12, flex: 1, fontSize: 14 }}>
                  {p.text}
                </Text>
              </View>
            ))}
          </View>

          {!isPro ? (
            <>
              <View style={{ height: 24 }} />
              <Pressable
                testID="upgrade-button"
                onPress={onUpgrade}
                disabled={loading}
                style={({ pressed }) => [
                  styles.cta,
                  { backgroundColor: c.accent, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                {loading ? (
                  <ActivityIndicator color={c.bg} />
                ) : (
                  <Text style={{ color: c.bg, fontSize: 15, fontWeight: '600', letterSpacing: 0.5 }}>
                    GO PRO (DEMO · NO PAYMENT)
                  </Text>
                )}
              </Pressable>
              <Text style={{ color: c.textTertiary, fontSize: 11, marginTop: 8, textAlign: 'center' }}>
                Stripe / Razorpay integration is Phase 2.
              </Text>
            </>
          ) : (
            <>
              <View style={{ height: 24 }} />
              <Text style={[styles.section, { color: c.textPrimary }]}>AIRLINE WEIGHT PROFILES</Text>
              <View style={[styles.airlineBox, { borderColor: c.borderSubtle }]}>
                {(user?.airline_profiles || []).map((a, i) => (
                  <View
                    key={a.id}
                    style={[
                      styles.airlineRow,
                      { borderBottomColor: c.borderSubtle, borderBottomWidth: i === (user?.airline_profiles?.length || 0) - 1 ? 0 : 1 },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: c.textPrimary, fontSize: 14 }}>{a.name}</Text>
                      <Text style={{ color: c.textTertiary, fontSize: 12, marginTop: 2 }}>
                        Max {a.max_kg.toFixed(1)} kg
                      </Text>
                    </View>
                    {!['carry-on', 'iata'].includes(a.id) && (
                      <Pressable
                        testID={`remove-airline-${a.id}`}
                        onPress={() => onRemoveAirline(a.id)}
                        hitSlop={8}
                      >
                        <Ionicons name="close" size={16} color={c.textTertiary} />
                      </Pressable>
                    )}
                  </View>
                ))}
              </View>

              <View style={{ height: 16 }} />
              <Text style={[styles.label, { color: c.textTertiary }]}>ADD AIRLINE</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput
                  testID="airline-name-input"
                  value={airlineName}
                  onChangeText={setAirlineName}
                  placeholder="IndiGo Domestic"
                  placeholderTextColor={c.textTertiary}
                  style={[
                    styles.input,
                    { color: c.textPrimary, borderBottomColor: c.borderActive, flex: 2 },
                  ]}
                />
                <TextInput
                  testID="airline-kg-input"
                  value={airlineKg}
                  onChangeText={setAirlineKg}
                  keyboardType="decimal-pad"
                  placeholder="7.0"
                  placeholderTextColor={c.textTertiary}
                  style={[
                    styles.input,
                    { color: c.textPrimary, borderBottomColor: c.borderActive, flex: 1, textAlign: 'center' },
                  ]}
                />
                <Pressable
                  testID="airline-add-button"
                  onPress={onAddAirline}
                  style={[styles.addBtn, { backgroundColor: c.accent }]}
                >
                  <Ionicons name="add" size={18} color={c.bg} />
                </Pressable>
              </View>

              <View style={{ height: 32 }} />
              <Pressable
                testID="downgrade-button"
                onPress={onDowngrade}
                disabled={loading}
                style={[styles.ghostBtn, { borderColor: c.borderActive }]}
              >
                <Text style={{ color: c.textSecondary, fontSize: 13 }}>Cancel Pro (demo)</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1 },
  iconBtn: { width: 36, height: 36, borderWidth: 1, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  kicker: { fontSize: 11, letterSpacing: 2, fontWeight: '600' },
  h1: { fontSize: 32, fontWeight: '700', letterSpacing: -1, marginTop: 4 },
  priceCard: { borderWidth: 1, borderRadius: 8, padding: 16, marginTop: 16 },
  price: { fontSize: 36, fontWeight: '700', letterSpacing: -1, marginTop: 4 },
  section: { fontSize: 11, letterSpacing: 2, fontWeight: '600', marginBottom: 8 },
  perksBox: { borderWidth: 1, borderRadius: 8 },
  perkRow: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  airlineBox: { borderWidth: 1, borderRadius: 8 },
  airlineRow: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  label: { fontSize: 11, letterSpacing: 1.5, marginBottom: 8 },
  input: { fontSize: 15, borderBottomWidth: 1, paddingVertical: 8 },
  addBtn: { width: 44, height: 44, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  cta: { paddingVertical: 16, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  ghostBtn: { paddingVertical: 12, borderWidth: 1, borderRadius: 4, alignItems: 'center' },
});
