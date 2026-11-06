import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BodyText, Button, CollapsibleSection, Dialog, Field, Input, SegmentedControl, Tag, color, font, space } from '@/design-system';
import { groupForStockMatrix, isLowStock, type StockMatrix, type StockVariantRow } from '@/lib/stockMatrix';
import { stockMovementTypeLabel } from '@/lib/roleLabels';
import type { Product, StockMovementType } from '@/models';
import { stockService, type ActorContext } from '@/services';

/** Bir ürünün varyantlarını gösteren blok — tam 2 ekseni olan varyantlar
 * kartezyen bir tabloya (satır×sütun), geri kalanlar (varsayılan varyant,
 * tek eksenli ürün, vb.) düz bir listeye düşer (bkz. lib/stockMatrix.ts).
 * Hem `src/app/stock.tsx` hem queue-erp'nin `StockScreen.tsx`'i bu bileşeni
 * paylaşıyor. Bir hücreye/satıra dokunmak o varyantın detay diyaloğunu açar
 * (düşük stok eşiği + stok hareketi formu, product feedback: "düşük stok
 * kriteri manuel belirlenmeli stok ekranında"). */
export function ProductStockGroup({
  ctx,
  product,
  rows,
  canWrite,
  onChanged,
}: {
  ctx: ActorContext;
  product: Product;
  rows: StockVariantRow[];
  canWrite: boolean;
  onChanged: () => void;
}) {
  // Seçili varyant id ile takip ediliyor, nesne referansıyla değil —
  // `onChanged()` sonrası `rows` prop'u taze verilerle yeniden geldiğinde
  // (yeni on_hand/threshold) diyalog otomatik güncel kalsın diye her
  // render'da `rows`'tan yeniden türetiliyor. Eski haliyle (bir
  // `StockVariantRow` nesnesini state'te tutmak) bir hareket kaydedildikten
  // sonra diyalog donmuş "eski" on_hand göstermeye devam ediyordu.
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null);
  const { matrix, rest } = useMemo(() => groupForStockMatrix(rows), [rows]);
  const activeRow = activeVariantId ? (rows.find((r) => r.variant.id === activeVariantId) ?? null) : null;

  if (rows.length === 0) return null;

  const lowCount = rows.filter((r) => isLowStock(r.level?.on_hand ?? 0, r.level?.low_stock_threshold ?? 0)).length;
  const subtitle = `${rows.length} varyant${lowCount > 0 ? ` · ${lowCount} düşük stok` : ''}`;

  return (
    <View style={styles.group}>
      {/* Kapalı başlarsa da bu özet satırı görünür kalır — kaydırmayı
          azaltmak için kapatmak, düşük stoklu bir varyantı gözden
          kaçırmaya yol açmamalı (product feedback: "ürün tanımlarını
          collapsible yapalım çünkü ekranda çok fazla kaydırma oluyor"). */}
      <CollapsibleSection
        title={product.name}
        subtitle={subtitle}
        subtitleColor={lowCount > 0 ? color.accentRamp[700] : undefined}
        defaultOpen={false}>
        <View style={styles.groupBody}>
          {matrix && <MatrixTable matrix={matrix} onCellPress={(r) => setActiveVariantId(r.variant.id)} />}

          {rest.length > 0 && (
            <View style={styles.flatList}>
              {rest.map((r) => {
                const onHand = r.level?.on_hand ?? 0;
                const threshold = r.level?.low_stock_threshold ?? 0;
                const low = isLowStock(onHand, threshold);
                const label = r.axes.length > 0 ? r.axes.map((a) => a.valueLabel).join(' · ') : r.variant.sku;
                return (
                  <Pressable key={r.variant.id} onPress={() => setActiveVariantId(r.variant.id)} style={styles.flatRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.flatLabel}>{label}</Text>
                      <Text style={styles.flatSku}>{r.variant.sku}</Text>
                    </View>
                    <Text style={[styles.flatQty, low && styles.qtyLow]}>{onHand}</Text>
                    {low && <Tag label="Düşük stok" variant="accent" />}
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      </CollapsibleSection>

      <VariantStockDialog ctx={ctx} canWrite={canWrite} row={activeRow} onClose={() => setActiveVariantId(null)} onChanged={onChanged} />
    </View>
  );
}

function MatrixTable({ matrix, onCellPress }: { matrix: StockMatrix; onCellPress: (row: StockVariantRow) => void }) {
  return (
    <View style={styles.matrixWrap}>
      <Text style={styles.matrixCaption}>
        {matrix.rowAttributeName} × {matrix.colAttributeName}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          <View style={styles.matrixRow}>
            <View style={styles.matrixCorner} />
            {matrix.colValues.map((cv) => (
              <View key={cv} style={styles.matrixHeadCell}>
                <Text style={styles.matrixHeadText}>{cv}</Text>
              </View>
            ))}
          </View>
          {matrix.rowValues.map((rv) => (
            <View key={rv} style={styles.matrixRow}>
              <View style={styles.matrixRowHead}>
                <Text style={styles.matrixHeadText}>{rv}</Text>
              </View>
              {matrix.colValues.map((cv) => {
                const cell = matrix.cellFor(rv, cv);
                if (!cell) return <View key={cv} style={styles.matrixCell} />;
                const onHand = cell.level?.on_hand ?? 0;
                const threshold = cell.level?.low_stock_threshold ?? 0;
                const low = isLowStock(onHand, threshold);
                return (
                  <Pressable key={cv} style={styles.matrixCell} onPress={() => onCellPress(cell)}>
                    <Text style={[styles.matrixQty, low && styles.qtyLow]}>{onHand}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function VariantStockDialog({
  ctx,
  canWrite,
  row,
  onClose,
  onChanged,
}: {
  ctx: ActorContext;
  canWrite: boolean;
  row: StockVariantRow | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  return (
    <Dialog visible={!!row} onRequestClose={onClose} title={row ? row.variant.sku : 'Varyant'}>
      {row && (
        <VariantStockDialogContent key={row.variant.id} ctx={ctx} canWrite={canWrite} row={row} onClose={onClose} onChanged={onChanged} />
      )}
    </Dialog>
  );
}

function VariantStockDialogContent({
  ctx,
  canWrite,
  row,
  onClose,
  onChanged,
}: {
  ctx: ActorContext;
  canWrite: boolean;
  row: StockVariantRow;
  onClose: () => void;
  onChanged: () => void;
}) {
  const onHand = row.level?.on_hand ?? 0;
  const [threshold, setThreshold] = useState(row.level?.low_stock_threshold ? String(row.level.low_stock_threshold) : '');
  const [thresholdBusy, setThresholdBusy] = useState(false);
  const [type, setType] = useState<StockMovementType>('in');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveThreshold = async () => {
    const n = Number(threshold.trim() || '0');
    if (!Number.isFinite(n) || n < 0) return;
    setThresholdBusy(true);
    try {
      await stockService.setLowStockThreshold(ctx, row.variant.id, Math.round(n));
      onChanged();
    } finally {
      setThresholdBusy(false);
    }
  };

  const submitMovement = async () => {
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) return;
    setBusy(true);
    setError(null);
    try {
      await stockService.recordMovement(ctx, { variant_id: row.variant.id, type, quantity: qty, reason: reason.trim() || null });
      setQuantity('');
      setReason('');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.dialogContent}>
      <BodyText muted>{row.axes.length > 0 ? row.axes.map((a) => `${a.attributeName}: ${a.valueLabel}`).join(' · ') : 'Varsayılan varyant (eksensiz)'}</BodyText>
      <Text style={styles.onHandBig}>{onHand} adet mevcut</Text>

      <Field label="Düşük stok eşiği (0 = kapalı)">
        <View style={styles.inlineRow}>
          <View style={{ flex: 1 }}>
            <Input value={threshold} onChangeText={setThreshold} keyboardType="number-pad" placeholder="0" editable={canWrite} />
          </View>
          {canWrite && <Button label={thresholdBusy ? '…' : 'Kaydet'} variant="secondary" disabled={thresholdBusy} onPress={() => void saveThreshold()} />}
        </View>
      </Field>
      <BodyText muted style={styles.hint}>
        Eşik sıfırken bu varyant hiçbir zaman &quot;düşük stok&quot; olarak işaretlenmez — uyarı almak için elle bir sayı girin.
      </BodyText>

      {canWrite && (
        <View style={styles.movementForm}>
          <SegmentedControl
            options={(['in', 'out', 'adjustment'] as StockMovementType[]).map((t) => ({ label: stockMovementTypeLabel[t], value: t }))}
            value={type}
            onChange={(v) => setType(v as StockMovementType)}
          />
          <Field label="Miktar">
            <Input value={quantity} onChangeText={setQuantity} keyboardType="number-pad" placeholder="10" />
          </Field>
          <Field label="Neden (opsiyonel)">
            <Input value={reason} onChangeText={setReason} placeholder="Örn. sayım düzeltmesi" />
          </Field>
          {!!error && <BodyText style={styles.error}>{error}</BodyText>}
          <Button label={busy ? '…' : 'Hareketi kaydet'} variant="primary" disabled={busy || !quantity} onPress={() => void submitMovement()} />
        </View>
      )}
      <Button label="Kapat" variant="ghost" onPress={onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: space[2] },
  groupBody: { gap: space[2], paddingTop: space[2] },
  flatList: { gap: space[1] },
  flatRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: color.divider },
  flatLabel: { fontSize: 14, color: color.text },
  flatSku: { fontSize: 11, color: color.dimmer, marginTop: 2 },
  flatQty: { fontFamily: font.bodySemiBold, fontSize: 16, color: color.text },
  qtyLow: { color: color.accentRamp[700] },

  matrixWrap: { gap: 4 },
  matrixCaption: { fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: color.dim },
  matrixRow: { flexDirection: 'row' },
  matrixCorner: { width: 76, height: 40 },
  matrixHeadCell: { width: 60, height: 40, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  matrixHeadText: { fontSize: 11, color: color.text, textAlign: 'center' },
  matrixRowHead: { width: 76, height: 48, alignItems: 'flex-start', justifyContent: 'center', paddingRight: 4 },
  matrixCell: { width: 60, height: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: color.divider },
  matrixQty: { fontFamily: font.bodySemiBold, fontSize: 15, color: color.text },

  dialogContent: { gap: space[3] },
  onHandBig: { fontSize: 26, fontFamily: font.heading, color: color.text },
  inlineRow: { flexDirection: 'row', gap: space[2], alignItems: 'flex-end' },
  hint: { fontSize: 11.5 },
  movementForm: { gap: space[3], borderTopWidth: 1, borderTopColor: color.divider, paddingTop: space[2] },
  error: { color: color.accentRamp[700] },
});
