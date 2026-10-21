// Authentication Provider
// Manages Firebase auth state and provides auth methods

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import {
  User as FirebaseUser,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from '../config/firebase';
import { getMyProfile, upsertMyProfile } from '../api';

type SignUpProfileInput = {
  firstName: string;
  lastName: string;
};

function parseName(displayName: string | null): { firstName: string; lastName: string } {
  const trimmed = (displayName || '').trim();
  if (!trimmed) {
    return { firstName: '', lastName: '' };
  }
  const parts = trimmed.split(/\s+/);
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' '),
  };
}

interface AuthContextValue {
  user: FirebaseUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isFirebaseConfigured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    email: string,
    password: string,
    profile: SignUpProfileInput
  ) => Promise<FirebaseUser | null>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  error: string | null;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Listen to auth state changes
  useEffect(() => {
    if (!auth) {
      // No Firebase configured, skip auth listener
      setIsLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setIsLoading(false);
    });

    return unsubscribe;
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const ensureUserProfileSchema = useCallback(
    async (uid: string, email: string, profile: SignUpProfileInput) => {
      if (!db) {
        throw new Error('Firestore not configured. Add credentials to .env file.');
      }

      const normalizedFirstName = profile.firstName.trim();
      const normalizedLastName = profile.lastName.trim();
      const normalizedEmail = email.trim();
      const now = serverTimestamp();

      await setDoc(
        doc(db, 'users', uid),
        {
          email: normalizedEmail,
          firstName: normalizedFirstName,
          lastName: normalizedLastName,
          nativeLanguage: 'en',
          targetLanguage: 'es',
          profilePictureUrl: '',
          createdAt: now,
          stats: {
            totalXp: 0,
            streak: 0,
            lastActive: now,
          },
        },
        { merge: true }
      );

      await setDoc(
        doc(db, 'users', uid, 'learning_plans', 'active'),
        {
          currentLanguageId: 'spanish',
          currentLevelId: 'words',
          updatedAt: now,
        },
        { merge: true }
      );
    },
    []
  );

  const signIn = useCallback(async (email: string, password: string) => {
    if (!auth) {
      setError('Firebase not configured. Add credentials to .env file.');
      throw new Error('Firebase not configured');
    }
    let result;
    try {
      setError(null);
      result = await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign in failed';
      setError(message);
      throw err;
    }

    try {
      const existingProfile = await getMyProfile();
      if (!existingProfile) {
        const fallbackName = parseName(result.user.displayName);
        await upsertMyProfile({
          email: result.user.email || email,
          firstName: fallbackName.firstName,
          lastName: fallbackName.lastName,
        });
      }
    } catch (profileError) {
      const profileMessage =
        profileError instanceof Error
          ? profileError.message
          : 'Unable to sync profile';
      const wrapped = new Error(`Signed in, but profile sync failed: ${profileMessage}`);
      setError(wrapped.message);
      throw wrapped;
    }
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, profile: SignUpProfileInput) => {
      if (!auth) {
        setError('Firebase not configured. Add credentials to .env file.');
        throw new Error('Firebase not configured');
      }
      try {
        setError(null);
        const result = await createUserWithEmailAndPassword(auth, email, password);
        await ensureUserProfileSchema(result.user.uid, result.user.email || email, profile);

        // Keep backend profile API in sync when available, but do not block sign-up success.
        try {
          await upsertMyProfile({
            email: result.user.email || email,
            firstName: profile.firstName,
            lastName: profile.lastName,
          });
        } catch (profileError) {
          console.warn('Profile API sync failed after sign up:', profileError);
        }
        return result.user;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Sign up failed';
        setError(message);
        throw err;
      }
    },
    [ensureUserProfileSchema]
  );

  const signOut = useCallback(async () => {
    if (!auth) {
      return;
    }
    try {
      setError(null);
      await firebaseSignOut(auth);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign out failed';
      setError(message);
      throw err;
    }
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    if (!auth) {
      setError('Firebase not configured. Add credentials to .env file.');
      throw new Error('Firebase not configured');
    }
    try {
      setError(null);
      await sendPasswordResetEmail(auth, email);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Password reset failed';
      setError(message);
      throw err;
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      isAuthenticated: !!user,
      isFirebaseConfigured,
      signIn,
      signUp,
      signOut,
      resetPassword,
      error,
      clearError,
    }),
    [user, isLoading, signIn, signUp, signOut, resetPassword, error, clearError]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
