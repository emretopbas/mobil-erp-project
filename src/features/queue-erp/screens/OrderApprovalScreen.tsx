import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Stepper } from '../components/Stepper';
import type { QueueAppApi } from '../useQueueApp';
import { accent, dim, dimmer, divider, fontHeading, ground, ink } from '../theme';

export function OrderApprovalScreen({ data }: { data: QueueAppApi['approvalScreen'] }) {
  const { orderLines, orderTotal, approveOrder, rejectOrder } = data;

  return (
    <View>
      <View style={styles.banner}>
        <Text style={styles.bannerKicker}>AI çıkardı · %92 güven</Text>
        <Text style={styles.bannerTitle}>Maria Sanchez · WhatsApp</Text>
        <Text style={styles.bannerSub}>Orijinal mesaj İspanyolca · çeviri açık</Text>
      </View>

      <Text style={styles.quote}>"12 Eylül için M ve L beden 65 keten gömlek gerekiyor."</Text>

      {orderLines.map((line, i) => (
        <View key={i} style={styles.line}>
          <View style={{ flex: 1 }}>
            <Text style={styles.lineName}>{line.name}</Text>
            <Text style={styles.lineMeta}>{line.meta}</Text>
          </View>
          <Stepper qty={line.qty} onInc={line.inc} onDec={line.dec} />
        </View>
      ))}

      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Toplam</Text>
        <Text style={styles.totalValue}>{orderTotal}</Text>
      </View>

      <View style={styles.missing}>
        <Text style={styles.missingKicker}>Eksik bilgi</Text>
        <Text style={styles.missingBody}>
          Teslim tarihi yazılı ama adres yok. Onayladığında AI adres sorusunu müşterinin dilinde gönderir.
        </Text>
        <View style={styles.actions}>
          <Pressable onPress={rejectOrder} style={styles.rejectBtn}>
            <Text style={styles.rejectText}>Düzeltme isteyin</Text>
          </Pressable>
          <Pressable onPress={approveOrder} style={styles.approveBtn}>
            <Text style={styles.approveText}>Siparişe çevir</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { padding: 16, paddingHorizontal: 18, borderBottomWidth: 2, borderBottomColor: ink, backgroundColor: accent },
  bannerKicker: { fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', fontFamily: fontHeading, color: ink },
  bannerTitle: { fontSize: 22, fontFamily: fontHeading, color: ink, marginTop: 4 },
  bannerSub: { fontSize: 12.5, marginTop: 3, color: ink, opacity: 0.9 },

  quote: { padding: 14, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: divider, fontSize: 13, lineHeight: 20, color: dim },

  line: { padding: 14, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: divider, flexDirection: 'row', alignItems: 'center', gap: 10 },
  lineName: { fontSize: 14.5, fontWeight: '700', color: ink },
  lineMeta: { fontSize: 11.5, color: dimmer, marginTop: 2 },

  totalRow: { padding: 14, paddingHorizontal: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', borderBottomWidth: 2, borderBottomColor: ink },
  totalLabel: { fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', fontFamily: fontHeading, color: dim },
  totalValue: { fontSize: 26, fontFamily: fontHeading, color: ink },

  missing: { padding: 14, paddingHorizontal: 18 },
  missingKicker: { fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', fontFamily: fontHeading, color: '#ff6a52' },
  missingBody: { fontSize: 13, lineHeight: 19, marginTop: 6, color: dim },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  rejectBtn: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: ink },
  rejectText: { fontFamily: fontHeading, fontSize: 14, color: ink },
  approveBtn: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', backgroundColor: accent },
  approveText: { fontFamily: fontHeading, fontSize: 14, color: ink },
});
