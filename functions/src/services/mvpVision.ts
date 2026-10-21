import { VisionBoundingBox, VisionDetectedLabel, VisionPipelineMode, VisionRegion } from '../vision/types';

const DEFAULT_OCR_ENDPOINT = 'https://router.huggingface.co/hf-inference/models/microsoft/trocr-base-printed';
const DEFAULT_DETECTION_ENDPOINT =
  'https://router.huggingface.co/hf-inference/models/google/owlvit-base-patch32';

const OBJECT_DETECTION_LABELS = [
  'person',
  'car',
  'phone',
  'laptop',
  'bottle',
  'chair',
  'table',
  'food',
] as const;

type VisionRequest = {
  imageBase64: string;
  imageMimeType?: string;
  mode: VisionPipelineMode;
};

export type MvpVisionResult =
  | {
      mode: 'ocr';
      raw: unknown;
      lines: string[];
      regions: VisionRegion[];
      model: 'microsoft/trocr-base-printed';
    }
  | {
      mode: 'object_detection';
      raw: unknown;
      labels: Array<VisionDetectedLabel & { confidence?: number }>;
      model: 'google/owlvit-base-patch32';
    };

function getApiKey(): string {
  const apiKey = process.env.HUGGING_FACE_API_KEY || process.env.HF_TOKEN || '';
  if (!apiKey) {
    throw new Error('Missing HUGGING_FACE_API_KEY for Hugging Face vision requests.');
  }
  return apiKey;
}

function normalizeConfiguredEndpoint(value: string | undefined, fallback: string): string {
  const endpoint = (value || fallback).trim();
  if (!endpoint) {
    return fallback;
  }
  if (endpoint.startsWith('https://api-inference.huggingface.co/models/')) {
    const modelId = endpoint.replace('https://api-inference.huggingface.co/models/', '');
    return `https://router.huggingface.co/hf-inference/models/${modelId}`;
  }
  return endpoint;
}

function normalizeImageInput(imageBase64: string): string {
  return imageBase64.trim().replace(/^data:[^;]+;base64,/, '');
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
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

function normalizeBox(value: unknown): VisionBoundingBox | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const box = value as Record<string, unknown>;
  const xmin = toNumber(box.xmin ?? box.x ?? box.left);
  const ymin = toNumber(box.ymin ?? box.y ?? box.top);
  const xmax = toNumber(box.xmax ?? box.right);
  const ymax = toNumber(box.ymax ?? box.bottom);
  const width = toNumber(box.width);
  const height = toNumber(box.height);

  if (xmin !== null && ymin !== null && xmax !== null && ymax !== null) {
    return {
      x: xmin,
      y: ymin,
      width: Math.max(0, xmax - xmin),
      height: Math.max(0, ymax - ymin),
    };
  }

  if (xmin !== null && ymin !== null && width !== null && height !== null) {
    return {
      x: xmin,
      y: ymin,
      width: Math.max(0, width),
      height: Math.max(0, height),
    };
  }

  return undefined;
}

async function postToHuggingFace(
  endpoint: string,
  payload: Record<string, unknown>
): Promise<unknown> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Vision request failed with ${response.status}: ${text}`);
  }

  return (await response.json()) as unknown;
}

function parseTrocrResponse(raw: unknown): { lines: string[]; regions: VisionRegion[] } {
  const entries = Array.isArray(raw) ? raw : [raw];
  const lines = dedupe(
    entries.flatMap((entry) => {
      if (typeof entry === 'string') {
        return entry
          .split('\n')
          .map((item) => normalizeText(item))
          .filter(Boolean);
      }
      if (entry && typeof entry === 'object') {
        const generatedText = normalizeText((entry as Record<string, unknown>).generated_text);
        return generatedText
          ? generatedText.split('\n').map((item) => normalizeText(item)).filter(Boolean)
          : [];
      }
      return [];
    })
  );

  return { lines, regions: [] };
}

function parseOwlVitResponse(raw: unknown): Array<VisionDetectedLabel & { confidence?: number }> {
  if (!Array.isArray(raw)) {
    return [];
  }

  const normalized = raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const data = entry as Record<string, unknown>;
      const label = normalizeText(data.label);
      if (!label) {
        return null;
      }
      return {
        label,
        box: normalizeBox(data.box),
        confidence: toNumber(data.score) ?? undefined,
      };
    })
    .filter((item) => item !== null);

  const deduped = new Map<string, VisionDetectedLabel & { confidence?: number }>();
  for (const item of normalized) {
    const existing = deduped.get(item.label);
    if (!existing || (item.confidence ?? 0) > (existing.confidence ?? 0)) {
      deduped.set(item.label, item);
    }
  }

  return Array.from(deduped.values());
}

export async function runMvpVision(request: VisionRequest): Promise<MvpVisionResult> {
  const image = normalizeImageInput(request.imageBase64);

  if (request.mode === 'ocr') {
    const endpoint = normalizeConfiguredEndpoint(
      process.env.HUGGING_FACE_OCR_ENDPOINT,
      DEFAULT_OCR_ENDPOINT
    );
    const raw = await postToHuggingFace(endpoint, {
      inputs: image,
      options: {
        wait_for_model: true,
        use_cache: false,
      },
    });

    const { lines, regions } = parseTrocrResponse(raw);
    return {
      mode: 'ocr',
      raw,
      lines,
      regions,
      model: 'microsoft/trocr-base-printed',
    };
  }

  const endpoint = normalizeConfiguredEndpoint(
    process.env.HUGGING_FACE_DETECTION_ENDPOINT,
    DEFAULT_DETECTION_ENDPOINT
  );
  const raw = await postToHuggingFace(endpoint, {
    inputs: image,
    parameters: {
      candidate_labels: OBJECT_DETECTION_LABELS.map((label) => `a photo of a ${label}`),
      threshold: 0.12,
    },
    options: {
      wait_for_model: true,
      use_cache: false,
    },
  });

  const labels = parseOwlVitResponse(raw).map((item) => ({
    ...item,
    label: item.label.replace(/^a photo of a /, ''),
  }));

  return {
    mode: 'object_detection',
    raw,
    labels,
    model: 'google/owlvit-base-patch32',
  };
}
