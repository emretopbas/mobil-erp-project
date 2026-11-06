// Modernist design system — ported from src/design-systems/_ds/modernist-…/styles.css
// and readme.md (the Claude Design project export). That folder is the vendored
// source of truth (raw CSS + docs); this file is the React Native port of its
// tokens. Keep them in sync by hand — there's no build step wiring one to the
// other. See ../design-systems/_ds/modernist-…/readme.md for the full guide
// ("Do" / "Don't" rules, which class is which).
//
// This is the system's LIGHT, flush-left, zero-radius "Modernist" look — flat,
// architectural, near-mono red on white, strong 2px rules. This is the whole
// app's design system now — the queue-erp shell (features/queue-erp/) that
// used to carry its own separate fixed-dark `theme.ts` override now draws
// from these same tokens (bg/text swap for ground/ink turned out to be the
// entire delta — same accent, same zero radius, same Archivo; see this
// session's progress.md entry for the port).

import { Platform } from 'react-native';

export const color = {
  bg: '#f3f2f2',
  surface: '#eae9e9',
  text: '#201e1d',
  accent: '#ec3013',
  accent2: '#e15b47',
  // --color-divider: color-mix(in srgb, #201e1d 40%, transparent)
  divider: 'rgba(32, 30, 29, 0.4)',

  neutral: {
    100: '#f8f4f4',
    200: '#eae7e7',
    300: '#d7d3d3',
    400: '#bab6b6',
    500: '#9b9797',
    600: '#7d7979',
    700: '#605d5d',
    800: '#444141',
    900: '#2d2b2b',
  },
  accentRamp: {
    100: '#fff2ef',
    200: '#ffe0d9',
    300: '#ffc4b8',
    400: '#ff9783',
    500: '#ff563c',
    600: '#dd2b0f',
    700: '#ae1800',
    800: '#7c1405',
    900: '#4d170e',
  },
  accent2Ramp: {
    100: '#fff2ef',
    200: '#ffe0da',
    300: '#ffc4b9',
    400: '#ff9784',
    500: '#ef6853',
    600: '#c94b39',
    700: '#9e3526',
    800: '#71261b',
    900: '#471d16',
  },

  // text-muted: color-mix(in srgb, var(--color-text) 55%, transparent)
  textMuted: 'rgba(32, 30, 29, 0.55)',

  // Two-tier secondary-text hierarchy + subtle row/panel fills, ported from
  // features/queue-erp/theme.ts's `dim`/`dimmer`/`rowFill`/`panelFill` (that
  // file's dark palette is this exact palette with bg/text inverted — same
  // #201e1d/#f3f2f2/#ec3013 values — so these are the same roles, just
  // computed against the light ground instead of the dark one).
  dim: 'rgba(32, 30, 29, 0.62)',
  dimmer: 'rgba(32, 30, 29, 0.42)',
  rowFill: '#f8f4f4',
  panelFill: '#eae9e9',
} as const;

export const font = {
  // Archivo, loaded via @expo-google-fonts/archivo (see App root font loading
  // in src/app/_layout.tsx's useFonts() call — every weight named here MUST
  // be loaded there too, or RN silently drops it for the platform default
  // with no warning; see that file's history for exactly this bug).
  heading: 'Archivo_800ExtraBold',
  headingBlack: 'Archivo_900Black',
  body: 'Archivo_400Regular',
  bodyMedium: 'Archivo_500Medium',
  bodySemiBold: 'Archivo_600SemiBold',
  bodyBold: 'Archivo_700Bold',
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
} as const;

// h1..h6 sizes, line-height 1.12, letter-spacing -0.015em (h6 differs: uppercase + tracked).
export const type = {
  h1: { fontSize: 42, lineHeight: 47 },
  h2: { fontSize: 32, lineHeight: 36 },
  h3: { fontSize: 25, lineHeight: 28 },
  h4: { fontSize: 20, lineHeight: 22 },
  h5: { fontSize: 16, lineHeight: 18 },
  h6: { fontSize: 13, lineHeight: 15 },
  body: { fontSize: 15, lineHeight: 23 }, // 15 / 1.55
} as const;

// --space-1 … --space-8. Note: no space-5/space-7 — the scale skips them
// on purpose, don't interpolate values it doesn't define.
export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  6: 24,
  8: 32,
} as const;

// --radius-sm/md/lg are all 0 on purpose ("Do not round a corner anywhere").
// Kept as named tokens (not a literal 0 sprinkled everywhere) so a future
// deliberate re-tune only touches this file, per the readme's own instruction.
export const radius = {
  sm: 0,
  md: 0,
  lg: 0,
} as const;

// Ink-tinted elevation (--shadow-sm/md/lg), ported to RN's split iOS/Android
// shadow model. iOS reads shadowColor/Offset/Opacity/Radius; Android only
// honors `elevation` (color-less) — approximated from the same CSS shadow.
type Elevation = {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
};
export const shadow: Record<'sm' | 'md' | 'lg', Elevation> = {
  sm: { shadowColor: color.neutral[900], shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.14, shadowRadius: 2, elevation: 1 },
  md: { shadowColor: color.neutral[900], shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.16, shadowRadius: 10, elevation: 4 },
  lg: { shadowColor: color.neutral[900], shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.22, shadowRadius: 32, elevation: 10 },
};

// Interactive states: readme.md's "hovers and pressed states come from the
// accent ramp, one step past the base" — hover has no mobile-touch meaning,
// so components use these only for the *pressed* state.
export const pressed = {
  accentFill: color.accentRamp[600], // btn-primary pressed
  accentFillDeeper: color.accentRamp[700], // matches CSS :active
  onTextTint: 'rgba(32, 30, 29, 0.14)', // btn-secondary pressed
  onAccentTint: 'rgba(236, 48, 19, 0.18)', // btn-ghost pressed
  rowTint: 'rgba(32, 30, 29, 0.04)', // table row hover has no touch equivalent; kept for reference
};

export const disabledOpacity = 0.45;
