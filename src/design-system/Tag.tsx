import { Pressable, StyleSheet, Text, View } from 'react-native';

import { color, radius } from './tokens';

export type TagVariant = 'accent' | 'accent2' | 'neutral' | 'outline';

/** `.tag` + `.tag-accent/-accent-2/-neutral/-outline`. Pass `onPress` to make
 * it tappable (e.g. products.tsx's variant chips, opened to edit) — plain
 * label tags elsewhere are unaffected since the prop is optional. */
export function Tag({ label, variant = 'neutral', onPress }: { label: string; variant?: TagVariant; onPress?: () => void }) {
  const content = (
    <View style={[styles.base, variantStyle[variant]]}>
      <Text style={[styles.label, { color: variantTextColor[variant] }]}>{label}</Text>
    </View>
  );
  if (!onPress) return content;
  return <Pressable onPress={onPress} hitSlop={4}>{content}</Pressable>;
}

const variantStyle = StyleSheet.create({
  accent: { backgroundColor: color.accentRamp[100] },
  accent2: { backgroundColor: color.accent2Ramp[100] },
  neutral: { backgroundColor: color.neutral[100] },
  outline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: color.accent },
});

const variantTextColor: Record<TagVariant, string> = {
  accent: color.accentRamp[800],
  accent2: color.accent2Ramp[800],
  neutral: color.neutral[800],
  outline: color.accent,
};

const styles = StyleSheet.create({
  base: {
    alignSelf: 'flex-start',
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderRadius: radius.md * 0.75,
  },
  label: { fontSize: 11, letterSpacing: 0.2 },
});
