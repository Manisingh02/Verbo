import { logger } from 'firebase-functions';

import {
  FlorenceVisionResult,
  VisionBoundingBox,
  VisionDetectedLabel,
  VisionPipelineMode,
  VisionRegion,
} from '../vision/types';

const FLORENCE_MODEL = 'microsoft/Florence-2-base-ft';
const FLORENCE_MODEL_NAME = 'florence-2-base-ft' as const;

type FlorenceRequest = {
  imageBase64: string;
  imageMimeType?: string;
  mode: VisionPipelineMode;
};

function getFlorenceTaskPrompt(mode: VisionPipelineMode): string {
  return mode === 'ocr' ? '<OCR_WITH_REGION>' : '<OD>';
}

function normalizeBase64Image(imageBase64: string, imageMimeType = 'image/jpeg') {
  const trimmed = imageBase64.trim();
  if (trimmed.startsWith('data:')) {
    return trimmed;
  }
  return `data:${imageMimeType};base64,${trimmed}`;
}

function getHuggingFaceConfig() {
  const apiKey = process.env.HUGGING_FACE_API_KEY || process.env.HF_TOKEN || '';
  const endpoint = (process.env.HUGGING_FACE_FLORENCE_ENDPOINT || '').trim();

  if (!apiKey) {
    throw new Error('Missing HUGGING_FACE_API_KEY for Florence vision requests.');
  }
  if (!endpoint) {
    throw new Error('Missing HUGGING_FACE_FLORENCE_ENDPOINT for Florence dedicated endpoint.');
  }

  return {
    apiKey,
    endpoint,
  };
}

async function callFlorenceEndpoint(request: FlorenceRequest): Promise<unknown> {
  const { apiKey, endpoint } = getHuggingFaceConfig();
  const prompt = getFlorenceTaskPrompt(request.mode);
  const imageDataUrl = normalizeBase64Image(request.imageBase64, request.imageMimeType);

  const candidateBodies = [
    {
      inputs: {
        image: imageDataUrl,
        text: prompt,
      },
      options: {
        wait_for_model: true,
        use_cache: false,
      },
    },
    {
      inputs: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              image: imageDataUrl,
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
    },
    {
      inputs: {
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: imageDataUrl,
                },
              },
              {
                type: 'text',
                text: prompt,
              },
            ],
          },
        ],
      },
      options: {
        wait_for_model: true,
        use_cache: false,
      },
    },
    {
      inputs: imageDataUrl,
      parameters: {
        prompt,
      },
      options: {
        wait_for_model: true,
        use_cache: false,
      },
    },
  ];

  let lastError: Error | null = null;

  for (const body of candidateBodies) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Florence request failed with ${response.status}: ${text}`);
      }

      return (await response.json()) as unknown;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown Florence request failure');
      logger.warn('Florence request attempt failed', {
        endpoint,
        mode: request.mode,
        prompt,
        error: lastError.message,
      });
    }
  }

  throw lastError || new Error('Florence request failed.');
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function parseJsonLikeString(value: string): unknown {
  const trimmed = value.trim();
  const candidates = [trimmed];

  if (trimmed.startsWith('```')) {
    const withoutFence = trimmed.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '');
    candidates.unshift(withoutFence.trim());
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (_error) {
      continue;
    }
  }

  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toBoundingBox(value: unknown): VisionBoundingBox | undefined {
  if (Array.isArray(value)) {
    if (value.length >= 4) {
      const [x1, y1, x2, y2] = value.map(toNumber);
      if ([x1, y1, x2, y2].every((part) => part !== null)) {
        return {
          x: x1 as number,
          y: y1 as number,
          width: Math.max(0, (x2 as number) - (x1 as number)),
          height: Math.max(0, (y2 as number) - (y1 as number)),
        };
      }
    }
    if (value.length >= 8) {
      const numbers = value.map(toNumber).filter((part): part is number => part !== null);
      if (numbers.length >= 8) {
        const xs = numbers.filter((_item, index) => index % 2 === 0);
        const ys = numbers.filter((_item, index) => index % 2 === 1);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        return {
          x: minX,
          y: minY,
          width: Math.max(0, maxX - minX),
          height: Math.max(0, maxY - minY),
        };
      }
    }
  }

  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const x = toNumber(record.x ?? record.left ?? record.x1);
  const y = toNumber(record.y ?? record.top ?? record.y1);
  const width = toNumber(record.width);
  const height = toNumber(record.height);
  const x2 = toNumber(record.x2 ?? record.right);
  const y2 = toNumber(record.y2 ?? record.bottom);

  if (x !== null && y !== null && width !== null && height !== null) {
    return { x, y, width, height };
  }

  if (x !== null && y !== null && x2 !== null && y2 !== null) {
    return {
      x,
      y,
      width: Math.max(0, x2 - x),
      height: Math.max(0, y2 - y),
    };
  }

  return undefined;
}

function flattenCandidates(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenCandidates(item));
  }
  if (typeof value === 'string') {
    const parsed = parseJsonLikeString(value);
    if (parsed !== value) {
      return flattenCandidates(parsed);
    }
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return [value, ...Object.values(record).flatMap((item) => flattenCandidates(item))];
  }
  return [value];
}

function extractOcrLines(raw: unknown): { lines: string[]; regions: VisionRegion[] } {
  const lines: string[] = [];
  const regions: VisionRegion[] = [];

  for (const candidate of flattenCandidates(raw)) {
    const record = asRecord(candidate);
    if (!record) {
      if (typeof candidate === 'string') {
        const text = normalizeString(candidate);
        if (text && !text.startsWith('<')) {
          lines.push(...text.split('\n').map((part) => part.trim()).filter(Boolean));
        }
      }
      continue;
    }

    const text =
      normalizeString(record.text) ||
      normalizeString(record.label) ||
      normalizeString(record.value) ||
      normalizeString(record.generated_text);

    const box =
      toBoundingBox(record.bbox) ||
      toBoundingBox(record.box) ||
      toBoundingBox(record.bounding_box) ||
      toBoundingBox(record.region) ||
      toBoundingBox(record.quad_box) ||
      toBoundingBox(record.quad_boxes);

    if (text && !text.startsWith('<')) {
      const splitLines = text.split('\n').map((part) => part.trim()).filter(Boolean);
      lines.push(...splitLines);
      if (box) {
        for (const line of splitLines) {
          regions.push({ text: line, ...box });
        }
      }
    }
  }

  return {
    lines: dedupeStrings(lines),
    regions,
  };
}

function extractDetectedLabels(raw: unknown): VisionDetectedLabel[] {
  const labels: VisionDetectedLabel[] = [];

  for (const candidate of flattenCandidates(raw)) {
    const record = asRecord(candidate);
    if (!record) {
      continue;
    }

    const label =
      normalizeString(record.label) ||
      normalizeString(record.object) ||
      normalizeString(record.category) ||
      normalizeString(record.name);

    const box =
      toBoundingBox(record.bbox) ||
      toBoundingBox(record.box) ||
      toBoundingBox(record.bounding_box);

    if (label) {
      labels.push({ label, box });
    }
  }

  const deduped = new Map<string, VisionDetectedLabel>();
  for (const item of labels) {
    const key = item.label.toLowerCase();
    if (!deduped.has(key)) {
      deduped.set(key, item);
    }
  }

  return Array.from(deduped.values());
}

export async function runFlorenceVision(request: FlorenceRequest): Promise<FlorenceVisionResult> {
  const raw = await callFlorenceEndpoint(request);

  if (request.mode === 'ocr') {
    const { lines, regions } = extractOcrLines(raw);
    return {
      mode: 'ocr',
      raw,
      lines,
      regions,
      model: FLORENCE_MODEL_NAME,
    };
  }

  return {
    mode: 'object_detection',
    raw,
    labels: extractDetectedLabels(raw),
    model: FLORENCE_MODEL_NAME,
  };
}
