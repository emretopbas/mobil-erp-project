import { StyleSheet, Text, View } from 'react-native';

import { color, font } from '@/design-system';
import { formatMoney } from '@/lib/money';
import { activeCells, buildQuantityGrid, lineCells, sumQuantities, type GridVariant, type TabSelection } from '@/lib/quantityGrid';
import type { OrderLine, OrderLineGroup } from '@/models';
import type { IndexedVariant } from './variantIndex';

interface ProductBlock {
  key: string;
  name: string;
  variants: GridVariant[];
  quantities: Record<string, number>;
  totalQuantity: number;
  amountMinor: number;
  assortment: { pattern: string; sets: number } | null;
}

/** Satırları ürün bazında gruplar (`line_group_id` varsa grubu, eski satırlar
 * için ürünü esas alır); her ürünün sadece SİPARİŞ EDİLEN varyantları ızgaraya
 * girer — böylece matris doğal olarak "sıkışık" olur. */
function groupLines(lines: OrderLine[], groups: OrderLineGroup[], index: Map<string, IndexedVariant>): ProductBlock[] {
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const blocks = new Map<string, ProductBlock>();
  for (const line of lines) {
    const info = index.get(line.variant_id);
    const productKey = info?.product.id ?? `?${line.variant_id}`;
    let block = blocks.get(productKey);
    if (!block) {
      block = { key: productKey, name: info?.product.name ?? 'Bilinmeyen ürün', variants: [], quantities: {}, totalQuantity: 0, amountMinor: 0, assortment: null };
      blocks.set(productKey, block);
    }
    block.variants.push({ id: line.variant_id, sku: info?.variant.sku ?? line.variant_id, axes: info?.axes ?? [], active: true });
    block.quantities[line.variant_id] = (block.quantities[line.variant_id] ?? 0) + line.quantity;
    block.totalQuantity += line.quantity;
    block.amountMinor += line.quantity * line.unit_price_minor;
    const group = line.line_group_id ? groupById.get(line.line_group_id) : undefined;
    if (group?.assortment_pattern && group.assortment_sets) block.assortment = { pattern: group.assortment_pattern, sets: group.assortment_sets };
  }
  return [...blocks.values()].sort((a, b) => a.name.localeCompare(b.name, 'tr'));
}

/** Sipariş satırlarının salt-okunur, ürün başına sıkıştırılmış görünümü:
 * 2+ eksenli üründe küçük bir matris (sadece sipariş edilen satır/sütunlar),
 * tek eksende şerit, eksensizde düz satır. Düzenleme "Düzenle" ile aynı
 * QuantityMatrix'e gider — burada adet yazılmaz. */
export function OrderLinesSummary({
  lines,
  groups,
  index,
  currency,
}: {
  lines: OrderLine[];
  groups: OrderLineGroup[];
  index: Map<string, IndexedVariant>;
  currency: string;
}) {
  const blocks = groupLines(lines, groups, index);
  return (
    <View style={styles.wrap}>
      {blocks.map((block) => (
        <View key={block.key} style={styles.block}>
          <View style={styles.head}>
            <Text style={styles.name}>{block.name}</Text>
            <Text style={styles.amount}>
              {block.totalQuantity} adet · {formatMoney(block.amountMinor, currency)}
            </Text>
          </View>
          {block.assortment && (
            <Text style={styles.asorti}>
              {block.assortment.sets} koli asorti ({block.assortment.pattern})
            </Text>
          )}
          <BlockBody block={block} />
        </View>
      ))}
    </View>
  );
}

function BlockBody({ block }: { block: ProductBlock }) {
  const grid = buildQuantityGrid(block.variants);
  const q = (id: string) => block.quantities[id] ?? 0;

  if (grid.mode === 'matrix' || grid.mode === 'tabs') {
    const rowAxis = grid.rowAxis!;
    const colAxis = grid.colAxis!;
    // Sekme kombinasyonları: sadece siparişte gerçekten geçenler.
    const tabCombos: TabSelection[] = [];
    if (grid.tabAxes.length === 0) tabCombos.push({});
    else {
      const seen = new Set<string>();
      for (const v of grid.cells) {
        const sel: TabSelection = {};
        for (const axis of grid.tabAxes) sel[axis.attributeId] = v.axes.find((a) => a.attributeId === axis.attributeId)?.valueLabel ?? '';
        const key = JSON.stringify(sel);
        if (!seen.has(key)) {
          seen.add(key);
          tabCombos.push(sel);
        }
      }
    }
    return (
      <View style={styles.tabs}>
        {tabCombos.map((tabs) => {
          const cells = activeCells(grid, tabs);
          const rows = rowAxis.values.filter((rv) => sumQuantities(lineCells(grid, tabs, 'row', rv), block.quantities) > 0);
          const cols = colAxis.values.filter((cv) => sumQuantities(lineCells(grid, tabs, 'col', cv), block.quantities) > 0);
          return (
            <View key={JSON.stringify(tabs)}>
              {grid.tabAxes.length > 0 && <Text style={styles.tabTitle}>{Object.values(tabs).join(' · ')}</Text>}
              <View style={styles.table}>
                <View style={styles.tr}>
                  <View style={styles.labelCell} />
                  {cols.map((cv) => (
                    <View key={cv} style={styles.cell}>
                      <Text style={styles.headText} numberOfLines={1}>{cv}</Text>
                    </View>
                  ))}
                  <View style={styles.cell}>
                    <Text style={styles.sumText}>Σ</Text>
                  </View>
                </View>
                {rows.map((rv) => (
                  <View key={rv} style={styles.tr}>
                    <View style={styles.labelCell}>
                      <Text style={styles.headText}>{rv}</Text>
                    </View>
                    {cols.map((cv) => {
                      const v = grid.find({ ...tabs, [rowAxis.attributeId]: rv, [colAxis.attributeId]: cv });
                      const n = v ? q(v.id) : 0;
                      return (
                        <View key={cv} style={styles.cell}>
                          <Text style={[styles.qty, n === 0 && styles.qtyEmpty]}>{n || '·'}</Text>
                        </View>
                      );
                    })}
                    <View style={styles.cell}>
                      <Text style={styles.sumText}>{sumQuantities(lineCells(grid, tabs, 'row', rv), block.quantities)}</Text>
                    </View>
                  </View>
                ))}
                <View style={styles.tr}>
                  <View style={styles.labelCell}>
                    <Text style={styles.sumText}>Σ</Text>
                  </View>
                  {cols.map((cv) => (
                    <View key={cv} style={styles.cell}>
                      <Text style={styles.sumText}>{sumQuantities(lineCells(grid, tabs, 'col', cv), block.quantities)}</Text>
                    </View>
                  ))}
                  <View style={styles.cell}>
                    <Text style={styles.sumText}>{sumQuantities(cells, block.quantities)}</Text>
                  </View>
                </View>
              </View>
            </View>
          );
        })}
        {grid.stray.map((v) => (
          <FlatLine key={v.id} label={v.sku} qty={q(v.id)} />
        ))}
      </View>
    );
  }

  if (grid.mode === 'strip') {
    const axis = grid.colAxis!;
    return (
      <View style={styles.table}>
        <View style={styles.tr}>
          {axis.values.map((val) => (
            <View key={val} style={styles.cell}>
              <Text style={styles.headText} numberOfLines={1}>{val}</Text>
            </View>
          ))}
        </View>
        <View style={styles.tr}>
          {axis.values.map((val) => {
            const v = grid.find({ [axis.attributeId]: val });
            return (
              <View key={val} style={styles.cell}>
                <Text style={styles.qty}>{v ? q(v.id) : ''}</Text>
              </View>
            );
          })}
        </View>
        {grid.stray.map((v) => (
          <FlatLine key={v.id} label={v.sku} qty={q(v.id)} />
        ))}
      </View>
    );
  }

  return (
    <View>
      {block.variants.map((v) => (
        <FlatLine key={v.id} label={v.axes.length > 0 ? v.axes.map((a) => a.valueLabel).join(' · ') : v.sku} qty={q(v.id)} />
      ))}
    </View>
  );
}

function FlatLine({ label, qty }: { label: string; qty: number }) {
  return (
    <View style={styles.flat}>
      <Text style={styles.headText}>{label}</Text>
      <Text style={styles.qty}>× {qty}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  block: { gap: 4 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  name: { fontSize: 14, fontFamily: font.heading, color: color.text, flexShrink: 1 },
  amount: { fontSize: 12, color: color.dim },
  asorti: { fontSize: 11.5, color: color.accentRamp[700] },
  tabs: { gap: 8 },
  tabTitle: { fontSize: 10.5, letterSpacing: 0.4, textTransform: 'uppercase', color: color.dim, marginBottom: 2 },
  table: { alignSelf: 'flex-start' },
  tr: { flexDirection: 'row' },
  labelCell: { width: 64, minHeight: 26, justifyContent: 'center', paddingRight: 4 },
  cell: { width: 54, minHeight: 26, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: color.divider },
  headText: { fontSize: 11.5, color: color.text },
  qty: { fontSize: 13, fontFamily: font.bodySemiBold, color: color.text },
  qtyEmpty: { color: color.dimmer, fontFamily: font.body },
  sumText: { fontSize: 12, fontFamily: font.bodySemiBold, color: color.dim },
  flat: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: color.divider },
});
