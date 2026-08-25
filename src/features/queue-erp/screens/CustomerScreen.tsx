import { StyleSheet, Text, View } from 'react-native';

import type { QueueAppApi } from '../useQueueApp';
import { dim, dimmer, divider, fontHeading, fontMono, ground, ink } from '../theme';

export function CustomerScreen({ data }: { data: QueueAppApi['customerScreen'] }) {
  const { identities, custStats, timeline } = data;

  return (
    <View>
      <View style={styles.header}>
        <Text style={styles.name}>Maria Sanchez</Text>
        <Text style={styles.sub}>Sanchez Textiles · Valencia, ES · ES dili</Text>
        <View style={styles.identities}>
          {identities.map((idn, i) => (
            <View key={i} style={styles.idPill}>
              <View style={[styles.idDot, { backgroundColor: idn.tint }]} />
              <Text style={styles.idText}>{idn.value}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.statsRow}>
        {custStats.map((c, i) => (
          <View key={c.label} style={[styles.statCell, { borderRightWidth: i === custStats.length - 1 ? 0 : 1 }]}>
            <Text style={styles.statLabel}>{c.label}</Text>
            <Text style={styles.statValue}>{c.value}</Text>
          </View>
        ))}
      </View>

      <View style={styles.timelineBlock}>
        <Text style={styles.timelineTitle}>Birleşik geçmiş</Text>
        {timeline.map((t, i) => (
          <View key={i} style={styles.timelineRow}>
            <View style={[styles.timelineDot, { backgroundColor: t.tint }]} />
            <View style={styles.timelineBody}>
              <Text style={styles.timelineItemTitle}>{t.title}</Text>
              <Text style={styles.timelineMeta}>{t.meta}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { padding: 18, borderBottomWidth: 2, borderBottomColor: ink },
  name: { fontSize: 24, fontFamily: fontHeading, color: ink },
  sub: { fontSize: 12.5, color: dim, marginTop: 2 },
  identities: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 12 },
  idPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 5, borderWidth: 1, borderColor: divider },
  idDot: { width: 7, height: 7 },
  idText: { fontSize: 11, fontWeight: '700', color: ink },

  statsRow: { flexDirection: 'row', borderBottomWidth: 2, borderBottomColor: ink },
  statCell: { flex: 1, padding: 13, paddingHorizontal: 14, borderRightColor: divider },
  statLabel: { fontSize: 9.5, letterSpacing: 1, textTransform: 'uppercase', fontWeight: '700', color: dimmer },
  statValue: { fontSize: 20, fontFamily: fontHeading, color: ink, marginTop: 3 },

  timelineBlock: { padding: 16, paddingHorizontal: 18 },
  timelineTitle: { fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', fontWeight: '700', color: dim, marginBottom: 12 },
  timelineRow: { flexDirection: 'row', gap: 12, paddingBottom: 15 },
  timelineDot: { width: 9, height: 9, marginTop: 4 },
  timelineBody: { flex: 1, borderLeftWidth: 1, borderLeftColor: divider, marginLeft: -5, paddingLeft: 14 },
  timelineItemTitle: { fontSize: 13.5, fontWeight: '600', color: ink },
  timelineMeta: { fontSize: 11, fontFamily: fontMono, color: dimmer, marginTop: 2 },
});
