import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const TOKEN_KEY = 'packr.token';

const canUseSecureStore = Platform.OS !== 'web';

type SecureStoreModule = typeof import('expo-secure-store');

let secureStorePromise: Promise<SecureStoreModule | null> | null = null;

function isUsableSecureStore(m: SecureStoreModule | null): m is SecureStoreModule {
  return (
    !!m &&
    typeof m.getItemAsync === 'function' &&
    typeof m.setItemAsync === 'function' &&
    typeof m.deleteItemAsync === 'function'
  );
}

async function getSecureStore() {
  if (!canUseSecureStore) return null;
  // Metro can resolve the JS module even when the native side is missing
  // (e.g. an outdated dev client): the import "succeeds" but exports are
  // undefined. Validate the exports instead of trusting the import.
  secureStorePromise ??= import('expo-secure-store')
    .then((m) => (isUsableSecureStore(m) ? m : null))
    .catch(() => null);
  return secureStorePromise;
}

export async function getToken(): Promise<string | null> {
  const SecureStore = await getSecureStore();
  if (SecureStore) {
    try {
      const value = await SecureStore.getItemAsync(TOKEN_KEY);
      if (value) return value;
      const legacy = await AsyncStorage.getItem(TOKEN_KEY);
      if (legacy) {
        await setToken(legacy);
        AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
        return legacy;
      }
      return null;
    } catch {
      return AsyncStorage.getItem(TOKEN_KEY);
    }
  }
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  const SecureStore = await getSecureStore();
  if (SecureStore) {
    try {
      await SecureStore.setItemAsync(TOKEN_KEY, token);
      return;
    } catch {
    }
  }
  await AsyncStorage.setItem(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  const SecureStore = await getSecureStore();
  if (SecureStore) {
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
  }
  await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
}
