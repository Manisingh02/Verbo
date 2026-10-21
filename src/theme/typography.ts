// Typography styles

import { StyleSheet } from 'react-native';
import { colors } from './colors';

export const typography = StyleSheet.create({
  // Headings
  h1: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.text,
    lineHeight: 40,
  },
  h2: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    lineHeight: 32,
  },
  h3: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
    lineHeight: 28,
  },
  h4: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    lineHeight: 24,
  },

  // Body text
  body: {
    fontSize: 16,
    fontWeight: '400',
    color: colors.text,
    lineHeight: 24,
  },
  bodySmall: {
    fontSize: 14,
    fontWeight: '400',
    color: colors.text,
    lineHeight: 20,
  },
  bodySemibold: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    lineHeight: 24,
  },

  // Caption/labels
  caption: {
    fontSize: 12,
    fontWeight: '400',
    color: colors.textSecondary,
    lineHeight: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textSecondary,
    lineHeight: 20,
  },

  // Special
  button: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 24,
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
});
