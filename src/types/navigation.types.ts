// Navigation type definitions

import type { NavigatorScreenParams } from '@react-navigation/native';
import type { VocabSuggestion } from './vision.types';

// Root Stack
export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList>;
  Onboarding: NavigatorScreenParams<OnboardingStackParamList>;
  Main: NavigatorScreenParams<MainDrawerParamList>;
};

// Auth Stack
export type AuthStackParamList = {
  Login: undefined;
  SignUp: undefined;
  ForgotPassword: undefined;
};

// Onboarding Stack
export type OnboardingStackParamList = {
  LanguageSelection: undefined;
};

// Main Drawer (for Instagram-style swipe)
export type MainDrawerParamList = {
  Camera: NavigatorScreenParams<CameraStackParamList>;
  Tabs: NavigatorScreenParams<MainTabParamList>;
};

// Main Tab Navigator
export type MainTabParamList = {
  HomeTab: NavigatorScreenParams<HomeStackParamList>;
  LearnTab: NavigatorScreenParams<LearnStackParamList>;
  ReviewTab: NavigatorScreenParams<ReviewStackParamList>;
  ProfileTab: NavigatorScreenParams<ProfileStackParamList>;
};

// Home Stack
export type HomeStackParamList = {
  Dashboard: undefined;
  AlphabetFlashcards: undefined;
  FlashcardsHome: undefined;
  Flashcards: {
    levelId: string;
    vocabType?: 'letter' | 'word' | 'phrase';
  };
  FlashcardDeck: {
    levelId: 'alphabet' | 'words' | 'phrases' | 'personal';
    batchIndex?: number;
    batchSize?: number;
    batchTitle?: string;
    batchSubtitle?: string;
  };
};

// Learn Stack
export type LearnStackParamList = {
  QuizList: undefined;
  Quiz: {
    quizId: string;
    levelId: string;
  };
  QuizResults: {
    quizAttemptId: string;
    score: number;
    totalQuestions: number;
  };
};

// Camera Stack
export type CameraStackParamList = {
  CameraCapture: undefined;
  VocabConfirmation: {
    visionResultId: string;
    suggestions: VocabSuggestion[];
  };
};

// Review Stack
export type ReviewStackParamList = {
  ReviewQueue: undefined;
};

// Profile Stack
export type ProfileStackParamList = {
  ProgressOverview: undefined;
};

// Declare global types for useNavigation hook
declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
