// Flashcards Screen

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { colors, spacing, typography } from '../../theme';
import type { HomeStackParamList } from '../../types/navigation.types';
import { getFlashcards } from '../../core/api';

type Props = NativeStackScreenProps<HomeStackParamList, 'Flashcards'>;

// Mock flashcards for skeleton
const MOCK_FLASHCARDS = [
  { id: '1', front: 'Hola', back: 'Hello' },
  { id: '2', front: 'Gracias', back: 'Thank you' },
  { id: '3', front: 'Por favor', back: 'Please' },
  { id: '4', front: 'Buenos días', back: 'Good morning' },
  { id: '5', front: 'Adiós', back: 'Goodbye' },
];

export function FlashcardsScreen() {
  const navigation = useNavigation();
  const route = useRoute<Props['route']>();

  const [flashcards, setFlashcards] = useState(MOCK_FLASHCARDS);
  const [usingMock, setUsingMock] = useState(true);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      try {
        const data = await getFlashcards();
        if (!isMounted) return;
        if (data.length > 0) {
          setFlashcards(data);
          setUsingMock(false);
        } else {
          setFlashcards(MOCK_FLASHCARDS);
          setUsingMock(true);
        }
      } catch (error) {
        if (!isMounted) return;
        setFlashcards(MOCK_FLASHCARDS);
        setUsingMock(true);
      }
    };

    load();
    return () => {
      isMounted = false;
    };
  }, []);

  const currentCard = flashcards[currentIndex];
  const totalCards = flashcards.length;
  const progress = totalCards > 0 ? ((currentIndex + 1) / totalCards) * 100 : 0;

  const handleFlip = () => {
    setIsFlipped(!isFlipped);
  };

  const handleNext = () => {
    if (currentIndex < flashcards.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setIsFlipped(false);
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setIsFlipped(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {usingMock && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            Using sample data until content is uploaded.
          </Text>
        </View>
      )}
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Flashcards</Text>
        <View style={styles.headerRight} />
      </View>

      {/* Progress Bar */}
      <View style={styles.progressContainer}>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${progress}%` }]} />
        </View>
        <Text style={styles.progressText}>
          {totalCards === 0 ? 0 : currentIndex + 1} / {totalCards}
        </Text>
      </View>

      {/* Flashcard */}
      <View style={styles.cardContainer}>
        <TouchableOpacity
          style={styles.card}
          onPress={handleFlip}
          activeOpacity={0.9}
          disabled={totalCards === 0}
        >
          <Text style={styles.cardLabel}>
            {isFlipped ? 'English' : 'Target Language'}
          </Text>
          <Text style={styles.cardText}>
            {currentCard ? (isFlipped ? currentCard.back : currentCard.front) : '-'}
          </Text>
          <Text style={styles.tapHint}>Tap to flip</Text>
        </TouchableOpacity>
      </View>

      {/* Navigation Buttons */}
      <View style={styles.navButtons}>
        <TouchableOpacity
          style={[styles.navButton, currentIndex === 0 && styles.navButtonDisabled]}
          onPress={handlePrevious}
          disabled={currentIndex === 0}
        >
          <Text style={styles.navButtonText}>Previous</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.navButton,
            styles.navButtonPrimary,
            currentIndex === flashcards.length - 1 && styles.navButtonDisabled,
          ]}
          onPress={handleNext}
          disabled={currentIndex === flashcards.length - 1 || totalCards === 0}
        >
          <Text style={[styles.navButtonText, styles.navButtonTextPrimary]}>
            {currentIndex === flashcards.length - 1 ? 'Done' : 'Next'}
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
  },
  banner: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bannerText: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
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
  progressText: {
    ...typography.caption,
    textAlign: 'center',
    marginTop: spacing.xs,
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
    textAlign: 'center',
  },
  tapHint: {
    ...typography.caption,
    color: colors.textTertiary,
    marginTop: spacing.xl,
  },
  navButtons: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
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
});
