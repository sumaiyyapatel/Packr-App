import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { isFirebaseAuthConfigured } from './firebaseAuth';

WebBrowser.maybeCompleteAuthSession();

const webClientId = process.env.EXPO_PUBLIC_FIREBASE_GOOGLE_WEB_CLIENT_ID;
const iosClientId = process.env.EXPO_PUBLIC_FIREBASE_GOOGLE_IOS_CLIENT_ID;
const androidClientId = process.env.EXPO_PUBLIC_FIREBASE_GOOGLE_ANDROID_CLIENT_ID;

export function isGoogleAuthConfigured() {
  if (!isFirebaseAuthConfigured()) return false;
  if (Platform.OS === 'web') return true;
  if (Platform.OS === 'android') return Boolean(webClientId);
  return Boolean(webClientId || iosClientId || androidClientId);
}

export function useGoogleIdTokenAuth() {
  const configured = isGoogleAuthConfigured();
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    webClientId: webClientId || 'disabled.apps.googleusercontent.com',
    iosClientId,
    androidClientId: androidClientId || webClientId,
    selectAccount: true,
  });

  return {
    configured,
    request,
    response,
    promptAsync,
  };
}
