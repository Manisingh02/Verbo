import { ImageTranslationResponse, VisionPipelineMode } from './types';
import { translateTexts } from '../services/translation';

function normalizeMode(value: unknown): VisionPipelineMode {
  return value === 'object_detection' ? 'object_detection' : 'ocr';
}

function normalizeLanguage(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : 'es';
}

export async function translateImagePipeline(params: {
  rawText?: unknown;
  rawLabels?: unknown;
  regions?: unknown;
  boxes?: unknown;
  mode?: unknown;
  targetLanguage?: unknown;
}): Promise<ImageTranslationResponse> {
  const mode = normalizeMode(params.mode);
  const targetLanguage = normalizeLanguage(params.targetLanguage);

  if (mode === 'ocr') {
    const rawText = Array.isArray(params.rawText)
      ? Array.from(
          new Set(
            params.rawText
              .map((item) => (typeof item === 'string' ? item.trim() : ''))
              .filter(Boolean)
          )
        )
      : [];

    const regions = Array.isArray(params.regions) ? params.regions : [];
    const translation = await translateTexts({
      texts: rawText,
      sourceLanguage: 'en',
      targetLanguage,
    });

    return {
      mode: 'ocr',
      sourceLanguage: translation.sourceLanguage,
      targetLanguage: translation.targetLanguage,
      rawText,
      translatedText: translation.translatedTexts,
      regions,
      modelVision: 'google-ml-kit',
      modelTranslation: translation.model,
      warning: rawText.length === 0 ? 'No text was detected in the image.' : undefined,
    };
  }

  const rawLabels = Array.isArray(params.rawLabels)
    ? Array.from(
        new Set(
          params.rawLabels
            .map((item) => (typeof item === 'string' ? item.trim().toLowerCase() : ''))
            .filter(Boolean)
        )
      )
    : [];
  const boxes = Array.isArray(params.boxes) ? params.boxes : [];
  const translation = await translateTexts({
    texts: rawLabels,
    sourceLanguage: 'en',
    targetLanguage,
  });

  return {
    mode: 'object_detection',
    sourceLanguage: translation.sourceLanguage,
    targetLanguage: translation.targetLanguage,
    rawLabels,
    translatedLabels: translation.translatedTexts,
    boxes,
    modelVision: 'google-ml-kit',
    modelTranslation: translation.model,
    warning: rawLabels.length === 0 ? 'No objects were detected in the image.' : undefined,
  };
}
