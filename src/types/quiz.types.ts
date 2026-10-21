// Quiz-related types based on Firestore schema

export type QuizType = 'multiple-choice' | 'translation' | 'listening';
export type QuestionType = 'mcq' | 'translation' | 'listening';

export interface Quiz {
  id: string;
  title: string;
  type: QuizType;
  createdAt: Date;
}

export interface Question {
  id: string;
  vocabId: string;
  prompt: string;
  correctAnswer: string;
  distractors: string[];
  questionType: QuestionType;
  pCorrect?: number;
  pointValue?: number;
}

export interface QuestionAttempt {
  id: string;
  userId: string;
  questionId: string;
  vocabId: string;
  correct: boolean;
  responseTimeMs: number;
  attemptTime: Date;
}

export interface QuizAttempt {
  id: string;
  languageId: string;
  levelId: string;
  quizId: string;
  score: number;
  totalQuestions: number;
  completedAt: Date;
}

// API request types
export interface SubmitQuizRequest {
  quizId: string;
  attempts: QuestionAttemptInput[];
}

export interface QuestionAttemptInput {
  questionId: string;
  vocabId: string;
  selectedAnswer: string;
  responseTimeMs: number;
}

export interface QuizQuestionResponse {
  quiz: Quiz;
  questions: Question[];
  adaptiveActive: boolean;
  scopeAttemptCount: number;
  modelSource: 'local' | 'cloudrun';
}

export interface QuizAttemptResponse {
  quizAttemptId: string;
  score: number;
  totalQuestions: number;
  rawPct: number;
  weightedPct: number;
  passed: boolean;
  adaptiveActive: boolean;
  scopeAttemptCount: number;
  modelSource: 'local' | 'cloudrun';
}
