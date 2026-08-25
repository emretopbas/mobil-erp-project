import { Platform } from 'react-native';

// Fixed dark "workshop" palette for the queue-first ERP screen — this view
// intentionally ignores system light/dark mode (see design note: "Ters
// zemin: atölye ışığında kontrast").
export const ink = '#f3f2f2';
export const ground = '#201e1d';
export const accent = '#ec3013';
export const dim = '#a6a19f';
export const dimmer = '#807b79';
export const divider = '#3a3634';
export const rowFill = '#2b2827';
export const panelFill = '#252221';

export const fontHeading = 'Archivo_800ExtraBold';
export const fontHeadingBlack = 'Archivo_900Black';
export const fontBody = 'Archivo_400Regular';
export const fontBodyMedium = 'Archivo_500Medium';
export const fontBodySemiBold = 'Archivo_600SemiBold';
export const fontBodyBold = 'Archivo_700Bold';

export const fontMono = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  6: 24,
  8: 32,
};
