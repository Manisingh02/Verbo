#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');
const readline = require('node:readline');
const { stringify } = require('csv-stringify/sync');

const DEFAULT_SENTENCES_PATH = '/Users/gurveerwaraich/Downloads/sentences.csv';
const DEFAULT_LINKS_PATH = '/Users/gurveerwaraich/Downloads/links.csv';
const DEFAULT_OUT_DIR = './scripts/output';
const DEFAULT_LIMIT = 500;
const DEFAULT_MIN_WORDS = 2;
const DEFAULT_MAX_WORDS = 12;
const DEFAULT_SEED = 42;
const TATOEBA_ENG_CODE = 'eng';
const TATOEBA_SPA_CODE = 'spa';

function parseIntFlag(rawValue, flagName, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${flagName} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function parseArgs(argv) {
  const flags = {
    sentences: DEFAULT_SENTENCES_PATH,
    links: DEFAULT_LINKS_PATH,
    out: DEFAULT_OUT_DIR,
    limit: DEFAULT_LIMIT,
    minWords: DEFAULT_MIN_WORDS,
    maxWords: DEFAULT_MAX_WORDS,
    seed: DEFAULT_SEED,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--sentences') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --sentences');
      }
      flags.sentences = value.trim();
      i += 1;
      continue;
    }

    if (arg === '--links') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --links');
      }
      flags.links = value.trim();
      i += 1;
      continue;
    }

    if (arg === '--out') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --out');
      }
      flags.out = value.trim();
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

    if (arg === '--minWords') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --minWords');
      }
      flags.minWords = parseIntFlag(value, '--minWords', 1, 1_000);
      i += 1;
      continue;
    }

    if (arg === '--maxWords') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --maxWords');
      }
      flags.maxWords = parseIntFlag(value, '--maxWords', 1, 1_000);
      i += 1;
      continue;
    }

    if (arg === '--seed') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --seed');
      }
      flags.seed = parseIntFlag(value, '--seed', 0, 4_294_967_295);
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (flags.minWords > flags.maxWords) {
    throw new Error('--minWords cannot be greater than --maxWords');
  }

  return flags;
}

function ensureFileExists(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required ${label} file: ${filePath}`);
  }
}

function removeBom(value) {
  return value.replace(/^\uFEFF/, '');
}

function normalizeSentenceLanguageCode(rawValue) {
  return removeBom(String(rawValue || '').trim())
    .replace(/^"+|"+$/g, '')
    .toLowerCase();
}

function splitTsvSentenceLine(line) {
  const parts = line.split('\t');
  if (parts.length < 3) {
    return null;
  }

  const sentenceId = removeBom(String(parts[0] || '').trim());
  const lang = normalizeSentenceLanguageCode(parts[1]);
  const text = parts.slice(2).join('\t').trim();

  if (!sentenceId || !lang) {
    return null;
  }

  return { sentenceId, lang, text };
}

function splitTsvLinkLine(line) {
  const parts = line.split('\t');
  if (parts.length < 2) {
    return null;
  }

  const sentenceId = removeBom(String(parts[0] || '').trim());
  const translationId = String(parts[1] || '').trim();
  if (!sentenceId || !translationId) {
    return null;
  }

  return { sentenceId, translationId };
}

async function loadSentencesByLanguage(sentencesPath) {
  const engSentences = new Map();
  const spaSentences = new Map();

  const stream = fs.createReadStream(sentencesPath, { encoding: 'utf8' });
  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const parsed = splitTsvSentenceLine(line);
    if (!parsed) {
      continue;
    }

    if (parsed.lang === TATOEBA_ENG_CODE) {
      if (!engSentences.has(parsed.sentenceId)) {
        engSentences.set(parsed.sentenceId, parsed.text);
      }
      continue;
    }

    if (parsed.lang === TATOEBA_SPA_CODE) {
      if (!spaSentences.has(parsed.sentenceId)) {
        spaSentences.set(parsed.sentenceId, parsed.text);
      }
    }
  }

  return { engSentences, spaSentences };
}

function countWordsBySpace(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

function hasLetters(text) {
  return /\p{L}/u.test(text);
}

function shouldDropSentence(text, minWords, maxWords) {
  const trimmed = text.trim();
  if (!trimmed) {
    return true;
  }

  const wordCount = countWordsBySpace(trimmed);
  if (wordCount < minWords || wordCount > maxWords) {
    return true;
  }

  const lower = trimmed.toLowerCase();
  if (lower.includes('http') || lower.includes('www') || lower.includes('@')) {
    return true;
  }

  if (!hasLetters(trimmed)) {
    return true;
  }

  return false;
}

function stripAccents(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function buildPairIdBase(englishText) {
  const lettersOnly = stripAccents(englishText.toLowerCase()).replace(/[^a-z]/g, '');
  const cropped = lettersOnly.slice(0, 24);
  return cropped || 'phrase';
}

function getUniquePairId(base, usedIds) {
  const seen = usedIds.get(base) || 0;
  const next = seen + 1;
  usedIds.set(base, next);
  if (next === 1) {
    return base;
  }
  return `${base}_${next}`;
}

function createSeededRng(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function shuffleDeterministically(items, rng) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

async function buildPairsFromLinks({
  linksPath,
  engSentences,
  spaSentences,
  minWords,
  maxWords,
}) {
  const dedupe = new Set();
  const pairs = [];
  let candidateLinks = 0;

  const stream = fs.createReadStream(linksPath, { encoding: 'utf8' });
  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const parsed = splitTsvLinkLine(line);
    if (!parsed) {
      continue;
    }

    let engText = '';
    let spaText = '';

    if (engSentences.has(parsed.sentenceId) && spaSentences.has(parsed.translationId)) {
      engText = String(engSentences.get(parsed.sentenceId) || '').trim();
      spaText = String(spaSentences.get(parsed.translationId) || '').trim();
    } else if (spaSentences.has(parsed.sentenceId) && engSentences.has(parsed.translationId)) {
      engText = String(engSentences.get(parsed.translationId) || '').trim();
      spaText = String(spaSentences.get(parsed.sentenceId) || '').trim();
    } else {
      continue;
    }

    candidateLinks += 1;

    if (shouldDropSentence(engText, minWords, maxWords)) {
      continue;
    }
    if (shouldDropSentence(spaText, minWords, maxWords)) {
      continue;
    }

    const key = `${engText.toLowerCase()}||${spaText.toLowerCase()}`;
    if (dedupe.has(key)) {
      continue;
    }

    dedupe.add(key);
    pairs.push({ textEn: engText, textEs: spaText });
  }

  return { pairs, candidateLinks };
}

function toOutputRows(pairs, limit) {
  const usedIds = new Map();
  const rows = pairs.slice(0, limit).map((pair, index) => {
    const base = buildPairIdBase(pair.textEn);
    const pairId = getUniquePairId(base, usedIds);
    return {
      pairId,
      text_en: pair.textEn,
      text_es: pair.textEs,
      rank: index + 1,
      sourceDataset: 'TATOEBA',
    };
  });
  return rows;
}

function printReport({
  engLoaded,
  spaLoaded,
  candidateLinks,
  pairsAfterFiltering,
  pairsWritten,
  firstTenPairIds,
}) {
  console.log('=== Tatoeba Phrase Prep Report ===');
  console.log(`Total eng sentences loaded: ${engLoaded}`);
  console.log(`Total spa sentences loaded: ${spaLoaded}`);
  console.log(`Total candidate links: ${candidateLinks}`);
  console.log(`Total pairs after filtering: ${pairsAfterFiltering}`);
  console.log(`Total pairs written: ${pairsWritten}`);
  console.log(
    `First 10 pairIds: ${firstTenPairIds.length ? firstTenPairIds.join(', ') : '(none)'}`
  );
}

async function main() {
  const flags = parseArgs(process.argv);

  const sentencesPath = path.resolve(process.cwd(), flags.sentences);
  const linksPath = path.resolve(process.cwd(), flags.links);
  const outDir = path.resolve(process.cwd(), flags.out);
  const outCsvPath = path.join(outDir, 'tatoeba_phrases_en_es_ready.csv');

  ensureFileExists(sentencesPath, 'sentences');
  ensureFileExists(linksPath, 'links');

  console.log(`[prepare] Loading sentences from: ${sentencesPath}`);
  const { engSentences, spaSentences } = await loadSentencesByLanguage(sentencesPath);
  console.log(
    `[prepare] Loaded sentence maps -> eng: ${engSentences.size}, spa: ${spaSentences.size}`
  );

  console.log(`[prepare] Scanning links from: ${linksPath}`);
  const { pairs, candidateLinks } = await buildPairsFromLinks({
    linksPath,
    engSentences,
    spaSentences,
    minWords: flags.minWords,
    maxWords: flags.maxWords,
  });

  const rng = createSeededRng(flags.seed);
  shuffleDeterministically(pairs, rng);

  const rows = toOutputRows(pairs, flags.limit);

  fs.mkdirSync(outDir, { recursive: true });
  const csv = stringify(rows, {
    header: true,
    columns: ['pairId', 'text_en', 'text_es', 'rank', 'sourceDataset'],
  });
  fs.writeFileSync(outCsvPath, csv, 'utf8');

  printReport({
    engLoaded: engSentences.size,
    spaLoaded: spaSentences.size,
    candidateLinks,
    pairsAfterFiltering: pairs.length,
    pairsWritten: rows.length,
    firstTenPairIds: rows.slice(0, 10).map((row) => row.pairId),
  });

  console.log(`Output written: ${outCsvPath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Fatal error: ${message}`);
  process.exit(1);
});
