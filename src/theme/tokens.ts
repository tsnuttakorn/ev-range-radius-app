/**
 * Centralized design system tokens for the EV Range Radius app.
 * A single source of truth for color, spacing, radius, and type so every
 * screen renders as one coherent visual system instead of ad-hoc hex values.
 */

export type ThemeMode = 'dark' | 'light';

export const palette = {
  // Brand / semantic accents — consistent meaning across the whole app.
  brand: '#2dd4bf', // teal — primary EV/eco accent (was cyan #06b6d4)
  brandDim: 'rgba(45, 212, 191, 0.14)',
  info: '#38bdf8', // sky — informational / GPS
  reserve: '#f59e0b', // amber — reserve buffer / max theoretical range
  reserveDim: 'rgba(245, 158, 11, 0.14)',
  success: '#22c55e', // green — safe route / climate / available
  successDim: 'rgba(34, 197, 94, 0.14)',
  danger: '#f43f5e', // rose — unreachable / occupied / destructive
  dangerDim: 'rgba(244, 63, 94, 0.14)',
  neutral: '#64748b',
} as const;

const darkTheme = {
  mode: 'dark' as ThemeMode,
  bg: '#070b14',
  surface: '#111827',
  surfaceRaised: '#1a2333',
  surfaceSunken: '#0b1120',
  border: '#26324a',
  borderSubtle: 'rgba(148, 163, 184, 0.12)',
  textPrimary: '#f8fafc',
  textSecondary: '#9aa7bd',
  textTertiary: '#5b6b85',
  overlayScrim: 'rgba(4, 7, 13, 0.6)',
  statusBarStyle: 'light-content' as const,
};

const lightTheme = {
  mode: 'light' as ThemeMode,
  bg: '#f4f6fb',
  surface: '#ffffff',
  surfaceRaised: '#ffffff',
  surfaceSunken: '#eef1f7',
  border: '#dbe1ec',
  borderSubtle: 'rgba(15, 23, 42, 0.08)',
  textPrimary: '#0f172a',
  textSecondary: '#54607a',
  textTertiary: '#8b96ab',
  overlayScrim: 'rgba(15, 23, 42, 0.35)',
  statusBarStyle: 'dark-content' as const,
};

export const themes = { dark: darkTheme, light: lightTheme };

export const getTheme = (mode: ThemeMode) => ({ ...themes[mode], ...palette });

export type Theme = ReturnType<typeof getTheme>;

// Radius scale — pick from this set rather than one-off numbers so every card/pill/chip in the
// app reads as the same visual language. `card`/`pill`/`chip` are semantic aliases for the most
// common uses so call sites read as intent, not magic numbers.
export const radius = {
  xs: 6,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  pill: 999,
  card: 20, // standard content card (summary cards, form containers, itinerary sections)
  panel: 28, // the largest floating surfaces (bottom sheet, banners)
  chip: 8, // small icon chips / badges
} as const;

// Spacing scale — 4px base unit.
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
} as const;

export const typography = {
  display: { fontSize: 38, fontWeight: '800' as const, letterSpacing: -0.5 },
  title: { fontSize: 17, fontWeight: '700' as const },
  label: {
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 1.1,
    textTransform: 'uppercase' as const,
  },
  body: { fontSize: 13, fontWeight: '500' as const },
  caption: { fontSize: 11, fontWeight: '500' as const },
} as const;

export const elevation = (color = '#000') => ({
  shadowColor: color,
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.18,
  shadowRadius: 16,
  elevation: 6,
});

/**
 * Map-specific semantic colors — kept separate from the theme-aware `palette` because map
 * overlays (markers, polygons, callouts) intentionally stay dark/high-contrast regardless of
 * the app's light/dark mode, for legibility against satellite/street imagery. Referencing these
 * instead of literal hex keeps marker/route colors in sync with the same brand palette.
 */
export const mapColors = {
  chargerDC: palette.reserve,
  chargerAC: palette.brand,
  statusAvailable: palette.success,
  statusOccupied: palette.danger,
  statusMaintenance: '#5b6b85',
  routeSafe: palette.success,
  routeToStop: palette.brand,
  routeNeedsCharge: palette.reserve,
  routeUnreachable: palette.danger,
  surface: '#070b14',
  surfaceRaised: '#131a2b',
  border: '#26324a',
  textPrimary: '#ffffff',
  textSecondary: '#9aa7bd',
  textTertiary: '#5b6b85',
} as const;
