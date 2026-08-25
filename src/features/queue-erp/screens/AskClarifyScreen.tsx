import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { QueueAppApi } from '../useQueueApp';
import { dim, dimmer, divider, fontHeading, fontMono, ground, ink } from '../theme';

export function AskClarifyScreen({ data }: { data: QueueAppApi['askScreen'] }) {
  const { askTemplates, askLangs, askPreview, askSource, context } = data;

  return (
    <View>
      <View style={styles.contextBlock}>
        <View style={styles.contextTop}>
          <View style={[styles.dot, { backgroundColor: context.channelDot }]} />
          <Text style={styles.contact}>{context.contact}</Text>
        </View>
        <Text style={styles.quote}>{context.quote}</Text>
        <Text style={styles.mismatch}>{context.mismatchLabel}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Şablon</Text>
        <View style={styles.wrapRow}>
          {askTemplates.map((t, i) => (
            <Pressable
              key={i}
              onPress={t.select}
              style={[styles.tplBtn, { backgroundColor: t.bg, borderColor: t.border }]}>
              <Text style={[styles.tplText, { color: t.fg }]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Gönderim dili</Text>
        <View style={styles.row}>
          {askLangs.map((l, i) => (
            <Pressable
              key={i}
              onPress={l.select}
              style={[styles.langBtn, { backgroundColor: l.bg, borderColor: l.border }]}>
              <Text style={[styles.langText, { color: l.fg }]}>{l.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.previewSection}>
        <Text style={styles.sectionTitle}>Önizleme · {askSource}</Text>
        <View style={styles.previewBox}>
          <Text style={styles.previewText}>{askPreview}</Text>
        </View>
        <Text style={styles.previewNote}>Yanıt geldiğinde sipariş kartı otomatik güncellenir ve kuyruğa geri düşer.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  contextBlock: { padding: 14, paddingHorizontal: 18, borderBottomWidth: 2, borderBottomColor: ink },
  contextTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 9, height: 9 },
  contact: { fontSize: 13, fontWeight: '700', color: ink },
  quote: { fontSize: 13, lineHeight: 20, color: dim, marginTop: 8 },
  mismatch: { fontSize: 11.5, marginTop: 8, color: '#ff6a52' },

  section: { padding: 14, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: divider },
  sectionTitle: { fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', fontWeight: '700', color: dim, marginBottom: 10 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tplBtn: { minHeight: 42, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  tplText: { fontSize: 12.5, fontWeight: '700' },

  row: { flexDirection: 'row', gap: 8 },
  langBtn: { minWidth: 56, minHeight: 42, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  langText: { fontFamily: fontMono, fontSize: 13, fontWeight: '700' },

  previewSection: { padding: 16, paddingHorizontal: 18 },
  previewBox: { marginTop: 10, borderWidth: 2, borderColor: ink, padding: 14 },
  previewText: { fontSize: 14.5, lineHeight: 21, color: ink },
  previewNote: { fontSize: 11.5, lineHeight: 17, color: dimmer, marginTop: 10 },
});
