import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { QueueAppApi } from '../useQueueApp';
import { accent, dim, dimmer, divider, fontHeading, fontMono, ground, ink } from '../theme';

export function TodayQueueScreen({ data }: { data: QueueAppApi['queueScreen'] }) {
  const { pulse, queue, queueEmpty, waError, fixWaError, resetQueue } = data;

  return (
    <View>
      {waError && (
        <View style={styles.errorBanner}>
          <View style={{ flex: 1 }}>
            <Text style={styles.errorKicker}>Bağlantı hatası</Text>
            <Text style={styles.errorBody}>WhatsApp oturumu düştü · 14 dakikadır mesaj alınmıyor.</Text>
          </View>
          <Pressable onPress={fixWaError} style={styles.errorBtn}>
            <Text style={styles.errorBtnText}>Yenile</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.pulseRow}>
        {pulse.map((p, i) => (
          <View key={i}>
            <Text style={styles.pulseLabel}>{p.label}</Text>
            <Text style={[styles.pulseValue, { color: p.fg }]}>{p.value}</Text>
          </View>
        ))}
      </View>

      {queueEmpty ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Kuyruk{'\n'}temiz.</Text>
          <Text style={styles.emptyBody}>Bugün bekleyen iş yok. Yeni mesaj geldiğinde kart burada görünür.</Text>
          <Pressable onPress={resetQueue} style={styles.emptyBtn}>
            <Text style={styles.emptyBtnText}>Kuyruğu geri yükle</Text>
          </Pressable>
        </View>
      ) : (
        queue.map((q) => (
          <View key={q.key} style={styles.card}>
            <View style={styles.cardTop}>
              <View style={[styles.tintDot, { backgroundColor: q.tint }]} />
              <View style={[styles.typeTag, { backgroundColor: q.typeBg }]}>
                <Text style={[styles.typeTagText, { color: q.typeFg }]}>{q.type}</Text>
              </View>
              <Text style={styles.time}>{q.time}</Text>
            </View>
            <Text style={styles.cardTitle}>{q.title}</Text>
            <Text style={styles.cardDetail}>{q.detail}</Text>
            <View style={styles.actions}>
              <Pressable onPress={q.skip} style={styles.skipBtn}>
                <Text style={styles.skipText}>Atla</Text>
              </Pressable>
              <Pressable onPress={q.act} style={styles.actBtn}>
                <Text style={styles.actText}>{q.cta}</Text>
              </Pressable>
            </View>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  errorBanner: {
    padding: 13,
    borderBottomWidth: 2,
    borderBottomColor: ink,
    backgroundColor: accent,
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  errorKicker: { fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', fontFamily: fontHeading, color: ink },
  errorBody: { fontSize: 13, lineHeight: 18, color: ink, marginTop: 3 },
  errorBtn: { minHeight: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: ink },
  errorBtnText: { fontSize: 11.5, letterSpacing: 0.5, textTransform: 'uppercase', fontFamily: fontHeading, color: ink },

  pulseRow: { padding: 14, paddingHorizontal: 18, flexDirection: 'row', gap: 18, borderBottomWidth: 2, borderBottomColor: ink },
  pulseLabel: { fontSize: 9.5, letterSpacing: 1, textTransform: 'uppercase', fontFamily: fontHeading, color: dim },
  pulseValue: { fontSize: 22, lineHeight: 24, fontFamily: fontHeading, marginTop: 2 },

  empty: { padding: 22, paddingVertical: 46 },
  emptyTitle: { fontSize: 44, lineHeight: 42, fontFamily: fontHeading, color: ink },
  emptyBody: { fontSize: 13.5, lineHeight: 19, color: dim, marginTop: 14, marginBottom: 18 },
  emptyBtn: { minHeight: 48, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: ink, alignSelf: 'flex-start' },
  emptyBtnText: { fontFamily: fontHeading, fontSize: 14, color: ink },

  card: { borderBottomWidth: 2, borderBottomColor: divider, padding: 16, paddingHorizontal: 18 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tintDot: { width: 9, height: 9 },
  typeTag: { paddingHorizontal: 6, paddingVertical: 3 },
  typeTagText: { fontSize: 9.5, letterSpacing: 1, textTransform: 'uppercase', fontFamily: fontHeading },
  time: { fontSize: 11, fontFamily: fontMono, color: dimmer },
  cardTitle: { fontSize: 19, lineHeight: 22, fontFamily: fontHeading, color: ink, marginTop: 9 },
  cardDetail: { fontSize: 13, lineHeight: 19, color: dim, marginTop: 5 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  skipBtn: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: ink },
  skipText: { fontFamily: fontHeading, fontSize: 13.5, color: ink },
  actBtn: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: accent },
  actText: { fontFamily: fontHeading, fontSize: 13.5, color: ink },
});
