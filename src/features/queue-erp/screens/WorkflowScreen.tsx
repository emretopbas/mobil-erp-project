import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { QueueAppApi } from '../useQueueApp';
import { accent, dim, dimmer, divider, fontHeading, fontMono, ground, ink } from '../theme';

export function WorkflowScreen({ data }: { data: QueueAppApi['workflowScreen'] }) {
  const { stages, stageOrders, stageEmpty } = data;

  return (
    <View>
      <View style={styles.stageRow}>
        {stages.map((st, i) => (
          <Pressable
            key={st.label}
            onPress={st.select}
            style={[styles.stageBtn, { backgroundColor: st.bg, borderRightWidth: i === stages.length - 1 ? 0 : 1 }]}>
            <Text style={[styles.stageCount, { color: st.fg }]}>{st.count}</Text>
            <Text style={[styles.stageLabel, { color: st.fg }]}>{st.label}</Text>
          </Pressable>
        ))}
      </View>

      {stageEmpty ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Bu aşama boş.</Text>
          <Text style={styles.emptyBody}>Bir kart bu aşamaya taşındığında burada listelenir.</Text>
        </View>
      ) : (
        stageOrders.map((o) => (
          <View key={o.id} style={styles.orderRow}>
            <View style={styles.orderTop}>
              <View style={[styles.tintDot, { backgroundColor: o.tint }]} />
              <Text style={styles.orderId}>{o.id}</Text>
              {o.ai && (
                <View style={styles.aiTag}>
                  <Text style={styles.aiTagText}>AI</Text>
                </View>
              )}
            </View>
            <View style={styles.orderMain}>
              <View style={{ flex: 1 }}>
                <Text style={styles.customer}>{o.customer}</Text>
                <Text style={styles.itemsOwner}>{o.items} · {o.owner}</Text>
              </View>
              <Text style={styles.total}>{o.total}</Text>
            </View>
            <View style={styles.orderActions}>
              <Pressable onPress={o.advance} style={styles.advanceBtn}>
                <Text style={styles.advanceText}>{o.next}</Text>
              </Pressable>
              <Text style={styles.due}>{o.due}</Text>
            </View>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stageRow: { flexDirection: 'row', borderBottomWidth: 2, borderBottomColor: ink },
  stageBtn: { flex: 1, minHeight: 58, padding: 8, paddingHorizontal: 6, justifyContent: 'center', gap: 2, borderRightColor: divider },
  stageCount: { fontSize: 20, lineHeight: 21, fontFamily: fontHeading },
  stageLabel: { fontSize: 9.5, letterSpacing: 0.5, textTransform: 'uppercase', fontFamily: fontHeading },

  empty: { padding: 18, paddingVertical: 38 },
  emptyTitle: { fontSize: 30, fontFamily: fontHeading, color: ink },
  emptyBody: { fontSize: 13, lineHeight: 19, color: dim, marginTop: 12 },

  orderRow: { padding: 15, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: divider },
  orderTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tintDot: { width: 8, height: 8 },
  orderId: { fontSize: 10.5, fontFamily: fontMono, color: dimmer },
  aiTag: { paddingHorizontal: 5, paddingVertical: 2, backgroundColor: accent },
  aiTagText: { fontSize: 9.5, fontFamily: fontHeading, color: ink },
  orderMain: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginTop: 5 },
  customer: { fontSize: 15, fontWeight: '700', color: ink },
  itemsOwner: { fontSize: 11.5, color: dimmer, marginTop: 2 },
  total: { fontSize: 16, fontFamily: fontHeading, color: ink },
  orderActions: { marginTop: 10, flexDirection: 'row', gap: 10, alignItems: 'center' },
  advanceBtn: { minHeight: 40, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: ink },
  advanceText: { fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase', fontWeight: '700', color: ink },
  due: { fontSize: 11, fontFamily: fontMono, color: dimmer },
});
