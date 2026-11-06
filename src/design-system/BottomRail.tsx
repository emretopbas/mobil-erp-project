import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, font } from './tokens';

export interface RailItem {
  label: string;
  glyph: string;
  n: number;
  count: number | null;
  bg: string;
  fg: string;
  go: () => void;
}

/** Bottom tab bar with an optional numeric badge per tab — ported from
 * queue-erp's BottomRail.tsx. `bg`/`fg` per item are caller-computed (active
 * vs inactive tint), same as the original. */
export function BottomRail({ items }: { items: RailItem[] }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.nav, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      {items.map((r, i) => (
        <Pressable
          key={r.n}
          onPress={r.go}
          style={[styles.item, { backgroundColor: r.bg, borderRightWidth: i === items.length - 1 ? 0 : 1 }]}>
          <Text style={[styles.glyph, { color: r.fg }]}>{r.glyph}</Text>
          <Text style={[styles.label, { color: r.fg }]}>{r.label}</Text>
          {r.count ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{r.count}</Text>
            </View>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  nav: {
    borderTopWidth: 2,
    borderTopColor: color.text,
    flexDirection: 'row',
    backgroundColor: color.bg,
  },
  item: {
    flex: 1,
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderRightColor: color.divider,
  },
  glyph: { fontSize: 15, fontFamily: font.heading },
  label: { fontSize: 9.5, letterSpacing: 0.5, textTransform: 'uppercase', fontFamily: font.bodyBold },
  badge: {
    position: 'absolute',
    top: 7,
    right: 9,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.accent,
  },
  badgeText: { color: color.bg, fontSize: 10, fontFamily: font.mono, fontWeight: '700' },
});
