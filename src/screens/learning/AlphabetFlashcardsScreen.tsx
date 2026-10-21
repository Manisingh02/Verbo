import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';

import { auth, db } from '../../core/config/firebase';
import { speakLetter } from '../../core/tts/speak';
import { colors, spacing, typography } from '../../theme';
import type { HomeStackParamList } from '../../types/navigation.types';

type SupportedLanguageId = 'english' | 'spanish';

type AlphabetLetter = {
  id: string;
  textNative: string;
  lowercase: string;
  order: number;
  nativeIso: 'en' | 'es';
};

function normalizeLanguageId(value: unknown): SupportedLanguageId {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'spanish' || normalized === 'es') {
    return 'spanish';
  }
  return 'english';
}

function normalizeNativeIso(value: unknown, languageId: SupportedLanguageId): 'en' | 'es' {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'es') {
    return 'es';
  }
  if (normalized === 'en') {
    return 'en';
  }
  return languageId === 'spanish' ? 'es' : 'en';
}

async function resolveCurrentLanguageId(): Promise<SupportedLanguageId> {
  if (!db || !auth?.currentUser) {
    return 'english';
  }

  const uid = auth.currentUser.uid;

  try {
    const activePlanSnap = await getDoc(doc(db, 'users', uid, 'learning_plans', 'active'));
    const fromPlan = normalizeLanguageId(activePlanSnap.data()?.currentLanguageId);
    if (activePlanSnap.exists()) {
      return fromPlan;
    }
  } catch {
    // Ignore and fall back to user profile.
  }

  try {
    const userSnap = await getDoc(doc(db, 'users', uid));
    return normalizeLanguageId(userSnap.data()?.targetLanguage);
  } catch {
    return 'english';
  }
}

export function AlphabetFlashcardsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [languageId, setLanguageId] = useState<SupportedLanguageId>('english');
  const [letters, setLetters] = useState<AlphabetLetter[]>([]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);

  useEffect(() => {
    let mounted = true;

    const loadLetters = async () => {
      if (!db) {
        if (mounted) {
          setError('Firestore not configured. Add credentials to .env file.');
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const resolvedLanguageId = await resolveCurrentLanguageId();
        const vocabRef = collection(
          db,
          'languages',
          resolvedLanguageId,
          'levels',
          'alphabet',
          'vocab'
        );

        const snapshot = await getDocs(vocabRef);
        const loaded = snapshot.docs
          .map((snapshotDoc) => {
            const data = snapshotDoc.data();
            const textNative =
              typeof data.textNative === 'string' ? data.textNative.trim() : '';
            const lowercase =
              typeof data.lowercase === 'string'
                ? data.lowercase.trim()
                : textNative.toLowerCase();
            const orderNumber = Number(data.order);
            const order = Number.isFinite(orderNumber)
              ? orderNumber
              : Number.MAX_SAFE_INTEGER;

            return {
              id: snapshotDoc.id,
              textNative,
              lowercase,
              order,
              nativeIso: normalizeNativeIso(data.nativeIso, resolvedLanguageId),
            } as AlphabetLetter;
          })
          .filter((letter) => letter.textNative.length > 0)
          .sort((a, b) => a.order - b.order);

        if (!mounted) {
          return;
        }

        setLanguageId(resolvedLanguageId);
        setLetters(loaded);
        setCurrentIndex(0);
        setIsFlipped(false);
      } catch (loadError) {
        if (!mounted) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : 'Failed to load letters');
        setLetters([]);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    loadLetters();

    return () => {
      mounted = false;
    };
  }, []);

  const totalLetters = letters.length;
  const currentLetter = letters[currentIndex];
  const progressLabel = useMemo(() => {
    if (totalLetters === 0) {
      return '0 / 0';
    }
    return `${currentIndex + 1} / ${totalLetters}`;
  }, [currentIndex, totalLetters]);

  const handleFlip = () => {
    if (!currentLetter) {
      return;
    }
    setIsFlipped((value) => !value);
  };

  const handlePrev = () => {
    if (currentIndex === 0) {
      return;
    }
    setCurrentIndex((value) => value - 1);
    setIsFlipped(false);
  };

  const handleNext = () => {
    if (currentIndex >= totalLetters - 1) {
      return;
    }
    setCurrentIndex((value) => value + 1);
    setIsFlipped(false);
  };

  const handleSpeak = () => {
    if (!currentLetter) {
      return;
    }
    speakLetter(currentLetter.textNative, currentLetter.nativeIso);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Alphabet Flashcards</Text>
        <View style={styles.headerRight} />
      </View>

      <View style={styles.progressContainer}>
        <Text style={styles.languageLabel}>
          {languageId === 'spanish' ? 'Spanish Alphabet' : 'English Alphabet'}
        </Text>
        <Text style={styles.progressText}>{progressLabel}</Text>
      </View>

      <View style={styles.cardContainer}>
        <View style={styles.card}>
          {isLoading ? (
            <ActivityIndicator size="large" color={colors.primary} />
          ) : error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : !currentLetter ? (
            <Text style={styles.emptyText}>No letters found for this level.</Text>
          ) : (
            <>
              <Text style={styles.cardLabel}>{isFlipped ? 'Lowercase' : 'Uppercase'}</Text>
              <Text style={styles.cardText}>
                {isFlipped ? currentLetter.lowercase : currentLetter.textNative}
              </Text>
              {!isFlipped && (
                <TouchableOpacity style={styles.speakButton} onPress={handleSpeak}>
                  <Text style={styles.speakButtonText}>🔊 Speak</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      </View>

      <View style={styles.controlsRow}>
        <TouchableOpacity
          style={[styles.controlButton, !currentLetter && styles.controlButtonDisabled]}
          onPress={handleFlip}
          disabled={!currentLetter}
        >
          <Text style={styles.controlButtonText}>Flip</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.navButtons}>
        <TouchableOpacity
          style={[styles.navButton, currentIndex === 0 && styles.navButtonDisabled]}
          onPress={handlePrev}
          disabled={currentIndex === 0 || !currentLetter}
        >
          <Text style={styles.navButtonText}>Previous</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.navButton,
            styles.navButtonPrimary,
            (currentIndex >= totalLetters - 1 || !currentLetter) && styles.navButtonDisabled,
          ]}
          onPress={handleNext}
          disabled={currentIndex >= totalLetters - 1 || !currentLetter}
        >
          <Text style={[styles.navButtonText, styles.navButtonTextPrimary]}>Next</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  backButton: {
    ...typography.body,
    color: colors.primary,
  },
  headerTitle: {
    ...typography.h4,
  },
  headerRight: {
    width: 50,
  },
  progressContainer: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    alignItems: 'center',
    gap: spacing.xs,
  },
  languageLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  progressText: {
    ...typography.bodySemibold,
    color: colors.text,
  },
  cardContainer: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: 20,
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 300,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardLabel: {
    ...typography.caption,
    color: colors.textTertiary,
    marginBottom: spacing.md,
  },
  cardText: {
    ...typography.h1,
    fontSize: 96,
    lineHeight: 104,
    textAlign: 'center',
  },
  speakButton: {
    marginTop: spacing.xl,
    backgroundColor: colors.backgroundSecondary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  speakButtonText: {
    ...typography.bodySemibold,
    color: colors.text,
  },
  controlsRow: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  controlButton: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  controlButtonDisabled: {
    opacity: 0.5,
  },
  controlButtonText: {
    ...typography.button,
    color: colors.text,
  },
  navButtons: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  navButton: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  navButtonPrimary: {
    backgroundColor: colors.primary,
  },
  navButtonDisabled: {
    opacity: 0.5,
  },
  navButtonText: {
    ...typography.button,
    color: colors.text,
  },
  navButtonTextPrimary: {
    color: colors.textInverse,
  },
  errorText: {
    ...typography.body,
    color: colors.error,
    textAlign: 'center',
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
