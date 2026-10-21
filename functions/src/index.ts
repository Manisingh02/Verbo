import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

import { translateImagePipeline } from './vision/pipeline';
import {
  ConfirmedVisionFlashcardInput,
  saveConfirmedVisionFlashcards,
  saveVisionTranslationResult,
} from './vision/saveResults';

admin.initializeApp();
const db = admin.firestore();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '12mb' }));

type AuthedRequest = Request & {
  user?: {
    uid: string;
    email?: string;
  };
};

type AdaptiveModelConfig = {
  bias?: number;
  weights?: {
    incorrect?: number;
    responseTimeMs?: number;
    recentAccuracy?: number;
    incorrectRate?: number;
    avgResponseTimeMs?: number;
    responseTimeDeltaMs?: number;
    attemptsSeen?: number;
    wrongStreak?: number;
    correctStreak?: number;
    vocabRankNormalized?: number;
  };
};

type LearningContext = {
  uid: string;
  languageId: string;
  levelId: string;
  nativeLanguage: string;
  targetLanguage: string;
};

type AttemptInput = {
  questionId: string;
  vocabId: string;
  selectedAnswer: string;
  responseTimeMs: number;
};

type AdaptiveStats = {
  timesCorrect: number;
  timesIncorrect: number;
  lastN: number[];
  pCorrect: number;
  avgResponseTimeMs: number;
  responseTimeSamples: number;
  attemptsSeen: number;
  wrongStreak: number;
  correctStreak: number;
  vocabRankNormalized: number;
};

type ScopeState = {
  attemptCount: number;
  adaptiveActive: boolean;
};

type ModelSource = 'local' | 'cloudrun';

type ModelFeatures = {
  uid: string;
  scopeKey: string;
  quizId: string;
  questionId: string;
  vocabId: string;
  responseTimeMs: number;
  avgResponseTimeMs: number;
  responseTimeDeltaMs: number;
  timesCorrect: number;
  timesIncorrect: number;
  attemptsSeen: number;
  wrongStreak: number;
  correctStreak: number;
  vocabRankNormalized: number;
  recentAccuracy: number;
  incorrectRate: number;
};

type QuestionPayload = {
  id: string;
  vocabId: string;
  prompt: string;
  correctAnswer: string;
  distractors: string[];
  questionType: string;
  pCorrect: number;
  pointValue: number;
};

let cachedAdaptiveModel: AdaptiveModelConfig | null | undefined;

const DEFAULT_LANGUAGE_ID = 'english';
const DEFAULT_LEVEL_ID = 'words';
const WARMUP_ATTEMPT_THRESHOLD = 10;
const MAINTENANCE_DAYS = 14;
const BASE_POINTS = 10;
const POINT_MULTIPLIER_CAP = 2.5;
const POINT_MULTIPLIER_SLOPE = 1.5;
const PASS_WEIGHTED_PCT = 85;
const PASS_RAW_PCT = 70;
const DEFAULT_QUIZ_LIMIT = 20;
const MAX_QUIZ_LIMIT = 100;
const DEFAULT_QUIZ_RESPONSE_TIME_MS = 2000;
const RANK_NORMALIZATION_MAX = 1000;

async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer (.+)$/);

  if (!match) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(match[1]);
    (req as AuthedRequest).user = {
      uid: decoded.uid,
      email: decoded.email,
    };
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function serializeTimestamp(value: unknown): string | null {
  if (value instanceof admin.firestore.Timestamp) {
    return value.toDate().toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return null;
}

function parsePositiveInt(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(parsed), max);
}

function normalizeLanguageId(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized === 'en' || normalized === 'english') {
    return 'english';
  }
  if (normalized === 'es' || normalized === 'spanish') {
    return 'spanish';
  }
  return normalized || DEFAULT_LANGUAGE_ID;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeVocabRank(value: unknown): number {
  const rank = Number(value);
  if (!Number.isFinite(rank) || rank <= 0) {
    return 0.5;
  }
  return clamp((rank - 1) / RANK_NORMALIZATION_MAX, 0, 1);
}

function shuffle<T>(values: T[]): T[] {
  const next = [...values];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function resolveTargetTranslationKey(targetLanguage: string): string {
  const normalized = normalizeLanguageId(targetLanguage);
  if (normalized === 'spanish') {
    return 'es';
  }
  if (normalized === 'english') {
    return 'en';
  }
  return normalized;
}

function resolveTextTarget(data: Record<string, unknown>, context: LearningContext): string {
  const directTextTarget = normalizeString(data.textTarget);
  if (directTextTarget) {
    return directTextTarget;
  }

  const translations =
    data.translations && typeof data.translations === 'object'
      ? (data.translations as Record<string, unknown>)
      : {};

  const targetKey = resolveTargetTranslationKey(context.targetLanguage);
  const fromTarget = normalizeString(translations[targetKey]);
  if (fromTarget) {
    return fromTarget;
  }

  if (context.languageId === 'english') {
    return normalizeString(translations.es) || normalizeString(data.textNative);
  }
  if (context.languageId === 'spanish') {
    return normalizeString(translations.en) || normalizeString(data.textNative);
  }
  return normalizeString(data.textNative);
}

function resolveScopeKey(context: LearningContext, quizId: string): string {
  return `${context.languageId}:${context.levelId}:${quizId}`;
}

function loadAdaptiveModel(): AdaptiveModelConfig | null {
  if (cachedAdaptiveModel !== undefined) {
    return cachedAdaptiveModel;
  }

  const candidates = [
    path.join(__dirname, '..', 'models', 'adaptive-model.json'),
    path.join(process.cwd(), 'models', 'adaptive-model.json'),
  ];

  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) {
        continue;
      }
      const raw = fs.readFileSync(filePath, 'utf8');
      cachedAdaptiveModel = JSON.parse(raw) as AdaptiveModelConfig;
      functions.logger.info('Adaptive model loaded', { filePath });
      return cachedAdaptiveModel;
    } catch (error) {
      functions.logger.error('Failed to load adaptive model file', { filePath, error });
    }
  }

  cachedAdaptiveModel = null;
  functions.logger.warn('Adaptive model not found. Falling back to heuristic scoring.');
  return cachedAdaptiveModel;
}

function scoreFromLocalModel(features: ModelFeatures): number {
  const responsePenalty = clamp((features.avgResponseTimeMs - 1800) / 5000, 0, 0.28);
  const responseDeltaPenalty = clamp(features.responseTimeDeltaMs / 5000, -0.06, 0.16);
  const historyPenalty = features.incorrectRate * 0.34;
  const trendPenalty = (1 - features.recentAccuracy) * 0.24;
  const wrongStreakPenalty = clamp(features.wrongStreak / 4, 0, 1) * 0.22;
  const rankPenalty = features.vocabRankNormalized * 0.14;
  const correctStreakBoost = clamp(features.correctStreak / 6, 0, 1) * 0.12;
  const exposureBoost = clamp(features.attemptsSeen / 16, 0, 1) * 0.1;

  const heuristicRisk = clamp(
    0.18 +
      responsePenalty +
      responseDeltaPenalty +
      historyPenalty +
      trendPenalty +
      wrongStreakPenalty +
      rankPenalty -
      correctStreakBoost -
      exposureBoost,
    0.03,
    0.97
  );
  const heuristicScore = clamp(1 - heuristicRisk, 0.01, 0.99);

  const model = loadAdaptiveModel();

  if (model?.weights) {
    const z =
      (model.bias ?? 0) +
      (model.weights.incorrect ?? 0) * features.incorrectRate +
      (model.weights.responseTimeMs ?? 0) * features.responseTimeMs +
      (model.weights.recentAccuracy ?? 0) * features.recentAccuracy +
      (model.weights.incorrectRate ?? 0) * features.incorrectRate +
      (model.weights.avgResponseTimeMs ?? 0) * features.avgResponseTimeMs +
      (model.weights.responseTimeDeltaMs ?? 0) * features.responseTimeDeltaMs +
      (model.weights.attemptsSeen ?? 0) * features.attemptsSeen +
      (model.weights.wrongStreak ?? 0) * features.wrongStreak +
      (model.weights.correctStreak ?? 0) * features.correctStreak +
      (model.weights.vocabRankNormalized ?? 0) * features.vocabRankNormalized;
    const probabilityWrong = 1 / (1 + Math.exp(-z));
    const modelScore = clamp(1 - probabilityWrong, 0, 1);
    const blended = modelScore * 0.65 + heuristicScore * 0.35;
    return Number(clamp(blended, 0.01, 0.99).toFixed(6));
  }

  return Number(heuristicScore.toFixed(6));
}

async function callCloudRunPredict(features: ModelFeatures[]): Promise<number[] | null> {
  const url = normalizeString(process.env.XGB_CLOUD_RUN_URL || '');
  if (!url) {
    return null;
  }

  const timeoutMs = parsePositiveInt(process.env.XGB_CLOUD_RUN_TIMEOUT_MS, 1500, 15000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ features }),
      signal: controller.signal,
    });

    if (!response.ok) {
      functions.logger.warn('Cloud Run model request failed', { status: response.status });
      return null;
    }

    const payload = (await response.json()) as {
      predictions?: unknown;
      pCorrect?: unknown;
    };

    const candidates = payload.predictions ?? payload.pCorrect;
    if (Array.isArray(candidates)) {
      const scores = candidates.map((item) => {
        if (typeof item === 'number') {
          return clamp(item, 0, 1);
        }
        if (item && typeof item === 'object') {
          const p = (item as Record<string, unknown>).pCorrect;
          if (typeof p === 'number') {
            return clamp(p, 0, 1);
          }
        }
        return NaN;
      });

      if (scores.every((score) => Number.isFinite(score)) && scores.length === features.length) {
        return scores;
      }
    }

    return null;
  } catch (error) {
    functions.logger.warn('Cloud Run model call failed, using local fallback', { error });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function predictPCorrectBatch(features: ModelFeatures[]): Promise<{ scores: number[]; modelSource: ModelSource }> {
  const cloudScores = await callCloudRunPredict(features);
  if (cloudScores && cloudScores.length === features.length) {
    return { scores: cloudScores, modelSource: 'cloudrun' };
  }
  const localScores = features.map((feature) => scoreFromLocalModel(feature));
  return { scores: localScores, modelSource: 'local' };
}

function computePointValue(pCorrect: number): number {
  const multiplier = clamp(1 + POINT_MULTIPLIER_SLOPE * (1 - pCorrect), 1, POINT_MULTIPLIER_CAP);
  return Number((BASE_POINTS * multiplier).toFixed(2));
}

function computeRiskBands(pCorrect: number): { dueAt: admin.firestore.Timestamp; priority: number; intervalDays: number; ease: number } {
  const risk = 1 - pCorrect;

  if (pCorrect >= 0.85) {
    const dueDate = new Date(Date.now() + MAINTENANCE_DAYS * 24 * 60 * 60 * 1000);
    return {
      dueAt: admin.firestore.Timestamp.fromDate(dueDate),
      priority: 8,
      intervalDays: MAINTENANCE_DAYS,
      ease: Number((1 - risk).toFixed(4)),
    };
  }

  const intervalHours =
    risk >= 0.8 ? 6 :
    risk >= 0.6 ? 12 :
    risk >= 0.4 ? 24 :
    48;

  return {
    dueAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + intervalHours * 60 * 60 * 1000)),
    priority: Math.round(risk * 100),
    intervalDays: Number((intervalHours / 24).toFixed(2)),
    ease: Number((1 - risk).toFixed(4)),
  };
}

function buildUserResponse(uid: string, data: FirebaseFirestore.DocumentData) {
  const stats = data.stats && typeof data.stats === 'object' ? data.stats : {};
  return {
    uid,
    email: normalizeString(data.email),
    firstName: normalizeString(data.firstName),
    lastName: normalizeString(data.lastName),
    nativeLanguage: normalizeLanguageId(normalizeString(data.nativeLanguage) || 'en'),
    targetLanguage: normalizeLanguageId(normalizeString(data.targetLanguage) || 'english'),
    profilePictureUrl: normalizeString(data.profilePictureUrl) || undefined,
    createdAt: serializeTimestamp(data.createdAt),
    stats: {
      totalXp: typeof stats.totalXp === 'number' ? stats.totalXp : 0,
      streak: typeof stats.streak === 'number' ? stats.streak : 0,
      lastActive: serializeTimestamp(stats.lastActive),
    },
  };
}

async function resolveLearningContext(req: Request, uid: string): Promise<LearningContext> {
  const userRef = db.collection('users').doc(uid);
  const [userSnapshot, activePlanSnapshot] = await Promise.all([
    userRef.get(),
    userRef.collection('learning_plans').doc('active').get(),
  ]);

  const userData = userSnapshot.data() || {};
  const activePlanData = activePlanSnapshot.data() || {};

  const queryLanguage = normalizeString(req.query.languageId);
  const queryLevel = normalizeString(req.query.levelId);

  const languageFromTarget = normalizeLanguageId(
    normalizeString(userData.targetLanguage) || DEFAULT_LANGUAGE_ID
  );
  const languageFromPlan = normalizeLanguageId(
    normalizeString(activePlanData.currentLanguageId) || languageFromTarget
  );

  return {
    uid,
    languageId: normalizeLanguageId(queryLanguage || languageFromPlan || DEFAULT_LANGUAGE_ID),
    levelId: normalizeString(queryLevel || activePlanData.currentLevelId) || DEFAULT_LEVEL_ID,
    nativeLanguage: normalizeLanguageId(normalizeString(userData.nativeLanguage) || 'english'),
    targetLanguage: languageFromTarget,
  };
}

function getLevelRef(languageId: string, levelId: string) {
  return db.collection('languages').doc(languageId).collection('levels').doc(levelId);
}

async function fetchVocabByIds(
  languageId: string,
  levelId: string,
  vocabIds: string[]
): Promise<Map<string, FirebaseFirestore.DocumentData>> {
  const ids = Array.from(new Set(vocabIds.filter((id) => !!id)));
  const docs = await Promise.all(
    ids.map((id) => getLevelRef(languageId, levelId).collection('vocab').doc(id).get())
  );
  const result = new Map<string, FirebaseFirestore.DocumentData>();
  for (const doc of docs) {
    if (doc.exists) {
      result.set(doc.id, doc.data() || {});
    }
  }
  return result;
}

async function fetchUserVocabByIds(
  uid: string,
  vocabIds: string[]
): Promise<Map<string, FirebaseFirestore.DocumentData>> {
  const ids = Array.from(new Set(vocabIds.filter((id) => !!id)));
  const docs = await Promise.all(
    ids.map((id) => db.collection('users').doc(uid).collection('vocab').doc(id).get())
  );
  const result = new Map<string, FirebaseFirestore.DocumentData>();
  for (const doc of docs) {
    if (doc.exists) {
      result.set(doc.id, doc.data() || {});
    }
  }
  return result;
}

async function getScopeState(uid: string, scopeKey: string): Promise<ScopeState> {
  const snapshot = await db.collection('users').doc(uid).collection('adaptive_scope_state').doc(scopeKey).get();
  const data = snapshot.data() || {};
  const attemptCount = typeof data.attemptCount === 'number' ? data.attemptCount : 0;
  return {
    attemptCount,
    adaptiveActive: attemptCount >= WARMUP_ATTEMPT_THRESHOLD + 1,
  };
}

async function incrementScopeAttempts(uid: string, scopeKey: string, incrementBy: number): Promise<ScopeState> {
  const ref = db.collection('users').doc(uid).collection('adaptive_scope_state').doc(scopeKey);
  const next = await db.runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    const data = snap.data() || {};
    const current = typeof data.attemptCount === 'number' ? data.attemptCount : 0;
    const attemptCount = current + Math.max(0, incrementBy);
    const adaptiveActive = attemptCount >= WARMUP_ATTEMPT_THRESHOLD + 1;

    txn.set(
      ref,
      {
        attemptCount,
        adaptiveActive,
        lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { attemptCount, adaptiveActive };
  });

  return next;
}

function getRecentAccuracy(lastN: number[]): number {
  if (lastN.length === 0) {
    return 0.5;
  }
  return lastN.reduce((sum, value) => sum + value, 0) / lastN.length;
}

function getIncorrectRate(timesCorrect: number, timesIncorrect: number): number {
  const total = timesCorrect + timesIncorrect;
  if (total === 0) {
    return 0.5;
  }
  return timesIncorrect / total;
}

async function buildQuestionPayloads(params: {
  uid: string;
  scopeKey: string;
  quizId: string;
  languageId: string;
  levelId: string;
  adaptiveActive: boolean;
  rawQuestions: Array<{ id: string; data: FirebaseFirestore.DocumentData }>;
}): Promise<{ questions: QuestionPayload[]; modelSource: ModelSource }> {
  const { uid, scopeKey, quizId, languageId, levelId, adaptiveActive, rawQuestions } = params;

  const vocabIds = rawQuestions.map((question) => normalizeString(question.data.vocabId) || question.id);
  const vocabMap = await fetchVocabByIds(languageId, levelId, vocabIds);
  const adaptiveSnapshots = await Promise.all(
    rawQuestions.map((question) =>
      db
        .collection('users')
        .doc(uid)
        .collection('adaptive_engine_data')
        .doc(normalizeString(question.data.vocabId) || question.id)
        .get()
    )
  );

  const features: ModelFeatures[] = [];
  const questionOrder: string[] = [];

  rawQuestions.forEach((question, index) => {
    const vocabId = normalizeString(question.data.vocabId) || question.id;
    const adaptiveData = adaptiveSnapshots[index].data() || {};
    const vocabData = vocabMap.get(vocabId) || {};
    const rankValue = question.data.rank ?? vocabData.rank;

    const timesCorrect =
      typeof adaptiveData.timesCorrect === 'number' ? adaptiveData.timesCorrect : 0;
    const timesIncorrect =
      typeof adaptiveData.timesIncorrect === 'number' ? adaptiveData.timesIncorrect : 0;
    const attemptsSeen = timesCorrect + timesIncorrect;
    const lastN = Array.isArray(adaptiveData.lastN)
      ? adaptiveData.lastN.map((item: unknown) => (item === 1 ? 1 : 0)).slice(-20)
      : [];
    const responseTimeSamples =
      typeof adaptiveData.responseTimeSamples === 'number' && adaptiveData.responseTimeSamples >= 0
        ? adaptiveData.responseTimeSamples
        : attemptsSeen;
    const avgResponseTimeMs =
      typeof adaptiveData.avgResponseTimeMs === 'number' && adaptiveData.avgResponseTimeMs > 0
        ? adaptiveData.avgResponseTimeMs
        : DEFAULT_QUIZ_RESPONSE_TIME_MS;
    const effectiveResponseTimeMs = responseTimeSamples > 0 ? avgResponseTimeMs : DEFAULT_QUIZ_RESPONSE_TIME_MS;
    const vocabRankNormalized = normalizeVocabRank(rankValue);
    const wrongStreak =
      typeof adaptiveData.wrongStreak === 'number' && adaptiveData.wrongStreak > 0
        ? adaptiveData.wrongStreak
        : 0;
    const correctStreak =
      typeof adaptiveData.correctStreak === 'number' && adaptiveData.correctStreak > 0
        ? adaptiveData.correctStreak
        : 0;

    features.push({
      uid,
      scopeKey,
      quizId,
      questionId: question.id,
      vocabId,
      responseTimeMs: effectiveResponseTimeMs,
      avgResponseTimeMs: avgResponseTimeMs,
      responseTimeDeltaMs: effectiveResponseTimeMs - avgResponseTimeMs,
      timesCorrect,
      timesIncorrect,
      attemptsSeen,
      wrongStreak,
      correctStreak,
      vocabRankNormalized,
      recentAccuracy: getRecentAccuracy(lastN),
      incorrectRate: getIncorrectRate(timesCorrect, timesIncorrect),
    });

    questionOrder.push(question.id);
  });

  let scores = features.map(() => 0.5);
  let modelSource: ModelSource = 'local';

  if (adaptiveActive && features.length > 0) {
    const predicted = await predictPCorrectBatch(features);
    scores = predicted.scores;
    modelSource = predicted.modelSource;
  }

  const scoreByQuestionId = new Map<string, number>();
  questionOrder.forEach((questionId, index) => {
    scoreByQuestionId.set(questionId, clamp(scores[index] ?? 0.5, 0, 1));
  });

  const questions: QuestionPayload[] = rawQuestions.map((question) => {
    const data = question.data;
    const vocabId = normalizeString(data.vocabId) || question.id;
    const pCorrect = scoreByQuestionId.get(question.id) ?? 0.5;

    return {
      id: question.id,
      vocabId,
      prompt: normalizeString(data.prompt),
      correctAnswer: normalizeString(data.correctAnswer),
      distractors: Array.isArray(data.distractors)
        ? data.distractors.map((item: unknown) => normalizeString(item)).filter(Boolean)
        : [],
      questionType: normalizeString(data.questionType) || 'mcq',
      pCorrect,
      pointValue: computePointValue(pCorrect),
    };
  });

  return { questions, modelSource };
}

function selectAdaptiveQuestions(questions: QuestionPayload[], limit: number, adaptiveActive: boolean): QuestionPayload[] {
  if (questions.length <= limit) {
    return questions;
  }

  if (!adaptiveActive) {
    return shuffle(questions).slice(0, limit);
  }

  const sortedByWeakness = [...questions].sort((a, b) => a.pCorrect - b.pCorrect);
  const weakCount = Math.min(Math.ceil(limit * 0.7), sortedByWeakness.length);

  const weak = sortedByWeakness.slice(0, weakCount);
  const weakIds = new Set(weak.map((item) => item.id));
  const baselinePool = shuffle(sortedByWeakness.filter((item) => !weakIds.has(item.id)));

  const selected: QuestionPayload[] = [];
  const usedVocab = new Set<string>();

  const tryPush = (item: QuestionPayload) => {
    if (selected.length >= limit) return;
    if (usedVocab.has(item.vocabId)) return;
    selected.push(item);
    usedVocab.add(item.vocabId);
  };

  weak.forEach(tryPush);
  baselinePool.forEach(tryPush);

  if (selected.length < limit) {
    const leftovers = shuffle(questions.filter((item) => !selected.find((existing) => existing.id === item.id)));
    leftovers.forEach((item) => {
      if (selected.length < limit) {
        selected.push(item);
      }
    });
  }

  return selected;
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/vision/translate', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as AuthedRequest).user;
    if (!user?.uid) {
      return res.status(401).json({ error: 'Missing authenticated user' });
    }

    const mode = normalizeString(req.body?.mode) || 'ocr';
    const targetLanguage = normalizeString(req.body?.targetLanguage) || 'es';

    const payload = await translateImagePipeline({
      rawText: req.body?.rawText,
      rawLabels: req.body?.rawLabels,
      regions: req.body?.regions,
      boxes: req.body?.boxes,
      mode,
      targetLanguage,
    });

    const context = await resolveLearningContext(req, user.uid);
    const visionResultId = await saveVisionTranslationResult({
      uid: user.uid,
      result: payload,
      languageId: context.languageId,
      levelId: context.levelId,
    });

    return res.json({
      ...payload,
      visionResultId,
    });
  } catch (error) {
    functions.logger.error('Vision translation pipeline failed', { error });
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Vision translation failed',
    });
  }
});

app.post('/vision-results/:visionResultId/flashcards', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as AuthedRequest).user;
    if (!user?.uid) {
      return res.status(401).json({ error: 'Missing authenticated user' });
    }

    const visionResultId = normalizeString(req.params.visionResultId);
    const rawItems: unknown[] = Array.isArray(req.body?.suggestions)
      ? req.body.suggestions
      : [];

    if (!visionResultId) {
      return res.status(400).json({ error: 'Missing visionResultId' });
    }
    if (rawItems.length === 0) {
      return res.status(400).json({ error: 'Select at least one flashcard to save' });
    }

    const items: ConfirmedVisionFlashcardInput[] = rawItems.slice(0, 50).map((item, index) => {
      const record =
        item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      return {
        sourceIndex:
          typeof record.sourceIndex === 'number'
            ? record.sourceIndex
            : typeof record.index === 'number'
              ? record.index
              : index,
        textNative: normalizeString(record.textNative),
        textTarget: normalizeString(record.textTarget),
        type:
          record.type === 'phrase' || record.type === 'objectLabel'
            ? record.type
            : 'word',
      };
    });

    const validItems = items.filter((item) => item.textNative && item.textTarget);
    if (validItems.length === 0) {
      return res.status(400).json({ error: 'Saved flashcards need text on both sides' });
    }

    const context = await resolveLearningContext(req, user.uid);
    const flashcards = await saveConfirmedVisionFlashcards({
      uid: user.uid,
      visionResultId,
      languageId: context.languageId,
      levelId: context.levelId,
      items: validItems,
    });

    return res.json({
      visionResultId,
      savedCount: flashcards.length,
      flashcards,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save flashcards';
    functions.logger.error('Failed to confirm vision flashcards', { error });
    return res.status(message === 'Vision result not found' ? 404 : 500).json({
      error: message,
    });
  }
});

app.get('/users/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as AuthedRequest).user;
    if (!user?.uid) {
      return res.status(401).json({ error: 'Missing authenticated user' });
    }

    const docRef = db.collection('users').doc(user.uid);
    const snapshot = await docRef.get();

    if (!snapshot.exists) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    return res.json({ user: buildUserResponse(user.uid, snapshot.data() || {}) });
  } catch (error) {
    functions.logger.error('Failed to fetch user profile', error);
    return res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

app.post('/users/me/profile', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as AuthedRequest).user;
    if (!user?.uid) {
      return res.status(401).json({ error: 'Missing authenticated user' });
    }

    const firstName = normalizeString(req.body?.firstName);
    const lastName = normalizeString(req.body?.lastName);
    const bodyEmail = normalizeString(req.body?.email);

    const docRef = db.collection('users').doc(user.uid);
    const snapshot = await docRef.get();
    const existing = snapshot.data() || {};
    const stats =
      existing.stats && typeof existing.stats === 'object' ? existing.stats : {};
    const now = admin.firestore.FieldValue.serverTimestamp();
    const resolvedEmail = user.email || bodyEmail || normalizeString(existing.email);

    const profileData: FirebaseFirestore.DocumentData = {
      email: resolvedEmail,
      firstName: firstName || normalizeString(existing.firstName),
      lastName: lastName || normalizeString(existing.lastName),
      nativeLanguage: normalizeLanguageId(normalizeString(existing.nativeLanguage) || 'en'),
      targetLanguage: normalizeLanguageId(normalizeString(existing.targetLanguage) || 'english'),
      profilePictureUrl: normalizeString(existing.profilePictureUrl),
      createdAt: existing.createdAt || now,
      stats: {
        totalXp: typeof stats.totalXp === 'number' ? stats.totalXp : 0,
        streak: typeof stats.streak === 'number' ? stats.streak : 0,
        lastActive: now,
      },
    };

    await docRef.set(profileData, { merge: true });
    const updatedSnapshot = await docRef.get();

    return res.json({
      user: buildUserResponse(user.uid, updatedSnapshot.data() || {}),
    });
  } catch (error) {
    functions.logger.error('Failed to upsert user profile', error);
    return res.status(500).json({ error: 'Failed to upsert user profile' });
  }
});

app.get('/flashcards', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as AuthedRequest).user;
    if (!user?.uid) {
      return res.status(401).json({ error: 'Missing authenticated user' });
    }

    const context = await resolveLearningContext(req, user.uid);
    const limit = parsePositiveInt(req.query.limit, 30, 200);
    const startAfterRank = req.query.startAfterRank;
    const source = normalizeString(req.query.source);

    if (source !== 'system') {
      const orderedUserVocabSnapshot = await db
        .collection('users')
        .doc(user.uid)
        .collection('learning_plans')
        .doc('active')
        .collection('ordered_vocab')
        .orderBy('orderIndex', 'desc')
        .limit(limit)
        .get();

      if (!orderedUserVocabSnapshot.empty) {
        const orderedIds = orderedUserVocabSnapshot.docs.map((doc) => doc.id);
        const userVocabMap = await fetchUserVocabByIds(user.uid, orderedIds);
        const flashcards = orderedIds
          .map((id, index) => {
            const data = userVocabMap.get(id);
            if (!data) {
              return null;
            }
            return {
              id,
              vocabId: id,
              frontText: normalizeString(data.textTarget),
              backText: normalizeString(data.textNative),
              audioUrl: normalizeString(data.audioUrl) || undefined,
              rank: index + 1,
              createdAt: serializeTimestamp(data.createdAt),
            };
          })
          .filter((card): card is NonNullable<typeof card> => !!card);

        if (flashcards.length > 0) {
          return res.json({
            languageId: context.languageId,
            levelId: context.levelId,
            source: 'user',
            flashcards,
          });
        }
      }

      if (source === 'user') {
        return res.json({
          languageId: context.languageId,
          levelId: context.levelId,
          source: 'user',
          flashcards: [],
        });
      }
    }

    let flashcardsQuery = getLevelRef(context.languageId, context.levelId)
      .collection('flashcards')
      .orderBy('rank')
      .limit(limit);

    if (startAfterRank !== undefined) {
      const rank = Number(startAfterRank);
      if (Number.isFinite(rank)) {
        flashcardsQuery = flashcardsQuery.startAfter(rank);
      }
    }

    const flashcardsSnapshot = await flashcardsQuery.get();

    if (!flashcardsSnapshot.empty) {
      const flashcards = flashcardsSnapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          vocabId: normalizeString(data.vocabId) || doc.id,
          frontText: normalizeString(data.frontText),
          backText: normalizeString(data.backText),
          audioUrl: normalizeString(data.audioUrl) || undefined,
          rank: typeof data.rank === 'number' ? data.rank : undefined,
          createdAt: serializeTimestamp(data.createdAt),
        };
      });

      return res.json({
        languageId: context.languageId,
        levelId: context.levelId,
        flashcards,
      });
    }

    let vocabQuery = getLevelRef(context.languageId, context.levelId)
      .collection('vocab')
      .orderBy('rank')
      .limit(limit);

    if (startAfterRank !== undefined) {
      const rank = Number(startAfterRank);
      if (Number.isFinite(rank)) {
        vocabQuery = vocabQuery.startAfter(rank);
      }
    }

    const vocabSnapshot = await vocabQuery.get();
    const vocab = vocabSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        languageId: context.languageId,
        levelId: context.levelId,
        type: normalizeString(data.type) || 'word',
        textNative: normalizeString(data.textNative),
        textTarget: resolveTextTarget(data, context),
        audioUrl: normalizeString(data.audioUrl) || undefined,
        imageUrl: normalizeString(data.imageUrl) || undefined,
        source: normalizeString(data.source) || 'system_default',
        visionResultId: normalizeString(data.visionResultId) || undefined,
        createdAt: serializeTimestamp(data.createdAt),
      };
    });

    return res.json({
      languageId: context.languageId,
      levelId: context.levelId,
      vocab,
    });
  } catch (error) {
    functions.logger.error('Failed to fetch flashcards', error);
    return res.status(500).json({ error: 'Failed to fetch flashcards' });
  }
});

app.get('/review-queue', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as AuthedRequest).user;
    if (!user?.uid) {
      return res.status(401).json({ error: 'Missing authenticated user' });
    }

    const context = await resolveLearningContext(req, user.uid);
    const limit = parsePositiveInt(req.query.limit, 50, 200);

    const reviewSnapshot = await db
      .collection('users')
      .doc(user.uid)
      .collection('learning_plans')
      .doc('active')
      .collection('review_queue')
      .orderBy('priority', 'desc')
      .limit(limit)
      .get();

    const vocabIds = reviewSnapshot.docs.map((doc) => doc.id);
    const vocabMap = await fetchVocabByIds(context.languageId, context.levelId, vocabIds);
    const userVocabMap = await fetchUserVocabByIds(user.uid, vocabIds);

    const reviewQueue = reviewSnapshot.docs.map((doc) => {
      const data = doc.data();
      const vocabData = userVocabMap.get(doc.id) || vocabMap.get(doc.id);
      return {
        vocabId: doc.id,
        dueAt: serializeTimestamp(data.dueAt),
        priority: typeof data.priority === 'number' ? data.priority : 0,
        intervalDays: typeof data.intervalDays === 'number' ? data.intervalDays : undefined,
        ease: typeof data.ease === 'number' ? data.ease : undefined,
        updatedAt: serializeTimestamp(data.updatedAt),
        vocab: vocabData
          ? {
              id: doc.id,
              languageId: context.languageId,
              levelId: context.levelId,
              type: normalizeString(vocabData.type) || 'word',
              textNative: normalizeString(vocabData.textNative),
              textTarget: resolveTextTarget(vocabData, context),
              audioUrl: normalizeString(vocabData.audioUrl) || undefined,
              imageUrl: normalizeString(vocabData.imageUrl) || undefined,
              source: normalizeString(vocabData.source) || 'system_default',
              visionResultId: normalizeString(vocabData.visionResultId) || undefined,
              createdAt: serializeTimestamp(vocabData.createdAt),
            }
          : undefined,
      };
    });

    return res.json({
      languageId: context.languageId,
      levelId: context.levelId,
      reviewQueue,
    });
  } catch (error) {
    functions.logger.error('Failed to fetch review queue', error);
    return res.status(500).json({ error: 'Failed to fetch review queue' });
  }
});

app.get('/quizzes', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as AuthedRequest).user;
    if (!user?.uid) {
      return res.status(401).json({ error: 'Missing authenticated user' });
    }

    const context = await resolveLearningContext(req, user.uid);
    const limit = parsePositiveInt(req.query.limit, 20, 100);

    const quizzesSnapshot = await getLevelRef(context.languageId, context.levelId)
      .collection('quizzes')
      .limit(limit)
      .get();

    const quizzes = quizzesSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        title: normalizeString(data.title) || 'Untitled Quiz',
        type: normalizeString(data.type) || 'multiple-choice',
        createdAt: serializeTimestamp(data.createdAt),
      };
    });

    return res.json({
      languageId: context.languageId,
      levelId: context.levelId,
      quizzes,
    });
  } catch (error) {
    functions.logger.error('Failed to fetch quizzes', error);
    return res.status(500).json({ error: 'Failed to fetch quizzes' });
  }
});

app.get('/quizzes/:quizId/questions', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as AuthedRequest).user;
    if (!user?.uid) {
      return res.status(401).json({ error: 'Missing authenticated user' });
    }

    const context = await resolveLearningContext(req, user.uid);
    const quizId = normalizeString(req.params.quizId);
    const limit = parsePositiveInt(req.query.limit, DEFAULT_QUIZ_LIMIT, MAX_QUIZ_LIMIT);

    if (!quizId) {
      return res.status(400).json({ error: 'Missing quizId' });
    }

    const quizRef = getLevelRef(context.languageId, context.levelId)
      .collection('quizzes')
      .doc(quizId);

    const [quizSnapshot, questionsSnapshot] = await Promise.all([
      quizRef.get(),
      quizRef.collection('questions').limit(MAX_QUIZ_LIMIT).get(),
    ]);

    if (!quizSnapshot.exists) {
      return res.status(404).json({ error: 'Quiz not found' });
    }

    const scopeKey = resolveScopeKey(context, quizId);
    const scopeState = await getScopeState(user.uid, scopeKey);

    const rawQuestions = questionsSnapshot.docs.map((doc) => ({
      id: doc.id,
      data: doc.data(),
    }));

    const built = await buildQuestionPayloads({
      uid: user.uid,
      scopeKey,
      quizId,
      languageId: context.languageId,
      levelId: context.levelId,
      adaptiveActive: scopeState.adaptiveActive,
      rawQuestions,
    });

    const selected = selectAdaptiveQuestions(
      built.questions,
      limit,
      scopeState.adaptiveActive
    );

    const quizData = quizSnapshot.data() || {};

    return res.json({
      languageId: context.languageId,
      levelId: context.levelId,
      adaptiveActive: scopeState.adaptiveActive,
      scopeAttemptCount: scopeState.attemptCount,
      modelSource: built.modelSource,
      quiz: {
        id: quizSnapshot.id,
        title: normalizeString(quizData.title) || 'Untitled Quiz',
        type: normalizeString(quizData.type) || 'multiple-choice',
        createdAt: serializeTimestamp(quizData.createdAt),
      },
      questions: selected,
    });
  } catch (error) {
    functions.logger.error('Failed to fetch quiz questions', error);
    return res.status(500).json({ error: 'Failed to fetch quiz questions' });
  }
});

app.post('/quizzes/:quizId/session', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as AuthedRequest).user;
    if (!user?.uid) {
      return res.status(401).json({ error: 'Missing authenticated user' });
    }

    const context = await resolveLearningContext(req, user.uid);
    const quizId = normalizeString(req.params.quizId);
    const limit = parsePositiveInt(req.body?.limit, DEFAULT_QUIZ_LIMIT, MAX_QUIZ_LIMIT);

    if (!quizId) {
      return res.status(400).json({ error: 'Missing quizId' });
    }

    const quizRef = getLevelRef(context.languageId, context.levelId)
      .collection('quizzes')
      .doc(quizId);

    const [quizSnapshot, questionsSnapshot] = await Promise.all([
      quizRef.get(),
      quizRef.collection('questions').limit(MAX_QUIZ_LIMIT).get(),
    ]);

    if (!quizSnapshot.exists) {
      return res.status(404).json({ error: 'Quiz not found' });
    }

    const scopeKey = resolveScopeKey(context, quizId);
    const scopeState = await getScopeState(user.uid, scopeKey);

    const rawQuestions = questionsSnapshot.docs.map((doc) => ({
      id: doc.id,
      data: doc.data(),
    }));

    const built = await buildQuestionPayloads({
      uid: user.uid,
      scopeKey,
      quizId,
      languageId: context.languageId,
      levelId: context.levelId,
      adaptiveActive: scopeState.adaptiveActive,
      rawQuestions,
    });

    const selected = selectAdaptiveQuestions(
      built.questions,
      limit,
      scopeState.adaptiveActive
    );

    return res.json({
      languageId: context.languageId,
      levelId: context.levelId,
      adaptiveActive: scopeState.adaptiveActive,
      scopeAttemptCount: scopeState.attemptCount,
      modelSource: built.modelSource,
      quizId,
      questions: selected,
    });
  } catch (error) {
    functions.logger.error('Failed to build quiz session', error);
    return res.status(500).json({ error: 'Failed to build quiz session' });
  }
});

app.post('/quizzes/:quizId/attempts', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as AuthedRequest).user;
    if (!user?.uid) {
      return res.status(401).json({ error: 'Missing authenticated user' });
    }

    const quizId = normalizeString(req.params.quizId);
    if (!quizId) {
      return res.status(400).json({ error: 'Missing quizId' });
    }

    const attemptsRaw = req.body?.attempts;
    if (!Array.isArray(attemptsRaw) || attemptsRaw.length === 0) {
      return res.status(400).json({ error: 'attempts must be a non-empty array' });
    }

    const attempts: AttemptInput[] = attemptsRaw
      .map((attempt: unknown) => {
        const source = attempt as Record<string, unknown>;
        return {
          questionId: normalizeString(source.questionId),
          vocabId: normalizeString(source.vocabId),
          selectedAnswer: normalizeString(source.selectedAnswer),
          responseTimeMs: Number(source.responseTimeMs),
        };
      })
      .filter((attempt) =>
        !!attempt.questionId &&
        !!attempt.vocabId &&
        !!attempt.selectedAnswer &&
        Number.isFinite(attempt.responseTimeMs) &&
        attempt.responseTimeMs >= 0
      );

    if (attempts.length === 0) {
      return res.status(400).json({ error: 'No valid attempts were provided' });
    }

    const context = await resolveLearningContext(req, user.uid);
    const quizRef = getLevelRef(context.languageId, context.levelId)
      .collection('quizzes')
      .doc(quizId);

    const quizSnapshot = await quizRef.get();
    if (!quizSnapshot.exists) {
      return res.status(404).json({ error: 'Quiz not found' });
    }

    const attemptEvaluations = await Promise.all(
      attempts.map(async (attempt) => {
        const questionSnapshot = await quizRef.collection('questions').doc(attempt.questionId).get();
        const questionData = questionSnapshot.data() || {};
        const resolvedVocabId = normalizeString(questionData.vocabId) || attempt.vocabId || attempt.questionId;
        const correctAnswer = normalizeString(questionData.correctAnswer);
        const isCorrect =
          correctAnswer.length > 0 &&
          normalizeString(attempt.selectedAnswer).toLowerCase() === correctAnswer.toLowerCase();

        return {
          ...attempt,
          vocabId: resolvedVocabId,
          isCorrect,
          questionExists: questionSnapshot.exists,
          questionRank: questionData.rank,
        };
      })
    );

    const validEvaluations = attemptEvaluations.filter((evaluation) => evaluation.questionExists);
    if (validEvaluations.length === 0) {
      return res.status(400).json({ error: 'None of the submitted questions exist for this quiz' });
    }
    const vocabMap = await fetchVocabByIds(
      context.languageId,
      context.levelId,
      validEvaluations.map((evaluation) => evaluation.vocabId)
    );

    const scopeKey = resolveScopeKey(context, quizId);
    const scopeState = await incrementScopeAttempts(user.uid, scopeKey, validEvaluations.length);

    const nowTimestamp = admin.firestore.Timestamp.now();
    const nowFieldValue = admin.firestore.FieldValue.serverTimestamp();

    const quizAttemptRef = db
      .collection('users')
      .doc(user.uid)
      .collection('quiz_attempts')
      .doc();

    const questionAttemptsCollection = quizAttemptRef.collection('question_attempts');

    const enrichedStatsByIndex: AdaptiveStats[] = [];

    for (const evaluation of validEvaluations) {
      const adaptiveRef = db
        .collection('users')
        .doc(user.uid)
        .collection('adaptive_engine_data')
        .doc(evaluation.vocabId);

      const adaptiveSnapshot = await adaptiveRef.get();
      const adaptiveData = adaptiveSnapshot.data() || {};

      const prevTimesCorrect = typeof adaptiveData.timesCorrect === 'number' ? adaptiveData.timesCorrect : 0;
      const prevTimesIncorrect = typeof adaptiveData.timesIncorrect === 'number' ? adaptiveData.timesIncorrect : 0;
      const prevLastN = Array.isArray(adaptiveData.lastN)
        ? adaptiveData.lastN.map((value: unknown) => (value === 1 ? 1 : 0)).slice(-19)
        : [];
      const prevResponseTimeSamples =
        typeof adaptiveData.responseTimeSamples === 'number' && adaptiveData.responseTimeSamples >= 0
          ? adaptiveData.responseTimeSamples
          : prevTimesCorrect + prevTimesIncorrect;
      const prevAvgResponseTimeMs =
        typeof adaptiveData.avgResponseTimeMs === 'number' && adaptiveData.avgResponseTimeMs > 0
          ? adaptiveData.avgResponseTimeMs
          : DEFAULT_QUIZ_RESPONSE_TIME_MS;
      const prevWrongStreak =
        typeof adaptiveData.wrongStreak === 'number' && adaptiveData.wrongStreak > 0
          ? adaptiveData.wrongStreak
          : 0;
      const prevCorrectStreak =
        typeof adaptiveData.correctStreak === 'number' && adaptiveData.correctStreak > 0
          ? adaptiveData.correctStreak
          : 0;
      const vocabData = vocabMap.get(evaluation.vocabId) || {};
      const vocabRankNormalized = normalizeVocabRank(evaluation.questionRank ?? vocabData.rank);

      const timesCorrect = prevTimesCorrect + (evaluation.isCorrect ? 1 : 0);
      const timesIncorrect = prevTimesIncorrect + (evaluation.isCorrect ? 0 : 1);
      const lastN = [...prevLastN, evaluation.isCorrect ? 1 : 0];
      const responseTimeSamples = prevResponseTimeSamples + 1;
      const avgResponseTimeMs =
        responseTimeSamples > 0
          ? Number(
              (
                (prevAvgResponseTimeMs * prevResponseTimeSamples + evaluation.responseTimeMs) /
                responseTimeSamples
              ).toFixed(2)
            )
          : evaluation.responseTimeMs;
      const wrongStreak = evaluation.isCorrect ? 0 : prevWrongStreak + 1;
      const correctStreak = evaluation.isCorrect ? prevCorrectStreak + 1 : 0;
      const attemptsSeen = timesCorrect + timesIncorrect;

      enrichedStatsByIndex.push({
        timesCorrect,
        timesIncorrect,
        lastN,
        pCorrect: typeof adaptiveData.pCorrect === 'number' ? clamp(adaptiveData.pCorrect, 0, 1) : 0.5,
        avgResponseTimeMs,
        responseTimeSamples,
        attemptsSeen,
        wrongStreak,
        correctStreak,
        vocabRankNormalized,
      });
    }

    const features: ModelFeatures[] = validEvaluations.map((evaluation, index) => {
      const stats = enrichedStatsByIndex[index];
      return {
        uid: user.uid,
        scopeKey,
        quizId,
        questionId: evaluation.questionId,
        vocabId: evaluation.vocabId,
        responseTimeMs: evaluation.responseTimeMs,
        avgResponseTimeMs: stats.avgResponseTimeMs,
        responseTimeDeltaMs: evaluation.responseTimeMs - stats.avgResponseTimeMs,
        timesCorrect: stats.timesCorrect,
        timesIncorrect: stats.timesIncorrect,
        attemptsSeen: stats.attemptsSeen,
        wrongStreak: stats.wrongStreak,
        correctStreak: stats.correctStreak,
        vocabRankNormalized: stats.vocabRankNormalized,
        recentAccuracy: getRecentAccuracy(stats.lastN),
        incorrectRate: getIncorrectRate(stats.timesCorrect, stats.timesIncorrect),
      };
    });

    let modelSource: ModelSource = 'local';
    let predictedPCorrect = features.map(() => 0.5);

    if (scopeState.adaptiveActive) {
      const prediction = await predictPCorrectBatch(features);
      predictedPCorrect = prediction.scores;
      modelSource = prediction.modelSource;
    }

    let correctCount = 0;
    let earnedPoints = 0;
    let maxPoints = 0;

    for (let i = 0; i < validEvaluations.length; i += 1) {
      const evaluation = validEvaluations[i];
      const stats = enrichedStatsByIndex[i];
      const pCorrect = scopeState.adaptiveActive ? clamp(predictedPCorrect[i] ?? 0.5, 0, 1) : 0.5;
      const pointValue = scopeState.adaptiveActive ? computePointValue(pCorrect) : BASE_POINTS;

      maxPoints += pointValue;
      if (evaluation.isCorrect) {
        correctCount += 1;
        earnedPoints += pointValue;
      }

      await questionAttemptsCollection.doc().set({
        userId: user.uid,
        questionId: evaluation.questionId,
        vocabId: evaluation.vocabId,
        correct: evaluation.isCorrect,
        responseTimeMs: evaluation.responseTimeMs,
        avgResponseTimeMs: stats.avgResponseTimeMs,
        attemptsSeen: stats.attemptsSeen,
        wrongStreak: stats.wrongStreak,
        attemptTime: nowFieldValue,
        pointValue,
        pCorrect,
      });

      const adaptiveRef = db
        .collection('users')
        .doc(user.uid)
        .collection('adaptive_engine_data')
        .doc(evaluation.vocabId);

      const difficultyScore = Number((1 - pCorrect).toFixed(6));
      const risk = computeRiskBands(pCorrect);

      await adaptiveRef.set(
        {
          vocabId: evaluation.vocabId,
          pCorrect,
          difficultyScore,
          timesCorrect: stats.timesCorrect,
          timesIncorrect: stats.timesIncorrect,
          attemptsSeen: stats.attemptsSeen,
          avgResponseTimeMs: stats.avgResponseTimeMs,
          responseTimeSamples: stats.responseTimeSamples,
          wrongStreak: stats.wrongStreak,
          correctStreak: stats.correctStreak,
          vocabRankNormalized: stats.vocabRankNormalized,
          lastResponseTimeMs: evaluation.responseTimeMs,
          lastSeen: nowFieldValue,
          lastN: stats.lastN,
        },
        { merge: true }
      );

      await db
        .collection('users')
        .doc(user.uid)
        .collection('learning_plans')
        .doc('active')
        .collection('review_queue')
        .doc(evaluation.vocabId)
        .set(
          {
            dueAt: risk.dueAt,
            priority: risk.priority,
            updatedAt: nowFieldValue,
            intervalDays: risk.intervalDays,
            ease: risk.ease,
          },
          { merge: true }
        );
    }

    const totalQuestions = validEvaluations.length;
    const rawPct = Number(((correctCount / Math.max(totalQuestions, 1)) * 100).toFixed(2));
    const weightedPct = Number(((earnedPoints / Math.max(maxPoints, 1)) * 100).toFixed(2));
    const passed = weightedPct >= PASS_WEIGHTED_PCT && rawPct >= PASS_RAW_PCT;

    await quizAttemptRef.set({
      languageId: context.languageId,
      levelId: context.levelId,
      quizId,
      score: correctCount,
      totalQuestions,
      rawPct,
      weightedPct,
      passed,
      adaptiveActive: scopeState.adaptiveActive,
      scopeKey,
      scopeAttemptCount: scopeState.attemptCount,
      completedAt: nowTimestamp,
    });

    return res.json({
      quizAttemptId: quizAttemptRef.id,
      score: correctCount,
      totalQuestions,
      rawPct,
      weightedPct,
      passed,
      adaptiveActive: scopeState.adaptiveActive,
      scopeAttemptCount: scopeState.attemptCount,
      modelSource,
    });
  } catch (error) {
    functions.logger.error('Failed to submit quiz attempts', error);
    return res.status(500).json({ error: 'Failed to submit quiz attempts' });
  }
});

export const api = functions.https.onRequest(app);
