import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { QueueAppApi } from '../useQueueApp';
import { dim, dimmer, divider, fontHeading, fontMono, ground, ink } from '../theme';

export function StockScreen({ data }: { data: QueueAppApi['stockScreen'] }) {
  const { stockFilters, visibleStock, stockEmpty, clearStockFilter } = data;

  return (
    <View>
      <View style={styles.filterRow}>
        {stockFilters.map((f) => (
          <Pressable key={f.label} onPress={f.select} style={[styles.filterBtn, { backgroundColor: f.bg, borderColor: f.border }]}>
            <Text style={[styles.filterText, { color: f.fg }]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>

      {stockEmpty ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Eşleşen{'\n'}kalem yok.</Text>
          <Text style={styles.emptyBody}>Bu filtrede gösterilecek stok kalemi bulunmuyor.</Text>
          <Pressable onPress={clearStockFilter} style={styles.emptyBtn}>
            <Text style={styles.emptyBtnText}>Filtreyi temizle</Text>
          </Pressable>
        </View>
      ) : (
        visibleStock.map((item) => (
          <View key={item.sku} style={styles.row}>
            <View style={styles.rowTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.meta}>{item.sku} · {item.stage}</Text>
              </View>
              <Text style={[styles.qty, { color: item.qtyFg }]}>{item.qty}</Text>
            </View>
            <View style={styles.cells}>
              {item.cells.map((c, i) => (
                <View key={i} style={[styles.cell, { backgroundColor: c.bg }]} />
              ))}
            </View>
            {!!item.warn && <Text style={styles.warn}>{item.warn}</Text>}
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  filterRow: { padding: 13, paddingHorizontal: 18, borderBottomWidth: 2, borderBottomColor: ink, flexDirection: 'row', gap: 10 },
  filterBtn: { minHeight: 40, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  filterText: { fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase', fontWeight: '700' },

  empty: { padding: 18, paddingVertical: 38 },
  emptyTitle: { fontSize: 30, lineHeight: 32, fontFamily: fontHeading, color: ink },
  emptyBody: { fontSize: 13, lineHeight: 19, color: dim, marginTop: 12, marginBottom: 16 },
  emptyBtn: { minHeight: 46, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: ink, alignSelf: 'flex-start' },
  emptyBtnText: { fontFamily: fontHeading, fontSize: 13.5, color: ink },

  row: { padding: 14, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: divider },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 },
  name: { fontSize: 14.5, fontWeight: '700', color: ink },
  meta: { fontSize: 11, fontFamily: fontMono, color: dimmer, marginTop: 2 },
  qty: { fontFamily: fontMono, fontSize: 16, fontWeight: '700' },
  cells: { marginTop: 9, flexDirection: 'row', gap: 2, height: 8 },
  cell: { flex: 1, height: 8 },
  warn: { marginTop: 9, fontSize: 12, color: '#ff6a52' },
});
