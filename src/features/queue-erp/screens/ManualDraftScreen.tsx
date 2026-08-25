import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Stepper } from '../components/Stepper';
import type { QueueAppApi } from '../useQueueApp';
import { accent, dim, dimmer, divider, fontHeading, fontMono, ground, ink, panelFill, rowFill } from '../theme';

export function ManualDraftScreen({ data }: { data: QueueAppApi['draftScreen'] }) {
  const {
    draftLines,
    draftTotal,
    draftHint,
    basket,
    basketEmpty,
    basketCount,
    lineCount,
    custOpen,
    custQuery,
    custLabel,
    custLabelFg,
    custCaret,
    custCount,
    custEmpty,
    custResults,
    toggleCust,
    setCustQuery,
    newCustomer,
  } = data;

  return (
    <View>
      <View style={styles.custSection}>
        <View style={styles.custHeaderRow}>
          <Text style={styles.sectionTitle}>Müşteri</Text>
          <Text style={styles.custCount}>{custCount}</Text>
        </View>
        <Pressable onPress={toggleCust} style={styles.custToggle}>
          <Text style={[styles.custToggleText, { color: custLabelFg }]}>{custLabel}</Text>
          <Text style={styles.caret}>{custCaret}</Text>
        </Pressable>

        {custOpen && (
          <View style={styles.custPanel}>
            <TextInput
              value={custQuery}
              onChangeText={setCustQuery}
              placeholder="Ara: isim veya şehir"
              placeholderTextColor={dimmer}
              style={styles.custInput}
            />
            <ScrollView style={styles.custResultsList} nestedScrollEnabled>
              {custResults.map((c, i) => (
                <Pressable key={i} onPress={c.select} style={[styles.custResultRow, { backgroundColor: c.bg }]}>
                  <View>
                    <Text style={styles.custResultName}>{c.name}</Text>
                    <Text style={styles.custResultMeta}>{c.place} · son sipariş {c.last}</Text>
                  </View>
                  <Text style={styles.custMark}>{c.mark}</Text>
                </Pressable>
              ))}
              {custEmpty && <Text style={styles.custEmptyText}>Kayıtlı müşteri bulunamadı.</Text>}
            </ScrollView>
            <Pressable onPress={newCustomer} style={styles.newCustBtn}>
              <Text style={styles.newCustText}>+ Yeni müşteri olarak kaydet</Text>
            </Pressable>
          </View>
        )}
      </View>

      <View style={styles.linesHeaderRow}>
        <Text style={styles.sectionTitle}>Kalemler</Text>
        <Text style={styles.lineCount}>{lineCount}</Text>
      </View>

      <ScrollView style={styles.linesList} nestedScrollEnabled>
        {draftLines.map((l) => (
          <View key={l.sku} style={[styles.lineRow, { backgroundColor: l.rowBg }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.lineName}>{l.name}</Text>
              <Text style={styles.lineMeta}>{l.sku} · {l.price}</Text>
            </View>
            <Stepper qty={l.qty} onInc={l.inc} onDec={l.dec} />
          </View>
        ))}
      </ScrollView>

      <View style={styles.basketSection}>
        <View style={styles.custHeaderRow}>
          <Text style={styles.sectionTitle}>Sepet</Text>
          <Text style={styles.lineCount}>{basketCount}</Text>
        </View>
        {basketEmpty && (
          <View style={styles.basketEmpty}>
            <Text style={styles.basketEmptyText}>
              Henüz kalem eklenmedi. Yukarıdaki listeden <Text style={{ color: dim, fontWeight: '700' }}>+</Text> ile adet ekleyin.
            </Text>
          </View>
        )}
        {basket.map((b) => (
          <View key={b.sku} style={styles.basketRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.basketName}>{b.name}</Text>
              <Text style={styles.basketMeta}>{b.sku} · {b.calc}</Text>
            </View>
            <Text style={styles.basketSum}>{b.sum}</Text>
            <Pressable onPress={b.remove} style={styles.removeBtn} hitSlop={6}>
              <Text style={styles.removeText}>×</Text>
            </Pressable>
          </View>
        ))}
      </View>

      <View style={styles.totalRow}>
        <Text style={styles.totalHint}>{draftHint}</Text>
        <Text style={styles.totalValue}>{draftTotal}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', fontWeight: '700', color: dim },
  custSection: { padding: 14, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: divider },
  custHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 },
  custCount: { fontSize: 10.5, fontFamily: fontMono, color: dimmer },
  custToggle: {
    minHeight: 50, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 2, borderColor: ink,
  },
  custToggleText: { fontSize: 14.5, fontWeight: '700' },
  caret: { fontSize: 11, color: ink },

  custPanel: { borderWidth: 2, borderColor: ink, borderTopWidth: 0, backgroundColor: panelFill },
  custInput: {
    minHeight: 46, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: divider,
    color: ink, fontSize: 13.5,
  },
  custResultsList: { maxHeight: 238 },
  custResultRow: {
    minHeight: 52, paddingVertical: 8, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: divider,
  },
  custResultName: { fontSize: 13.5, fontWeight: '700', color: ink },
  custResultMeta: { fontSize: 11, color: dimmer, marginTop: 2 },
  custMark: { fontSize: 11, color: accent },
  custEmptyText: { padding: 16, paddingHorizontal: 12, fontSize: 12.5, color: dimmer },
  newCustBtn: { minHeight: 48, paddingHorizontal: 12, justifyContent: 'center', borderTopWidth: 2, borderTopColor: ink, backgroundColor: accent },
  newCustText: { fontFamily: fontHeading, fontSize: 13.5, color: ink },

  linesHeaderRow: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  lineCount: { fontSize: 10.5, fontFamily: fontMono, color: dimmer },
  linesList: { maxHeight: 232, borderTopWidth: 2, borderTopColor: ink, borderBottomWidth: 2, borderBottomColor: ink },
  lineRow: { paddingVertical: 12, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: divider, flexDirection: 'row', alignItems: 'center', gap: 10 },
  lineName: { fontSize: 14, fontWeight: '700', color: ink },
  lineMeta: { fontSize: 11, fontFamily: fontMono, color: dimmer, marginTop: 2 },

  basketSection: { paddingHorizontal: 18, paddingTop: 14 },
  basketEmpty: { marginTop: 10, padding: 14, borderWidth: 2, borderColor: divider, borderStyle: 'dashed' },
  basketEmptyText: { fontSize: 12.5, lineHeight: 18, color: dimmer },
  basketRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: divider },
  basketName: { fontSize: 13.5, fontWeight: '700', color: ink },
  basketMeta: { fontSize: 11, fontFamily: fontMono, color: dimmer, marginTop: 2 },
  basketSum: { fontFamily: fontMono, fontSize: 14, fontWeight: '700', color: ink },
  removeBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: divider },
  removeText: { fontSize: 14, fontFamily: fontHeading, color: dim },

  totalRow: { padding: 16, paddingHorizontal: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  totalHint: { fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', fontWeight: '700', color: dim },
  totalValue: { fontSize: 26, fontFamily: fontHeading, color: ink },
});
