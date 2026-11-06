import { Pressable, StyleSheet, Text, View } from 'react-native';

import { color, font } from './tokens';

/** `.radio` + `.dot` — no native `<input type=radio>` on RN, built from a
 * pressable row + a dot view; `checked` mirrors `input:checked + .dot`. */
export function Radio({ label, checked, onPress }: { label: string; checked: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.row} hitSlop={6}>
      <View style={[styles.dot, checked && styles.dotChecked]} />
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: color.divider,
  },
  // box-shadow: inset 0 0 0 4px var(--color-bg) — an inner ring, faked with a
  // thick border in the background color over an accent fill.
  dotChecked: {
    backgroundColor: color.accent,
    borderWidth: 4,
    borderColor: color.bg,
  },
  label: { fontFamily: font.body, fontSize: 14, color: color.text },
});
