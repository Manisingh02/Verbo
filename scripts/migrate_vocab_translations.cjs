#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');

// Force REST transport and avoid gRPC init hangs in some local environments.
process.env.GOOGLE_CLOUD_DISABLE_GRPC = process.env.GOOGLE_CLOUD_DISABLE_GRPC || 'true';
process.env.NO_GCE_CHECK = process.env.NO_GCE_CHECK || 'true';

const admin = require('firebase-admin');

const SERVICE_ACCOUNT_PATH = path.resolve(
  process.cwd(),
  'scripts/serviceAccountKey.json'
);

const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_RETRY_ATTEMPTS = 6;
const BASE_DELAY_MS = 500;
const COMMIT_TIMEOUT_MS = 45_000;

function parseArgs(argv) {
  const flags = {
    dryRun: false,
    dropTextTarget: false,
    batchSize: DEFAULT_BATCH_SIZE,
    limit: undefined,
    retryAttempts: DEFAULT_RETRY_ATTEMPTS,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--dry-run') {
      flags.dryRun = true;
      continue;
    }

    if (arg === '--drop-textTarget') {
      flags.dropTextTarget = true;
      continue;
    }

    if (arg === '--batchSize') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --batchSize');
      }
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
        throw new Error('--batchSize must be an integer between 1 and 500');
      }
      flags.batchSize = parsed;
      i += 1;
      continue;
    }

    if (arg === '--limit') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --limit');
      }
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error('--limit must be a non-negative integer');
      }
      flags.limit = parsed;
      i += 1;
      continue;
    }

    if (arg === '--retryAttempts') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --retryAttempts');
      }
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error('--retryAttempts must be an integer >= 1');
      }
      flags.retryAttempts = parsed;
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
  chunk,
  languageLabel,
  batchNumber,
  totalBatches,
  retryAttempts,
  batchSize,
}) {
  for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
    console.log(
      `[migrate] ${languageLabel} batch ${batchNumber}/${totalBatches} attempt ${attempt}/${retryAttempts} committing ${chunk.length} docs...`
    );

    const batch = db.batch();
    for (const op of chunk) {
      batch.set(op.docRef, op.updateData, { merge: true });
    }

    let timeoutId;
    try {
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          const error = new Error(
            `Batch commit timeout after ${COMMIT_TIMEOUT_MS}ms (${languageLabel} batch ${batchNumber}/${totalBatches})`
          );
          error.code = 'ETIMEDOUT';
          reject(error);
        }, COMMIT_TIMEOUT_MS);
      });

      await Promise.race([batch.commit(), timeoutPromise]);
      clearTimeout(timeoutId);
      return;
    } catch (error) {
      clearTimeout(timeoutId);
      const canRetry = isTransientError(error) && attempt < retryAttempts;
      if (!canRetry) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Failed ${languageLabel} batch ${batchNumber}/${totalBatches} attempt ${attempt}/${retryAttempts}: ${message}`
        );
      }

      const delayMs = BASE_DELAY_MS * 2 ** (attempt - 1);
      console.log(
        `[migrate] ${languageLabel} batch ${batchNumber}/${totalBatches} attempt ${attempt}/${retryAttempts} failed; retrying in ${delayMs}ms`
      );
      await sleep(delayMs);
    }
  }

  throw new Error(
    `Retry attempts exhausted for ${languageLabel} batch ${batchNumber}/${totalBatches}`
  );
}

function isMap(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function buildUpdateForDoc(docData, nativeIso, targetIso, dropTextTarget) {
  const updateData = {};
  let shouldUpdate = false;

  if (docData.nativeIso !== nativeIso) {
    updateData.nativeIso = nativeIso;
    shouldUpdate = true;
  }

  const translations = docData.translations;
  const translationsIsMap = isMap(translations);
  const rawTextTarget = typeof docData.textTarget === 'string' ? docData.textTarget.trim() : '';
  const hasTextTarget = rawTextTarget.length > 0;

  if (!translationsIsMap) {
    const nextTranslations = {};
    if (hasTextTarget) {
      nextTranslations[targetIso] = rawTextTarget;
    }
    updateData.translations = nextTranslations;
    shouldUpdate = true;
  } else {
    const existingTarget = translations[targetIso];
    const hasExistingTarget =
      typeof existingTarget === 'string' && existingTarget.trim().length > 0;
    if (hasTextTarget && !hasExistingTarget) {
      updateData[`translations.${targetIso}`] = rawTextTarget;
      shouldUpdate = true;
    }
  }

  if (dropTextTarget && Object.prototype.hasOwnProperty.call(docData, 'textTarget')) {
    updateData.textTarget = admin.firestore.FieldValue.delete();
    shouldUpdate = true;
  }

  return {
    shouldUpdate,
    updateData,
    missingOrEmptyTextTarget: !hasTextTarget,
  };
}

async function scanLanguageDocs({
  db,
  languageId,
  nativeIso,
  targetIso,
  dropTextTarget,
  limit,
}) {
  let query = db
    .collection('languages')
    .doc(languageId)
    .collection('levels')
    .doc('words')
    .collection('vocab')
    .orderBy(admin.firestore.FieldPath.documentId());

  if (limit !== undefined) {
    query = query.limit(limit);
  }

  const snapshot = await query.get();

  const updates = [];
  const stats = {
    scanned: 0,
    updated: 0,
    skipped: 0,
    missingOrEmptyTextTarget: 0,
    firstTenUpdatedVocabIds: [],
  };

  for (const doc of snapshot.docs) {
    stats.scanned += 1;
    const data = doc.data() || {};
    const result = buildUpdateForDoc(data, nativeIso, targetIso, dropTextTarget);

    if (result.missingOrEmptyTextTarget) {
      stats.missingOrEmptyTextTarget += 1;
    }

    if (result.shouldUpdate) {
      stats.updated += 1;
      updates.push({
        vocabId: doc.id,
        docRef: doc.ref,
        updateData: result.updateData,
      });
      if (stats.firstTenUpdatedVocabIds.length < 10) {
        stats.firstTenUpdatedVocabIds.push(doc.id);
      }
    } else {
      stats.skipped += 1;
    }
  }

  return { updates, stats };
}

async function applyUpdates({
  db,
  updates,
  languageLabel,
  batchSize,
  retryAttempts,
  dryRun,
}) {
  if (dryRun || updates.length === 0) {
    return;
  }

  const totalBatches = Math.ceil(updates.length / batchSize);
  let written = 0;

  for (let i = 0; i < updates.length; i += batchSize) {
    const batchNumber = Math.floor(i / batchSize) + 1;
    const chunk = updates.slice(i, i + batchSize);

    await commitChunkWithRetry({
      db,
      chunk,
      languageLabel,
      batchNumber,
      totalBatches,
      retryAttempts,
      batchSize,
    });

    written += chunk.length;
    console.log(
      `[migrate] ${languageLabel} batch ${batchNumber}/${totalBatches} committed (cumulative ${written}/${updates.length})`
    );
  }
}

function printReport(englishStats, spanishStats, dryRun, dropTextTarget) {
  console.log('\n=== Vocab Translation Migration Report ===');
  if (dryRun) {
    console.log('DRY RUN: no Firestore writes were performed.');
  }
  console.log(`dropTextTarget: ${dropTextTarget ? 'true' : 'false'}`);

  console.log('\nEnglish');
  console.log(`- scanned: ${englishStats.scanned}`);
  console.log(`- updated: ${englishStats.updated}`);
  console.log(`- skipped: ${englishStats.skipped}`);
  console.log(
    `- missing/empty textTarget: ${englishStats.missingOrEmptyTextTarget}`
  );
  console.log(
    `- first 10 updated vocabIds: ${
      englishStats.firstTenUpdatedVocabIds.length
        ? englishStats.firstTenUpdatedVocabIds.join(', ')
        : '(none)'
    }`
  );

  console.log('\nSpanish');
  console.log(`- scanned: ${spanishStats.scanned}`);
  console.log(`- updated: ${spanishStats.updated}`);
  console.log(`- skipped: ${spanishStats.skipped}`);
  console.log(
    `- missing/empty textTarget: ${spanishStats.missingOrEmptyTextTarget}`
  );
  console.log(
    `- first 10 updated vocabIds: ${
      spanishStats.firstTenUpdatedVocabIds.length
        ? spanishStats.firstTenUpdatedVocabIds.join(', ')
        : '(none)'
    }`
  );
}

async function main() {
  const flags = parseArgs(process.argv);

  console.log(
    `[migrate] Starting migration (dryRun=${flags.dryRun}, dropTextTarget=${flags.dropTextTarget}, batchSize=${flags.batchSize}, limit=${flags.limit ?? 'none'}, retryAttempts=${flags.retryAttempts})`
  );

  ensureFileExists(SERVICE_ACCOUNT_PATH, 'service account key');
  const serviceAccount = readServiceAccount(SERVICE_ACCOUNT_PATH);

  console.log('[migrate] Initializing Firebase Admin...');
  const app =
    admin.apps.length === 0
      ? admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          projectId: serviceAccount.project_id,
        })
      : admin.apps[0];

  console.log('[migrate] Creating Firestore client...');
  const db = admin.firestore();
  db.settings({ preferRest: true });
  console.log('[migrate] Firestore client ready.');

  try {
    console.log('[migrate] Scanning english vocab docs...');
    const english = await scanLanguageDocs({
      db,
      languageId: 'english',
      nativeIso: 'en',
      targetIso: 'es',
      dropTextTarget: flags.dropTextTarget,
      limit: flags.limit,
    });
    console.log(
      `[migrate] English scan complete (scanned=${english.stats.scanned}, updates=${english.updates.length})`
    );

    console.log('[migrate] Scanning spanish vocab docs...');
    const spanish = await scanLanguageDocs({
      db,
      languageId: 'spanish',
      nativeIso: 'es',
      targetIso: 'en',
      dropTextTarget: flags.dropTextTarget,
      limit: flags.limit,
    });
    console.log(
      `[migrate] Spanish scan complete (scanned=${spanish.stats.scanned}, updates=${spanish.updates.length})`
    );

    await applyUpdates({
      db,
      updates: english.updates,
      languageLabel: 'english',
      batchSize: flags.batchSize,
      retryAttempts: flags.retryAttempts,
      dryRun: flags.dryRun,
    });

    await applyUpdates({
      db,
      updates: spanish.updates,
      languageLabel: 'spanish',
      batchSize: flags.batchSize,
      retryAttempts: flags.retryAttempts,
      dryRun: flags.dryRun,
    });

    printReport(english.stats, spanish.stats, flags.dryRun, flags.dropTextTarget);
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
