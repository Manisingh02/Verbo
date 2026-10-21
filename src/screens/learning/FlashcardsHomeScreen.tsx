import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { getFlashcards, getQuizzes } from '../../core/api';
import { colors, spacing, typography } from '../../theme';
import type { HomeStackParamList } from '../../types/navigation.types';
import type { Quiz } from '../../types/quiz.types';
import type { FlashcardLevelId } from '../../types/vocab.types';

type Props = NativeStackScreenProps<HomeStackParamList, 'FlashcardsHome'>;
type BatchLevelId = Exclude<FlashcardLevelId, 'alphabet'>;

type FlashcardPreview = Awaited<ReturnType<typeof getFlashcards>>[number];

type BatchOption = {
  key: string;
  levelId: BatchLevelId;
  batchIndex: number;
  batchSize: number;
  title: string;
  subtitle: string;
  metadata: string;
};

const MAX_BATCH_SOURCE_CARDS = 200;
const FALLBACK_BATCH_SIZE = 20;
const MIN_GUIDED_BATCH_SIZE = 12;

function getGuideQuizzes(quizzes: Quiz[]): Quiz[] {
  return quizzes;
}

function buildBatchOptions(
  levelId: BatchLevelId,
  label: string,
  cards: FlashcardPreview[],
  quizzes: Quiz[]
): BatchOption[] {
  if (cards.length === 0) {
    return [];
  }

  const guideQuizzes = getGuideQuizzes(quizzes);
  const guidedBatchSize =
    guideQuizzes.length > 0
      ? Math.max(MIN_GUIDED_BATCH_SIZE, Math.ceil(cards.length / guideQuizzes.length))
      : FALLBACK_BATCH_SIZE;
  const batchSize = Math.min(MAX_BATCH_SOURCE_CARDS, guidedBatchSize);
  const batchCount = Math.ceil(cards.length / batchSize);

  return Array.from({ length: batchCount }, (_, batchIndex) => {
    const start = batchIndex * batchSize;
    const end = Math.min(start + batchSize, cards.length);
    const guideQuiz = guideQuizzes[batchIndex % Math.max(guideQuizzes.length, 1)];
    const guideText = guideQuiz ? `Guided by ${guideQuiz.title}` : 'Generated from flashcards';

    return {
      key: `${levelId}-${batchIndex}`,
      levelId,
      batchIndex,
      batchSize,
      title: `${label} Set ${batchIndex + 1}`,
      subtitle: `${cards[start]?.front || 'Start'} through ${cards[end - 1]?.front || 'review'}`,
      metadata: `${end - start} cards - ${guideText}`,
    };
  });
}

export function FlashcardsHomeScreen({ navigation }: Props) {
  const [wordCards, setWordCards] = useState<FlashcardPreview[]>([]);
  const [phraseCards, setPhraseCards] = useState<FlashcardPreview[]>([]);
  const [personalCards, setPersonalCards] = useState<FlashcardPreview[]>([]);
  const [wordQuizzes, setWordQuizzes] = useState<Quiz[]>([]);
  const [phraseQuizzes, setPhraseQuizzes] = useState<Quiz[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedLevel, setSelectedLevel] = useState<BatchLevelId | null>(null);

  const wordBatches = useMemo(
    () => buildBatchOptions('words', 'Words', wordCards, wordQuizzes),
    [wordCards, wordQuizzes]
  );
  const phraseBatches = useMemo(
    () => buildBatchOptions('phrases', 'Phrases', phraseCards, phraseQuizzes),
    [phraseCards, phraseQuizzes]
  );
  const personalBatches = useMemo(
    () => buildBatchOptions('personal', 'Camera Flashcards', personalCards, []),
    [personalCards]
  );
  const selectedBatches =
    selectedLevel === 'phrases'
      ? phraseBatches
      : selectedLevel === 'personal'
        ? personalBatches
        : wordBatches;
  const selectedTitle =
    selectedLevel === 'phrases'
      ? 'Phrases & Sentences'
      : selectedLevel === 'personal'
        ? 'My Camera Flashcards'
        : 'Words';

  const loadBatches = async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const [
        nextWordCards,
        nextPhraseCards,
        nextPersonalCards,
        nextWordQuizzesResult,
        nextPhraseQuizzesResult,
      ] =
        await Promise.all([
          getFlashcards('words', { limit: MAX_BATCH_SOURCE_CARDS, source: 'system' }),
          getFlashcards('phrases', { limit: MAX_BATCH_SOURCE_CARDS, source: 'system' }),
          getFlashcards('personal', { limit: MAX_BATCH_SOURCE_CARDS, source: 'user' }),
          getQuizzes({ levelId: 'words', limit: 100 }),
          getQuizzes({ levelId: 'phrases', limit: 100 }),
        ]);

      setWordCards(nextWordCards);
      setPhraseCards(nextPhraseCards);
      setPersonalCards(nextPersonalCards);
      setWordQuizzes(nextWordQuizzesResult.quizzes);
      setPhraseQuizzes(nextPhraseQuizzesResult.quizzes);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to load flashcard batches');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadBatches();
  }, []);

  const openAlphabet = () => {
    navigation.navigate('FlashcardDeck', { levelId: 'alphabet' });
  };

  const openBatchLevel = (levelId: BatchLevelId) => {
    setSelectedLevel(levelId);
  };

  const openBatch = (batch: BatchOption) => {
    navigation.navigate('FlashcardDeck', {
      levelId: batch.levelId,
      batchIndex: batch.batchIndex,
      batchSize: batch.batchSize,
      batchTitle: batch.title,
      batchSubtitle: batch.metadata,
    });
  };

  const renderBatchSection = (title: string, batches: BatchOption[]) => (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionMeta}>{batches.length} sets</Text>
      </View>

      {batches.length > 0 ? (
        <View style={styles.levelList}>
          {batches.map((batch) => (
            <TouchableOpacity
              key={batch.key}
              style={styles.levelCard}
              activeOpacity={0.88}
              onPress={() => openBatch(batch)}
            >
              <View style={styles.levelIndex}>
                <Text style={styles.levelIndexText}>
                  {String(batch.batchIndex + 1).padStart(2, '0')}
                </Text>
              </View>

              <View style={styles.levelContent}>
                <View style={styles.levelHeader}>
                  <Text style={styles.levelTitle}>{batch.title}</Text>
                  <Text style={styles.levelChevron}>›</Text>
                </View>
                <Text style={styles.levelSubtitle}>{batch.subtitle}</Text>
                <View style={styles.metadataPill}>
                  <Text style={styles.metadataText}>{batch.metadata}</Text>
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No {title.toLowerCase()} batches found yet.</Text>
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => {
              if (selectedLevel) {
                setSelectedLevel(null);
                return;
              }
              navigation.goBack();
            }}
          >
            <Text style={styles.backButton}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Flashcards</Text>
          <View style={styles.headerRight} />
        </View>

        <View style={styles.hero}>
          <Text style={styles.eyebrow}>Study decks</Text>
          <Text style={styles.heroTitle}>
            {selectedLevel ? `${selectedTitle} sets` : 'Choose what to review'}
          </Text>
          <Text style={styles.heroSubtitle}>
            {selectedLevel
              ? 'Pick a smaller set and study it in the flashcard deck.'
              : 'Start with alphabet basics, or open Words and Phrases to choose from quiz-guided sets.'}
          </Text>
        </View>

        {!selectedLevel ? (
          <View style={styles.levelList}>
            <TouchableOpacity style={styles.levelCard} activeOpacity={0.88} onPress={openAlphabet}>
              <View style={styles.levelIndex}>
                <Text style={styles.levelIndexText}>01</Text>
              </View>
              <View style={styles.levelContent}>
                <View style={styles.levelHeader}>
                  <Text style={styles.levelTitle}>Alphabet</Text>
                  <Text style={styles.levelChevron}>›</Text>
                </View>
                <Text style={styles.levelSubtitle}>
                  Review letter forms and pronunciation basics.
                </Text>
                <View style={styles.metadataPill}>
                  <Text style={styles.metadataText}>Letter deck</Text>
                </View>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.levelCard}
              activeOpacity={0.88}
              onPress={() => openBatchLevel('words')}
            >
              <View style={styles.levelIndex}>
                <Text style={styles.levelIndexText}>02</Text>
              </View>
              <View style={styles.levelContent}>
                <View style={styles.levelHeader}>
                  <Text style={styles.levelTitle}>Words</Text>
                  <Text style={styles.levelChevron}>›</Text>
                </View>
                <Text style={styles.levelSubtitle}>
                  Open vocabulary flashcards grouped into smaller review sets.
                </Text>
                <View style={styles.metadataPill}>
                  <Text style={styles.metadataText}>
                    {isLoading ? 'Loading sets...' : `${wordBatches.length} sets`}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.levelCard}
              activeOpacity={0.88}
              onPress={() => openBatchLevel('phrases')}
            >
              <View style={styles.levelIndex}>
                <Text style={styles.levelIndexText}>03</Text>
              </View>
              <View style={styles.levelContent}>
                <View style={styles.levelHeader}>
                  <Text style={styles.levelTitle}>Phrases & Sentences</Text>
                  <Text style={styles.levelChevron}>›</Text>
                </View>
                <Text style={styles.levelSubtitle}>
                  Open phrase and sentence cards grouped into readable sets.
                </Text>
                <View style={styles.metadataPill}>
                  <Text style={styles.metadataText}>
                    {isLoading ? 'Loading sets...' : `${phraseBatches.length} sets`}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.levelCard}
              activeOpacity={0.88}
              onPress={() => openBatchLevel('personal')}
            >
              <View style={styles.levelIndex}>
                <Text style={styles.levelIndexText}>04</Text>
              </View>
              <View style={styles.levelContent}>
                <View style={styles.levelHeader}>
                  <Text style={styles.levelTitle}>My Camera Flashcards</Text>
                  <Text style={styles.levelChevron}>›</Text>
                </View>
                <Text style={styles.levelSubtitle}>
                  Review flashcards you saved from translated photos.
                </Text>
                <View style={styles.metadataPill}>
                  <Text style={styles.metadataText}>
                    {isLoading ? 'Loading sets...' : `${personalBatches.length} sets`}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          </View>
        ) : null}

        {selectedLevel ? (
          <TouchableOpacity
            style={styles.switchButton}
            activeOpacity={0.88}
            onPress={() => setSelectedLevel(null)}
          >
            <Text style={styles.switchButtonText}>Back to deck types</Text>
          </TouchableOpacity>
        ) : null}

        {selectedLevel && loadError ? (
          <View style={styles.noticeCard}>
            <Text style={styles.noticeTitle}>Batch loading warning</Text>
            <Text style={styles.noticeText}>{loadError}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={() => void loadBatches()}>
              <Text style={styles.retryButtonText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {selectedLevel ? (
          isLoading ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.loadingText}>Building flashcard sets...</Text>
            </View>
          ) : (
            renderBatchSection(selectedTitle, selectedBatches)
          )
        ) : null}

        {!selectedLevel && loadError ? (
          <View style={styles.noticeCard}>
            <Text style={styles.noticeTitle}>Batch loading warning</Text>
            <Text style={styles.noticeText}>{loadError}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={() => void loadBatches()}>
              <Text style={styles.retryButtonText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        ) : null}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  backButton: {
    ...typography.bodySemibold,
    color: colors.primary,
  },
  headerTitle: {
    ...typography.h4,
    color: colors.text,
  },
  headerRight: {
    width: 52,
  },
  hero: {
    marginBottom: spacing.lg,
  },
  eyebrow: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  heroTitle: {
    ...typography.h1,
    color: colors.text,
  },
  heroSubtitle: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    lineHeight: 21,
    marginTop: spacing.sm,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
  },
  sectionMeta: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  levelList: {
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  levelCard: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: 14,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  switchButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  switchButtonText: {
    ...typography.bodySemibold,
    color: colors.text,
  },
  levelIndex: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: spacing.md,
  },
  levelIndexText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '800',
  },
  levelContent: {
    flex: 1,
  },
  levelHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  levelTitle: {
    ...typography.bodySemibold,
    color: colors.text,
    flex: 1,
  },
  levelChevron: {
    ...typography.h3,
    color: colors.textTertiary,
    lineHeight: 24,
  },
  levelSubtitle: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  metadataPill: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.primary + '12',
  },
  metadataText: {
    ...typography.caption,
    color: colors.primaryDark,
    fontWeight: '700',
  },
  loadingCard: {
    minHeight: 170,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  loadingText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  noticeCard: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 14,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  noticeTitle: {
    ...typography.bodySemibold,
    color: colors.text,
  },
  noticeText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    lineHeight: 20,
  },
  retryButton: {
    alignSelf: 'flex-start',
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  retryButtonText: {
    ...typography.button,
    color: colors.textInverse,
  },
  emptyCard: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  emptyText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
