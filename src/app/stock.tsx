import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BodyText, Button, Divider, space } from '@/design-system';
import { ModuleScreen } from '@/components/module-screen';
import { ProductStockGroup } from '@/features/stock/ProductStockGroup';
import type { StockVariantRow } from '@/lib/stockMatrix';
import type { Product } from '@/models';
import { hasPermission, productService, settingsService, stockService, useActorContext, useSession } from '@/services';
import { useReloadOnMount } from '@/hooks/use-reload';

interface ProductGroup {
  product: Product;
  rows: StockVariantRow[];
}

/** Stok giriş/çıkış (CLAUDE.md §5.1). All writes go through `stockService`,
 * which recomputes `on_hand` and enforces the negative-stock guard — this
 * screen never touches on_hand itself. Ürün başına kartezyen (2 eksenli)
 * tablo veya düz liste (`ProductStockGroup` — bkz. queue-erp'nin
 * StockScreen.tsx'i, aynı bileşeni paylaşıyor). */
export default function StockScreen() {
  const ctx = useActorContext();
  const { business, refreshBusiness } = useSession();
  const [groups, setGroups] = useState<ProductGroup[] | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!ctx) return;
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

  if (!ctx) return null;
  const canWrite = hasPermission(ctx.employee.role, 'stockMovement', 'create');
  const canManageSettings = hasPermission(ctx.employee.role, 'settings', 'update');

  const toggleAllowNegative = async () => {
    setSettingsBusy(true);
    try {
      await settingsService.setAllowNegativeStock(ctx, business?.allow_negative_stock !== 1);
      await refreshBusiness();
    } finally {
      setSettingsBusy(false);
    }
  };

  const visibleGroups = (groups ?? []).filter((g) => g.rows.length > 0);

  return (
    <ModuleScreen title="Stok" subtitle="Varyant bazlı stok seviyeleri ve hareketler">
      {groups === null && <BodyText muted>Yükleniyor…</BodyText>}
      {groups?.length === 0 && (
        <BodyText muted>Henüz varyant yok. Önce Ürünler ekranından bir ürün ve varyant ekleyin.</BodyText>
      )}

      <View style={styles.list}>
        {visibleGroups.map((g) => (
          <ProductStockGroup key={g.product.id} ctx={ctx} product={g.product} rows={g.rows} canWrite={canWrite} onChanged={() => void reload()} />
        ))}
      </View>

      <Divider />
      <BodyText muted>
        {'Negatif stok engeli: bir "çıkış" hareketi mevcut stoktan fazlaysa varsayılan olarak reddedilir (CLAUDE.md §5.1).'}
      </BodyText>
      {canManageSettings && (
        <Button
          label={settingsBusy ? '…' : business?.allow_negative_stock === 1 ? 'Negatif stoka izin veriliyor — kapat' : 'Negatif stoka izin ver'}
          variant="secondary"
          disabled={settingsBusy}
          onPress={toggleAllowNegative}
        />
      )}
    </ModuleScreen>
  );
}

const styles = StyleSheet.create({
  list: { gap: space[4] },
});
