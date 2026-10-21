#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');
const admin = require('firebase-admin');

const SERVICE_ACCOUNT_PATH = path.resolve(
  process.cwd(),
  'scripts/serviceAccountKey.json'
);

const ENGLISH_LETTERS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
  'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
];

const SPANISH_LETTERS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
  'N', 'Ñ', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
];

function parseArgs(argv) {
  const flags = {
    dryRun: false,
    lang: 'both',
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--dry-run') {
      flags.dryRun = true;
      continue;
    }

    if (arg === '--lang') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --lang');
      }
      const normalized = value.trim().toLowerCase();
      if (!['en', 'es', 'both'].includes(normalized)) {
        throw new Error('--lang must be one of: en, es, both');
      }
      flags.lang = normalized;
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

function toLetterId(letter) {
  if (letter === 'Ñ') {
    return 'enie';
  }
  return letter.toLowerCase();
}

function buildLetterDocs(languageId, nativeIso, letters) {
  return letters.map((letter, index) => {
    const letterId = toLetterId(letter);
    return {
      letterId,
      path: `languages/${languageId}/levels/alphabet/vocab/${letterId}`,
      data: {
        type: 'letter',
        nativeIso,
        textNative: letter,
        lowercase: letter.toLowerCase(),
        order: index + 1,
        sourceDataset: 'CURATED-ALPHABET',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    };
  });
}

function buildLevelSpec(languageId) {
  return {
    path: `languages/${languageId}/levels/alphabet`,
    data: {
      levelNumber: 1,
      description: 'Alphabet',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
  };
}

async function seedLanguage({ db, dryRun, languageId, nativeIso, letters }) {
  const levelSpec = buildLevelSpec(languageId);
  const letterDocs = buildLetterDocs(languageId, nativeIso, letters);

  if (!dryRun) {
    await db.doc(levelSpec.path).set(levelSpec.data, { merge: true });
    for (const doc of letterDocs) {
      await db.doc(doc.path).set(doc.data, { merge: true });
    }
  }

  return {
    processed: letterDocs.length,
    firstFewIds: letterDocs.slice(0, 8).map((doc) => doc.letterId),
  };
}

function printReport({ dryRun, enStats, esStats }) {
  console.log('=== Firestore Alphabet Seed Report ===');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE RUN'}`);
  console.log(`English letters processed: ${enStats.processed}`);
  console.log(`Spanish letters processed: ${esStats.processed}`);
  console.log(
    `First few English doc IDs written: ${
      enStats.firstFewIds.length ? enStats.firstFewIds.join(', ') : '(none)'
    }`
  );
  console.log(
    `First few Spanish doc IDs written: ${
      esStats.firstFewIds.length ? esStats.firstFewIds.join(', ') : '(none)'
    }`
  );
}

async function main() {
  const flags = parseArgs(process.argv);
  ensureFileExists(SERVICE_ACCOUNT_PATH, 'service account key');

  const serviceAccount = readServiceAccount(SERVICE_ACCOUNT_PATH);

  const app =
    admin.apps.length === 0
      ? admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        })
      : admin.apps[0];

  const db = admin.firestore();
  db.settings({ preferRest: true });

  const shouldDoEnglish = flags.lang === 'en' || flags.lang === 'both';
  const shouldDoSpanish = flags.lang === 'es' || flags.lang === 'both';

  const enStats = { processed: 0, firstFewIds: [] };
  const esStats = { processed: 0, firstFewIds: [] };

  try {
    if (shouldDoEnglish) {
      const result = await seedLanguage({
        db,
        dryRun: flags.dryRun,
        languageId: 'english',
        nativeIso: 'en',
        letters: ENGLISH_LETTERS,
      });
      enStats.processed = result.processed;
      enStats.firstFewIds = result.firstFewIds;
    }

    if (shouldDoSpanish) {
      const result = await seedLanguage({
        db,
        dryRun: flags.dryRun,
        languageId: 'spanish',
        nativeIso: 'es',
        letters: SPANISH_LETTERS,
      });
      esStats.processed = result.processed;
      esStats.firstFewIds = result.firstFewIds;
    }

    printReport({
      dryRun: flags.dryRun,
      enStats,
      esStats,
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
