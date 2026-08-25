import { Pressable, StyleSheet, Text, View } from 'react-native';

import { accent, dim, fontHeading, ground, ink } from '../theme';

export function FooterCta({
  note,
  label,
  onPress,
}: {
  note: string;
  label: string;
  onPress: () => void;
}) {
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
    borderTopColor: ink,
    paddingHorizontal: 18,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: ground,
  },
  note: { flex: 1, fontSize: 11.5, lineHeight: 15, color: dim },
  btn: { minHeight: 50, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: accent },
  btnText: { color: ink, fontFamily: fontHeading, fontSize: 14 },
});
