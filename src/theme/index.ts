// Theme exports

export { colors, type ColorKey } from './colors';
export { spacing, borderRadius } from './spacing';
export { typography } from './typography';

// Combined theme object for convenience
export const theme = {
  colors: require('./colors').colors,
  spacing: require('./spacing').spacing,
  borderRadius: require('./spacing').borderRadius,
} as const;
