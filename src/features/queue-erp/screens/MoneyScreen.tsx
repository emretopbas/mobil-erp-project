import { StyleSheet, Text, View } from 'react-native';

import type { QueueAppApi } from '../useQueueApp';
import { accent, dim, dimmer, divider, fontHeading, fontMono, ground, ink } from '../theme';

export function MoneyScreen({ data }: { data: QueueAppApi['moneyScreen'] }) {
  const { months, expenses } = data;

  return (
    <View>
      <View style={styles.summary}>
        <Text style={styles.summaryLabel}>Ağustos · net</Text>
        <Text style={styles.summaryValue}>€7.150</Text>
        <View style={styles.summaryRow}>
          <View>
            <Text style={styles.miniLabel}>Gelir</Text>
            <Text style={styles.miniValue}>€18.400</Text>
          </View>
          <View>
            <Text style={styles.miniLabel}>Gider</Text>
            <Text style={[styles.miniValue, { color: '#ff6a52' }]}>€11.250</Text>
          </View>
          <View>
            <Text style={styles.miniLabel}>Tahsilat bekleyen</Text>
            <Text style={styles.miniValue}>€4.320</Text>
          </View>
        </View>
      </View>

      <View style={styles.chartBlock}>
        <Text style={styles.chartLabel}>Son 6 ay</Text>
        <View style={styles.chart}>
          {months.map((m, i) => (
            <View key={i} style={styles.chartCol}>
              <View style={[styles.bar, { height: m.revH as `${number}%`, backgroundColor: ink }]} />
              <View style={[styles.bar, { height: m.expH as `${number}%`, backgroundColor: accent }]} />
            </View>
          ))}
        </View>
        <View style={styles.chartLabels}>
          {months.map((m, i) => (
            <Text key={i} style={styles.chartMonthLabel}>{m.label}</Text>
          ))}
        </View>
      </View>

      <View style={styles.expensesBlock}>
        <Text style={styles.expensesTitle}>Gider dağılımı</Text>
        {expenses.map((e) => (
          <View key={e.label} style={styles.expenseRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.expenseLabel}>{e.label}</Text>
              <View style={styles.expenseTrack}>
                <View style={[styles.expenseFill, { width: e.pct as `${number}%` }]} />
              </View>
            </View>
            <Text style={styles.expenseValue}>{e.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { padding: 18, borderBottomWidth: 2, borderBottomColor: ink },
  summaryLabel: { fontSize: 10.5, letterSpacing: 1, textTransform: 'uppercase', fontWeight: '700', color: dim },
  summaryValue: { fontSize: 46, lineHeight: 48, fontFamily: fontHeading, color: ink, marginTop: 4 },
  summaryRow: { flexDirection: 'row', gap: 18, marginTop: 12 },
  miniLabel: { fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: dimmer, fontWeight: '700' },
  miniValue: { fontSize: 17, fontFamily: fontHeading, color: ink, marginTop: 2 },

  chartBlock: { padding: 16, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: divider },
  chartLabel: { fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', fontWeight: '700', color: dim },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 7, height: 120, marginTop: 12, borderBottomWidth: 2, borderBottomColor: ink },
  chartCol: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: '100%' },
  bar: { flex: 1 },
  chartLabels: { flexDirection: 'row', gap: 7, marginTop: 6 },
  chartMonthLabel: { flex: 1, textAlign: 'center', fontSize: 10, fontFamily: fontMono, color: dimmer },

  expensesBlock: { padding: 16, paddingHorizontal: 18 },
  expensesTitle: { fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', fontWeight: '700', color: dim, marginBottom: 12 },
  expenseRow: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: divider },
  expenseLabel: { fontSize: 13.5, fontWeight: '600', color: ink },
  expenseTrack: { marginTop: 5, height: 6, backgroundColor: divider },
  expenseFill: { height: 6, backgroundColor: ink },
  expenseValue: { width: 92, textAlign: 'right', fontFamily: fontMono, fontSize: 13, color: ink },
});
