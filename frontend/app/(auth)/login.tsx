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

export default function Login() {
  const { c } = useTheme();
  const router = useRouter();
  const login = useStore((s) => s.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async () => {
    setErr(null);
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || 'Login failed');
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
        <Text style={[styles.brand, { color: c.textPrimary }]}>PACKR</Text>
        <Text style={[styles.tag, { color: c.textSecondary }]}>9 ITEMS · 27 OUTFITS</Text>

        <View style={{ height: 48 }} />

        <Text style={[styles.h1, { color: c.textPrimary }]}>Welcome back</Text>
        <Text style={[styles.body, { color: c.textSecondary }]}>Sign in to your wardrobe.</Text>

        <View style={{ height: 32 }} />
        <Text style={[styles.label, { color: c.textTertiary }]}>EMAIL</Text>
        <TextInput
          testID="login-email-input"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          placeholder="you@example.com"
          placeholderTextColor={c.textTertiary}
          style={[styles.input, { color: c.textPrimary, borderBottomColor: c.borderActive }]}
        />

        <View style={{ height: 24 }} />
        <Text style={[styles.label, { color: c.textTertiary }]}>PASSWORD</Text>
        <TextInput
          testID="login-password-input"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="••••••••"
          placeholderTextColor={c.textTertiary}
          style={[styles.input, { color: c.textPrimary, borderBottomColor: c.borderActive }]}
        />

        {err && <Text style={[styles.error, { color: c.error }]}>{err}</Text>}

        <View style={{ height: 32 }} />
        <Pressable
          testID="login-submit-button"
          onPress={onSubmit}
          disabled={loading || !email || !password}
          style={({ pressed }) => [
            styles.btn,
            { backgroundColor: c.accent, opacity: pressed ? 0.85 : 1 },
            (!email || !password) && { opacity: 0.5 },
          ]}
        >
          {loading ? (
            <ActivityIndicator color={c.bg} />
          ) : (
            <Text style={[styles.btnText, { color: c.bg }]}>Sign In</Text>
          )}
        </Pressable>

        <View style={{ height: 16 }} />
        <Pressable
          testID="login-go-register-button"
          onPress={() => router.replace('/(auth)/register')}
          style={styles.linkBtn}
        >
          <Text style={[styles.link, { color: c.textSecondary }]}>
            New here? <Text style={{ color: c.accent }}>Create an account</Text>
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 24, paddingTop: 96, paddingBottom: 48 },
  brand: { fontSize: 28, fontWeight: '700', letterSpacing: 4 },
  tag: { fontSize: 11, marginTop: 4, letterSpacing: 2 },
  h1: { fontSize: 32, fontWeight: '700', letterSpacing: -1 },
  body: { fontSize: 15, marginTop: 8 },
  label: { fontSize: 11, letterSpacing: 1.5, marginBottom: 8 },
  input: { fontSize: 18, borderBottomWidth: 1, paddingVertical: 8 },
  btn: { paddingVertical: 16, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 16, fontWeight: '600', letterSpacing: 0.5 },
  linkBtn: { alignItems: 'center', paddingVertical: 8 },
  link: { fontSize: 14 },
  error: { marginTop: 12, fontSize: 13 },
});
