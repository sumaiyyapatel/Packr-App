import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../src/theme/ThemeProvider';
import { submitFeedback } from '../src/lib/analytics';

export default function SettingsScreen() {
  const { c } = useTheme();
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: c.borderSubtle }]}>
        <Pressable onPress={() => router.back()} style={[styles.iconBtn, { borderColor: c.borderSubtle }]}>
          <Ionicons name="chevron-back" size={20} color={c.textPrimary} />
        </Pressable>
        <View style={{ marginLeft: 12 }}>
          <Text style={[styles.kicker, { color: c.accent }]}>SETTINGS</Text>
          <Text style={[styles.title, { color: c.textPrimary }]}>Feedback</Text>
        </View>
      </View>

      <View style={{ padding: 24 }}>
        <Text style={{ color: c.textPrimary, fontSize: 18, fontWeight: '800' }}>Help shape launch</Text>
        <Text style={{ color: c.textSecondary, marginTop: 8, lineHeight: 21 }}>
          Send bugs, confusing flows, missing packing needs, or destination ideas.
        </Text>

        <TextInput
          value={message}
          onChangeText={setMessage}
          multiline
          placeholder="What should Packr improve?"
          placeholderTextColor={c.textTertiary}
          style={[styles.input, { color: c.textPrimary, borderColor: c.borderSubtle, backgroundColor: c.surface }]}
        />

        <Pressable
          onPress={send}
          disabled={sending || !message.trim()}
          style={[styles.sendBtn, { backgroundColor: c.accent, opacity: sending || !message.trim() ? 0.5 : 1 }]}
        >
          {sending ? <ActivityIndicator color={c.bg} /> : <Text style={{ color: c.bg, fontWeight: '800' }}>SEND FEEDBACK</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1 },
  iconBtn: { width: 36, height: 36, borderWidth: 1, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  kicker: { fontSize: 11, letterSpacing: 2, fontWeight: '600' },
  title: { fontSize: 24, fontWeight: '800' },
  input: { minHeight: 140, borderWidth: 1, borderRadius: 8, padding: 12, textAlignVertical: 'top', marginTop: 20 },
  sendBtn: { height: 48, borderRadius: 6, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
});
