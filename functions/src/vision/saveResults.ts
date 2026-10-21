import * as admin from 'firebase-admin';
import { randomUUID } from 'crypto';

import { ImageTranslationResponse } from './types';

type SaveParams = {
  uid: string;
  result: ImageTranslationResponse;
  languageId: string;
  levelId: string;
};

export type ConfirmedVisionFlashcardInput = {
  sourceIndex?: number;
  textNative: string;
  textTarget: string;
  type?: 'word' | 'phrase' | 'objectLabel';
};

type VisionResultPayload = {
  normalized: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function normalizeConfirmedType(value: unknown): 'word' | 'phrase' | 'objectLabel' {
  return value === 'phrase' || value === 'objectLabel' ? value : 'word';
}

function buildVisionResultPayload(result: ImageTranslationResponse): VisionResultPayload {
  if (result.mode === 'ocr') {
    return {
      rawPayload: { rawText: result.rawText },
      normalized: {
        text: {
          fullText: result.rawText.join(' '),
          blocks: result.regions,
        },
      },
    };
  }

  return {
    rawPayload: { rawLabels: result.rawLabels },
    normalized: {
      objects: result.rawLabels.map((label, index) => ({
        label,
        bbox: result.boxes[index] || null,
      })),
    },
  };
}

export async function saveVisionTranslationResult(params: SaveParams): Promise<string> {
  const db = admin.firestore();
  const createdAt = admin.firestore.FieldValue.serverTimestamp();
  const resultRef = db.collection('users').doc(params.uid).collection('vision_results').doc();
  const result = params.result;
  const { rawPayload, normalized } = buildVisionResultPayload(result);

  await resultRef.set({
    mode: result.mode,
    provider: result.modelVision,
    imageUrl: '',
    createdAt,
    raw: rawPayload,
    normalized,
    detectedLanguage: result.sourceLanguage,
    languageId: params.languageId,
    levelId: params.levelId,
  });

  return resultRef.id;
}

export async function saveConfirmedVisionFlashcards(params: {
  uid: string;
  visionResultId: string;
  languageId: string;
  levelId: string;
  items: ConfirmedVisionFlashcardInput[];
}): Promise<
  Array<{
    id: string;
    vocabId: string;
    frontText: string;
    backText: string;
  }>
> {
  const db = admin.firestore();
  const resultRef = db
    .collection('users')
    .doc(params.uid)
    .collection('vision_results')
    .doc(params.visionResultId);
  const resultSnapshot = await resultRef.get();

  if (!resultSnapshot.exists) {
    throw new Error('Vision result not found');
  }

  const createdAt = admin.firestore.FieldValue.serverTimestamp();
  const dueNow = admin.firestore.Timestamp.now();
  const batch = db.batch();
  const orderBase = Date.now();
  const savedFlashcards: Array<{
    id: string;
    vocabId: string;
    frontText: string;
    backText: string;
  }> = [];

  params.items.forEach((item, index) => {
    const textNative = item.textNative.trim();
    const textTarget = item.textTarget.trim();
    if (!textNative || !textTarget) {
      return;
    }

    const sourceIndex = typeof item.sourceIndex === 'number' ? item.sourceIndex : index;
    const idSlug = slugify(textNative || textTarget) || randomUUID();
    const vocabId = `${params.visionResultId}-${sourceIndex}-${idSlug}`;
    const vocabRef = db.collection('users').doc(params.uid).collection('vocab').doc(vocabId);
    batch.set(
      vocabRef,
      {
        languageId: params.languageId,
        levelId: params.levelId,
        type: normalizeConfirmedType(item.type),
        textNative,
        textTarget,
        source: 'camera',
        visionResultId: params.visionResultId,
        sourceIndex,
        userId: params.uid,
        createdAt,
        confirmedAt: createdAt,
      },
      { merge: true }
    );

    const orderedRef = db
      .collection('users')
      .doc(params.uid)
      .collection('learning_plans')
      .doc('active')
      .collection('ordered_vocab')
      .doc(vocabId);
    batch.set(
      orderedRef,
      {
        orderIndex: orderBase + index,
        addedAt: createdAt,
        source: 'camera',
        visionResultId: params.visionResultId,
      },
      { merge: true }
    );

    const reviewQueueRef = db
      .collection('users')
      .doc(params.uid)
      .collection('learning_plans')
      .doc('active')
      .collection('review_queue')
      .doc(vocabId);
    batch.set(
      reviewQueueRef,
      {
        dueAt: dueNow,
        priority: 100,
        updatedAt: createdAt,
        intervalDays: 0,
        ease: 2.5,
      },
      { merge: true }
    );

    savedFlashcards.push({
      id: vocabId,
      vocabId,
      frontText: textTarget,
      backText: textNative,
    });
  });

  await batch.commit();
  return savedFlashcards;
}
