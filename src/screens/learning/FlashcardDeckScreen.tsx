import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';

import { getFlashcards } from '../../core/api';
import { auth, db } from '../../core/config/firebase';
import { speakLetter } from '../../core/tts/speak';
import { colors, spacing, typography } from '../../theme';
import type { HomeStackParamList } from '../../types/navigation.types';
import type { FlashcardItem, FlashcardLevelId } from '../../types/vocab.types';

type Props = NativeStackScreenProps<HomeStackParamList, 'FlashcardDeck'>;
type SupportedLanguageId = 'english' | 'spanish';

const LEVEL_COPY: Record<
  FlashcardLevelId,
  {
    title: string;
    subtitle: string;
    frontLabel: string;
    backLabel: string;
    emptyText: string;
  }
> = {
  alphabet: {
    title: 'Alphabet',
    subtitle: 'Uppercase on the front, lowercase on the back.',
    frontLabel: 'Uppercase',
    backLabel: 'Lowercase',
    emptyText: 'No alphabet cards found for this language.',
  },
  words: {
    title: 'Words',
    subtitle: 'High-frequency vocabulary, one card at a time.',
    frontLabel: 'Word',
    backLabel: 'Translation',
    emptyText: 'No word flashcards found for this level.',
  },
  phrases: {
    title: 'Phrases & Sentences',
    subtitle: 'Longer phrase cards with room to read.',
    frontLabel: 'Phrase',
    backLabel: 'Translation',
    emptyText: 'No phrase flashcards found for this level.',
  },
  personal: {
    title: 'My Camera Flashcards',
    subtitle: 'Cards you saved from translated photos.',
    frontLabel: 'Translation',
    backLabel: 'Original',
    emptyText: 'No saved camera flashcards found yet.',
  },
};

function normalizeLanguageId(value: unknown): SupportedLanguageId {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'spanish' || normalized === 'es') {
    return 'spanish';
  }
  return 'english';
}

function nativeIsoFromLanguageId(languageId: SupportedLanguageId): 'en' | 'es' {
  return languageId === 'spanish' ? 'es' : 'en';
}

async function resolveCurrentLanguageId(): Promise<SupportedLanguageId> {
  if (!db || !auth?.currentUser) {
    return 'english';
  }

  const uid = auth.currentUser.uid;

  try {
    const activePlanSnap = await getDoc(doc(db, 'users', uid, 'learning_plans', 'active'));
    if (activePlanSnap.exists()) {
      return normalizeLanguageId(activePlanSnap.data()?.currentLanguageId);
    }
  } catch {
    // Fall back to the user profile below.
  }

  try {
    const userSnap = await getDoc(doc(db, 'users', uid));
    return normalizeLanguageId(userSnap.data()?.targetLanguage);
  } catch {
    return 'english';
  }
}

function normalizeAlphabetCards(
  levelId: FlashcardLevelId,
  languageId: SupportedLanguageId,
  snapshotDocs: QueryDocumentSnapshot<DocumentData>[]
): FlashcardItem[] {
  return snapshotDocs
    .map((snapshotDoc, index) => {
      const data = snapshotDoc.data();
      const frontText = typeof data.textNative === 'string' ? data.textNative.trim() : '';
      const backText =
        typeof data.lowercase === 'string' ? data.lowercase.trim() : frontText.toLowerCase();
      const orderNumber = Number(data.order);

      return {
        id: snapshotDoc.id,
        levelId,
        frontText,
        backText,
        nativeIso: nativeIsoFromLanguageId(languageId),
        order: Number.isFinite(orderNumber) ? orderNumber : index + 1,
        ttsType: 'letter',
      } as FlashcardItem;
    })
    .filter((card) => card.frontText.length > 0 && card.backText.length > 0)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

function normalizeDeckCards(
  levelId: Exclude<FlashcardLevelId, 'alphabet'>,
  languageId: SupportedLanguageId,
  cards: Awaited<ReturnType<typeof getFlashcards>>
): FlashcardItem[] {
  return cards
    .map((card, index) => ({
      id: card.id,
      levelId,
      frontText: card.front.trim(),
      backText: card.back.trim(),
      nativeIso: nativeIsoFromLanguageId(languageId),
      order: typeof card.order === 'number' ? card.order : index + 1,
      ttsType: 'text' as const,
    }))
    .filter((card) => card.frontText.length > 0 && card.backText.length > 0);
}

function buildLanguageLabel(languageId: SupportedLanguageId): string {
  return languageId === 'spanish' ? 'Spanish' : 'English';
}

export function FlashcardDeckScreen({ navigation, route }: Props) {
  const { levelId, batchIndex, batchSize, batchTitle, batchSubtitle } = route.params;

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [languageId, setLanguageId] = useState<SupportedLanguageId>('english');
  const [cards, setCards] = useState<FlashcardItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    let mounted = true;

    const loadCards = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const resolvedLanguageId = await resolveCurrentLanguageId();
        let nextCards: FlashcardItem[] = [];
        const hasRequestedBatch =
          typeof batchIndex === 'number' &&
          typeof batchSize === 'number' &&
          batchIndex >= 0 &&
          batchSize > 0;

        if (levelId === 'alphabet') {
          if (!db) {
            throw new Error('Firestore not configured. Add credentials to .env file.');
          }

          const vocabRef = collection(
            db,
            'languages',
            resolvedLanguageId,
            'levels',
            'alphabet',
            'vocab'
          );
          const snapshot = await getDocs(vocabRef);
          nextCards = normalizeAlphabetCards(levelId, resolvedLanguageId, snapshot.docs);
        } else {
          const apiCards = await getFlashcards(
            levelId,
            hasRequestedBatch
              ? { limit: 200, source: levelId === 'personal' ? 'user' : 'system' }
              : { source: levelId === 'personal' ? 'user' : 'system' }
          );
          nextCards = normalizeDeckCards(levelId, resolvedLanguageId, apiCards);
        }

        if (!mounted) {
          return;
        }

        const batchStart = hasRequestedBatch ? batchIndex * batchSize : 0;
        const batchEnd = hasRequestedBatch ? batchStart + batchSize : nextCards.length;
        const batchCards = hasRequestedBatch ? nextCards.slice(batchStart, batchEnd) : nextCards;

        setLanguageId(resolvedLanguageId);
        setCards(batchCards.length > 0 ? batchCards : nextCards);
        setCurrentIndex(0);
        setIsFlipped(false);
        setIsComplete(false);
      } catch (loadError) {
        if (!mounted) {
          return;
        }

        setCards([]);
        setError(loadError instanceof Error ? loadError.message : 'Failed to load flashcards');
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    void loadCards();

    return () => {
      mounted = false;
    };
  }, [levelId, batchIndex, batchSize]);

  const currentCard = cards[currentIndex];
  const totalCards = cards.length;
  const progress = totalCards > 0 ? ((currentIndex + 1) / totalCards) * 100 : 0;
  const copy = LEVEL_COPY[levelId];
  const deckTitle = batchTitle || copy.title;
  const deckSubtitle = batchSubtitle || copy.subtitle;

  const progressLabel = useMemo(() => {
    if (totalCards === 0) {
      return '0 / 0';
    }
    return `${currentIndex + 1} / ${totalCards}`;
  }, [currentIndex, totalCards]);

  const displayedText = currentCard
    ? isFlipped
      ? currentCard.backText
      : currentCard.frontText
    : '';

  const handleFlip = () => {
    if (!currentCard) {
      return;
    }
    setIsFlipped((value) => !value);
  };

  const handlePrevious = () => {
    if (currentIndex === 0) {
      return;
    }
    setCurrentIndex((value) => value - 1);
    setIsFlipped(false);
  };

  const handleNext = () => {
    if (!currentCard) {
      return;
    }
    if (currentIndex >= totalCards - 1) {
      setIsComplete(true);
      return;
    }
    setCurrentIndex((value) => value + 1);
    setIsFlipped(false);
  };

  const handleRestart = () => {
    setCurrentIndex(0);
    setIsFlipped(false);
    setIsComplete(false);
  };

  const handleSpeak = () => {
    if (!currentCard || currentCard.ttsType !== 'letter') {
      return;
    }
    speakLetter(currentCard.frontText, currentCard.nativeIso);
  };

  if (isComplete) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.backButton}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{deckTitle}</Text>
          <View style={styles.headerRight} />
        </View>

        <View style={styles.completeContainer}>
          <View style={styles.completeCard}>
            <Text style={styles.completeEyebrow}>Deck complete</Text>
            <Text style={styles.completeTitle}>{deckTitle}</Text>
            <Text style={styles.completeSubtitle}>
              You reviewed {totalCards} {totalCards === 1 ? 'card' : 'cards'}.
            </Text>

            <TouchableOpacity style={styles.primaryButton} onPress={handleRestart}>
              <Text style={styles.primaryButtonText}>Review Again</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => navigation.goBack()}>
              <Text style={styles.secondaryButtonText}>Choose Another Deck</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{deckTitle}</Text>
        <View style={styles.countPill}>
          <Text style={styles.countPillText}>{progressLabel}</Text>
        </View>
      </View>

      <View style={styles.progressContainer}>
        <Text style={styles.levelLabel}>
          {buildLanguageLabel(languageId)} - {deckSubtitle}
        </Text>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${progress}%` }]} />
        </View>
      </View>

      <View style={styles.cardContainer}>
        <TouchableOpacity
          style={styles.card}
          activeOpacity={0.92}
          onPress={handleFlip}
          disabled={!currentCard || !!error || isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size="large" color={colors.primary} />
          ) : error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : !currentCard ? (
            <Text style={styles.emptyText}>{copy.emptyText}</Text>
          ) : (
            <>
              <View style={styles.cardTopRow}>
                <Text style={styles.cardLabel}>
                  {isFlipped ? copy.backLabel : copy.frontLabel}
                </Text>
                <Text style={styles.flipHint}>{isFlipped ? 'Answer' : 'Tap to flip'}</Text>
              </View>
              <Text
                style={[
                  styles.cardText,
                  levelId === 'alphabet'
                    ? styles.cardTextAlphabet
                    : levelId === 'phrases'
                      ? styles.cardTextPhrase
                      : styles.cardTextWord,
                ]}
              >
                {displayedText}
              </Text>
              {!isFlipped && currentCard.ttsType === 'letter' ? (
                <TouchableOpacity style={styles.speakButton} onPress={handleSpeak}>
                  <Text style={styles.speakButtonText}>Speak</Text>
                </TouchableOpacity>
              ) : null}
            </>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.navButtons}>
        <TouchableOpacity
          style={[styles.navButton, currentIndex === 0 && styles.buttonDisabled]}
          onPress={handlePrevious}
          disabled={currentIndex === 0 || !currentCard}
        >
          <Text style={styles.navButtonText}>Previous</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navButton, styles.navButtonPrimary, !currentCard && styles.buttonDisabled]}
          onPress={handleNext}
          disabled={!currentCard}
        >
          <Text style={styles.navButtonTextPrimary}>
            {currentIndex >= totalCards - 1 ? 'Finish' : 'Next'}
          </Text>
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
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  backButton: {
    ...typography.bodySemibold,
    color: colors.primary,
  },
  headerTitle: {
    ...typography.h4,
    color: colors.text,
    flex: 1,
    textAlign: 'center',
  },
  headerRight: {
    width: 52,
  },
  countPill: {
    minWidth: 52,
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  countPillText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  progressContainer: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  levelLabel: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  progressBar: {
    height: 8,
    backgroundColor: colors.gray200,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 4,
  },
  cardContainer: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: spacing.xl,
    justifyContent: 'center',
    minHeight: 330,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTopRow: {
    position: 'absolute',
    top: spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  cardLabel: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  flipHint: {
    ...typography.caption,
    color: colors.textTertiary,
  },
  cardText: {
    textAlign: 'center',
    color: colors.text,
  },
  cardTextAlphabet: {
    ...typography.h1,
    fontSize: 96,
    lineHeight: 104,
  },
  cardTextWord: {
    ...typography.h1,
    fontSize: 48,
    lineHeight: 56,
  },
  cardTextPhrase: {
    ...typography.h3,
    lineHeight: 34,
  },
  speakButton: {
    alignSelf: 'center',
    marginTop: spacing.xl,
    backgroundColor: colors.backgroundSecondary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  speakButtonText: {
    ...typography.bodySemibold,
    color: colors.text,
  },
  navButtons: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
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
    backgroundColor: colors.text,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  navButtonText: {
    ...typography.button,
    color: colors.text,
  },
  navButtonTextPrimary: {
    ...typography.button,
    color: colors.textInverse,
  },
  completeContainer: {
    flex: 1,
    padding: spacing.lg,
    justifyContent: 'center',
  },
  completeCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  completeEyebrow: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  completeTitle: {
    ...typography.h2,
    color: colors.text,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  completeSubtitle: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  primaryButtonText: {
    ...typography.button,
    color: colors.textInverse,
  },
  secondaryButton: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  secondaryButtonText: {
    ...typography.button,
    color: colors.text,
  },
  errorText: {
    ...typography.body,
    color: colors.error,
    textAlign: 'center',
    lineHeight: 22,
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
});
