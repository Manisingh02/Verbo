// Combined providers wrapper

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './AuthProvider';

// Create a query client with default options
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

// Query keys for cache management
export const queryKeys = {
  user: ['user'] as const,
  userStats: ['user', 'stats'] as const,
  learningPlan: ['learningPlan'] as const,
  roadmap: ['roadmap'] as const,
  flashcards: (levelId: string) => ['flashcards', levelId] as const,
  quiz: (quizId: string) => ['quiz', quizId] as const,
  reviewQueue: ['reviewQueue'] as const,
  languages: ['languages'] as const,
};

interface AppProvidersProps {
  children: React.ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}

// Re-export individual providers and hooks
export { AuthProvider, useAuth } from './AuthProvider';
