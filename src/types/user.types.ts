// User-related types based on Firestore schema

export interface UserStats {
  totalXp: number;
  streak: number;
  lastActive: Date;
}

export interface User {
  uid: string;
  email: string;
  firstName: string;
  lastName: string;
  nativeLanguage: string;
  targetLanguage: string;
  profilePictureUrl?: string;
  createdAt: Date;
  stats: UserStats;
}

export interface LearningPlan {
  currentLanguageId: string;
  currentLevelId: string;
  updatedAt: Date;
}

export type RoadmapItemType = 'unit' | 'lesson' | 'checkpoint';
export type RoadmapItemStatus = 'locked' | 'unlocked' | 'completed';

export interface RoadmapItem {
  id: string;
  type: RoadmapItemType;
  orderIndex: number;
  levelId: string;
  status: RoadmapItemStatus;
  unlockedAt?: Date;
  completedAt?: Date;
}

export interface Language {
  id: string;
  name: string;
  isoCode: string;
}

export interface Level {
  id: string;
  levelNumber: number;
  description: string;
}

// API request/response types
export interface CreateUserRequest {
  email: string;
  firstName: string;
  lastName: string;
  nativeLanguage: string;
}

export interface SelectLanguageRequest {
  languageId: string;
}
