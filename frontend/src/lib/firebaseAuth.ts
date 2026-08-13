import { getApp, getApps, initializeApp } from 'firebase/app';
import type { FirebaseApp } from 'firebase/app';
import * as FirebaseAuth from 'firebase/auth';
import type { Auth, Persistence, User as FirebaseUser, UserCredential } from 'firebase/auth';
import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

type ReactNativeAuthModule = typeof FirebaseAuth & {
  getReactNativePersistence: (storage: typeof ReactNativeAsyncStorage) => Persistence;
};

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

let cachedAuth: Auth | null = null;

function isExpoGo() {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}

export function isFirebaseAuthConfigured() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
}

function getFirebaseApp(): FirebaseApp | null {
  if (!isFirebaseAuthConfigured()) return null;
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

function getFirebaseAuth(): Auth | null {
  const app = getFirebaseApp();
  if (!app) return null;
  if (cachedAuth) return cachedAuth;
  if (Platform.OS === 'web') {
    cachedAuth = FirebaseAuth.getAuth(app);
    return cachedAuth;
  }
  try {
    const getReactNativePersistence = (FirebaseAuth as ReactNativeAuthModule).getReactNativePersistence;
    cachedAuth = FirebaseAuth.initializeAuth(app, {
      persistence: getReactNativePersistence(ReactNativeAsyncStorage),
    });
  } catch (error: any) {
    if (error?.code !== 'auth/already-initialized') throw error;
    cachedAuth = FirebaseAuth.getAuth(app);
  }
  return cachedAuth;
}

async function tokenFromCredential(credential: UserCredential) {
  return credential.user.getIdToken(true);
}

export async function registerWithFirebase(email: string, password: string, name?: string) {
  const auth = getFirebaseAuth();
  if (!auth) return null;
  const credential = await FirebaseAuth.createUserWithEmailAndPassword(auth, email, password);
  if (name) await FirebaseAuth.updateProfile(credential.user, { displayName: name });
  return tokenFromCredential(credential);
}

export async function loginWithFirebase(email: string, password: string) {
  const auth = getFirebaseAuth();
  if (!auth) return null;
  return tokenFromCredential(await FirebaseAuth.signInWithEmailAndPassword(auth, email, password));
}

export async function loginWithGoogleIdToken(googleIdToken: string) {
  const auth = getFirebaseAuth();
  if (!auth) return null;
  return tokenFromCredential(
    await FirebaseAuth.signInWithCredential(
      auth,
      FirebaseAuth.GoogleAuthProvider.credential(googleIdToken)
    )
  );
}

export async function loginWithGooglePopup() {
  const auth = getFirebaseAuth();
  if (!auth || typeof window === 'undefined') return null;
  const provider = new FirebaseAuth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return tokenFromCredential(await FirebaseAuth.signInWithPopup(auth, provider));
}

export async function loginWithNativeGoogle() {
  const auth = getFirebaseAuth();
  if (!auth) return null;
  if (Platform.OS === 'web') return loginWithGooglePopup();
  if (Platform.OS !== 'android') return null;
  if (isExpoGo()) {
    throw new Error('Android Google sign-in needs a development build. Expo Go cannot load RNGoogleSignin.');
  }

  const webClientId = process.env.EXPO_PUBLIC_FIREBASE_GOOGLE_WEB_CLIENT_ID;
  if (!webClientId) throw new Error('Missing Google web client ID');

  const { GoogleSignin } = await import('@react-native-google-signin/google-signin');
  GoogleSignin.configure({ webClientId, offlineAccess: false });
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  let response;
  try {
    response = await GoogleSignin.signIn();
  } catch (error: unknown) {
    const googleError = error as { code?: string; message?: string };
    const message = googleError.message || '';
    if (
      googleError.code === '10' ||
      googleError.code === 'DEVELOPER_ERROR' ||
      /DEVELOPER_ERROR|Developer console is not set up correctly/i.test(message)
    ) {
      throw new Error(
        'Google Sign-In Android config mismatch. In Firebase, enable Google sign-in, verify package com.inkspace.packr and the APK SHA-1, download a fresh google-services.json, then rebuild and reinstall the app.'
      );
    }
    throw error;
  }
  if (response.type !== 'success') throw new Error('Google sign-in was cancelled');

  const idToken = response.data.idToken;
  if (!idToken) {
    throw new Error(
      'Google did not return an ID token. Add your Android SHA-1 fingerprint in Firebase, then download a fresh google-services.json.'
    );
  }

  return tokenFromCredential(
    await FirebaseAuth.signInWithCredential(
      auth,
      FirebaseAuth.GoogleAuthProvider.credential(idToken)
    )
  );
}

/**
 * Cheap token getter for request interceptors: returns a valid ID token for
 * the signed-in user (the SDK caches it and auto-refreshes near expiry).
 * Returns null immediately when nobody is signed in — no listener wait.
 */
export async function getFreshFirebaseToken(forceRefresh = false): Promise<string | null> {
  const auth = getFirebaseAuth();
  const user = auth?.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken(forceRefresh);
  } catch {
    return null;
  }
}

/** Resolve the signed-in Firebase user, waiting briefly for rehydration. */
export async function waitForFirebaseUser(timeoutMs = 2500): Promise<FirebaseUser | null> {
  const auth = getFirebaseAuth();
  if (!auth) return null;
  if (auth.currentUser) return auth.currentUser;
  return new Promise<FirebaseUser | null>((resolve) => {
    let unsubscribe = () => {};
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(null);
    }, timeoutMs);
    unsubscribe = FirebaseAuth.onAuthStateChanged(
      auth,
      (user) => {
        clearTimeout(timer);
        unsubscribe();
        resolve(user);
      },
      () => {
        clearTimeout(timer);
        unsubscribe();
        resolve(null);
      }
    );
  });
}

export async function getCurrentFirebaseToken() {
  const auth = getFirebaseAuth();
  if (!auth) return null;
  if (auth.currentUser) return auth.currentUser.getIdToken();
  return new Promise<string | null>((resolve) => {
    let unsubscribe = () => {};
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(null);
    }, 1500);
    unsubscribe = FirebaseAuth.onAuthStateChanged(
      auth,
      (user) => {
        clearTimeout(timer);
        unsubscribe();
        if (!user) {
          resolve(null);
          return;
        }
        user.getIdToken().then(resolve).catch(() => resolve(null));
      },
      () => {
        clearTimeout(timer);
        unsubscribe();
        resolve(null);
      }
    );
  });
}

/** 'password' | 'google.com' | null (no signed-in user) */
export function currentAuthProvider(): string | null {
  const auth = getFirebaseAuth();
  return auth?.currentUser?.providerData[0]?.providerId ?? null;
}

/**
 * Deletes the signed-in Firebase Auth user. Firebase requires a *recent*
 * sign-in for this; if the session is stale it throws `auth/requires-recent-login`
 * and we reauthenticate once before retrying:
 *  - password accounts: re-verify with the password the caller collected
 *  - Google accounts: re-run the Google flow (a fresh sign-in resets recency)
 * Call this AFTER wiping Firestore data — once the user is deleted, Firestore
 * security rules (which check request.auth.uid) can no longer be satisfied.
 */
export async function deleteFirebaseUser(password?: string): Promise<void> {
  const auth = getFirebaseAuth();
  const user = auth?.currentUser;
  if (!auth || !user) throw new Error('Not signed in');

  try {
    await FirebaseAuth.deleteUser(user);
    return;
  } catch (error: unknown) {
    const code = (error as { code?: string }).code;
    if (code !== 'auth/requires-recent-login') throw error;
  }

  const providerId = user.providerData[0]?.providerId;
  if (providerId === 'password') {
    if (!password) throw new Error('Re-enter your password to confirm account deletion.');
    if (!user.email) throw new Error('This account has no email on file to reauthenticate with.');
    await FirebaseAuth.reauthenticateWithCredential(
      user,
      FirebaseAuth.EmailAuthProvider.credential(user.email, password)
    );
  } else if (providerId === 'google.com') {
    const originalUid = user.uid;
    const refreshedToken = Platform.OS === 'web' ? await loginWithGooglePopup() : await loginWithNativeGoogle();
    if (!refreshedToken) throw new Error('Could not re-verify your Google sign-in. Try again.');
    if (auth.currentUser?.uid !== originalUid) {
      throw new Error('That Google account does not match the account you are deleting. Try again.');
    }
  } else {
    throw new Error('Could not re-verify your sign-in. Sign out and back in, then try again.');
  }

  await FirebaseAuth.deleteUser(auth.currentUser ?? user);
}

export async function logoutFirebase() {
  const auth = getFirebaseAuth();
  if (Platform.OS === 'android' && !isExpoGo()) {
    const { GoogleSignin } = await import('@react-native-google-signin/google-signin');
    await GoogleSignin.signOut().catch(() => {});
  }
  if (auth?.currentUser) await FirebaseAuth.signOut(auth);
}
