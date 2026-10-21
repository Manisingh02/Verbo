// Cloud Functions API client (thin wrapper)

import { auth } from '../config/firebase';
import type {
  Question,
  QuestionAttemptInput,
  Quiz,
  QuizAttemptResponse,
  QuizQuestionResponse,
} from '../../types/quiz.types';
import type {
  FlashcardLevelId,
  FlashcardSource,
  ReviewQueueItem,
  Vocab,
} from '../../types/vocab.types';
import type { User } from '../../types/user.types';
import type {
  ConfirmVocabRequest,
  TranslateImageRequest,
  TranslateImageResponse,
} from '../../types/vision.types';

const FUNCTIONS_BASE_URL = process.env.EXPO_PUBLIC_FUNCTIONS_URL;

type FlashcardDTO = {
  id?: string;
  vocabId?: string;
  frontText?: string;
  backText?: string;
  rank?: number;
  vocab?: Vocab;
  textNative?: string;
  textTarget?: string;
};

type FlashcardsResponse = {
  flashcards?: FlashcardDTO[];
  vocab?: Vocab[];
};

type ReviewQueueResponse = {
  reviewQueue?: ReviewQueueItemDTO[];
  items?: ReviewQueueItemDTO[];
};

type ReviewQueueItemDTO = {
  vocabId: string;
  dueAt?: string | null;
  priority: number;
  intervalDays?: number;
  ease?: number;
  updatedAt?: string | null;
  vocab?: VocabDTO;
};

type VocabDTO = {
  id: string;
  languageId: string;
  levelId?: string;
  type: Vocab['type'];
  textNative: string;
  textTarget: string;
  audioUrl?: string;
  imageUrl?: string;
  source: Vocab['source'];
  visionResultId?: string;
  createdAt?: string | null;
};

type QuizDTO = {
  id: string;
  title: string;
  type: Quiz['type'];
  createdAt?: string | null;
};

type QuestionDTO = {
  id: string;
  vocabId: string;
  prompt: string;
  correctAnswer: string;
  distractors: string[];
  questionType: Question['questionType'];
  pCorrect?: number;
  pointValue?: number;
};

type QuizzesResponse = {
  quizzes?: QuizDTO[];
  levelId?: string;
};

type QuizQuestionsResponse = {
  quiz: QuizDTO;
  questions: QuestionDTO[];
  adaptiveActive?: boolean;
  scopeAttemptCount?: number;
  modelSource?: 'local' | 'cloudrun';
};

type SubmitQuizAttemptsResponse = QuizAttemptResponse;

type ConfirmVisionFlashcardsResponse = {
  visionResultId: string;
  savedCount: number;
  flashcards?: FlashcardDTO[];
};

export type UpsertProfilePayload = {
  firstName?: string;
  lastName?: string;
  email?: string;
};

type UserProfileResponse = {
  user: {
    uid: string;
    email: string;
    firstName: string;
    lastName: string;
    nativeLanguage: string;
    targetLanguage: string;
    profilePictureUrl?: string;
    createdAt?: string | null;
    stats?: {
      totalXp?: number;
      streak?: number;
      lastActive?: string | null;
    };
  };
};

function parseDateOrNow(value?: string | null): Date {
  if (!value) {
    return new Date();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

async function getAuthToken(): Promise<string | null> {
  if (!auth?.currentUser) return null;
  return auth.currentUser.getIdToken();
}

function parseErrorStatus(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const match = error.message.match(/^Request failed: (\d{3})/);
  return match ? Number(match[1]) : null;
}

async function requestJson<T>(
  path: string,
  options?: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    timeoutMs?: number;
  }
): Promise<T> {
  if (!FUNCTIONS_BASE_URL) {
    throw new Error('Missing EXPO_PUBLIC_FUNCTIONS_URL');
  }

  const token = await getAuthToken();
  const method = options?.method || 'GET';
  const controller = new AbortController();
  const timeoutMs = options?.timeoutMs;
  const timeoutId =
    typeof timeoutMs === 'number' && timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

  try {
    const response = await fetch(`${FUNCTIONS_BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
      ...(options?.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });

    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('The request took too long. Please try again with a clearer image.');
    }
    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export type FlashcardCard = { id: string; front: string; back: string; order?: number };

function normalizeFlashcards(payload: FlashcardsResponse): FlashcardCard[] {
  if (payload.flashcards && payload.flashcards.length > 0) {
    return payload.flashcards.map((card, index) => ({
      id: card.id || card.vocabId || `flashcard-${index}`,
      front: card.frontText || card.vocab?.textTarget || card.textTarget || '',
      back: card.backText || card.vocab?.textNative || card.textNative || '',
      order: typeof card.rank === 'number' ? card.rank : index + 1,
    }));
  }

  if (payload.vocab && payload.vocab.length > 0) {
    return payload.vocab.map((vocab, index) => ({
      id: vocab.id || `vocab-${index}`,
      front: vocab.textTarget,
      back: vocab.textNative,
      order: index + 1,
    }));
  }

  return [];
}

function normalizeVocab(vocab?: VocabDTO): Vocab | undefined {
  if (!vocab) {
    return undefined;
  }
  return {
    id: vocab.id,
    languageId: vocab.languageId,
    levelId: vocab.levelId,
    type: vocab.type,
    textNative: vocab.textNative,
    textTarget: vocab.textTarget,
    audioUrl: vocab.audioUrl,
    imageUrl: vocab.imageUrl,
    source: vocab.source,
    visionResultId: vocab.visionResultId,
    createdAt: parseDateOrNow(vocab.createdAt),
  };
}

function normalizeReviewQueue(payload: ReviewQueueResponse): ReviewQueueItem[] {
  const items = payload.reviewQueue || payload.items || [];
  return items.map((item) => ({
    vocabId: item.vocabId,
    dueAt: parseDateOrNow(item.dueAt),
    priority: item.priority,
    intervalDays: item.intervalDays,
    ease: item.ease,
    updatedAt: parseDateOrNow(item.updatedAt),
    vocab: normalizeVocab(item.vocab),
  }));
}

export async function getFlashcards(
  levelId: FlashcardLevelId = 'words',
  options?: { limit?: number; source?: FlashcardSource }
): Promise<FlashcardCard[]> {
  const params = new URLSearchParams();
  if (levelId !== 'personal') {
    params.set('levelId', levelId);
  }
  if (options?.limit) {
    params.set('limit', String(options.limit));
  }
  if (options?.source) {
    params.set('source', options.source);
  } else if (levelId === 'personal') {
    params.set('source', 'user');
  }

  const query = params.toString();
  const payload = await requestJson<FlashcardsResponse>(
    query ? `/flashcards?${query}` : '/flashcards'
  );
  return normalizeFlashcards(payload);
}

export async function getReviewQueue(): Promise<ReviewQueueItem[]> {
  const payload = await requestJson<ReviewQueueResponse>('/review-queue');
  return normalizeReviewQueue(payload);
}

function normalizeUser(payload: UserProfileResponse): User {
  const rawUser = payload.user;
  return {
    uid: rawUser.uid,
    email: rawUser.email,
    firstName: rawUser.firstName,
    lastName: rawUser.lastName,
    nativeLanguage: rawUser.nativeLanguage || 'en',
    targetLanguage: rawUser.targetLanguage || '',
    profilePictureUrl: rawUser.profilePictureUrl,
    createdAt: parseDateOrNow(rawUser.createdAt),
    stats: {
      totalXp: rawUser.stats?.totalXp ?? 0,
      streak: rawUser.stats?.streak ?? 0,
      lastActive: parseDateOrNow(rawUser.stats?.lastActive),
    },
  };
}

function normalizeQuiz(dto: QuizDTO): Quiz {
  return {
    id: dto.id,
    title: dto.title,
    type: dto.type,
    createdAt: parseDateOrNow(dto.createdAt),
  };
}

function normalizeQuestion(dto: QuestionDTO): Question {
  return {
    id: dto.id,
    vocabId: dto.vocabId,
    prompt: dto.prompt,
    correctAnswer: dto.correctAnswer,
    distractors: dto.distractors,
    questionType: dto.questionType,
    pCorrect: typeof dto.pCorrect === 'number' ? dto.pCorrect : undefined,
    pointValue: typeof dto.pointValue === 'number' ? dto.pointValue : undefined,
  };
}

export function getQuizzes(): Promise<Quiz[]>;
export function getQuizzes(options: {
  levelId?: string;
  limit?: number;
}): Promise<{ quizzes: Quiz[]; levelId: string }>;
export async function getQuizzes(options?: {
  levelId?: string;
  limit?: number;
}): Promise<Quiz[] | { quizzes: Quiz[]; levelId: string }> {
  const params = new URLSearchParams();
  if (options?.levelId) {
    params.set('levelId', options.levelId);
  }
  if (options?.limit) {
    params.set('limit', String(options.limit));
  }

  const query = params.toString();
  const payload = await requestJson<QuizzesResponse>(query ? `/quizzes?${query}` : '/quizzes');
  const quizzes = (payload.quizzes || [])
    .map(normalizeQuiz)
    .sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })
    );

  if (options) {
    return {
      quizzes,
      levelId: (typeof payload.levelId === 'string' ? payload.levelId.trim() : '') || 'words',
    };
  }

  return quizzes;
}

export async function getQuizQuestions(quizId: string): Promise<QuizQuestionResponse> {
  const payload = await requestJson<QuizQuestionsResponse>(`/quizzes/${quizId}/questions`);
  return {
    quiz: normalizeQuiz(payload.quiz),
    questions: (payload.questions || []).map(normalizeQuestion),
    adaptiveActive: !!payload.adaptiveActive,
    scopeAttemptCount: typeof payload.scopeAttemptCount === 'number' ? payload.scopeAttemptCount : 0,
    modelSource: payload.modelSource === 'cloudrun' ? 'cloudrun' : 'local',
  };
}

export async function submitQuizAttempts(
  quizId: string,
  attempts: QuestionAttemptInput[]
): Promise<SubmitQuizAttemptsResponse> {
  const payload = await requestJson<SubmitQuizAttemptsResponse>(`/quizzes/${quizId}/attempts`, {
    method: 'POST',
    body: { attempts },
  });

  return {
    ...payload,
    modelSource: payload.modelSource === 'cloudrun' ? 'cloudrun' : 'local',
  };
}

export async function getMyProfile(): Promise<User | null> {
  try {
    const payload = await requestJson<UserProfileResponse>('/users/me');
    return normalizeUser(payload);
  } catch (error) {
    const status = parseErrorStatus(error);
    if (status === 404) {
      return null;
    }
    throw error;
  }
}

export async function upsertMyProfile(payload: UpsertProfilePayload): Promise<User> {
  const response = await requestJson<UserProfileResponse>('/users/me/profile', {
    method: 'POST',
    body: payload,
  });
  return normalizeUser(response);
}

export async function translateImage(payload: TranslateImageRequest): Promise<TranslateImageResponse> {
  return requestJson<TranslateImageResponse>('/vision/translate', {
    method: 'POST',
    body: payload,
    timeoutMs: 25000,
  });
}

export async function confirmVisionFlashcards(
  payload: ConfirmVocabRequest
): Promise<{ savedCount: number; flashcards: FlashcardCard[] }> {
  const response = await requestJson<ConfirmVisionFlashcardsResponse>(
    `/vision-results/${encodeURIComponent(payload.visionResultId)}/flashcards`,
    {
      method: 'POST',
      body: { suggestions: payload.suggestions },
    }
  );

  return {
    savedCount: response.savedCount,
    flashcards: normalizeFlashcards({ flashcards: response.flashcards || [] }),
  };
}
