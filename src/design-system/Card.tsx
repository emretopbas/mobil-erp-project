import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { color, font, radius, shadow, space } from './tokens';

export type Elevation = 'sm' | 'md' | 'lg' | 'none';

/** `.card` (+ `.elev-sm/md/lg`). */
export function Card({
  children,
  elevation = 'none',
  style,
}: {
  children: React.ReactNode;
  elevation?: Elevation;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.card, elevation !== 'none' && shadow[elevation], style]}>{children}</View>;
}

export function CardKicker({ children }: { children: string }) {
  return <Text style={styles.kicker}>{children}</Text>;
}

export function CardTitle({ children }: { children: string }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function CardBody({ children }: { children: string }) {
  return <Text style={styles.body}>{children}</Text>;
}

export function CardMeta({ children }: { children: React.ReactNode }) {
  return <View style={styles.meta}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'column',
    gap: space[2],
    padding: space[3],
    borderRadius: radius.md,
    backgroundColor: color.surface,
  },
  kicker: { fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: color.accent },
  title: { fontFamily: font.heading, fontSize: 17, lineHeight: 20, color: color.text },
  body: { fontSize: 13, opacity: 0.8, color: color.text },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
