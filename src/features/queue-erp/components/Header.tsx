import { Pressable, StyleSheet, Text, View } from 'react-native';

import { accent, dimmer, fontHeading, ground, ink } from '../theme';

interface Dot {
  bg: string;
  w: number;
}

export function Header({
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
  header: { paddingHorizontal: 18, backgroundColor: ground },
  top: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10, paddingBottom: 12 },
  kicker: { fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', fontFamily: fontHeading, color: accent },
  title: { fontSize: 25, lineHeight: 27, marginTop: 3, fontFamily: fontHeading, color: ink },
  settingsBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: ink,
  },
  settingsGlyph: { color: ink, fontSize: 15, fontFamily: fontHeading },
  rule: { height: 2, backgroundColor: ink },
  subrow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 9 },
  dots: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  dot: { height: 4 },
  swipeLabel: { fontSize: 10.5, letterSpacing: 1, textTransform: 'uppercase', fontFamily: fontHeading, color: dimmer },
});
