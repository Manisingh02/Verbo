#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function ensureFileExists(filePath, label) {
  if (!fs.existsSync(filePath)) {
    console.error(`Missing required input file (${label}): ${filePath}`);
    process.exit(1);
  }
}

function stripAccents(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeLookupKey(value) {
  return stripAccents(String(value || '').toLowerCase().trim());
}

const CONTRACTION_FRAGMENTS = new Set(['s', 't', 'm', 're', 'll', 'd', 've']);

function shouldFilterTextNative(rawTextNative) {
  const textNative = String(rawTextNative || '').trim();
  const normalized = normalizeLookupKey(textNative);

  if (!textNative) {
    return true;
  }
  if (CONTRACTION_FRAGMENTS.has(normalized)) {
    return true;
  }
  if (normalized.length === 1 && normalized !== 'a' && normalized !== 'i') {
    return true;
  }
  if (!/^[a-z]+$/.test(normalized)) {
    return true;
  }
  return false;
}

function slugify(value) {
  const cleaned = stripAccents(String(value || '').toLowerCase().trim()).replace(/[^a-z]/g, '');
  return cleaned || 'word';
}

function getUniqueVocabId(slugBase, usedSlugs) {
  const count = usedSlugs.get(slugBase) || 0;
  const nextCount = count + 1;
  usedSlugs.set(slugBase, nextCount);
  if (nextCount === 1) {
    return slugBase;
  }
  return `${slugBase}_${nextCount}`;
}

function parseMusePairs(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const map = new Map();
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const parts = line.split(/\s+/);
    if (parts.length < 2) {
      continue;
    }
    const source = normalizeLookupKey(parts[0]);
    const target = parts[1].trim();
    if (!source || !target) {
      continue;
    }
    if (!map.has(source)) {
      map.set(source, target);
    }
  }
  return map;
}

function parseUsCsv(usPath) {
  const content = fs.readFileSync(usPath, 'utf8');
  const headerRows = parse(content, {
    columns: false,
    bom: true,
    trim: true,
    skip_empty_lines: true,
    to_line: 1,
  });

  const headers = headerRows[0] || [];
  const requiredHeaders = ['Word', 'Zipf-value', 'Dom_PoS_SUBTLEX'];
  const missing = requiredHeaders.filter((header) => !headers.includes(header));
  if (missing.length > 0) {
    console.error(
      `US CSV missing required headers: ${missing.join(', ')}. File: ${usPath}`
    );
    process.exit(1);
  }

  const rows = parse(content, {
    columns: true,
    bom: true,
    trim: true,
    skip_empty_lines: true,
  });

  const extracted = [];
  let filteredOut = 0;
  for (const row of rows) {
    const textNative = String(row['Word'] || '').trim();
    if (shouldFilterTextNative(textNative)) {
      filteredOut += 1;
      continue;
    }
    extracted.push({
      textNative,
      zipf: String(row['Zipf-value'] || '').trim(),
      pos: String(row['Dom_PoS_SUBTLEX'] || '').trim(),
    });
  }
  return { rows: extracted, filteredOut };
}

function parseEsCsv(esPath) {
  const content = fs.readFileSync(esPath, 'utf8');
  const rows = parse(content, {
    columns: false,
    bom: true,
    trim: true,
    skip_empty_lines: true,
    from_line: 2,
  });

  const extracted = [];
  let filteredOut = 0;
  for (const row of rows) {
    const textNative = String(row[0] || '').trim();
    if (shouldFilterTextNative(textNative)) {
      filteredOut += 1;
      continue;
    }
    extracted.push({
      textNative,
      logFreq: String(row[3] || '').trim(),
    });
  }
  return { rows: extracted, filteredOut };
}

function attachUsTranslations(usRows, enToEs) {
  const usedSlugs = new Map();
  const missingWords = [];
  const output = usRows.map((row, index) => {
    const key = normalizeLookupKey(row.textNative);
    const textTarget = enToEs.get(key) || '';
    if (!textTarget) {
      missingWords.push(row.textNative);
    }
    const vocabId = getUniqueVocabId(slugify(row.textNative), usedSlugs);
    return {
      vocabId,
      textNative: row.textNative,
      textTarget,
      zipf: row.zipf,
      pos: row.pos,
      rank: index + 1,
      sourceDataset: 'SUBTLEX-US',
    };
  });
  return { output, missingWords };
}

function attachEsTranslations(esRows, esToEn) {
  const usedSlugs = new Map();
  const missingWords = [];
  const output = esRows.map((row, index) => {
    const key = normalizeLookupKey(row.textNative);
    const textTarget = esToEn.get(key) || '';
    if (!textTarget) {
      missingWords.push(row.textNative);
    }
    const vocabId = getUniqueVocabId(slugify(row.textNative), usedSlugs);
    return {
      vocabId,
      textNative: row.textNative,
      textTarget,
      logFreq: row.logFreq,
      rank: index + 1,
      sourceDataset: 'SUBTLEX-ES',
    };
  });
  return { output, missingWords };
}

function writeCsv(filePath, records, columns) {
  const csv = stringify(records, {
    header: true,
    columns,
  });
  fs.writeFileSync(filePath, csv, 'utf8');
}

function printReport(usTotal, esTotal, usFilteredOut, esFilteredOut, usMissing, esMissing) {
  console.log('=== SUBTLEX Prep Report ===');
  console.log(`Total US rows processed: ${usTotal}`);
  console.log(`Total ES rows processed: ${esTotal}`);
  console.log(`Rows filtered out (US): ${usFilteredOut}`);
  console.log(`Rows filtered out (ES): ${esFilteredOut}`);
  console.log(`Missing translation count (US): ${usMissing.length}`);
  console.log(`Missing translation count (ES): ${esMissing.length}`);
  console.log(
    `First 20 missing US words: ${usMissing.slice(0, 20).join(', ') || '(none)'}`
  );
  console.log(
    `First 20 missing ES words: ${esMissing.slice(0, 20).join(', ') || '(none)'}`
  );
}

function main() {
  const args = parseArgs(process.argv);
  const projectRoot = process.cwd();

  const usPath = path.resolve(projectRoot, args.us || 'subtlex_us_top_500.csv');
  const esPath = path.resolve(projectRoot, args.es || 'subtlex_es_top_500.csv');
  const museEnEsPath = path.resolve(
    projectRoot,
    args.museEnEs || 'scripts/data/muse-en-es.txt'
  );
  const museEsEnPath = path.resolve(
    projectRoot,
    args.museEsEn || 'scripts/data/muse-es-en.txt'
  );
  const outDir = path.resolve(projectRoot, args.outDir || 'scripts/output');

  ensureFileExists(usPath, 'US CSV');
  ensureFileExists(esPath, 'ES CSV');
  ensureFileExists(museEnEsPath, 'MUSE EN->ES');
  ensureFileExists(museEsEnPath, 'MUSE ES->EN');

  const { rows: usRows, filteredOut: usFilteredOut } = parseUsCsv(usPath);
  const { rows: esRows, filteredOut: esFilteredOut } = parseEsCsv(esPath);
  const enToEs = parseMusePairs(museEnEsPath);
  const esToEn = parseMusePairs(museEsEnPath);

  const { output: usOutput, missingWords: usMissing } = attachUsTranslations(
    usRows,
    enToEs
  );
  const { output: esOutput, missingWords: esMissing } = attachEsTranslations(
    esRows,
    esToEn
  );

  fs.mkdirSync(outDir, { recursive: true });

  writeCsv(
    path.join(outDir, 'subtlex_us_top_500_ready.csv'),
    usOutput,
    ['vocabId', 'textNative', 'textTarget', 'zipf', 'pos', 'rank', 'sourceDataset']
  );
  writeCsv(
    path.join(outDir, 'subtlex_es_top_500_ready.csv'),
    esOutput,
    ['vocabId', 'textNative', 'textTarget', 'logFreq', 'rank', 'sourceDataset']
  );

  printReport(
    usOutput.length,
    esOutput.length,
    usFilteredOut,
    esFilteredOut,
    usMissing,
    esMissing
  );
}

main();
