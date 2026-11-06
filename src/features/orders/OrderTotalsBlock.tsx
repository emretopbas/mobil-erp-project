import { StyleSheet, Text, View } from 'react-native';

import { color, font } from '@/design-system';
import { formatPercentValue } from '@/lib/orderTotals';
import { formatMoney } from '@/lib/money';
import type { Order } from '@/models';

/** Sipariş toplamı: iskonto varsa Brüt → İskonto → Net, yoksa tek "Toplam".
 * Cariye sevkiyatta NET tutar borç yazılır. */
export function OrderTotalsBlock({ order }: { order: Pick<Order, 'currency' | 'gross_total_minor' | 'discount_type' | 'discount_value' | 'discount_amount_minor' | 'net_total_minor'> }) {
  const hasDiscount = order.discount_amount_minor > 0;
  return (
    <View style={styles.wrap}>
      {hasDiscount && (
        <>
          <View style={styles.row}>
            <Text style={styles.label}>Brüt</Text>
            <Text style={styles.value}>{formatMoney(order.gross_total_minor, order.currency)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>İskonto{order.discount_type === 'percent' ? ` (%${formatPercentValue(order.discount_value)})` : ''}</Text>
            <Text style={styles.value}>−{formatMoney(order.discount_amount_minor, order.currency)}</Text>
          </View>
        </>
      )}
      <View style={[styles.row, hasDiscount && styles.netRow]}>
        <Text style={styles.label}>{hasDiscount ? 'Net' : 'Toplam'}</Text>
        <Text style={styles.netValue}>{formatMoney(order.net_total_minor, order.currency)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  netRow: { borderTopWidth: 1, borderTopColor: color.divider, marginTop: 2, paddingTop: 5 },
  label: { fontSize: 12.5, fontFamily: font.heading, color: color.dim },
  value: { fontSize: 13, color: color.text },
  netValue: { fontSize: 14, fontFamily: font.heading, color: color.text },
});
