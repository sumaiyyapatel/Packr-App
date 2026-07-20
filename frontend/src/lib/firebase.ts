import { getApp, getApps, initializeApp } from 'firebase/app';
import type { FirebaseApp } from 'firebase/app';
import {
  getFirestore,
  initializeFirestore,
  type Firestore,
} from 'firebase/firestore';

// Single source of truth for the Firebase app instance.
// firebaseAuth.ts creates the app on the auth path; this module reuses it
// (or creates it first, whoever runs first wins — same config either way).
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

export function isFirebaseConfigured(): boolean {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
}

export function getFirebaseApp(): FirebaseApp {
  if (!isFirebaseConfigured()) {
    throw new Error('Firebase is not configured: missing EXPO_PUBLIC_FIREBASE_* env vars');
  }
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

let cachedDb: Firestore | null = null;

export function getDb(): Firestore {
  if (cachedDb) return cachedDb;
  const app = getFirebaseApp();
  try {
    // React Native networking can't always hold streaming connections;
    // auto-detect falls back to long-polling when needed.
    cachedDb = initializeFirestore(app, {
      experimentalAutoDetectLongPolling: true,
    });
  } catch {
    // Already initialized elsewhere.
    cachedDb = getFirestore(app);
  }
  return cachedDb;
}
