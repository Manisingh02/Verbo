#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');
const { parse } = require('csv-parse/sync');

const BATCH_LIMIT = 200;
const BATCH_COMMIT_TIMEOUT_MS = 45_000;
const MAX_COMMIT_ATTEMPTS = 6;
const BASE_RETRY_DELAY_MS = 500;
let adminSingleton = null;

const PATHS = {
  usCsv: path.resolve(process.cwd(), 'scripts/output/subtlex_us_top_500_ready.csv'),
  esCsv: path.resolve(process.cwd(), 'scripts/output/subtlex_es_top_500_ready.csv'),
  serviceAccount: path.resolve(process.cwd(), 'scripts/serviceAccountKey.json'),
};

const US_HEADERS = [
  'vocabId',
  'textNative',
  'textTarget',
  'zipf',
  'pos',
  'rank',
  'sourceDataset',
];

const ES_HEADERS = [
  'vocabId',
  'textNative',
  'textTarget',
  'logFreq',
  'rank',
  'sourceDataset',
];

function getAdmin() {
  if (!adminSingleton) {
    adminSingleton = require('firebase-admin');
  }
  return adminSingleton;
}

function parseArgs(argv) {
  const flags = {
    dryRun: false,
    project: undefined,
    exportJsonPath: undefined,
    limit: undefined,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      flags.dryRun = true;
      continue;
    }
    if (arg === '--project') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --project');
      }
      flags.project = value.trim();
      i += 1;
      continue;
    }
    if (arg === '--export-json') {
      const maybePath = argv[i + 1];
      if (!maybePath || maybePath.startsWith('--')) {
        flags.exportJsonPath = 'scripts/output/firestore_vocab_seed.json';
      } else {
        flags.exportJsonPath = maybePath.trim();
        i += 1;
      }
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
    throw new Error(`Unknown argument: ${arg}`);
  }

  return flags;
}

function ensureFileExists(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required ${label} file: ${filePath}`);
  }
}

function readServiceAccount(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in service account file: ${filePath}`);
  }
  if (!json.project_id || !json.client_email || !json.private_key) {
    throw new Error(
      `Service account file missing required fields (project_id/client_email/private_key): ${filePath}`
    );
  }
  return json;
}

function parseCsv(filePath, requiredHeaders) {
  const content = fs.readFileSync(filePath, 'utf8');
  const records = parse(content, {
    columns: true,
    bom: true,
    trim: true,
    skip_empty_lines: true,
  });

  const actualHeaders = records.length > 0 ? Object.keys(records[0]) : [];
  for (const header of requiredHeaders) {
    if (!actualHeaders.includes(header)) {
      throw new Error(`CSV missing required header "${header}" in ${filePath}`);
    }
  }

  return records;
}

function bumpReason(reasonMap, key) {
  reasonMap[key] = (reasonMap[key] || 0) + 1;
}

function transformUsRows(rows) {
  const writes = [];
  const skipped = {};
  const firstTenIds = [];

  for (const row of rows) {
    const vocabId = String(row.vocabId || '').trim();
    const textNative = String(row.textNative || '').trim();
    const textTarget = String(row.textTarget || '').trim();
    const pos = String(row.pos || '').trim();
    const sourceDataset = String(row.sourceDataset || '').trim();

    if (!vocabId) {
      bumpReason(skipped, 'missing_vocabId');
      continue;
    }
    if (!textNative) {
      bumpReason(skipped, 'missing_textNative');
      continue;
    }
    if (sourceDataset !== 'SUBTLEX-US') {
      bumpReason(skipped, 'invalid_sourceDataset');
      continue;
    }

    const zipf = Number.parseFloat(String(row.zipf || '').trim());
    const rank = Number.parseInt(String(row.rank || '').trim(), 10);

    if (!Number.isFinite(zipf)) {
      bumpReason(skipped, 'invalid_zipf');
      continue;
    }
    if (!Number.isInteger(rank)) {
      bumpReason(skipped, 'invalid_rank');
      continue;
    }

    writes.push({
      vocabId,
      data: {
        type: 'word',
        textNative,
        textTarget,
        zipf,
        pos,
        rank,
        source: 'system_default',
        sourceDataset: 'SUBTLEX-US',
      },
    });
    if (firstTenIds.length < 10) {
      firstTenIds.push(vocabId);
    }
  }

  return { writes, skipped, firstTenIds };
}

function transformEsRows(rows) {
  const writes = [];
  const skipped = {};
  const firstTenIds = [];

  for (const row of rows) {
    const vocabId = String(row.vocabId || '').trim();
    const textNative = String(row.textNative || '').trim();
    const textTarget = String(row.textTarget || '').trim();
    const sourceDataset = String(row.sourceDataset || '').trim();

    if (!vocabId) {
      bumpReason(skipped, 'missing_vocabId');
      continue;
    }
    if (!textNative) {
      bumpReason(skipped, 'missing_textNative');
      continue;
    }
    if (sourceDataset !== 'SUBTLEX-ES') {
      bumpReason(skipped, 'invalid_sourceDataset');
      continue;
    }

    const logFreq = Number.parseFloat(String(row.logFreq || '').trim());
    const rank = Number.parseInt(String(row.rank || '').trim(), 10);

    if (!Number.isFinite(logFreq)) {
      bumpReason(skipped, 'invalid_logFreq');
      continue;
    }
    if (!Number.isInteger(rank)) {
      bumpReason(skipped, 'invalid_rank');
      continue;
    }

    writes.push({
      vocabId,
      data: {
        type: 'word',
        textNative,
        textTarget,
        logFreq,
        rank,
        source: 'system_default',
        sourceDataset: 'SUBTLEX-ES',
      },
    });
    if (firstTenIds.length < 10) {
      firstTenIds.push(vocabId);
    }
  }

  return { writes, skipped, firstTenIds };
}

function mergeReasonMaps(a, b) {
  const merged = { ...a };
  for (const [key, value] of Object.entries(b)) {
    merged[key] = (merged[key] || 0) + value;
  }
  return merged;
}

function buildExportPayload(usWrites, esWrites, skippedReasons) {
  const baseDocs = [
    {
      path: 'languages/english',
      data: { name: 'English', isoCode: 'en' },
    },
    {
      path: 'languages/spanish',
      data: { name: 'Spanish', isoCode: 'es' },
    },
    {
      path: 'languages/english/levels/words',
      data: { levelNumber: 2, description: 'Common words' },
    },
    {
      path: 'languages/spanish/levels/words',
      data: { levelNumber: 2, description: 'Common words' },
    },
  ];

  const englishVocabDocs = usWrites.map((row) => ({
    path: `languages/english/levels/words/vocab/${row.vocabId}`,
    data: {
      ...row.data,
      updatedAt: '__SERVER_TIMESTAMP__',
    },
  }));

  const spanishVocabDocs = esWrites.map((row) => ({
    path: `languages/spanish/levels/words/vocab/${row.vocabId}`,
    data: {
      ...row.data,
      updatedAt: '__SERVER_TIMESTAMP__',
    },
  }));

  return {
    generatedAt: new Date().toISOString(),
    notes: [
      'Import baseDocs first, then vocab docs.',
      'Replace "__SERVER_TIMESTAMP__" with server timestamps in your importer.',
      'All operations are intended as set(..., { merge: true }).',
    ],
    summary: {
      englishDocs: englishVocabDocs.length,
      spanishDocs: spanishVocabDocs.length,
      skippedReasons,
    },
    baseDocs,
    englishVocabDocs,
    spanishVocabDocs,
  };
}

function writeJsonExport(outPath, payload) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function ensureBaseDocs(db, dryRun) {
  const specs = [
    {
      path: 'languages/english',
      data: { name: 'English', isoCode: 'en' },
    },
    {
      path: 'languages/spanish',
      data: { name: 'Spanish', isoCode: 'es' },
    },
    {
      path: 'languages/english/levels/words',
      data: { levelNumber: 2, description: 'Common words' },
    },
    {
      path: 'languages/spanish/levels/words',
      data: { levelNumber: 2, description: 'Common words' },
    },
  ];

  if (dryRun) {
    return;
  }

  for (const spec of specs) {
    await db.doc(spec.path).set(spec.data, { merge: true });
  }
}

function initializeFirebase(serviceAccount, projectId) {
  const admin = getAdmin();
  // Prevent metadata endpoint probing in local/dev environments.
  process.env.NO_GCE_CHECK = 'true';

  if (admin.apps.length === 0) {
    return admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId,
    });
  }
  return admin.apps[0];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientCommitError(error) {
  const transientTokens = [
    'ETIMEDOUT',
    'ECONNRESET',
    'EAI_AGAIN',
    'DEADLINE_EXCEEDED',
    'UNAVAILABLE',
  ];

  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '').toUpperCase();
  return transientTokens.some((token) => code.includes(token) || message.includes(token));
}

async function writeRowsInBatches(db, writes, language, dryRun) {
  const admin = getAdmin();
  if (dryRun || writes.length === 0) {
    return 0;
  }

  const totalBatches = Math.ceil(writes.length / BATCH_LIMIT);
  let written = 0;
  for (let i = 0; i < writes.length; i += BATCH_LIMIT) {
    const batchNumber = Math.floor(i / BATCH_LIMIT) + 1;
    const chunk = writes.slice(i, i + BATCH_LIMIT);

    let committed = false;
    for (let attempt = 1; attempt <= MAX_COMMIT_ATTEMPTS; attempt += 1) {
      const batch = db.batch();
      for (const row of chunk) {
        const docPath = `languages/${language}/levels/words/vocab/${row.vocabId}`;
        const docRef = db.doc(docPath);
        batch.set(
          docRef,
          {
            ...row.data,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      console.log(
        `[seed] ${language} batch ${batchNumber}/${totalBatches} attempt ${attempt}/${MAX_COMMIT_ATTEMPTS} committing ${chunk.length} docs...`
      );

      try {
        let timeoutId;
        try {
          const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
              const timeoutError = new Error(
                `Commit timeout after ${BATCH_COMMIT_TIMEOUT_MS}ms`
              );
              timeoutError.code = 'ETIMEDOUT';
              reject(timeoutError);
            }, BATCH_COMMIT_TIMEOUT_MS);
          });

          await Promise.race([batch.commit(), timeoutPromise]);
        } finally {
          clearTimeout(timeoutId);
        }
        committed = true;
        break;
      } catch (error) {
        const retryable = isTransientCommitError(error);
        const canRetry = retryable && attempt < MAX_COMMIT_ATTEMPTS;
        if (!canRetry) {
          const reason = error instanceof Error ? error.message : String(error);
          throw new Error(
            `Failed commit for ${language} batch ${batchNumber}/${totalBatches} attempt ${attempt}/${MAX_COMMIT_ATTEMPTS}: ${reason}`
          );
        }

        const delayMs = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
        console.log(
          `[seed] ${language} batch ${batchNumber}/${totalBatches} attempt ${attempt}/${MAX_COMMIT_ATTEMPTS} failed; retrying in ${delayMs}ms`
        );
        await sleep(delayMs);
      }
    }

    if (!committed) {
      throw new Error(
        `Commit did not succeed for ${language} batch ${batchNumber}/${totalBatches}`
      );
    }

    written += chunk.length;
    console.log(
      `[seed] ${language} batch ${batchNumber}/${totalBatches} committed (cumulative ${written}/${writes.length})`
    );
  }

  return written;
}

function printFinalReport({
  dryRun,
  modeMessage,
  englishWritten,
  spanishWritten,
  skippedReasons,
  firstEnglishIds,
  firstSpanishIds,
}) {
  console.log('\n=== Firestore Vocab Seed Report ===');
  if (modeMessage) {
    console.log(modeMessage);
  } else if (dryRun) {
    console.log('DRY RUN: no Firestore writes were performed.');
  }
  console.log(`English docs written: ${englishWritten}`);
  console.log(`Spanish docs written: ${spanishWritten}`);

  const skippedEntries = Object.entries(skippedReasons);
  if (skippedEntries.length === 0) {
    console.log('Rows skipped: 0');
  } else {
    console.log('Rows skipped (by reason):');
    for (const [reason, count] of skippedEntries) {
      console.log(`- ${reason}: ${count}`);
    }
  }

  console.log(
    `First 10 English vocabIds written: ${
      firstEnglishIds.length ? firstEnglishIds.join(', ') : '(none)'
    }`
  );
  console.log(
    `First 10 Spanish vocabIds written: ${
      firstSpanishIds.length ? firstSpanishIds.join(', ') : '(none)'
    }`
  );
}

function applyLimit(writes, limit) {
  if (limit === undefined) {
    return writes;
  }
  return writes.slice(0, limit);
}

function firstTenVocabIds(writes) {
  return writes.slice(0, 10).map((row) => row.vocabId);
}

async function main() {
  const { dryRun, project, exportJsonPath, limit } = parseArgs(process.argv);
  let firebaseApp = null;
  let db = null;

  try {
    ensureFileExists(PATHS.usCsv, 'US CSV');
    ensureFileExists(PATHS.esCsv, 'ES CSV');

    if (!exportJsonPath) {
      ensureFileExists(PATHS.serviceAccount, 'service account');
    }

    console.log(`[seed] Reading US CSV: ${PATHS.usCsv}`);
    const usRows = parseCsv(PATHS.usCsv, US_HEADERS);
    console.log(`[seed] Reading ES CSV: ${PATHS.esCsv}`);
    const esRows = parseCsv(PATHS.esCsv, ES_HEADERS);
    console.log(`[seed] Parsed rows -> US: ${usRows.length}, ES: ${esRows.length}`);

    const usResult = transformUsRows(usRows);
    const esResult = transformEsRows(esRows);
    const skippedReasons = mergeReasonMaps(usResult.skipped, esResult.skipped);
    const usWrites = applyLimit(usResult.writes, limit);
    const esWrites = applyLimit(esResult.writes, limit);
    const firstEnglishIds = firstTenVocabIds(usWrites);
    const firstSpanishIds = firstTenVocabIds(esWrites);

    if (exportJsonPath) {
      const resolvedOutPath = path.resolve(process.cwd(), exportJsonPath);
      const payload = buildExportPayload(usWrites, esWrites, skippedReasons);
      writeJsonExport(resolvedOutPath, payload);

      printFinalReport({
        dryRun: false,
        modeMessage: 'EXPORT JSON: no Firestore writes were performed.',
        englishWritten: usWrites.length,
        spanishWritten: esWrites.length,
        skippedReasons,
        firstEnglishIds,
        firstSpanishIds,
      });
      console.log(`JSON export written: ${resolvedOutPath}`);
      return;
    }

    if (dryRun) {
      printFinalReport({
        dryRun: true,
        modeMessage: undefined,
        englishWritten: usWrites.length,
        spanishWritten: esWrites.length,
        skippedReasons,
        firstEnglishIds,
        firstSpanishIds,
      });
      return;
    }

    const serviceAccount = readServiceAccount(PATHS.serviceAccount);
    const projectId = project || serviceAccount.project_id;

    const admin = getAdmin();
    firebaseApp = initializeFirebase(serviceAccount, projectId);
    db = admin.firestore();
    db.settings({ preferRest: true });

    await ensureBaseDocs(db, dryRun);

    const englishWritten = await writeRowsInBatches(db, usWrites, 'english', false);
    const spanishWritten = await writeRowsInBatches(db, esWrites, 'spanish', false);

    printFinalReport({
      dryRun,
      modeMessage: undefined,
      englishWritten,
      spanishWritten,
      skippedReasons,
      firstEnglishIds,
      firstSpanishIds,
    });
  } finally {
    if (db && typeof db.terminate === 'function') {
      await db.terminate();
    }
    if (firebaseApp) {
      await firebaseApp.delete();
    }
  }
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
