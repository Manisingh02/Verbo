// Firebase configuration
// Using Firebase JS SDK for Expo managed workflow

import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import {
  initializeAuth,
  getAuth,
  Auth,
  // @ts-ignore - getReactNativePersistence exists in react-native builds
  getReactNativePersistence,
} from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || '',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || '',
};

// Check if Firebase is configured
const isFirebaseConfigured = !!firebaseConfig.apiKey && !!firebaseConfig.projectId;

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

if (isFirebaseConfigured) {
  try {
    // Initialize Firebase (avoid re-initialization)
    app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

    // Initialize Auth with AsyncStorage persistence for React Native
    try {
      auth = initializeAuth(app, {
        persistence: getReactNativePersistence(AsyncStorage),
      });
    } catch (error) {
      // Auth already initialized, get existing instance
      auth = getAuth(app);
    }

    db = getFirestore(app);
  } catch (error) {
    console.warn('Firebase initialization failed:', error);
  }
} else {
  console.warn('Firebase not configured. Add credentials to .env file.');
}

export { app, auth, db, isFirebaseConfigured };
