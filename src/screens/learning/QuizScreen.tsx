// Quiz Screen

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { colors, spacing, typography } from '../../theme';
import { getQuizQuestions, getQuizzes, submitQuizAttempts } from '../../core/api';
import type { QuestionAttemptInput, QuizAttemptResponse } from '../../types/quiz.types';

type QuizQuestion = {
  id: string;
  vocabId: string;
  prompt: string;
  options: string[];
  correctAnswer: string;
  pCorrect?: number;
  pointValue?: number;
};

// Mock quiz fallback until cloud data is available.
const MOCK_QUESTIONS: QuizQuestion[] = [
  {
    id: '1',
    vocabId: 'hola',
    prompt: 'What does "Hola" mean?',
    options: ['Hello', 'Goodbye', 'Please', 'Thank you'],
    correctAnswer: 'Hello',
    pointValue: 10,
  },
  {
    id: '2',
    vocabId: 'gracias',
    prompt: 'What does "Gracias" mean?',
    options: ['Hello', 'Goodbye', 'Please', 'Thank you'],
    correctAnswer: 'Thank you',
    pointValue: 10,
  },
  {
    id: '3',
    vocabId: 'adios',
    prompt: 'What does "Adios" mean?',
    options: ['Hello', 'Goodbye', 'Please', 'Thank you'],
    correctAnswer: 'Goodbye',
    pointValue: 10,
  },
];

function shuffle(values: string[]): string[] {
  const next = [...values];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function getDifficultyLabel(pCorrect?: number): { label: string; tone: 'hard' | 'medium' | 'easy' | 'neutral' } {
  if (typeof pCorrect !== 'number') {
    return { label: 'Unscored', tone: 'neutral' };
  }
  if (pCorrect <= 0.45) {
    return { label: 'Hard', tone: 'hard' };
  }
  if (pCorrect <= 0.7) {
    return { label: 'Medium', tone: 'medium' };
  }
  return { label: 'Easy', tone: 'easy' };
}

function normalizeQuizQuestions(
  payloadQuestions: Array<{
    id: string;
    vocabId: string;
    prompt: string;
    correctAnswer: string;
    distractors: string[];
    pCorrect?: number;
    pointValue?: number;
  }>
): QuizQuestion[] {
  return payloadQuestions
    .map((question) => {
      const baseOptions = [question.correctAnswer, ...question.distractors].filter(Boolean);
      const uniqueOptions = Array.from(new Set(baseOptions));
      if (!question.prompt || !question.correctAnswer || uniqueOptions.length === 0) {
        return null;
      }

      return {
        id: question.id,
        vocabId: question.vocabId,
        prompt: question.prompt,
        correctAnswer: question.correctAnswer,
        options: shuffle(uniqueOptions),
        pCorrect: question.pCorrect,
        pointValue: question.pointValue,
      } as QuizQuestion;
    })
    .filter((value): value is QuizQuestion => !!value);
}

export function QuizScreen() {
  const navigation = useNavigation();

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [usingMock, setUsingMock] = useState(false);

  const [quizId, setQuizId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [adaptiveActive, setAdaptiveActive] = useState(false);
  const [scopeAttemptCount, setScopeAttemptCount] = useState(0);
  const [modelSource, setModelSource] = useState<'local' | 'cloudrun'>('local');

  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [score, setScore] = useState(0);
  const [quizComplete, setQuizComplete] = useState(false);

  const [questionStartedAtMs, setQuestionStartedAtMs] = useState<number>(Date.now());
  const [currentResponseTimeMs, setCurrentResponseTimeMs] = useState<number>(0);
  const [attempts, setAttempts] = useState<QuestionAttemptInput[]>([]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [backendResult, setBackendResult] = useState<QuizAttemptResponse | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadQuiz = async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const quizzes = await getQuizzes();
        if (!mounted) return;

        if (quizzes.length === 0) {
          setQuestions(MOCK_QUESTIONS);
          setUsingMock(true);
          setQuizId(null);
          setAdaptiveActive(false);
          setScopeAttemptCount(0);
          setModelSource('local');
          setIsLoading(false);
          return;
        }

        const selectedQuizId = quizzes[0].id;
        const payload = await getQuizQuestions(selectedQuizId);
        if (!mounted) return;

        const normalized = normalizeQuizQuestions(payload.questions);

        if (normalized.length === 0) {
          setQuestions(MOCK_QUESTIONS);
          setUsingMock(true);
          setQuizId(null);
          setAdaptiveActive(false);
          setScopeAttemptCount(0);
          setModelSource('local');
        } else {
          setQuestions(normalized);
          setQuizId(selectedQuizId);
          setUsingMock(false);
          setAdaptiveActive(payload.adaptiveActive);
          setScopeAttemptCount(payload.scopeAttemptCount);
          setModelSource(payload.modelSource);
        }
      } catch (error) {
        if (!mounted) return;
        setQuestions(MOCK_QUESTIONS);
        setUsingMock(true);
        setQuizId(null);
        setAdaptiveActive(false);
        setScopeAttemptCount(0);
        setModelSource('local');
        setLoadError(error instanceof Error ? error.message : 'Failed to load quiz');
      } finally {
        if (mounted) {
          setIsLoading(false);
          setQuestionStartedAtMs(Date.now());
        }
      }
    };

    loadQuiz();
    return () => {
      mounted = false;
    };
  }, []);

  const totalQuestions = questions.length;
  const currentQuestion = questions[currentIndex];
  const progress = totalQuestions > 0 ? ((currentIndex + 1) / totalQuestions) * 100 : 0;

  const displayedScore = useMemo(() => {
    if (backendResult) {
      return backendResult;
    }
    return {
      score,
      totalQuestions,
      rawPct: totalQuestions > 0 ? Number(((score / totalQuestions) * 100).toFixed(2)) : 0,
      weightedPct: totalQuestions > 0 ? Number(((score / totalQuestions) * 100).toFixed(2)) : 0,
      passed: false,
      adaptiveActive,
      scopeAttemptCount,
      modelSource,
      quizAttemptId: '',
    } as QuizAttemptResponse;
  }, [backendResult, score, totalQuestions, adaptiveActive, scopeAttemptCount, modelSource]);

  const handleSelectAnswer = (answer: string) => {
    if (showResult) return;
    setSelectedAnswer(answer);
  };

  const handleSubmit = () => {
    if (!selectedAnswer || !currentQuestion) return;

    const elapsed = Math.max(1, Date.now() - questionStartedAtMs);
    setCurrentResponseTimeMs(elapsed);
    setShowResult(true);

    if (selectedAnswer === currentQuestion.correctAnswer) {
      setScore((prev) => prev + 1);
    }
  };

  const finalizeQuiz = async (nextAttempts: QuestionAttemptInput[]) => {
    if (!quizId || usingMock || nextAttempts.length === 0) {
      setQuizComplete(true);
      return;
    }

    setIsSubmitting(true);
    setSubmissionError(null);
    try {
      const result = await submitQuizAttempts(quizId, nextAttempts);
      setBackendResult(result);
      setAdaptiveActive(result.adaptiveActive);
      setScopeAttemptCount(result.scopeAttemptCount);
      setModelSource(result.modelSource);
    } catch (error) {
      setSubmissionError(error instanceof Error ? error.message : 'Failed to submit quiz');
    } finally {
      setIsSubmitting(false);
      setQuizComplete(true);
    }
  };

  const handleNext = async () => {
    if (!currentQuestion) return;

    const updatedAttempts = [
      ...attempts,
      {
        questionId: currentQuestion.id,
        vocabId: currentQuestion.vocabId,
        selectedAnswer: selectedAnswer || '',
        responseTimeMs: currentResponseTimeMs || 1,
      },
    ];
    setAttempts(updatedAttempts);

    if (currentIndex < totalQuestions - 1) {
      setCurrentIndex((prev) => prev + 1);
      setSelectedAnswer(null);
      setShowResult(false);
      setCurrentResponseTimeMs(0);
      setQuestionStartedAtMs(Date.now());
      return;
    }

    await finalizeQuiz(updatedAttempts);
  };

  const handleRestart = async () => {
    setCurrentIndex(0);
    setSelectedAnswer(null);
    setShowResult(false);
    setScore(0);
    setAttempts([]);
    setCurrentResponseTimeMs(0);
    setQuestionStartedAtMs(Date.now());
    setBackendResult(null);
    setSubmissionError(null);
    setQuizComplete(false);

    if (!quizId || usingMock) {
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    try {
      const payload = await getQuizQuestions(quizId);
      const normalized = normalizeQuizQuestions(payload.questions);
      if (normalized.length > 0) {
        setQuestions(normalized);
        setAdaptiveActive(payload.adaptiveActive);
        setScopeAttemptCount(payload.scopeAttemptCount);
        setModelSource(payload.modelSource);
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to refresh adaptive quiz');
    } finally {
      setIsLoading(false);
      setQuestionStartedAtMs(Date.now());
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centeredState}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.centeredText}>Loading quiz...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (quizComplete) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.resultContainer}>
          <Text style={styles.resultTitle}>Quiz Complete</Text>
          <Text style={styles.resultScore}>
            {displayedScore.score} / {displayedScore.totalQuestions}
          </Text>
          <Text style={styles.resultMeta}>Raw: {displayedScore.rawPct.toFixed(2)}%</Text>
          <Text style={styles.resultMeta}>Weighted: {displayedScore.weightedPct.toFixed(2)}%</Text>
          <Text style={[styles.resultMeta, displayedScore.passed ? styles.passText : styles.failText]}>
            {displayedScore.passed ? 'Passed (mastery reached)' : 'Not passed yet'}
          </Text>
          <Text style={styles.resultMeta}>Model source: {displayedScore.modelSource}</Text>
          {submissionError ? <Text style={styles.errorText}>{submissionError}</Text> : null}
          <TouchableOpacity style={styles.restartButton} onPress={handleRestart}>
            <Text style={styles.restartButtonText}>Try Again</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
            <Text style={styles.backButtonText}>Back to Dashboard</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!currentQuestion) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centeredState}>
          <Text style={styles.centeredText}>No quiz questions available.</Text>
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
            <Text style={styles.backButtonText}>Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const displayPoints = Number((currentQuestion.pointValue ?? 10).toFixed(2));
  const difficulty = getDifficultyLabel(currentQuestion.pCorrect);
  const hasModelScore = typeof currentQuestion.pCorrect === 'number';

  return (
    <SafeAreaView style={styles.container}>
      {usingMock ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Using sample quiz data until cloud content is available.</Text>
        </View>
      ) : null}

      {!usingMock ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            {adaptiveActive
              ? `Adaptive mode active (${scopeAttemptCount} attempts)`
              : `Calibration mode (${scopeAttemptCount}/10 attempts)`}
          </Text>
        </View>
      ) : null}

      {loadError ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Quiz load warning: {loadError}</Text>
        </View>
      ) : null}

      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.headerBack}>Exit</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Quiz</Text>
        <Text style={styles.headerScore}>Score: {score}</Text>
      </View>

      <View style={styles.progressContainer}>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${progress}%` }]} />
        </View>
      </View>

      <View style={styles.questionContainer}>
        <Text style={styles.questionNumber}>
          Question {currentIndex + 1} of {totalQuestions}
        </Text>
        <Text style={styles.questionText}>{currentQuestion.prompt}</Text>
        <Text style={styles.questionMeta}>Points: {displayPoints}</Text>
        <Text
          style={[
            styles.questionMeta,
            difficulty.tone === 'hard' && styles.hardText,
            difficulty.tone === 'medium' && styles.mediumText,
            difficulty.tone === 'easy' && styles.easyText,
          ]}
        >
          Difficulty: {adaptiveActive ? difficulty.label : 'Calibration'}
        </Text>
        <Text style={styles.questionMeta}>
          {adaptiveActive && hasModelScore
            ? `Model score assigned (p correct): ${Math.round((currentQuestion.pCorrect || 0) * 100)}%`
            : 'Model score assignment starts after calibration.'}
        </Text>
      </View>

      <View style={styles.optionsContainer}>
        {currentQuestion.options.map((option) => {
          const isSelected = selectedAnswer === option;
          const isCorrect = option === currentQuestion.correctAnswer;
          const showCorrect = showResult && isCorrect;
          const showIncorrect = showResult && isSelected && !isCorrect;

          return (
            <TouchableOpacity
              key={option}
              style={[
                styles.option,
                isSelected && styles.optionSelected,
                showCorrect && styles.optionCorrect,
                showIncorrect && styles.optionIncorrect,
              ]}
              onPress={() => handleSelectAnswer(option)}
              disabled={showResult}
            >
              <Text
                style={[
                  styles.optionText,
                  isSelected && styles.optionTextSelected,
                  (showCorrect || showIncorrect) && styles.optionTextResult,
                ]}
              >
                {option}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.actionContainer}>
        {!showResult ? (
          <TouchableOpacity
            style={[styles.actionButton, !selectedAnswer && styles.actionButtonDisabled]}
            onPress={handleSubmit}
            disabled={!selectedAnswer}
          >
            <Text style={styles.actionButtonText}>Check Answer</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.actionButton, isSubmitting && styles.actionButtonDisabled]}
            onPress={handleNext}
            disabled={isSubmitting}
          >
            <Text style={styles.actionButtonText}>
              {isSubmitting
                ? 'Submitting...'
                : currentIndex === totalQuestions - 1
                ? 'See Results'
                : 'Next Question'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  centeredText: {
    ...typography.body,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  banner: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  headerBack: {
    ...typography.body,
    color: colors.primary,
  },
  headerTitle: {
    ...typography.h4,
  },
  headerScore: {
    ...typography.bodySemibold,
    color: colors.primary,
  },
  progressContainer: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
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
  questionContainer: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xl,
  },
  questionNumber: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  questionText: {
    ...typography.h3,
    lineHeight: 32,
  },
  questionMeta: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  hardText: {
    color: colors.error,
  },
  mediumText: {
    color: colors.warning,
  },
  easyText: {
    color: colors.success,
  },
  optionsContainer: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  option: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    padding: spacing.lg,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  optionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  optionCorrect: {
    borderColor: colors.success,
    backgroundColor: colors.success + '20',
  },
  optionIncorrect: {
    borderColor: colors.error,
    backgroundColor: colors.error + '20',
  },
  optionText: {
    ...typography.body,
  },
  optionTextSelected: {
    ...typography.bodySemibold,
    color: colors.white,
  },
  optionTextResult: {
    color: colors.text,
  },
  actionContainer: {
    padding: spacing.lg,
  },
  actionButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  actionButtonDisabled: {
    opacity: 0.5,
  },
  actionButtonText: {
    ...typography.bodySemibold,
    color: colors.white,
  },
  resultContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  resultTitle: {
    ...typography.h2,
    marginBottom: spacing.md,
  },
  resultScore: {
    ...typography.h1,
    color: colors.primary,
    marginBottom: spacing.sm,
  },
  resultMeta: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  passText: {
    color: colors.success,
  },
  failText: {
    color: colors.error,
  },
  errorText: {
    ...typography.bodySmall,
    color: colors.error,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  restartButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  restartButtonText: {
    ...typography.bodySemibold,
    color: colors.white,
  },
  backButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  backButtonText: {
    ...typography.body,
    color: colors.primary,
  },
});
