import { Pressable, StyleSheet, Text, View } from 'react-native';

import { color, font } from './tokens';

interface Dot {
  bg: string;
  w: number;
}

/** Header for the swipeable queue-shell screens — title/kicker, a settings
 * button, and (when the screen is on the swipe rail) a progress-dot row.
 * Distinct from `NavBar`, which the deeper admin screens keep using — ported
 * from queue-erp's Header.tsx. */
export function QueueHeader({
  title,
  kicker,
  onSettings,
  inRail,
  dots,
  swipeLabel,
}: {
  title: string;
  kicker: string;
  onSettings: () => void;
  inRail: boolean;
  dots: Dot[];
  swipeLabel: string;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.top}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>{kicker}</Text>
          <Text style={styles.title}>{title}</Text>
        </View>
        <Pressable onPress={onSettings} style={styles.settingsBtn} hitSlop={6}>
          <Text style={styles.settingsGlyph}>≡</Text>
        </Pressable>
      </View>
      <View style={styles.rule} />
      <View style={styles.subrow}>
        {inRail ? (
          <View style={styles.dots}>
            {dots.map((d, i) => (
              <View key={i} style={[styles.dot, { width: d.w, backgroundColor: d.bg }]} />
            ))}
          </View>
        ) : (
          <View />
        )}
        <Text style={styles.swipeLabel}>{swipeLabel}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 18, backgroundColor: color.bg },
  top: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10, paddingBottom: 12 },
  kicker: { fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', fontFamily: font.heading, color: color.accent },
  title: { fontSize: 25, lineHeight: 27, marginTop: 3, fontFamily: font.heading, color: color.text },
  settingsBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: color.text,
  },
  settingsGlyph: { color: color.text, fontSize: 15, fontFamily: font.heading },
  rule: { height: 2, backgroundColor: color.text },
  subrow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 9 },
  dots: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  dot: { height: 4 },
  swipeLabel: { fontSize: 10.5, letterSpacing: 1, textTransform: 'uppercase', fontFamily: font.heading, color: color.dimmer },
});
