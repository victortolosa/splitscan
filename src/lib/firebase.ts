import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

type RuntimeConfig = Partial<{
  VITE_FIREBASE_API_KEY: string;
  VITE_FIREBASE_AUTH_DOMAIN: string;
  VITE_FIREBASE_PROJECT_ID: string;
  VITE_FIREBASE_STORAGE_BUCKET: string;
  VITE_FIREBASE_MESSAGING_SENDER_ID: string;
  VITE_FIREBASE_APP_ID: string;
  VITE_FIREBASE_MEASUREMENT_ID: string;
}>;

const runtimeConfig =
  typeof window !== 'undefined'
    ? (window as Window & { __SPLITSCAN_CONFIG__?: RuntimeConfig }).__SPLITSCAN_CONFIG__
    : undefined;

const env = import.meta.env as Record<string, string | undefined>;

const isNonEmpty = (value?: string) => typeof value === 'string' && value.trim().length > 0;

const isDev = Boolean(import.meta.env?.DEV);

const resolveConfig = (key: keyof RuntimeConfig) => {
  const runtimeValue = runtimeConfig?.[key];
  const envValue = env[key];

  if (isDev) {
    if (isNonEmpty(envValue)) {
      return envValue;
    }
    if (isNonEmpty(runtimeValue)) {
      return runtimeValue;
    }
    return undefined;
  }

  if (isNonEmpty(runtimeValue)) {
    return runtimeValue;
  }
  if (isNonEmpty(envValue)) {
    return envValue;
  }
  return undefined;
};

const config = {
  apiKey: resolveConfig('VITE_FIREBASE_API_KEY'),
  authDomain: resolveConfig('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: resolveConfig('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: resolveConfig('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: resolveConfig('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: resolveConfig('VITE_FIREBASE_APP_ID'),
  measurementId: resolveConfig('VITE_FIREBASE_MEASUREMENT_ID'),
};

export const hasFirebase = Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);

const app = hasFirebase ? (getApps().length ? getApps()[0] : initializeApp(config)) : null;

export const firebaseAuth = app ? getAuth(app) : null;
export const firestoreDb = app ? getFirestore(app) : null;
export const firebaseStorage = app ? getStorage(app) : null;
