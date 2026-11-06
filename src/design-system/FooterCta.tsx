import { Pressable, StyleSheet, Text, View } from 'react-native';

import { color, font } from './tokens';

/** Single persistent bottom action bar (one primary CTA per screen) —
 * ported from queue-erp's FooterCta.tsx. */
export function FooterCta({ note, label, onPress }: { note: string; label: string; onPress: () => void }) {
  return (
    <View style={styles.footer}>
      <Text style={styles.note}>{note}</Text>
      <Pressable onPress={onPress} style={styles.btn}>
        <Text style={styles.btnText}>{label}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    borderTopWidth: 2,
    borderTopColor: color.text,
    paddingHorizontal: 18,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: color.bg,
  },
  note: { flex: 1, fontSize: 11.5, lineHeight: 15, color: color.dim },
  btn: { minHeight: 50, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: color.accent },
  btnText: { color: color.bg, fontFamily: font.heading, fontSize: 14 },
});
