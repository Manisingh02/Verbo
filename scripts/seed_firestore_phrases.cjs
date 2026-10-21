#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');
const { parse } = require('csv-parse/sync');

// Force REST path in local environments where gRPC can hang.
process.env.GOOGLE_CLOUD_DISABLE_GRPC = process.env.GOOGLE_CLOUD_DISABLE_GRPC || 'true';
process.env.NO_GCE_CHECK = process.env.NO_GCE_CHECK || 'true';

const admin = require('firebase-admin');

const DEFAULT_CSV_PATH = './scripts/output/tatoeba_phrases_en_es_ready.csv';
const SERVICE_ACCOUNT_PATH = './scripts/serviceAccountKey.json';
const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_RETRY_ATTEMPTS = 6;
const BASE_DELAY_MS = 500;
const COMMIT_TIMEOUT_MS = 45_000;

const REQUIRED_HEADERS = ['pairId', 'text_en', 'text_es', 'rank', 'sourceDataset'];

function parseIntFlag(rawValue, flagName, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${flagName} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function parseArgs(argv) {
  const flags = {
    csv: DEFAULT_CSV_PATH,
    limit: undefined,
    dryRun: false,
    batchSize: DEFAULT_BATCH_SIZE,
    retryAttempts: DEFAULT_RETRY_ATTEMPTS,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--dry-run') {
      flags.dryRun = true;
      continue;
    }

    if (arg === '--csv') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --csv');
      }
      flags.csv = value.trim();
      i += 1;
      continue;
    }

    if (arg === '--limit') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --limit');
      }
      flags.limit = parseIntFlag(value, '--limit', 1, 100_000);
      i += 1;
      continue;
    }

    if (arg === '--batchSize') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --batchSize');
      }
      flags.batchSize = parseIntFlag(value, '--batchSize', 1, 200);
      i += 1;
      continue;
    }

    if (arg === '--retryAttempts') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --retryAttempts');
      }
      flags.retryAttempts = parseIntFlag(value, '--retryAttempts', 1, 20);
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

function parseCsvRows(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const rows = parse(content, {
    columns: true,
    bom: true,
    trim: true,
    skip_empty_lines: true,
  });

  const actualHeaders = rows.length > 0 ? Object.keys(rows[0]) : [];
  for (const header of REQUIRED_HEADERS) {
    if (!actualHeaders.includes(header)) {
      throw new Error(`CSV missing required header "${header}" in ${filePath}`);
    }
  }

  return rows;
}

function bumpReason(reasonMap, key) {
  reasonMap[key] = (reasonMap[key] || 0) + 1;
}

function transformRows(rawRows, limit) {
  const rows = limit === undefined ? rawRows : rawRows.slice(0, limit);
  const validRows = [];
  const skippedReasons = {};

  for (const row of rows) {
    const pairId = String(row.pairId || '').trim();
    const textEn = String(row.text_en || '').trim();
    const textEs = String(row.text_es || '').trim();
    const rank = Number.parseInt(String(row.rank || '').trim(), 10);

    if (!pairId) {
      bumpReason(skippedReasons, 'missing_pairId');
      continue;
    }
    if (!textEn) {
      bumpReason(skippedReasons, 'missing_text_en');
      continue;
    }
    if (!textEs) {
      bumpReason(skippedReasons, 'missing_text_es');
      continue;
    }
    if (!Number.isInteger(rank) || rank < 1) {
      bumpReason(skippedReasons, 'invalid_rank');
      continue;
    }

    validRows.push({
      pairId,
      textEn,
      textEs,
      rank,
    });
  }

  return { validRows, skippedReasons };
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

async function commitChunkWithRetry({ db, ops, batchNumber, totalBatches, retryAttempts }) {
  for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
    console.log(
      `[seed-phrases] batch ${batchNumber}/${totalBatches} attempt ${attempt}/${retryAttempts} committing ${ops.length} ops...`
    );

    const batch = db.batch();
    for (const op of ops) {
      batch.set(op.docRef, op.data, { merge: true });
    }

    let timeoutId;
    try {
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          const timeoutError = new Error(
            `Batch commit timeout after ${COMMIT_TIMEOUT_MS}ms (batch ${batchNumber}/${totalBatches})`
          );
          timeoutError.code = 'ETIMEDOUT';
          reject(timeoutError);
        }, COMMIT_TIMEOUT_MS);
      });

      await Promise.race([batch.commit(), timeoutPromise]);
      clearTimeout(timeoutId);
      console.log(`[seed-phrases] batch ${batchNumber}/${totalBatches} committed`);
      return;
    } catch (error) {
      clearTimeout(timeoutId);
      const canRetry = isTransientError(error) && attempt < retryAttempts;
      if (!canRetry) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Failed batch ${batchNumber}/${totalBatches} attempt ${attempt}/${retryAttempts}: ${message}`
        );
      }

      const delayMs = BASE_DELAY_MS * 2 ** (attempt - 1);
      console.log(
        `[seed-phrases] batch ${batchNumber}/${totalBatches} attempt ${attempt}/${retryAttempts} failed; retrying in ${delayMs}ms`
      );
      await sleep(delayMs);
    }
  }

  throw new Error(`Retry attempts exhausted for batch ${batchNumber}/${totalBatches}`);
}

async function ensureLevelDocs(db, dryRun) {
  const specs = [
    {
      path: 'languages/english/levels/phrases',
      data: { levelNumber: 3, description: 'Phrases & Sentences' },
    },
    {
      path: 'languages/spanish/levels/phrases',
      data: { levelNumber: 3, description: 'Phrases & Sentences' },
    },
  ];

  if (dryRun) {
    return;
  }

  for (const spec of specs) {
    await db.doc(spec.path).set(spec.data, { merge: true });
  }
}

function buildWriteOps(db, validRows) {
  const ops = [];

  for (const row of validRows) {
    const englishRef = db.doc(`languages/english/levels/phrases/vocab/${row.pairId}`);
    const spanishRef = db.doc(`languages/spanish/levels/phrases/vocab/${row.pairId}`);

    ops.push({
      docRef: englishRef,
      data: {
        type: 'phrase',
        nativeIso: 'en',
        textNative: row.textEn,
        translations: { es: row.textEs },
        rank: row.rank,
        sourceDataset: 'TATOEBA',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    });

    ops.push({
      docRef: spanishRef,
      data: {
        type: 'phrase',
        nativeIso: 'es',
        textNative: row.textEs,
        translations: { en: row.textEn },
        rank: row.rank,
        sourceDataset: 'TATOEBA',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    });
  }

  return ops;
}

async function writeOpsInBatches({ db, ops, dryRun, batchSize, retryAttempts }) {
  if (dryRun || ops.length === 0) {
    return;
  }

  const totalBatches = Math.ceil(ops.length / batchSize);
  for (let i = 0; i < ops.length; i += batchSize) {
    const batchNumber = Math.floor(i / batchSize) + 1;
    const chunk = ops.slice(i, i + batchSize);
    await commitChunkWithRetry({
      db,
      ops: chunk,
      batchNumber,
      totalBatches,
      retryAttempts,
    });
  }
}

function printReport({
  dryRun,
  totalRowsRead,
  englishWritten,
  spanishWritten,
  skippedReasons,
  firstTenPairIds,
}) {
  console.log('\n=== Firestore Phrase Seed Report ===');
  if (dryRun) {
    console.log('DRY RUN: no Firestore writes were performed.');
  }
  console.log(`Total rows read: ${totalRowsRead}`);
  console.log(`English docs written: ${englishWritten}`);
  console.log(`Spanish docs written: ${spanishWritten}`);

  const skippedEntries = Object.entries(skippedReasons);
  if (skippedEntries.length === 0) {
    console.log('Skipped rows: 0');
  } else {
    const totalSkipped = skippedEntries.reduce((sum, [, count]) => sum + count, 0);
    console.log(`Skipped rows: ${totalSkipped}`);
    for (const [reason, count] of skippedEntries) {
      console.log(`- ${reason}: ${count}`);
    }
  }

  console.log(
    `First 10 pairIds written: ${firstTenPairIds.length ? firstTenPairIds.join(', ') : '(none)'}`
  );
}

async function main() {
  const flags = parseArgs(process.argv);

  const csvPath = path.resolve(process.cwd(), flags.csv);
  const serviceAccountPath = path.resolve(process.cwd(), SERVICE_ACCOUNT_PATH);

  ensureFileExists(csvPath, 'ready CSV');
  ensureFileExists(serviceAccountPath, 'service account key');

  console.log(`[seed-phrases] Reading CSV: ${csvPath}`);
  const rawRows = parseCsvRows(csvPath);
  const totalRowsRead = flags.limit === undefined ? rawRows.length : Math.min(rawRows.length, flags.limit);

  const { validRows, skippedReasons } = transformRows(rawRows, flags.limit);
  const firstTenPairIds = validRows.slice(0, 10).map((row) => row.pairId);

  if (flags.dryRun) {
    printReport({
      dryRun: true,
      totalRowsRead,
      englishWritten: validRows.length,
      spanishWritten: validRows.length,
      skippedReasons,
      firstTenPairIds,
    });
    return;
  }

  const serviceAccount = readServiceAccount(serviceAccountPath);
  const app =
    admin.apps.length === 0
      ? admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          projectId: serviceAccount.project_id,
        })
      : admin.apps[0];

  const db = admin.firestore();
  db.settings({ preferRest: true });

  try {
    await ensureLevelDocs(db, false);

    const ops = buildWriteOps(db, validRows);
    await writeOpsInBatches({
      db,
      ops,
      dryRun: false,
      batchSize: flags.batchSize,
      retryAttempts: flags.retryAttempts,
    });

    printReport({
      dryRun: false,
      totalRowsRead,
      englishWritten: validRows.length,
      spanishWritten: validRows.length,
      skippedReasons,
      firstTenPairIds,
    });
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
