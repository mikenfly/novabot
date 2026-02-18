/** Design tokens — mapped from PWA CSS custom properties in pwa/src/styles/index.css */

export const colors = {
  bgPrimary: '#0c0c0e',
  bgSecondary: '#141416',
  bgTertiary: '#1c1c20',
  bgElevated: '#222228',

  textPrimary: '#ececf0',
  textSecondary: '#7a7a85',
  textTertiary: '#52525a',

  accent: '#7c5cfc',
  accentHover: '#9278ff',
  accentSubtle: 'rgba(124, 92, 252, 0.12)',
  accentGlow: 'rgba(124, 92, 252, 0.25)',

  error: '#ff5555',
  danger: '#ff5555',

  border: 'rgba(255, 255, 255, 0.06)',
  borderSubtle: 'rgba(255, 255, 255, 0.04)',

  messageUser: 'rgba(124, 92, 252, 0.15)',
  messageUserBorder: 'rgba(124, 92, 252, 0.2)',
  messageAssistant: 'rgba(255, 255, 255, 0.04)',
  messageAssistantBorder: 'rgba(255, 255, 255, 0.06)',

  connectionOk: '#34d399',
  connectionError: '#ff5555',
  connectionWarning: '#fbbf24',

  backdrop: 'rgba(0, 0, 0, 0.6)',
  glass: 'rgba(255, 255, 255, 0.03)',
  glassBorder: 'rgba(255, 255, 255, 0.06)',
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const typography = {
  body: {
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: -0.15,
  },
  bodySmall: {
    fontSize: 13,
    lineHeight: 18,
  },
  caption: {
    fontSize: 11,
    lineHeight: 14,
  },
  heading: {
    fontSize: 17,
    fontWeight: '600' as const,
    letterSpacing: -0.2,
  },
  mono: {
    fontFamily: 'Menlo',
    fontSize: 13,
    lineHeight: 18,
  },
} as const;

export const shadows = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.4,
    shadowRadius: 3,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
  },
} as const;

export const hitSlop = { top: 8, bottom: 8, left: 8, right: 8 } as const;
