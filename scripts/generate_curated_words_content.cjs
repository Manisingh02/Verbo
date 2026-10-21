#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');

// Force REST transport and avoid gRPC initialization hangs in some local environments.
process.env.GOOGLE_CLOUD_DISABLE_GRPC = process.env.GOOGLE_CLOUD_DISABLE_GRPC || 'true';
process.env.NO_GCE_CHECK = process.env.NO_GCE_CHECK || 'true';

const admin = require('firebase-admin');

const SERVICE_ACCOUNT_PATH = path.resolve(process.cwd(), 'scripts/serviceAccountKey.json');

const DEFAULT_LEVEL = 'words';
const DEFAULT_LANGUAGE = 'both';
const DEFAULT_VOCAB_LIMIT = 200;
const DEFAULT_NUM_QUIZZES = 10;
const DEFAULT_QUIZ_SIZE = 10;
const DEFAULT_SEED = 42;
const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_RETRY_ATTEMPTS = 6;

const BASE_RETRY_DELAY_MS = 500;
const COMMIT_TIMEOUT_MS = 45_000;

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
    numQuizzes: DEFAULT_NUM_QUIZZES,
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

    if (arg === '--numQuizzes') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --numQuizzes');
      }
      flags.numQuizzes = parsePositiveInt(value, '--numQuizzes', { min: 0 });
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
      flags.batchSize = parsePositiveInt(value, '--batchSize', { min: 1, max: 500 });
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
      `[generate] ${languageLabel} ${phaseLabel} batch ${batchNumber}/${totalBatches} attempt ${attempt}/${retryAttempts} committing ${ops.length} ops...`
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
        `[generate] ${languageLabel} ${phaseLabel} batch ${batchNumber}/${totalBatches} committed`
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
        `[generate] ${languageLabel} ${phaseLabel} batch ${batchNumber}/${totalBatches} attempt ${attempt}/${retryAttempts} failed; retrying in ${delayMs}ms`
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
  if (ops.length === 0 || dryRun) {
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

function sampleUniqueValues(values, count, rng) {
  if (values.length < count) {
    return null;
  }
  const copy = values.slice();
  shuffleInPlace(copy, rng);
  return copy.slice(0, count);
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTranslation(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function languageConfig(languageId) {
  if (languageId === 'english') {
    return {
      languageId: 'english',
      nativeIso: 'en',
      targetIso: 'es',
      promptPrefix: 'Translate to Spanish:',
    };
  }

  if (languageId === 'spanish') {
    return {
      languageId: 'spanish',
      nativeIso: 'es',
      targetIso: 'en',
      promptPrefix: 'Translate to English:',
    };
  }

  throw new Error(`Unsupported language: ${languageId}`);
}

async function readVocabRows({ db, languageId, level, vocabLimit, targetIso }) {
  let query = db
    .collection('languages')
    .doc(languageId)
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
    const doc = snapshot.docs[i];
    const data = doc.data() || {};

    stats.vocabRead += 1;

    const textNative = normalizeText(data.textNative);
    const rankParsed = Number.parseInt(String(data.rank ?? ''), 10);
    const rank = Number.isInteger(rankParsed) ? rankParsed : i + 1;

    const translations =
      data.translations && typeof data.translations === 'object' && !Array.isArray(data.translations)
        ? data.translations
        : {};

    const textTarget = normalizeTranslation(translations[targetIso]);
    if (!textTarget) {
      stats.missingTranslationSkipped += 1;
      continue;
    }

    usable.push({
      vocabId: doc.id,
      textNative,
      textTarget,
      rank,
    });
  }

  stats.usableVocab = usable.length;
  return { usable, stats };
}

function buildQuestionVocabSequence(usableCount, neededCount, rng) {
  if (usableCount === 0 || neededCount === 0) {
    return [];
  }

  const sequence = [];
  while (sequence.length < neededCount) {
    const cycle = [];
    for (let i = 0; i < usableCount; i += 1) {
      cycle.push(i);
    }
    shuffleInPlace(cycle, rng);
    sequence.push(...cycle);
  }

  return sequence.slice(0, neededCount);
}

function buildCuratedDocs({
  db,
  level,
  languageCfg,
  usableVocab,
  numQuizzes,
  quizSize,
  rng,
}) {
  const levelRef = db
    .collection('languages')
    .doc(languageCfg.languageId)
    .collection('levels')
    .doc(level);

  const flashcardsCol = levelRef.collection('flashcards');
  const quizzesCol = levelRef.collection('quizzes');

  const flashcards = usableVocab.map((item) => {
    const docRef = flashcardsCol.doc(item.vocabId);
    return {
      id: item.vocabId,
      docRef,
      data: {
        vocabId: item.vocabId,
        frontText: item.textNative,
        backText: item.textTarget,
        audioUrl: '',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        rank: item.rank,
      },
    };
  });

  const quizzes = [];
  for (let i = 1; i <= numQuizzes; i += 1) {
    const quizId = `${level}_q${i}`;
    const docRef = quizzesCol.doc(quizId);
    quizzes.push({
      id: quizId,
      docRef,
      data: {
        title: `Words Quiz ${i}`,
        type: 'multiple-choice',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        quizSize,
        vocabLimitUsed: usableVocab.length,
        targetIso: languageCfg.targetIso,
      },
    });
  }

  const answerPool = Array.from(
    new Set(
      usableVocab
        .map((item) => item.textTarget)
        .filter((value) => typeof value === 'string' && value.trim().length > 0)
    )
  );

  const totalQuestionsNeeded = numQuizzes * quizSize;
  const sequence = buildQuestionVocabSequence(usableVocab.length, totalQuestionsNeeded, rng);

  const questions = [];
  let skippedInsufficientDistractors = 0;

  for (let i = 0; i < totalQuestionsNeeded; i += 1) {
    const quizNumber = Math.floor(i / quizSize) + 1;
    const questionNumber = (i % quizSize) + 1;
    const quizId = `${level}_q${quizNumber}`;
    const questionId = `${quizId}_${questionNumber}`;

    const vocabIndex = sequence[i];
    const vocabItem = usableVocab[vocabIndex];
    if (!vocabItem) {
      skippedInsufficientDistractors += 1;
      continue;
    }

    const candidates = answerPool.filter((answer) => answer !== vocabItem.textTarget);
    const distractors = sampleUniqueValues(candidates, 3, rng);
    if (!distractors) {
      skippedInsufficientDistractors += 1;
      continue;
    }

    const docRef = quizzesCol.doc(quizId).collection('questions').doc(questionId);
    questions.push({
      id: questionId,
      docRef,
      data: {
        prompt: `${languageCfg.promptPrefix} ${vocabItem.textNative}`,
        correctAnswer: vocabItem.textTarget,
        distractors,
        questionType: 'mcq',
        vocabId: vocabItem.vocabId,
        rank: vocabItem.rank,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    });
  }

  return {
    flashcards,
    quizzes,
    questions,
    skippedInsufficientDistractors,
  };
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

async function processLanguage({ db, flags, languageId }) {
  const languageCfg = languageConfig(languageId);
  const languageSeed = (flags.seed ^ hashString(`${languageId}:${flags.level}`)) >>> 0;
  const rng = createRng(languageSeed);

  console.log(`[generate] ${languageId}: reading vocab docs...`);
  const vocabData = await readVocabRows({
    db,
    languageId,
    level: flags.level,
    vocabLimit: flags.vocabLimit,
    targetIso: languageCfg.targetIso,
  });
  console.log(
    `[generate] ${languageId}: vocab read=${vocabData.stats.vocabRead}, usable=${vocabData.stats.usableVocab}, missingTranslationSkipped=${vocabData.stats.missingTranslationSkipped}`
  );

  const curated = buildCuratedDocs({
    db,
    level: flags.level,
    languageCfg,
    usableVocab: vocabData.usable,
    numQuizzes: flags.numQuizzes,
    quizSize: flags.quizSize,
    rng,
  });

  const report = {
    vocabRead: vocabData.stats.vocabRead,
    usableVocab: vocabData.stats.usableVocab,
    missingTranslationSkipped: vocabData.stats.missingTranslationSkipped,
    flashcardsCreated: 0,
    flashcardsSkipped: 0,
    quizzesCreated: 0,
    quizzesSkipped: 0,
    questionsCreated: 0,
    questionsSkipped: curated.skippedInsufficientDistractors,
    firstFlashcardIdsCreated: [],
    firstQuestionIdsCreated: [],
    deletedFlashcards: 0,
    deletedQuizzes: 0,
    deletedQuestions: 0,
  };

  if (flags.overwrite) {
    console.log(`[generate] ${languageId}: collecting existing generated docs for overwrite...`);
    const deletes = await collectOverwriteDeleteOps({
      db,
      languageId,
      level: flags.level,
    });
    report.deletedFlashcards = deletes.deletedFlashcards;
    report.deletedQuizzes = deletes.deletedQuizzes;
    report.deletedQuestions = deletes.deletedQuestions;

    console.log(
      `[generate] ${languageId}: overwrite delete targets flashcards=${deletes.deletedFlashcards}, quizzes=${deletes.deletedQuizzes}, questions=${deletes.deletedQuestions}`
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
    report.quizzesCreated = curated.quizzes.length;
    report.questionsCreated = curated.questions.length;
    report.firstFlashcardIdsCreated = firstTenIds(curated.flashcards);
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

  console.log(`[generate] ${languageId}: checking existing docs (overwrite=false)...`);
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

  report.flashcardsCreated = flashcardExisting.toCreate.length;
  report.flashcardsSkipped += flashcardExisting.skipped.length;

  report.quizzesCreated = quizExisting.toCreate.length;
  report.quizzesSkipped += quizExisting.skipped.length;

  report.questionsCreated = questionExisting.toCreate.length;
  report.questionsSkipped += questionExisting.skipped.length;

  report.firstFlashcardIdsCreated = firstTenIds(flashcardExisting.toCreate);
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

function printReport({ flags, reports }) {
  console.log('\n=== Curated Words Content Report ===');
  if (flags.dryRun) {
    console.log('DRY RUN: no Firestore writes were performed.');
  }

  console.log(
    `Config: language=${flags.language}, level=${flags.level}, vocabLimit=${flags.vocabLimit}, numQuizzes=${flags.numQuizzes}, quizSize=${flags.quizSize}, seed=${flags.seed}, overwrite=${flags.overwrite}, batchSize=${flags.batchSize}, retryAttempts=${flags.retryAttempts}`
  );

  for (const [languageId, report] of Object.entries(reports)) {
    console.log(`\n${languageId[0].toUpperCase()}${languageId.slice(1)}`);
    console.log(`- vocab read count: ${report.vocabRead}`);
    console.log(`- usable vocab count: ${report.usableVocab}`);
    console.log(
      `- missing translation skipped count: ${report.missingTranslationSkipped}`
    );
    console.log(
      `- flashcards created/skipped: ${report.flashcardsCreated}/${report.flashcardsSkipped}`
    );
    console.log(`- quizzes created/skipped: ${report.quizzesCreated}/${report.quizzesSkipped}`);
    console.log(
      `- questions created/skipped: ${report.questionsCreated}/${report.questionsSkipped}`
    );

    if (flags.overwrite) {
      console.log(
        `- overwrite deleted (flashcards/quizzes/questions): ${report.deletedFlashcards}/${report.deletedQuizzes}/${report.deletedQuestions}`
      );
    }

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
  }
}

async function main() {
  const flags = parseArgs(process.argv);

  console.log(
    `[generate] Starting curated content generation (language=${flags.language}, level=${flags.level}, vocabLimit=${flags.vocabLimit}, numQuizzes=${flags.numQuizzes}, quizSize=${flags.quizSize}, dryRun=${flags.dryRun}, seed=${flags.seed}, overwrite=${flags.overwrite}, batchSize=${flags.batchSize}, retryAttempts=${flags.retryAttempts})`
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

    printReport({ flags, reports });
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
