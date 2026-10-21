// Vision/Camera-related types based on Firestore schema

import type { VocabType } from './vocab.types';

export type VisionMode = 'text' | 'object';
export type VisionProvider = 'florence2_base_ft';
export type VisionTranslationMode = 'ocr' | 'object_detection';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectedObject {
  label: string;
  confidence: number;
  bbox?: BoundingBox;
}

export interface TextBlock {
  text: string;
  confidence: number;
}

export interface VisionResultNormalized {
  text?: {
    fullText?: string;
    blocks?: TextBlock[];
  };
  objects?: DetectedObject[];
  detectedLanguage?: string;
}

export interface VisionResult {
  id: string;
  mode: VisionMode;
  provider: VisionProvider;
  imageUrl: string;
  createdAt: Date;
  raw: Record<string, unknown>;
  normalized: VisionResultNormalized;
}

export interface Upload {
  id: string;
  fileUrl: string;
  type: 'vision' | 'profile' | 'misc';
  createdAt: Date;
}

// API response from vision Cloud Function
export interface VocabSuggestion {
  sourceIndex?: number;
  textNative: string;
  textTarget: string;
  type: VocabType;
  confidence: number;
  source: 'camera';
}

export interface VisionProcessResponse {
  visionResultId: string;
  imageUrl: string;
  suggestions: VocabSuggestion[];
}

// API request types
export interface ProcessImageRequest {
  uploadId: string;
  mode: VisionMode;
}

export interface ConfirmVocabRequest {
  visionResultId: string;
  suggestions: VocabSuggestion[];
}

export interface VisionTranslationBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisionTranslationRegion extends VisionTranslationBox {
  text: string;
}

export interface TranslateImageRequest {
  mode: VisionTranslationMode;
  targetLanguage?: string;
  rawText?: string[];
  rawLabels?: string[];
  regions?: VisionTranslationRegion[];
  boxes?: VisionTranslationBox[];
}

export interface OCRTranslationResult {
  mode: 'ocr';
  visionResultId: string;
  sourceLanguage: string;
  targetLanguage: string;
  rawText: string[];
  translatedText: string[];
  regions: VisionTranslationRegion[];
  modelVision: string;
  modelTranslation: string;
  warning?: string;
}

export interface ObjectDetectionTranslationResult {
  mode: 'object_detection';
  visionResultId: string;
  sourceLanguage: string;
  targetLanguage: string;
  rawLabels: string[];
  translatedLabels: string[];
  boxes: VisionTranslationBox[];
  modelVision: string;
  modelTranslation: string;
  warning?: string;
}

export type TranslateImageResponse = OCRTranslationResult | ObjectDetectionTranslationResult;
