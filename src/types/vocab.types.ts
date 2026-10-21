// Vocabulary-related types based on Firestore schema

export type VocabType = 'letter' | 'word' | 'phrase' | 'objectLabel';
export type VocabSource = 'camera' | 'preset_plan' | 'manual' | 'system_default';
export type FlashcardLevelId = 'alphabet' | 'words' | 'phrases' | 'personal';
export type FlashcardSource = 'all' | 'system' | 'user';

export interface Vocab {
  id: string;
  languageId: string;
  levelId?: string;
  type: VocabType;
  textNative: string;
  textTarget: string;
  audioUrl?: string;
  imageUrl?: string;
  source: VocabSource;
  visionResultId?: string;
  createdAt: Date;
}

export interface Flashcard {
  id: string;
  vocabId: string;
  frontText: string;
  backText: string;
  audioUrl?: string;
  createdAt: Date;
}

export interface FlashcardItem {
  id: string;
  levelId: FlashcardLevelId;
  frontText: string;
  backText: string;
  nativeIso: 'en' | 'es';
  order?: number;
  ttsType: 'letter' | 'text';
}

export interface ReviewQueueItem {
  vocabId: string;
  dueAt: Date;
  priority: number;
  intervalDays?: number;
  ease?: number;
  updatedAt: Date;
  // Populated vocab data for display
  vocab?: Vocab;
}

export interface AdaptiveEngineData {
  vocabId: string;
  difficultyScore: number;
  timesCorrect: number;
  timesIncorrect: number;
  lastSeen: Date;
  lastN?: number[]; // Last 20 attempt results (1 = correct, 0 = incorrect)
}
