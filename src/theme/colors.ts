// Verbo color palette - minimal/functional design

export const colors = {
  // Primary brand colors
  primary: '#6366F1', // Indigo
  primaryLight: '#818CF8',
  primaryDark: '#4F46E5',

  // Secondary colors
  secondary: '#10B981', // Emerald (for success/correct)
  secondaryLight: '#34D399',
  secondaryDark: '#059669',

  // Semantic colors
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#3B82F6',

  // Neutral colors
  white: '#FFFFFF',
  black: '#000000',

  // Grays
  gray50: '#F9FAFB',
  gray100: '#F3F4F6',
  gray200: '#E5E7EB',
  gray300: '#D1D5DB',
  gray400: '#9CA3AF',
  gray500: '#6B7280',
  gray600: '#4B5563',
  gray700: '#374151',
  gray800: '#1F2937',
  gray900: '#111827',

  // Background colors
  background: '#FFFFFF',
  backgroundSecondary: '#F9FAFB',
  backgroundTertiary: '#F3F4F6',

  // Text colors
  text: '#111827',
  textSecondary: '#6B7280',
  textTertiary: '#9CA3AF',
  textInverse: '#FFFFFF',

  // Border colors
  border: '#E5E7EB',
  borderFocused: '#6366F1',

  // Camera overlay
  cameraOverlay: 'rgba(0, 0, 0, 0.6)',
} as const;

export type ColorKey = keyof typeof colors;
