import { Pressable, StyleSheet, Text, View } from 'react-native';

import { color, font } from './tokens';

/** Quantity `[−][qty][+]` control — ported from the queue-erp mockup
 * (features/queue-erp/components/Stepper.tsx), same geometry, light tokens.
 * Used by order-line and stock-movement quantity entry. */
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
    borderColor: color.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { color: color.text, fontSize: 18, fontFamily: font.heading },
  value: {
    minWidth: 48,
    height: 44,
    borderTopWidth: 2,
    borderBottomWidth: 2,
    borderColor: color.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  valueText: { color: color.text, fontFamily: font.mono, fontSize: 15, fontWeight: '700' },
});
