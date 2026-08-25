import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { QueueAppApi } from '../useQueueApp';
import { accent, dim, dimmer, divider, fontHeading, ground, ink } from '../theme';

export function SettingsScreen({ data }: { data: QueueAppApi['settingsScreen'] }) {
  const { channels, team, toggles } = data;

  return (
    <View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Kanallar · ücretsiz planda 1 adet</Text>
        {channels.map((c) => (
          <View key={c.key} style={styles.channelRow}>
            <View style={[styles.dot, { backgroundColor: c.tint }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{c.name}</Text>
              <Text style={styles.rowSub}>{c.meta}</Text>
            </View>
            <Pressable onPress={c.toggle} style={[styles.pill, { backgroundColor: c.pillBg }]}>
              <Text style={[styles.pillText, { color: c.pillFg }]}>{c.pill}</Text>
            </Pressable>
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Ekip · vardiya</Text>
        {team.map((p) => (
          <View key={p.initials} style={styles.teamRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{p.initials}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.teamName}>{p.name}</Text>
              <Text style={styles.rowSub}>{p.role} · {p.task}</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: p.badgeBg }]}>
              <Text style={[styles.badgeText, { color: p.badgeFg }]}>{p.state}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.sectionNoBorder}>
        <Text style={styles.sectionTitle}>Çeviri</Text>
        {toggles.map((t) => (
          <Pressable key={t.label} onPress={t.toggle} style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{t.label}</Text>
              <Text style={styles.rowSub}>{t.sub}</Text>
            </View>
            <View style={[styles.track, { backgroundColor: t.trackBg, justifyContent: t.knobEnd ? 'flex-end' : 'flex-start' }]}>
              <View style={styles.knob} />
            </View>
          </Pressable>
        ))}

        <View style={styles.planCard}>
          <View style={styles.planHeader}>
            <Text style={styles.planHeaderText}>Plan · Free</Text>
          </View>
          <View style={styles.planBody}>
            <Text style={styles.planText}>1 kanal · 100 sipariş/ay · 1 kullanıcı</Text>
            <View style={styles.planTrack}>
              <View style={styles.planFill} />
            </View>
            <Text style={styles.planUsage}>64 / 100 sipariş</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { padding: 16, paddingHorizontal: 18, borderBottomWidth: 2, borderBottomColor: ink },
  sectionNoBorder: { padding: 16, paddingHorizontal: 18 },
  sectionTitle: { fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', fontWeight: '700', color: dim, marginBottom: 10 },

  channelRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: divider },
  dot: { width: 10, height: 10 },
  rowTitle: { fontSize: 13.5, fontWeight: '600', color: ink },
  rowSub: { fontSize: 11, color: dimmer, marginTop: 1 },
  pill: { minHeight: 38, paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: ink },
  pillText: { fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: '700' },

  teamRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: divider },
  avatar: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: ink },
  avatarText: { fontFamily: fontHeading, fontSize: 12.5, color: ground },
  teamName: { fontSize: 13.5, fontWeight: '700', color: ink },
  badge: { paddingHorizontal: 7, paddingVertical: 4 },
  badgeText: { fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', fontWeight: '700' },

  toggleRow: { flexDirection: 'row', alignItems: 'center', minHeight: 52, borderBottomWidth: 1, borderBottomColor: divider, gap: 10 },
  track: { width: 48, height: 26, padding: 2, flexDirection: 'row', alignItems: 'center' },
  knob: { width: 22, height: 22, backgroundColor: ground },

  planCard: { marginTop: 16, borderWidth: 2, borderColor: ink },
  planHeader: { padding: 10, paddingHorizontal: 12, backgroundColor: ink },
  planHeaderText: { fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', fontWeight: '800', color: ground },
  planBody: { padding: 12 },
  planText: { fontSize: 13, lineHeight: 19, color: dim },
  planTrack: { marginTop: 9, height: 8, backgroundColor: divider },
  planFill: { height: 8, width: '64%', backgroundColor: accent },
  planUsage: { fontSize: 11, marginTop: 5, color: dimmer },
});
