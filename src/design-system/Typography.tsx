import { Text, type TextProps, type TextStyle } from 'react-native';

import { color, font, type } from './tokens';

type Level = 1 | 2 | 3 | 4 | 5 | 6;

const levelStyle: Record<Level, TextStyle> = {
  1: { ...type.h1, fontFamily: font.heading, letterSpacing: -0.6 },
  2: { ...type.h2, fontFamily: font.heading, letterSpacing: -0.5 },
  3: { ...type.h3, fontFamily: font.heading, letterSpacing: -0.4 },
  4: { ...type.h4, fontFamily: font.heading, letterSpacing: -0.3 },
  5: { ...type.h5, fontFamily: font.heading, letterSpacing: -0.25 },
  // h6 differs from h1-h5: uppercase + tracked, not just smaller.
  6: { ...type.h6, fontFamily: font.heading, letterSpacing: 1, textTransform: 'uppercase' },
};

/** h1…h6 — flush-left by default ("Do not center … hero copy"). */
export function Heading({ level = 2, style, ...rest }: TextProps & { level?: Level }) {
  return <Text {...rest} style={[{ color: color.text }, levelStyle[level], style]} />;
}

/** Body copy — `.body { font-size: 15px; line-height: 1.55 }`. */
export function BodyText({ muted, style, ...rest }: TextProps & { muted?: boolean }) {
  return (
    <Text
      {...rest}
      style={[{ fontFamily: font.body, color: muted ? color.textMuted : color.text }, type.body, style]}
    />
  );
}
