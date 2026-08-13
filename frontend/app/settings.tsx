import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../src/theme/ThemeProvider';
import { type as t, space, radius } from '../src/theme/tokens';
import { Kicker, Title, IconButton, Toggle, TextField, Button, ReceiptRow } from '../src/components/ui';
import { useStore } from '../src/lib/store';
import { submitFeedback } from '../src/lib/analytics';

function randomId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export default function SettingsScreen() {
  const { c, mode, toggle } = useTheme();
  const router = useRouter();
  const user = useStore((s) => s.user);
  const selectedAirlineId = useStore((s) => s.selectedAirlineId);
  const setSelectedAirline = useStore((s) => s.setSelectedAirline);
  const saveAirlineProfiles = useStore((s) => s.saveAirlineProfiles);
  const logout = useStore((s) => s.logout);

  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [addingAirline, setAddingAirline] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  const send = async () => {
    if (!message.trim()) return;
    setSending(true);
    try {
      await submitFeedback(message.trim(), 'settings');
      setMessage('');
      Alert.alert('Feedback sent', 'Thanks for helping improve Packr.');
    } catch {
      Alert.alert('Could not send feedback', 'Please try again.');
    } finally {
      setSending(false);
    }
  };

  const onSignOut = () => {
    Alert.alert('Sign out?', '', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  const legalComingSoon = (title: string) =>
    Alert.alert(title, 'This page is being finalized and will be linked here before launch.');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: c.borderSubtle }]}>
        <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} />
        <View style={{ marginLeft: space.md }}>
          <Kicker>SETTINGS</Kicker>
          <Title>Settings</Title>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.xxl, paddingBottom: space.xxxl }}>
        <View style={{ gap: space.sm }}>
          <Text style={[t.kicker, { color: c.textTertiary }]}>PROFILE</Text>
          <View style={styles.box}>
            <ReceiptRow label="Name" value={user?.name || 'Not set'} />
            <ReceiptRow label="Email" value={user?.email || '—'} />
          </View>
        </View>

        <View style={{ gap: space.md }}>
          <Text style={[t.kicker, { color: c.textTertiary }]}>APPEARANCE</Text>
          <Toggle
            label={mode === 'dark' ? 'Charcoal theme' : 'Bone theme'}
            value={mode === 'dark'}
            onValueChange={toggle}
          />
        </View>

        <View style={{ gap: space.sm }}>
          <View style={styles.sectionRow}>
            <Text style={[t.kicker, { color: c.textTertiary }]}>AIRLINE PROFILES</Text>
            <IconButton
              icon={addingAirline ? 'close' : 'add'}
              accessibilityLabel={addingAirline ? 'Cancel' : 'Add airline profile'}
              onPress={() => setAddingAirline((v) => !v)}
            />
          </View>
          <View style={styles.box}>
            {(user?.airline_profiles || []).map((profile) => {
              const selected = (selectedAirlineId || user?.airline_profiles[0]?.id) === profile.id;
              const removable = (user?.airline_profiles.length || 0) > 1;
              return (
                <View key={profile.id} style={[styles.airlineRow, { borderBottomColor: c.borderSubtle }]}>
                  <Pressable
                    style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm }}
                    onPress={() => setSelectedAirline(profile.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                  >
                    <Ionicons
                      name={selected ? 'radio-button-on' : 'radio-button-off'}
                      size={18}
                      color={selected ? c.accent : c.textTertiary}
                    />
                    <View>
                      <Text style={[t.body, { color: c.textPrimary }]}>{profile.name}</Text>
                      <Text style={[t.micro, { color: c.textTertiary }]}>{profile.max_kg.toFixed(1)} kg limit</Text>
                    </View>
                  </Pressable>
                  {removable ? (
                    <Pressable
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${profile.name}`}
                      onPress={() =>
                        saveAirlineProfiles((user?.airline_profiles || []).filter((p) => p.id !== profile.id))
                      }
                    >
                      <Ionicons name="close" size={16} color={c.textTertiary} />
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </View>
          {addingAirline ? (
            <AddAirlineForm
              onAdd={async (name, maxKg) => {
                await saveAirlineProfiles([...(user?.airline_profiles || []), { id: randomId(), name, max_kg: maxKg }]);
                setAddingAirline(false);
              }}
            />
          ) : null}
        </View>

        <View style={{ gap: space.sm }}>
          <Text style={[t.kicker, { color: c.textTertiary }]}>NOTIFICATIONS</Text>
          <Toggle label="Trip reminders (coming soon)" value={false} onValueChange={() => {}} />
        </View>

        <View>
          <Text style={[t.kicker, { color: c.textTertiary }]}>FEEDBACK</Text>
          <Text style={[t.h2, { color: c.textPrimary, marginTop: space.sm }]}>Help shape launch</Text>
          <Text style={[t.body, { color: c.textSecondary, marginTop: space.xs }]}>
            Send bugs, confusing flows, missing packing needs, or destination ideas.
          </Text>

          <View style={{ marginTop: space.lg }}>
            <TextField
              value={message}
              onChangeText={setMessage}
              multiline
              placeholder="What should Packr improve?"
              style={styles.input}
            />
          </View>

          <Button
            title="Send feedback"
            onPress={send}
            disabled={!message.trim()}
            loading={sending}
            style={{ marginTop: space.md }}
          />
        </View>

        <View style={{ gap: space.sm }}>
          <Text style={[t.kicker, { color: c.textTertiary }]}>LEGAL</Text>
          <View style={styles.box}>
            <ReceiptRow label="Privacy policy" onPress={() => legalComingSoon('Privacy policy')} value={<Ionicons name="chevron-forward" size={16} color={c.textTertiary} />} />
            <ReceiptRow label="Terms of service" onPress={() => legalComingSoon('Terms of service')} value={<Ionicons name="chevron-forward" size={16} color={c.textTertiary} />} />
          </View>
        </View>

        <View style={{ gap: space.sm }}>
          <Text style={[t.kicker, { color: c.textTertiary }]}>ACCOUNT</Text>
          <Button title="Sign out" variant="secondary" onPress={onSignOut} />
          <Button title="Delete account" variant="danger" onPress={() => setShowDelete(true)} />
        </View>
      </ScrollView>

      <DeleteAccountModal visible={showDelete} onClose={() => setShowDelete(false)} />
    </SafeAreaView>
  );
}

function AddAirlineForm({ onAdd }: { onAdd: (name: string, maxKg: number) => Promise<void> }) {
  const [name, setName] = useState('');
  const [maxKg, setMaxKg] = useState('7.0');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const kg = parseFloat(maxKg);
    if (!name.trim() || !Number.isFinite(kg) || kg <= 0) return;
    setSaving(true);
    try {
      await onAdd(name.trim(), kg);
      setName('');
      setMaxKg('7.0');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.box, { padding: space.lg, gap: space.md }]}>
      <TextField label="NAME" value={name} onChangeText={setName} placeholder="Ryanair carry-on" />
      <TextField label="LIMIT (KG)" value={maxKg} onChangeText={setMaxKg} keyboardType="decimal-pad" />
      <Button title="Add profile" onPress={submit} loading={saving} disabled={!name.trim()} />
    </View>
  );
}

function DeleteAccountModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { c } = useTheme();
  const router = useRouter();
  const authProvider = useStore((s) => s.authProvider);
  const deleteAccount = useStore((s) => s.deleteAccount);
  const [confirmText, setConfirmText] = useState('');
  const [password, setPassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!visible) return null;
  const needsPassword = authProvider() === 'password';
  const canDelete = confirmText.trim().toUpperCase() === 'DELETE' && (!needsPassword || password.length > 0);

  const onConfirm = async () => {
    setErr(null);
    setDeleting(true);
    try {
      await deleteAccount(needsPassword ? password : undefined);
      onClose();
      router.replace('/(auth)/login');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Could not delete account. Try again.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <View style={styles.modalRoot}>
      <Pressable style={styles.modalBackdrop} onPress={deleting ? undefined : onClose} />
      <View style={[styles.modalCard, { backgroundColor: c.surface, borderColor: c.borderSubtle }]}>
        <Text style={[t.h2, { color: c.error }]}>Delete account</Text>
        <Text style={[t.body, { color: c.textSecondary, marginTop: space.sm }]}>
          This permanently deletes your wardrobe, trips, templates, and posts. It cannot be undone.
        </Text>

        <View style={{ marginTop: space.lg }}>
          <TextField
            label={'TYPE "DELETE" TO CONFIRM'}
            value={confirmText}
            onChangeText={setConfirmText}
            autoCapitalize="characters"
            autoCorrect={false}
          />
        </View>

        {needsPassword ? (
          <View style={{ marginTop: space.md }}>
            <TextField
              label="PASSWORD"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="Confirm with your password"
            />
          </View>
        ) : null}

        {err ? <Text style={[t.bodySm, { color: c.error, marginTop: space.md }]}>{err}</Text> : null}

        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.lg }}>
          <Button title="Cancel" variant="secondary" onPress={onClose} disabled={deleting} style={{ flex: 1 }} />
          <Button
            title="Delete permanently"
            variant="danger"
            onPress={onConfirm}
            disabled={!canDelete}
            loading={deleting}
            style={{ flex: 1 }}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', padding: space.lg, borderBottomWidth: 1 },
  input: { minHeight: 140, textAlignVertical: 'top' },
  box: { borderRadius: radius.sharp, overflow: 'hidden' },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  airlineRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.md, borderBottomWidth: 1 },
  modalRoot: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', padding: space.xl },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  modalCard: { borderRadius: radius.sheet, borderWidth: 1, padding: space.xl },
});
