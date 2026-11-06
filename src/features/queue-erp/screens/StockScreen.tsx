import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BodyText, color, font } from '@/design-system';
import { ProductStockGroup } from '@/features/stock/ProductStockGroup';
import { isLowStock, type StockVariantRow } from '@/lib/stockMatrix';
import type { Product } from '@/models';
import { hasPermission, productService, stockService, type ActorContext } from '@/services';
import { useReloadOnMount } from '@/hooks/use-reload';
import type { StockFilter } from '../useQueueApp';

const FILTERS: StockFilter[] = ['Tümü', 'Düşük stok'];

interface ProductGroup {
  product: Product;
  rows: StockVariantRow[];
}

/** Screen 4 — ürün başına kartezyen (2 eksenli) tablo veya düz liste
 * (`ProductStockGroup`, product feedback: "ürün varyantlarını tek tek
 * göstermektense bir kartezyen tablo daha hoş olabilir"). Mockup'ın üçüncü
 * filtresi ("Üretimde") hâlâ yok — stok üretim durumunu takip etmiyor. */
export function StockScreen({ ctx }: { ctx: ActorContext }) {
  const [groups, setGroups] = useState<ProductGroup[] | null>(null);
  const [filter, setFilter] = useState<StockFilter>('Tümü');

  const canWrite = hasPermission(ctx.employee.role, 'stockMovement', 'create');

  const reload = useCallback(async () => {
    const products = await productService.list(ctx);
    const next: ProductGroup[] = [];
    for (const product of products) {
      const variants = await productService.listVariantsWithAttributes(ctx, product.id);
      const rows: StockVariantRow[] = [];
      for (const { variant, axes } of variants) {
        rows.push({ variant, axes, level: await stockService.getLevel(ctx, variant.id) });
      }
      next.push({ product, rows });
    }
    setGroups(next);
  }, [ctx]);

  useReloadOnMount(reload);

  const filteredGroups = (groups ?? [])
    .map((g) => ({
      product: g.product,
      rows: filter === 'Tümü' ? g.rows : g.rows.filter((r) => isLowStock(r.level?.on_hand ?? 0, r.level?.low_stock_threshold ?? 0)),
    }))
    .filter((g) => g.rows.length > 0);

  const totalRows = (groups ?? []).reduce((n, g) => n + g.rows.length, 0);

  return (
    <View>
      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <Pressable
            key={f}
            onPress={() => setFilter(f)}
            style={[styles.filterBtn, { backgroundColor: filter === f ? color.text : 'transparent', borderColor: color.text }]}>
            <Text style={{ color: filter === f ? color.bg : color.text, fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase', fontWeight: '700' }}>{f}</Text>
          </Pressable>
        ))}
      </View>

      {groups === null ? (
        <View style={styles.empty}>
          <BodyText muted>Yükleniyor…</BodyText>
        </View>
      ) : filteredGroups.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Eşleşen{'\n'}kalem yok.</Text>
          <BodyText muted>{totalRows === 0 ? 'Henüz varyant yok — önce Ürünler ekranından ekleyin.' : 'Bu filtrede gösterilecek stok kalemi bulunmuyor.'}</BodyText>
        </View>
      ) : (
        <View style={styles.list}>
          {filteredGroups.map((g) => (
            <ProductStockGroup key={g.product.id} ctx={ctx} product={g.product} rows={g.rows} canWrite={canWrite} onChanged={() => void reload()} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  filterRow: { padding: 13, paddingHorizontal: 18, borderBottomWidth: 2, borderBottomColor: color.text, flexDirection: 'row', gap: 10 },
  filterBtn: { minHeight: 40, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },

  empty: { padding: 18, paddingVertical: 38, gap: 12 },
  emptyTitle: { fontSize: 30, lineHeight: 32, fontFamily: font.heading, color: color.text },

  list: { padding: 18, gap: 22 },
});
