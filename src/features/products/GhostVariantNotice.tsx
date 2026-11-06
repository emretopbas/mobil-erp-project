import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BodyText, Button, Card, color, font, Heading, space } from '@/design-system';
import { canonicalVariantKey, type Combination } from '@/lib/variantAxes';
import { productService, type ActorContext, type DefaultVariantUsage } from '@/services';
import { useReloadOnMount } from '@/hooks/use-reload';

interface Ghost {
  productId: string;
  productName: string;
  usage: DefaultVariantUsage;
  candidates: Combination[];
}

const comboLabel = (c: Combination) => c.picks.map((p) => p.value.label).join(' · ');

/** Hayalet default varyant düzeltmesi: eksenli varyantların YANINDA duran
 * eksensiz (`variant_key=''`) varyantı listeler. Hareketsiz olanlar tek
 * dokunuşla silinir; stok/sipariş/alım geçmişi olanlar silinmez, ürünün henüz
 * varyantı olmayan bir kombinasyonuna dönüştürülür (stok korunur). Hiç hayalet
 * yoksa hiçbir şey göstermez. */
export function GhostVariantNotice({ ctx, onChanged }: { ctx: ActorContext; onChanged: () => void | Promise<void> }) {
  const [ghosts, setGhosts] = useState<Ghost[] | null>(null);
  const [pending, setPending] = useState<{ variantId: string; combo: Combination; productName: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const found = await productService.findGhostDefaultVariants(ctx);
    const withCandidates: Ghost[] = [];
    for (const g of found) {
      withCandidates.push({ ...g, candidates: g.usage.inUse ? await productService.ghostConversionCandidates(ctx, g.productId) : [] });
    }
    setGhosts(withCandidates);
  }, [ctx]);

  useReloadOnMount(load);

  const cleanup = async () => {
    setBusy(true);
    setError(null);
    try {
      const report = await productService.cleanupGhostDefaultVariants(ctx);
      setMessage(`${report.removed.length} hareketsiz varsayılan varyant silindi${report.kept.length ? `, ${report.kept.length} tanesi kullanılmış olduğu için duruyor` : ''}.`);
      await load();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const convert = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await productService.convertGhostDefaultVariant(ctx, pending.variantId, pending.combo);
      setMessage(`${pending.productName}: varyant "${comboLabel(pending.combo)}" kombinasyonuna dönüştürüldü.`);
      setPending(null);
      await load();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!ghosts || (ghosts.length === 0 && !message)) return null;
  const unused = ghosts.filter((g) => !g.usage.inUse).length;

  return (
    <Card style={styles.card}>
      <Heading level={5}>Eksensiz (hayalet) varyantlar</Heading>
      {ghosts.length > 0 && (
        <BodyText muted>
          {ghosts.length} üründe eksenli varyantların yanında eksensiz bir varsayılan varyant duruyor; hiçbir kombinasyona karşılık gelmediği için katalogda ve
          stokta kaybolmuş adetlere yol açar.
        </BodyText>
      )}
      {!!message && <BodyText>{message}</BodyText>}
      {!!error && <BodyText style={styles.error}>{error}</BodyText>}

      {ghosts.map((g) => (
        <View key={g.usage.variant.id} style={styles.ghostRow}>
          <Text style={styles.ghostName}>
            {g.productName} · {g.usage.variant.sku}
          </Text>
          <BodyText muted>
            {g.usage.inUse
              ? `Kullanılmış: ${g.usage.movementCount} stok hareketi, ${g.usage.orderLineCount} sipariş satırı, ${g.usage.purchaseLineCount} alım satırı — silinmez, bir kombinasyona dönüştürün:`
              : 'Hareketsiz — silinebilir.'}
          </BodyText>
          {g.usage.inUse && g.candidates.length === 0 && <BodyText muted>Dönüştürülebilecek boş kombinasyon yok — önce ürüne yeni bir değer ekleyin.</BodyText>}
          {g.usage.inUse && (
            <View style={styles.chips}>
              {g.candidates.slice(0, 24).map((c) => (
                <Pressable
                  key={canonicalVariantKey(c)}
                  onPress={() => setPending({ variantId: g.usage.variant.id, combo: c, productName: g.productName })}
                  style={[styles.chip, pending?.variantId === g.usage.variant.id && canonicalVariantKey(pending.combo) === canonicalVariantKey(c) && styles.chipOn]}>
                  <Text style={styles.chipText}>{comboLabel(c)}</Text>
                </Pressable>
              ))}
            </View>
          )}
          {pending?.variantId === g.usage.variant.id && (
            <View style={styles.confirmRow}>
              <Text style={styles.confirmText}>“{comboLabel(pending.combo)}” olarak dönüştürülsün mü?</Text>
              <Button label={busy ? '…' : 'Onayla'} variant="primary" disabled={busy} onPress={() => void convert()} />
              <Button label="Vazgeç" variant="secondary" onPress={() => setPending(null)} />
            </View>
          )}
        </View>
      ))}

      {unused > 0 && <Button label={busy ? '…' : `Hareketsizleri sil (${unused})`} variant="secondary" disabled={busy} onPress={() => void cleanup()} />}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space[2] },
  error: { color: color.accentRamp[700] },
  ghostRow: { gap: 4, paddingTop: space[2], borderTopWidth: 1, borderTopColor: color.divider },
  ghostName: { fontSize: 14, fontFamily: font.heading, color: color.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, height: 34, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: color.text },
  chipOn: { backgroundColor: color.surface, borderWidth: 2 },
  chipText: { fontSize: 12.5, color: color.text },
  confirmRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] },
  confirmText: { fontSize: 12.5, color: color.text, flexShrink: 1 },
});
