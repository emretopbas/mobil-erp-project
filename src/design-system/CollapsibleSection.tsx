import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { color } from './tokens';
import { Divider } from './Divider';
import { Heading } from './Typography';

/** A `Divider` + tappable `Heading` that shows/hides its children — first
 * built for MoneyScreen's four report sections (Son Kayıtlar, Hesaplar,
 * Kategori Bazlı Gider, Yaklaşan Vadeler), now shared with Ürünler's
 * per-product Varyantlar section and the Stok ekranı's per-product groups
 * too (product feedback: "ürün tanımlarını collapsible yapalım çünkü
 * ekranda çok fazla kaydırma oluyor"). Defaults open unless `defaultOpen`
 * says otherwise — the Stok ekranı opts into closed-by-default since it's
 * the one screen where every product's full grid piling up at once is the
 * complaint. `subtitle` renders under the title, visible whether the
 * section is open or closed — a quick summary (variant count, low-stock
 * count) so collapsing never hides that something needs attention. */
export function CollapsibleSection({
  title,
  subtitle,
  subtitleColor,
  defaultOpen = true,
  children,
}: {
  title: string;
  subtitle?: string;
  subtitleColor?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <Divider />
      <Pressable onPress={() => setOpen((o) => !o)} style={styles.sectionHeader} hitSlop={4}>
        <View style={styles.sectionHeaderTitles}>
          <Heading level={5}>{title}</Heading>
          {!!subtitle && <Text style={[styles.subtitle, subtitleColor ? { color: subtitleColor } : null]}>{subtitle}</Text>}
        </View>
        <Text style={styles.sectionCaret}>{open ? '▲' : '▼'}</Text>
      </Pressable>
      {open && children}
    </>
  );
}

const styles = StyleSheet.create({
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 2 },
  sectionHeaderTitles: { flex: 1, gap: 2 },
  subtitle: { fontSize: 12, color: color.dimmer },
  sectionCaret: { fontSize: 11, color: color.dimmer },
});
