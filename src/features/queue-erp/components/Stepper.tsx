import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fontHeading, fontMono, ink } from '../theme';

export function Stepper({ qty, onInc, onDec }: { qty: number; onInc: () => void; onDec: () => void }) {
  return (
    <View style={styles.row}>
      <Pressable onPress={onDec} style={styles.btn} hitSlop={6}>
        <Text style={styles.btnText}>−</Text>
      </Pressable>
      <View style={styles.value}>
        <Text style={styles.valueText}>{qty}</Text>
      </View>
      <Pressable onPress={onInc} style={styles.btn} hitSlop={6}>
        <Text style={styles.btnText}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  btn: {
    width: 44,
    height: 44,
    borderWidth: 2,
    borderColor: ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { color: ink, fontSize: 18, fontFamily: fontHeading },
  value: {
    minWidth: 48,
    height: 44,
    borderTopWidth: 2,
    borderBottomWidth: 2,
    borderColor: ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  valueText: { color: ink, fontFamily: fontMono, fontSize: 15, fontWeight: '700' },
});
