import type { Rect, Text } from '@infinitered/react-native-mlkit-text-recognition';
import type {
  RNMLKitObjectDetectionObject,
  RNMLKitRect,
} from '@infinitered/react-native-mlkit-object-detection';

import type { VisionTranslationBox, VisionTranslationRegion } from '../../types/vision.types';

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

const COMMON_OCR_WORDS = new Set([
  'a',
  'afternoon',
  'bike',
  'bikes',
  'book',
  'books',
  'bottle',
  'car',
  'cars',
  'cat',
  'chair',
  'coffee',
  'dog',
  'food',
  'good',
  'have',
  'he',
  'hello',
  'hi',
  'home',
  'house',
  'i',
  'is',
  'john',
  'manvinder',
  'morning',
  'my',
  'name',
  'night',
  'phone',
  'please',
  'school',
  'she',
  'table',
  'tea',
  'thank',
  'thanks',
  'they',
  'water',
  'we',
  'you',
  'your',
]);

function getEditDistance(a: string, b: string): number {
  if (a === b) {
    return 0;
  }

  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, (_, rowIndex) =>
    Array.from({ length: cols }, (_, colIndex) => {
      if (rowIndex === 0) return colIndex;
      if (colIndex === 0) return rowIndex;
      return 0;
    })
  );

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const substitutionCost = a[row - 1] === b[col - 1] ? 0 : 1;
      dp[row][col] = Math.min(
        dp[row - 1][col] + 1,
        dp[row][col - 1] + 1,
        dp[row - 1][col - 1] + substitutionCost
      );
    }
  }

  return dp[a.length][b.length];
}

function correctAgainstCommonWords(token: string): string {
  const lower = token.toLowerCase();

  if (!/^[a-z]+$/i.test(token) || COMMON_OCR_WORDS.has(lower)) {
    return token;
  }

  let bestMatch: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of COMMON_OCR_WORDS) {
    if (Math.abs(candidate.length - lower.length) > 1) {
      continue;
    }

    const distance = getEditDistance(lower, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestMatch = candidate;
    }
  }

  if (!bestMatch || bestDistance > 1) {
    return token;
  }

  if (token === token.toUpperCase()) {
    return bestMatch.toUpperCase();
  }

  if (token[0] === token[0].toUpperCase()) {
    return `${bestMatch[0].toUpperCase()}${bestMatch.slice(1)}`;
  }

  return bestMatch;
}

function normalizeOcrToken(token: string): string {
  const digitLikeLetterMap: Record<string, string> = {
    '0': 'o',
    '1': 'i',
    '3': 'j',
    '4': 'a',
    '5': 's',
    '6': 'g',
    '8': 'b',
  };

  const letterCount = (token.match(/[A-Za-z]/g) || []).length;
  const digitCount = (token.match(/\d/g) || []).length;

  // Only repair mixed OCR tokens that are mostly alphabetic.
  if (digitCount === 0 || letterCount < 2) {
    return correctAgainstCommonWords(token);
  }

  return correctAgainstCommonWords(
    token.replace(/\d/g, (digit) => digitLikeLetterMap[digit] || digit)
  );
}

function normalizeText(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((token) => normalizeOcrToken(token))
    .join(' ');
}

function rectToBox(frame: Rect): VisionTranslationBox {
  return {
    x: frame.left,
    y: frame.top,
    width: Math.max(0, frame.right - frame.left),
    height: Math.max(0, frame.bottom - frame.top),
  };
}

function objectFrameToBox(frame: RNMLKitRect): VisionTranslationBox {
  return {
    x: frame.origin.x,
    y: frame.origin.y,
    width: Math.max(0, frame.size.x),
    height: Math.max(0, frame.size.y),
  };
}

export function normalizeRecognizedText(result: Text): {
  rawText: string[];
  regions: VisionTranslationRegion[];
} {
  const fullText = normalizeText(result.text || '');
  const regions = result.blocks.flatMap((block) =>
    block.lines
      .map((line) => ({
        text: normalizeText(line.text),
        ...rectToBox(line.frame),
      }))
      .filter((line) => !!line.text)
  );

  return {
    rawText: fullText ? [fullText] : dedupe(regions.map((region) => region.text)),
    regions,
  };
}

export function normalizeDetectedObjects(detections: RNMLKitObjectDetectionObject[]): {
  objectCount: number;
  rawLabels: string[];
  boxes: VisionTranslationBox[];
} {
  const entries = detections.flatMap((item) =>
    item.labels.map((label) => ({
      label: label.text.trim().toLowerCase(),
      box: objectFrameToBox(item.frame),
    }))
  );

  return {
    objectCount: detections.length,
    rawLabels: dedupe(entries.map((entry) => entry.label)),
    boxes: entries.map((entry) => entry.box),
  };
}
