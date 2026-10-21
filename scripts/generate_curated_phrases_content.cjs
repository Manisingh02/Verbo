
const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');

process.env.GOOGLE_CLOUD_DISABLE_GRPC = process.env.GOOGLE_CLOUD_DISABLE_GRPC || 'true';
process.env.NO_GCE_CHECK = process.env.NO_GCE_CHECK || 'true';

const admin = require('firebase-admin');

const SERVICE_ACCOUNT_PATH = path.resolve(process.cwd(), 'scripts/serviceAccountKey.json');

const DEFAULT_LANGUAGE = 'both';
const DEFAULT_LEVEL = 'phrases';
const DEFAULT_VOCAB_LIMIT = 200;
const DEFAULT_NUM_QUIZZES_PER_TYPE = 5;
const DEFAULT_QUIZ_SIZE = 10;
const DEFAULT_SEED = 42;
const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_RETRY_ATTEMPTS = 6;

const BASE_RETRY_DELAY_MS = 500;
const COMMIT_TIMEOUT_MS = 45_000;

const QUIZ_TYPE_ORDER = [
  {
    type: 'translation',
    titlePrefix: 'Translation Quiz',
  },
  {
    type: 'reverse_translation',
    titlePrefix: 'Reverse Translation Quiz',
  },
  {
    type: 'fill_in_blank',
    titlePrefix: 'Fill in the Blank Quiz',
  },
];

const EN_FUNCTION_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'if',
  'then',
  'than',
  'so',
  'to',
  'of',
  'in',
  'on',
  'at',
  'for',
  'from',
  'by',
  'with',
  'about',
  'into',
  'through',
  'during',
  'before',
  'after',
  'above',
  'below',
  'up',
  'down',
  'out',
  'off',
  'over',
  'under',
  'again',
  'further',
  'once',
  'is',
  'am',
  'are',
  'was',
  'were',
  'be',
  'being',
  'been',
  'do',
  'does',
  'did',
  'have',
  'has',
  'had',
  'i',
  'you',
  'he',
  'she',
  'it',
  'we',
  'they',
  'me',
  'him',
  'her',
  'us',
  'them',
  'my',
  'your',
  'his',
  'its',
  'our',
  'their',
  'mine',
  'yours',
  'hers',
  'ours',
  'theirs',
  'this',
  'that',
  'these',
  'those',
  'who',
  'whom',
  'whose',
  'which',
  'what',
  'when',
  'where',
  'why',
  'how',
  'not',
  'no',
  'yes',
  'can',
  'could',
  'should',
  'would',
  'will',
  'shall',
  'may',
  'might',
  'must',
]);

const ES_FUNCTION_WORDS = new Set([
  'a',
  'al',
  'el',
  'la',
  'los',
  'las',
  'un',
  'una',
  'unos',
  'unas',
  'de',
  'del',
  'y',
  'e',
  'o',
  'u',
  'pero',
  'si',
  'que',
  'como',
  'cuando',
  'donde',
  'porque',
  'por',
  'para',
  'con',
  'sin',
  'en',
  'sobre',
  'entre',
  'hacia',
  'hasta',
  'desde',
  'durante',
  'antes',
  'despues',
  'arriba',
  'abajo',
  'yo',
  'tu',
  'el',
  'ella',
  'nosotros',
  'nosotras',
  'vosotros',
  'vosotras',
  'ellos',
  'ellas',
  'me',
  'te',
  'se',
  'nos',
  'os',
  'mi',
  'mis',
  'tu',
  'tus',
  'su',
  'sus',
  'nuestro',
  'nuestra',
  'nuestros',
  'nuestras',
  'vuestro',
  'vuestra',
  'vuestros',
  'vuestras',
  'este',
  'esta',
  'estos',
  'estas',
  'ese',
  'esa',
  'esos',
  'esas',
  'aquel',
  'aquella',
  'aquellos',
  'aquellas',
  'es',
  'soy',
  'eres',
  'somos',
  'son',
  'fue',
  'fui',
  'ser',
  'estar',
  'esta',
  'estan',
  'estoy',
  'estas',
  'estaba',
  'estaban',
  'hay',
  'haber',
  'he',
  'has',
  'ha',
  'hemos',
  'han',
  'no',
  'si',
]);

function parsePositiveInt(value, flagName, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${flagName} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function parseArgs(argv) {
  const flags = {
    language: DEFAULT_LANGUAGE,
    level: DEFAULT_LEVEL,
    vocabLimit: DEFAULT_VOCAB_LIMIT,
    numQuizzesPerType: DEFAULT_NUM_QUIZZES_PER_TYPE,
    quizSize: DEFAULT_QUIZ_SIZE,
    dryRun: false,
    seed: DEFAULT_SEED,
    overwrite: false,
    batchSize: DEFAULT_BATCH_SIZE,
    retryAttempts: DEFAULT_RETRY_ATTEMPTS,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--dry-run') {
      flags.dryRun = true;
      continue;
    }

    if (arg === '--overwrite') {
      flags.overwrite = true;
      continue;
    }

    if (arg === '--language') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --language');
      }
      const normalized = value.trim().toLowerCase();
      if (!['english', 'spanish', 'both'].includes(normalized)) {
        throw new Error('--language must be one of: english, spanish, both');
      }
      flags.language = normalized;
      i += 1;
      continue;
    }

    if (arg === '--level') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --level');
      }
      const normalized = value.trim();
      if (!normalized) {
        throw new Error('--level cannot be empty');
      }
      flags.level = normalized;
      i += 1;
      continue;
    }

    if (arg === '--vocabLimit') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --vocabLimit');
      }
      flags.vocabLimit = parsePositiveInt(value, '--vocabLimit', { min: 0 });
      i += 1;
      continue;
    }

    if (arg === '--numQuizzesPerType') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --numQuizzesPerType');
      }
      flags.numQuizzesPerType = parsePositiveInt(value, '--numQuizzesPerType', { min: 0 });
      i += 1;
      continue;
    }

    if (arg === '--quizSize') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --quizSize');
      }
      flags.quizSize = parsePositiveInt(value, '--quizSize', { min: 0 });
      i += 1;
      continue;
    }

    if (arg === '--seed') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --seed');
      }
      flags.seed = parsePositiveInt(value, '--seed', { min: 0, max: 4_294_967_295 });
      i += 1;
      continue;
    }

    if (arg === '--batchSize') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --batchSize');
      }
      flags.batchSize = parsePositiveInt(value, '--batchSize', { min: 1, max: 200 });
      i += 1;
      continue;
    }

    if (arg === '--retryAttempts') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --retryAttempts');
      }
      flags.retryAttempts = parsePositiveInt(value, '--retryAttempts', { min: 1, max: 20 });
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return flags;
}

function ensureFileExists(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required ${label}: ${filePath}`);
  }
}

function readServiceAccount(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in service account key: ${filePath}`);
  }

  if (!json.project_id || !json.client_email || !json.private_key) {
    throw new Error(
      `Service account missing project_id/client_email/private_key: ${filePath}`
    );
  }

  return json;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientError(error) {
  const tokens = [
    'ETIMEDOUT',
    'ECONNRESET',
    'EAI_AGAIN',
    'DEADLINE_EXCEEDED',
    'UNAVAILABLE',
  ];

  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '').toUpperCase();

  return tokens.some((token) => code.includes(token) || message.includes(token));
}

async function commitChunkWithRetry({
  db,
  ops,
  languageLabel,
  phaseLabel,
  batchNumber,
  totalBatches,
  retryAttempts,
}) {
  for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
    console.log(
      `[phrases] ${languageLabel} ${phaseLabel} batch ${batchNumber}/${totalBatches} attempt ${attempt}/${retryAttempts} committing ${ops.length} ops...`
    );

    const batch = db.batch();
    for (const op of ops) {
      if (op.kind === 'delete') {
        batch.delete(op.docRef);
      } else {
        batch.set(op.docRef, op.data, { merge: true });
      }
    }

    let timeoutId;
    try {
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          const timeoutError = new Error(
            `Batch commit timed out after ${COMMIT_TIMEOUT_MS}ms (${languageLabel} ${phaseLabel} batch ${batchNumber}/${totalBatches})`
          );
          timeoutError.code = 'ETIMEDOUT';
          reject(timeoutError);
        }, COMMIT_TIMEOUT_MS);
      });

      await Promise.race([batch.commit(), timeoutPromise]);
      clearTimeout(timeoutId);
      console.log(
        `[phrases] ${languageLabel} ${phaseLabel} batch ${batchNumber}/${totalBatches} committed`
      );
      return;
    } catch (error) {
      clearTimeout(timeoutId);
      const canRetry = isTransientError(error) && attempt < retryAttempts;
      if (!canRetry) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Failed ${languageLabel} ${phaseLabel} batch ${batchNumber}/${totalBatches} attempt ${attempt}/${retryAttempts}: ${message}`
        );
      }

      const delayMs = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
      console.log(
        `[phrases] ${languageLabel} ${phaseLabel} batch ${batchNumber}/${totalBatches} attempt ${attempt}/${retryAttempts} failed; retrying in ${delayMs}ms`
      );
      await sleep(delayMs);
    }
  }

  throw new Error(
    `Retry attempts exhausted for ${languageLabel} ${phaseLabel} batch ${batchNumber}/${totalBatches}`
  );
}

async function applyOpsInBatches({
  db,
  ops,
  dryRun,
  batchSize,
  retryAttempts,
  languageLabel,
  phaseLabel,
}) {
  if (dryRun || ops.length === 0) {
    return;
  }

  const totalBatches = Math.ceil(ops.length / batchSize);
  for (let start = 0; start < ops.length; start += batchSize) {
    const batchNumber = Math.floor(start / batchSize) + 1;
    const chunk = ops.slice(start, start + batchSize);
    await commitChunkWithRetry({
      db,
      ops: chunk,
      languageLabel,
      phaseLabel,
      batchNumber,
      totalBatches,
      retryAttempts,
    });
  }
}

function createRng(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function hashString(input) {
  let hash = 2_166_136_261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function shuffleInPlace(array, rng) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function stripAccents(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeLookupWord(word) {
  return stripAccents(String(word || '').toLowerCase()).replace(/[^a-z]/g, '');
}

function buildUniquePool(values) {
  const seen = new Set();
  const output = [];

  for (const raw of values) {
    const value = normalizeText(raw);
    if (!value) {
      continue;
    }

    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(value);
  }

  return output;
}

function languageConfig(languageId) {
  if (languageId === 'english') {
    return {
      languageId: 'english',
      nativeIso: 'en',
      targetIso: 'es',
      translationPrompt: (textNative) => `Translate to Spanish: ${textNative}`,
      reversePrompt: (textTarget) => `Which English phrase means: ${textTarget}?`,
    };
  }

  if (languageId === 'spanish') {
    return {
      languageId: 'spanish',
      nativeIso: 'es',
      targetIso: 'en',
      translationPrompt: (textNative) => `Translate to English: ${textNative}`,
      reversePrompt: (textTarget) => `¿Qué frase en español significa: ${textTarget}?`,
    };
  }

  throw new Error(`Unsupported language: ${languageId}`);
}

function extractWordMatches(text) {
  const matches = [];
  const regex = /\p{L}+(?:['’]\p{L}+)?/gu;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const word = match[0];
    const start = match.index;
    const end = start + word.length;
    const lookup = normalizeLookupWord(word);

    matches.push({
      word,
      start,
      end,
      lookup,
    });
  }

  return matches;
}

function isFunctionWord(lookupWord, nativeIso) {
  if (!lookupWord) {
    return true;
  }

  if (nativeIso === 'es') {
    return ES_FUNCTION_WORDS.has(lookupWord);
  }

  return EN_FUNCTION_WORDS.has(lookupWord);
}

function buildFillInBlankCandidate(textNative, nativeIso) {
  const text = normalizeText(textNative);
  if (!text) {
    return null;
  }

  const words = extractWordMatches(text);
  if (words.length < 2) {
    return null;
  }

  let candidates = words.filter(
    (word, index) => index > 0 && word.lookup.length >= 3 && !isFunctionWord(word.lookup, nativeIso)
  );

  if (candidates.length === 0) {
    candidates = words.filter(
      (word, index) => index > 0 && word.lookup.length >= 4 && !isFunctionWord(word.lookup, nativeIso)
    );
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => b.lookup.length - a.lookup.length || a.start - b.start);
  const selected = candidates[0];

  const prompt = `${text.slice(0, selected.start)}_____${text.slice(selected.end)}`;
  if (!prompt.includes('_____')) {
    return null;
  }

  if (prompt.trim() === '_____') {
    return null;
  }

  return {
    prompt,
    correctAnswer: selected.word,
    correctLookup: selected.lookup,
  };
}

function buildWordPoolFromNativeText(usableVocab, nativeIso) {
  const words = [];

  for (const vocab of usableVocab) {
    const matches = extractWordMatches(vocab.textNative);
    for (const match of matches) {
      if (match.lookup.length < 3) {
        continue;
      }
      if (isFunctionWord(match.lookup, nativeIso)) {
        continue;
      }
      words.push(match.word);
    }
  }

  return buildUniquePool(words);
}

async function readVocabRows({ db, languageCfg, level, vocabLimit }) {
  let query = db
    .collection('languages')
    .doc(languageCfg.languageId)
    .collection('levels')
    .doc(level)
    .collection('vocab')
    .orderBy('rank', 'asc');

  if (vocabLimit > 0) {
    query = query.limit(vocabLimit);
  }

  const snapshot = await query.get();

  const usable = [];
  const stats = {
    vocabRead: 0,
    usableVocab: 0,
    missingTranslationSkipped: 0,
  };

  for (let i = 0; i < snapshot.docs.length; i += 1) {
    const docSnap = snapshot.docs[i];
    const data = docSnap.data() || {};

    stats.vocabRead += 1;

    const textNative = normalizeText(data.textNative);
    if (!textNative) {
      continue;
    }

    const translations =
      data.translations && typeof data.translations === 'object' && !Array.isArray(data.translations)
        ? data.translations
        : {};

    const textTarget = normalizeText(translations[languageCfg.targetIso]);
    if (!textTarget) {
      stats.missingTranslationSkipped += 1;
      continue;
    }

    const rankParsed = Number.parseInt(String(data.rank ?? ''), 10);
    const rank = Number.isInteger(rankParsed) ? rankParsed : i + 1;

    usable.push({
      vocabId: docSnap.id,
      textNative,
      textTarget,
      rank,
      nativeIso: languageCfg.nativeIso,
    });
  }

  stats.usableVocab = usable.length;
  return { usable, stats };
}

function createCyclingIndexSource(length, rng) {
  if (length === 0) {
    return () => null;
  }

  let cycle = [];
  let cursor = 0;

  const refill = () => {
    cycle = [];
    for (let i = 0; i < length; i += 1) {
      cycle.push(i);
    }
    shuffleInPlace(cycle, rng);
    cursor = 0;
  };

  refill();

  return () => {
    if (cursor >= cycle.length) {
      refill();
    }
    const value = cycle[cursor];
    cursor += 1;
    return value;
  };
}

function pickDistractors({ primaryPool, fallbackPool = [], correctAnswer, count, rng }) {
  const correct = normalizeText(correctAnswer).toLowerCase();
  const chosen = [];
  const seen = new Set([correct]);

  const tryPool = (pool) => {
    if (chosen.length >= count) {
      return;
    }

    const shuffled = pool.slice();
    shuffleInPlace(shuffled, rng);

    for (const value of shuffled) {
      const next = normalizeText(value);
      if (!next) {
        continue;
      }

      const key = next.toLowerCase();
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      chosen.push(next);
      if (chosen.length >= count) {
        return;
      }
    }
  };

  tryPool(primaryPool);
  if (chosen.length < count) {
    tryPool(fallbackPool);
  }

  return chosen.length >= count ? chosen.slice(0, count) : null;
}

function buildQuizDocs({ db, languageId, level, numQuizzesPerType, quizSize, vocabLimitUsed }) {
  const levelRef = db
    .collection('languages')
    .doc(languageId)
    .collection('levels')
    .doc(level);

  const quizzesCol = levelRef.collection('quizzes');
  const quizzes = [];

  let orderIndex = 1;
  for (const quizType of QUIZ_TYPE_ORDER) {
    for (let i = 1; i <= numQuizzesPerType; i += 1) {
      const quizId = `${quizType.type}_q${i}`;
      quizzes.push({
        id: quizId,
        quizType: quizType.type,
        docRef: quizzesCol.doc(quizId),
        data: {
          title: `${quizType.titlePrefix} ${i}`,
          type: quizType.type,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          quizSize,
          vocabLimitUsed,
          orderIndex,
        },
      });
      orderIndex += 1;
    }
  }

  return quizzes;
}

function buildFlashcardDocs({ db, languageId, level, usableVocab }) {
  const flashcardsCol = db
    .collection('languages')
    .doc(languageId)
    .collection('levels')
    .doc(level)
    .collection('flashcards');

  return usableVocab.map((vocab) => ({
    id: vocab.vocabId,
    docRef: flashcardsCol.doc(vocab.vocabId),
    data: {
      vocabId: vocab.vocabId,
      frontText: vocab.textNative,
      backText: vocab.textTarget,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      rank: vocab.rank,
    },
  }));
}

function buildQuizzesByTypeMap(quizzes) {
  const map = {
    translation: [],
    reverse_translation: [],
    fill_in_blank: [],
  };

  for (const quiz of quizzes) {
    map[quiz.quizType].push(quiz);
  }

  return map;
}

function generateTranslationQuestions({ quizzes, usableVocab, languageCfg, answerPool, quizSize, rng }) {
  const questions = [];

  const indexSource = createCyclingIndexSource(usableVocab.length, rng);
  const maxAttemptsPerQuestion = Math.max(usableVocab.length, 1) * 2;

  for (const quiz of quizzes) {
    for (let index = 1; index <= quizSize; index += 1) {
      let built = null;

      for (let attempt = 0; attempt < maxAttemptsPerQuestion; attempt += 1) {
        const selectedIndex = indexSource();
        if (selectedIndex === null) {
          break;
        }

        const vocab = usableVocab[selectedIndex];
        if (!vocab) {
          continue;
        }

        const distractors = pickDistractors({
          primaryPool: answerPool,
          correctAnswer: vocab.textTarget,
          count: 3,
          rng,
        });

        if (!distractors) {
          continue;
        }

        built = {
          id: `${quiz.id}_${index}`,
          quizType: 'translation',
          docRef: quiz.docRef.collection('questions').doc(`${quiz.id}_${index}`),
          data: {
            vocabId: vocab.vocabId,
            prompt: languageCfg.translationPrompt(vocab.textNative),
            correctAnswer: vocab.textTarget,
            distractors,
            questionType: 'translation',
            rank: vocab.rank,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        };
        break;
      }

      if (built) {
        questions.push(built);
      }
    }
  }

  return questions;
}

function generateReverseTranslationQuestions({ quizzes, usableVocab, languageCfg, nativePool, quizSize, rng }) {
  const questions = [];

  const indexSource = createCyclingIndexSource(usableVocab.length, rng);
  const maxAttemptsPerQuestion = Math.max(usableVocab.length, 1) * 2;

  for (const quiz of quizzes) {
    for (let index = 1; index <= quizSize; index += 1) {
      let built = null;

      for (let attempt = 0; attempt < maxAttemptsPerQuestion; attempt += 1) {
        const selectedIndex = indexSource();
        if (selectedIndex === null) {
          break;
        }

        const vocab = usableVocab[selectedIndex];
        if (!vocab) {
          continue;
        }

        const distractors = pickDistractors({
          primaryPool: nativePool,
          correctAnswer: vocab.textNative,
          count: 3,
          rng,
        });

        if (!distractors) {
          continue;
        }

        built = {
          id: `${quiz.id}_${index}`,
          quizType: 'reverse_translation',
          docRef: quiz.docRef.collection('questions').doc(`${quiz.id}_${index}`),
          data: {
            vocabId: vocab.vocabId,
            prompt: languageCfg.reversePrompt(vocab.textTarget),
            correctAnswer: vocab.textNative,
            distractors,
            questionType: 'reverse_translation',
            rank: vocab.rank,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        };
        break;
      }

      if (built) {
        questions.push(built);
      }
    }
  }

  return questions;
}

function generateFillInBlankQuestions({
  quizzes,
  fillableItems,
  fillAnswerPool,
  fallbackWordPool,
  quizSize,
  rng,
}) {
  const questions = [];

  const indexSource = createCyclingIndexSource(fillableItems.length, rng);
  const maxAttemptsPerQuestion = Math.max(fillableItems.length, 1) * 2;

  for (const quiz of quizzes) {
    for (let index = 1; index <= quizSize; index += 1) {
      let built = null;

      for (let attempt = 0; attempt < maxAttemptsPerQuestion; attempt += 1) {
        const selectedIndex = indexSource();
        if (selectedIndex === null) {
          break;
        }

        const item = fillableItems[selectedIndex];
        if (!item) {
          continue;
        }

        const distractors = pickDistractors({
          primaryPool: fillAnswerPool,
          fallbackPool: fallbackWordPool,
          correctAnswer: item.fill.correctAnswer,
          count: 3,
          rng,
        });

        if (!distractors) {
          continue;
        }

        built = {
          id: `${quiz.id}_${index}`,
          quizType: 'fill_in_blank',
          docRef: quiz.docRef.collection('questions').doc(`${quiz.id}_${index}`),
          data: {
            vocabId: item.vocab.vocabId,
            prompt: item.fill.prompt,
            correctAnswer: item.fill.correctAnswer,
            distractors,
            questionType: 'fill_in_blank',
            rank: item.vocab.rank,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        };
        break;
      }

      if (built) {
        questions.push(built);
      }
    }
  }

  return questions;
}

function countByQuizType(items) {
  const counts = {
    translation: 0,
    reverse_translation: 0,
    fill_in_blank: 0,
  };

  for (const item of items) {
    if (item.quizType in counts) {
      counts[item.quizType] += 1;
    }
  }

  return counts;
}

function chunkItems(items, chunkSize) {
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

async function splitExistingDocs({ db, plannedDocs, lookupBatchSize = 200 }) {
  if (plannedDocs.length === 0) {
    return { toCreate: [], skipped: [] };
  }

  const toCreate = [];
  const skipped = [];

  const chunks = chunkItems(plannedDocs, lookupBatchSize);
  for (const chunk of chunks) {
    const refs = chunk.map((item) => item.docRef);
    const snapshots = await db.getAll(...refs);

    for (let i = 0; i < chunk.length; i += 1) {
      const planned = chunk[i];
      const snapshot = snapshots[i];
      if (snapshot.exists) {
        skipped.push(planned);
      } else {
        toCreate.push(planned);
      }
    }
  }

  return { toCreate, skipped };
}

async function collectOverwriteDeleteOps({ db, languageId, level }) {
  const levelRef = db
    .collection('languages')
    .doc(languageId)
    .collection('levels')
    .doc(level);

  const flashcardsSnap = await levelRef.collection('flashcards').get();
  const quizzesSnap = await levelRef.collection('quizzes').get();

  const deleteOps = [];

  for (const flashDoc of flashcardsSnap.docs) {
    deleteOps.push({ kind: 'delete', docRef: flashDoc.ref });
  }

  for (const quizDoc of quizzesSnap.docs) {
    const questionsSnap = await quizDoc.ref.collection('questions').get();
    for (const questionDoc of questionsSnap.docs) {
      deleteOps.push({ kind: 'delete', docRef: questionDoc.ref });
    }
    deleteOps.push({ kind: 'delete', docRef: quizDoc.ref });
  }

  return {
    deleteOps,
    deletedFlashcards: flashcardsSnap.docs.length,
    deletedQuizzes: quizzesSnap.docs.length,
    deletedQuestions: deleteOps.length - flashcardsSnap.docs.length - quizzesSnap.docs.length,
  };
}

function toSetOps(items) {
  return items.map((item) => ({
    kind: 'set',
    docRef: item.docRef,
    data: item.data,
  }));
}

function firstTenIds(items) {
  return items.slice(0, 10).map((item) => item.id);
}

function buildFillResources(usableVocab, nativeIso) {
  const fillableItems = [];
  const fillAnswerValues = [];

  for (const vocab of usableVocab) {
    const fill = buildFillInBlankCandidate(vocab.textNative, nativeIso);
    if (!fill) {
      continue;
    }

    fillableItems.push({ vocab, fill });
    fillAnswerValues.push(fill.correctAnswer);
  }

  return {
    fillableItems,
    fillAnswerPool: buildUniquePool(fillAnswerValues),
    fillInBlankCandidatesSkippedForBadContext: usableVocab.length - fillableItems.length,
  };
}

function buildCuratedDocs({ db, level, languageCfg, usableVocab, numQuizzesPerType, quizSize, rng }) {
  const flashcards = buildFlashcardDocs({
    db,
    languageId: languageCfg.languageId,
    level,
    usableVocab,
  });

  const quizzes = buildQuizDocs({
    db,
    languageId: languageCfg.languageId,
    level,
    numQuizzesPerType,
    quizSize,
    vocabLimitUsed: usableVocab.length,
  });
  const quizzesByType = buildQuizzesByTypeMap(quizzes);

  const translationAnswerPool = buildUniquePool(usableVocab.map((vocab) => vocab.textTarget));
  const nativePool = buildUniquePool(usableVocab.map((vocab) => vocab.textNative));

  const fillResources = buildFillResources(usableVocab, languageCfg.nativeIso);
  const fallbackWordPool = buildWordPoolFromNativeText(usableVocab, languageCfg.nativeIso);

  const translationQuestions = generateTranslationQuestions({
    quizzes: quizzesByType.translation,
    usableVocab,
    languageCfg,
    answerPool: translationAnswerPool,
    quizSize,
    rng,
  });

  const reverseQuestions = generateReverseTranslationQuestions({
    quizzes: quizzesByType.reverse_translation,
    usableVocab,
    languageCfg,
    nativePool,
    quizSize,
    rng,
  });

  const fillInBlankQuestions = generateFillInBlankQuestions({
    quizzes: quizzesByType.fill_in_blank,
    fillableItems: fillResources.fillableItems,
    fillAnswerPool: fillResources.fillAnswerPool,
    fallbackWordPool,
    quizSize,
    rng,
  });

  const questions = [
    ...translationQuestions,
    ...reverseQuestions,
    ...fillInBlankQuestions,
  ];

  return {
    flashcards,
    quizzes,
    questions,
    counts: {
      quizzes: {
        translation: quizzesByType.translation.length,
        reverse_translation: quizzesByType.reverse_translation.length,
        fill_in_blank: quizzesByType.fill_in_blank.length,
      },
      questions: {
        translation: translationQuestions.length,
        reverse_translation: reverseQuestions.length,
        fill_in_blank: fillInBlankQuestions.length,
      },
    },
    fillInBlankCandidatesSkippedForBadContext:
      fillResources.fillInBlankCandidatesSkippedForBadContext,
  };
}

async function processLanguage({ db, flags, languageId }) {
  const languageCfg = languageConfig(languageId);
  const languageSeed = (flags.seed ^ hashString(`${languageId}:${flags.level}`)) >>> 0;
  const rng = createRng(languageSeed);

  console.log(`[phrases] ${languageId}: reading vocab docs...`);
  const vocabData = await readVocabRows({
    db,
    languageCfg,
    level: flags.level,
    vocabLimit: flags.vocabLimit,
  });
  console.log(
    `[phrases] ${languageId}: vocab read=${vocabData.stats.vocabRead}, usable=${vocabData.stats.usableVocab}, missingTranslationSkipped=${vocabData.stats.missingTranslationSkipped}`
  );

  const curated = buildCuratedDocs({
    db,
    level: flags.level,
    languageCfg,
    usableVocab: vocabData.usable,
    numQuizzesPerType: flags.numQuizzesPerType,
    quizSize: flags.quizSize,
    rng,
  });

  const report = {
    vocabReadCount: vocabData.stats.vocabRead,
    usableVocabCount: vocabData.stats.usableVocab,
    missingTranslationSkippedCount: vocabData.stats.missingTranslationSkipped,
    flashcardsCreated: 0,
    flashcardsSkipped: 0,
    translationQuizzesCreated: 0,
    reverseTranslationQuizzesCreated: 0,
    fillInBlankQuizzesCreated: 0,
    translationQuestionsCreated: 0,
    reverseTranslationQuestionsCreated: 0,
    fillInBlankQuestionsCreated: 0,
    fillInBlankCandidatesSkippedForBadContext:
      curated.fillInBlankCandidatesSkippedForBadContext,
    firstFlashcardIdsCreated: [],
    firstQuestionIdsCreated: [],
    deletedFlashcards: 0,
    deletedQuizzes: 0,
    deletedQuestions: 0,
  };

  if (flags.overwrite) {
    console.log(`[phrases] ${languageId}: collecting existing generated docs for overwrite...`);
    const deletes = await collectOverwriteDeleteOps({
      db,
      languageId,
      level: flags.level,
    });

    report.deletedFlashcards = deletes.deletedFlashcards;
    report.deletedQuizzes = deletes.deletedQuizzes;
    report.deletedQuestions = deletes.deletedQuestions;

    console.log(
      `[phrases] ${languageId}: overwrite delete targets flashcards=${deletes.deletedFlashcards}, quizzes=${deletes.deletedQuizzes}, questions=${deletes.deletedQuestions}`
    );

    await applyOpsInBatches({
      db,
      ops: deletes.deleteOps,
      dryRun: flags.dryRun,
      batchSize: flags.batchSize,
      retryAttempts: flags.retryAttempts,
      languageLabel: languageId,
      phaseLabel: 'overwrite-delete',
    });

    report.flashcardsCreated = curated.flashcards.length;
    report.flashcardsSkipped = 0;
    report.firstFlashcardIdsCreated = firstTenIds(curated.flashcards);

    report.translationQuizzesCreated = curated.counts.quizzes.translation;
    report.reverseTranslationQuizzesCreated = curated.counts.quizzes.reverse_translation;
    report.fillInBlankQuizzesCreated = curated.counts.quizzes.fill_in_blank;

    report.translationQuestionsCreated = curated.counts.questions.translation;
    report.reverseTranslationQuestionsCreated = curated.counts.questions.reverse_translation;
    report.fillInBlankQuestionsCreated = curated.counts.questions.fill_in_blank;
    report.firstQuestionIdsCreated = firstTenIds(curated.questions);

    await applyOpsInBatches({
      db,
      ops: toSetOps(curated.flashcards),
      dryRun: flags.dryRun,
      batchSize: flags.batchSize,
      retryAttempts: flags.retryAttempts,
      languageLabel: languageId,
      phaseLabel: 'flashcards',
    });

    await applyOpsInBatches({
      db,
      ops: toSetOps(curated.quizzes),
      dryRun: flags.dryRun,
      batchSize: flags.batchSize,
      retryAttempts: flags.retryAttempts,
      languageLabel: languageId,
      phaseLabel: 'quizzes',
    });

    await applyOpsInBatches({
      db,
      ops: toSetOps(curated.questions),
      dryRun: flags.dryRun,
      batchSize: flags.batchSize,
      retryAttempts: flags.retryAttempts,
      languageLabel: languageId,
      phaseLabel: 'questions',
    });

    return report;
  }

  console.log(`[phrases] ${languageId}: checking existing docs (overwrite=false)...`);

  const flashcardExisting = await splitExistingDocs({
    db,
    plannedDocs: curated.flashcards,
  });
  const quizExisting = await splitExistingDocs({
    db,
    plannedDocs: curated.quizzes,
  });
  const questionExisting = await splitExistingDocs({
    db,
    plannedDocs: curated.questions,
  });

  const quizCounts = countByQuizType(quizExisting.toCreate);
  const questionCounts = countByQuizType(questionExisting.toCreate);

  report.flashcardsCreated = flashcardExisting.toCreate.length;
  report.flashcardsSkipped = flashcardExisting.skipped.length;
  report.firstFlashcardIdsCreated = firstTenIds(flashcardExisting.toCreate);

  report.translationQuizzesCreated = quizCounts.translation;
  report.reverseTranslationQuizzesCreated = quizCounts.reverse_translation;
  report.fillInBlankQuizzesCreated = quizCounts.fill_in_blank;

  report.translationQuestionsCreated = questionCounts.translation;
  report.reverseTranslationQuestionsCreated = questionCounts.reverse_translation;
  report.fillInBlankQuestionsCreated = questionCounts.fill_in_blank;
  report.firstQuestionIdsCreated = firstTenIds(questionExisting.toCreate);

  await applyOpsInBatches({
    db,
    ops: toSetOps(flashcardExisting.toCreate),
    dryRun: flags.dryRun,
    batchSize: flags.batchSize,
    retryAttempts: flags.retryAttempts,
    languageLabel: languageId,
    phaseLabel: 'flashcards',
  });

  await applyOpsInBatches({
    db,
    ops: toSetOps(quizExisting.toCreate),
    dryRun: flags.dryRun,
    batchSize: flags.batchSize,
    retryAttempts: flags.retryAttempts,
    languageLabel: languageId,
    phaseLabel: 'quizzes',
  });

  await applyOpsInBatches({
    db,
    ops: toSetOps(questionExisting.toCreate),
    dryRun: flags.dryRun,
    batchSize: flags.batchSize,
    retryAttempts: flags.retryAttempts,
    languageLabel: languageId,
    phaseLabel: 'questions',
  });

  return report;
}

function printReport(flags, reports) {
  console.log('\n=== Curated Phrases Content Report ===');
  if (flags.dryRun) {
    console.log('DRY RUN: no Firestore writes were performed.');
  }

  console.log(
    `Config: language=${flags.language}, level=${flags.level}, vocabLimit=${flags.vocabLimit}, numQuizzesPerType=${flags.numQuizzesPerType}, quizSize=${flags.quizSize}, seed=${flags.seed}, overwrite=${flags.overwrite}, batchSize=${flags.batchSize}, retryAttempts=${flags.retryAttempts}`
  );

  for (const [languageId, report] of Object.entries(reports)) {
    console.log(`\n${languageId[0].toUpperCase()}${languageId.slice(1)}`);
    console.log(`- vocab read count: ${report.vocabReadCount}`);
    console.log(`- usable vocab count: ${report.usableVocabCount}`);
    console.log(
      `- skipped due to missing translation: ${report.missingTranslationSkippedCount}`
    );
    console.log(`- flashcards created: ${report.flashcardsCreated}`);
    console.log(`- flashcards skipped: ${report.flashcardsSkipped}`);
    console.log(`- translation quizzes created: ${report.translationQuizzesCreated}`);
    console.log(
      `- reverse translation quizzes created: ${report.reverseTranslationQuizzesCreated}`
    );
    console.log(`- fill_in_blank quizzes created: ${report.fillInBlankQuizzesCreated}`);
    console.log(`- translation questions created: ${report.translationQuestionsCreated}`);
    console.log(
      `- reverse translation questions created: ${report.reverseTranslationQuestionsCreated}`
    );
    console.log(`- fill_in_blank questions created: ${report.fillInBlankQuestionsCreated}`);
    console.log(
      `- fill_in_blank candidates skipped for bad context: ${report.fillInBlankCandidatesSkippedForBadContext}`
    );
    console.log(
      `- first 10 flashcardIds created: ${
        report.firstFlashcardIdsCreated.length > 0
          ? report.firstFlashcardIdsCreated.join(', ')
          : '(none)'
      }`
    );
    console.log(
      `- first 10 questionIds created: ${
        report.firstQuestionIdsCreated.length > 0
          ? report.firstQuestionIdsCreated.join(', ')
          : '(none)'
      }`
    );

    if (flags.overwrite) {
      console.log(
        `- overwrite deleted (flashcards/quizzes/questions): ${report.deletedFlashcards}/${report.deletedQuizzes}/${report.deletedQuestions}`
      );
    }
  }
}

async function main() {
  const flags = parseArgs(process.argv);

  console.log(
    `[phrases] Starting curated phrase content generation (language=${flags.language}, level=${flags.level}, vocabLimit=${flags.vocabLimit}, numQuizzesPerType=${flags.numQuizzesPerType}, quizSize=${flags.quizSize}, dryRun=${flags.dryRun}, seed=${flags.seed}, overwrite=${flags.overwrite}, batchSize=${flags.batchSize}, retryAttempts=${flags.retryAttempts})`
  );

  ensureFileExists(SERVICE_ACCOUNT_PATH, 'service account key');
  const serviceAccount = readServiceAccount(SERVICE_ACCOUNT_PATH);

  const app =
    admin.apps.length === 0
      ? admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          projectId: serviceAccount.project_id,
        })
      : admin.apps[0];

  const db = admin.firestore();
  db.settings({ preferRest: true });

  const selectedLanguages =
    flags.language === 'both' ? ['english', 'spanish'] : [flags.language];

  const reports = {};

  try {
    for (const languageId of selectedLanguages) {
      reports[languageId] = await processLanguage({
        db,
        flags,
        languageId,
      });
    }

    printReport(flags, reports);
  } finally {
    if (typeof db.terminate === 'function') {
      await db.terminate();
    }
    await app.delete();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Fatal error: ${message}`);
  process.exit(1);
});
