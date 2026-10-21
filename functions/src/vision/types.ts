export type VisionPipelineMode = 'ocr' | 'object_detection';

export type VisionBoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type VisionRegion = VisionBoundingBox & {
  text: string;
};

export type VisionDetectedLabel = {
  label: string;
  box?: VisionBoundingBox;
};

export type FlorenceVisionResult =
  | {
      mode: 'ocr';
      raw: unknown;
      lines: string[];
      regions: VisionRegion[];
      model: 'florence-2-base-ft';
    }
  | {
      mode: 'object_detection';
      raw: unknown;
      labels: VisionDetectedLabel[];
      model: 'florence-2-base-ft';
    };

export type ActiveVisionModel =
  | 'google-ml-kit'
  | 'florence-2-base-ft';

export type OCRTranslationResponse = {
  mode: 'ocr';
  sourceLanguage: string;
  targetLanguage: string;
  rawText: string[];
  translatedText: string[];
  regions: VisionRegion[];
  modelVision: ActiveVisionModel;
  modelTranslation: 'google-cloud-translation-v3';
  warning?: string;
};

export type ObjectDetectionTranslationResponse = {
  mode: 'object_detection';
  sourceLanguage: string;
  targetLanguage: string;
  rawLabels: string[];
  translatedLabels: string[];
  boxes: VisionBoundingBox[];
  modelVision: ActiveVisionModel;
  modelTranslation: 'google-cloud-translation-v3';
  warning?: string;
};

export type ImageTranslationResponse =
  | OCRTranslationResponse
  | ObjectDetectionTranslationResponse;
