import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BodyText, color, font } from '@/design-system';
import { OrderLinesSummary } from '@/features/orders/OrderLinesSummary';
import { OrderTotalsBlock } from '@/features/orders/OrderTotalsBlock';
import { loadVariantIndex, type IndexedVariant } from '@/features/orders/variantIndex';
import type { Customer, Order, OrderLine, OrderLineGroup } from '@/models';
import { customerService, hasPermission, orderService, type ActorContext } from '@/services';
import { useReloadOnMount } from '@/hooks/use-reload';

/** Screen 2 — review a specific draft order's real lines before confirming
 * (`orderService.confirm`, a pure status change — it never books a
 * RevenueEntry; money is recorded separately, on the customer screen's
 * "+ Ödeme ekle", whenever it actually arrives). Reached only from a Queue
 * item, so `orderId` is always set when this renders — `TodayQueueScreen`
 * never offers it otherwise. Drops the mockup's "AI çıkardı %92 güven /
 * Maria Sanchez · WhatsApp" copy (Faz-2 channel/NLP attribution flavor); the
 * underlying review-and-confirm action is real Faz-1 functionality and keeps
 * working the same either way. */
export function OrderApprovalScreen({
  ctx,
  orderId,
  flash,
  onDone,
  onEdit,
}: {
  ctx: ActorContext;
  orderId: string;
  flash: (message: string) => void;
  onDone: () => void;
  /** Kalemleri düzenlemek için sipariş matrisini (ManualDraftScreen) açar. */
  onEdit: () => void;
}) {
  const [order, setOrder] = useState<Order | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [lines, setLines] = useState<OrderLine[] | null>(null);
  const [groups, setGroups] = useState<OrderLineGroup[]>([]);
  const [index, setIndex] = useState<Map<string, IndexedVariant>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [o, l, g, customers, variantIndex] = await Promise.all([
      ctx.repository.orders.getById(orderId),
      orderService.lines(ctx, orderId),
      orderService.lineGroups(ctx, orderId),
      customerService.list(ctx, { includeInactive: true }),
      loadVariantIndex(ctx),
    ]);
    setOrder(o);
    setCustomer(customers.find((c) => c.id === o?.customer_id) ?? null);
    setIndex(variantIndex);
    setGroups(g);
    setLines(l);
  }, [ctx, orderId]);

  useReloadOnMount(reload);


  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      await orderService.confirm(ctx, orderId);
      flash('Sipariş onaylandı');
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** Was previously a no-op (just navigated back, leaving the draft order
   * behind forever — the reported bug). A rejected draft has no real use
   * left, so this actually removes it (soft delete, per §8), not just backs
   * out of the screen. */
  const reject = async () => {
    setBusy(true);
    setError(null);
    try {
      await orderService.softDelete(ctx, orderId);
      flash('Taslak sipariş silindi');
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const canDelete = hasPermission(ctx.employee.role, 'order', 'delete');

  if (!lines || !order) {
    return (
      <View style={styles.empty}>
        <BodyText muted>Yükleniyor…</BodyText>
      </View>
    );
  }

  return (
    <View>
      <View style={styles.customerBlock}>
        <Text style={styles.customerLabel}>Müşteri</Text>
        <Text style={styles.customerName}>{customer?.name ?? '—'}</Text>
      </View>

      {!!error && <BodyText style={styles.error}>{error}</BodyText>}

      {lines.length === 0 ? (
        <BodyText muted style={styles.noLines}>
          Bu siparişin henüz kalemi yok.
        </BodyText>
      ) : (
        <View style={styles.summaryBox}>
          <OrderLinesSummary lines={lines} groups={groups} index={index} currency={order.currency} />
        </View>
      )}

      <View style={styles.totalsBox}>
        <OrderTotalsBlock order={order} />
      </View>

      <View style={styles.actions}>
        {canDelete && (
          <Pressable onPress={() => void reject()} style={[styles.rejectBtn, busy && { opacity: 0.6 }]} disabled={busy}>
            <Text style={styles.rejectBtnText}>{busy ? '…' : 'Reddet'}</Text>
          </Pressable>
        )}
        {hasPermission(ctx.employee.role, 'order', 'update') && (
          <Pressable onPress={onEdit} style={[styles.rejectBtn, busy && { opacity: 0.6 }]} disabled={busy}>
            <Text style={styles.rejectBtnText}>Düzenle</Text>
          </Pressable>
        )}
        <Pressable onPress={() => void approve()} style={[styles.approveBtn, busy && { opacity: 0.6 }]} disabled={busy}>
          <Text style={styles.approveBtnText}>{busy ? '…' : 'Siparişe çevir'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { padding: 22 },
  error: { color: color.accentRamp[700], paddingHorizontal: 18 },
  customerBlock: { padding: 16, paddingHorizontal: 18, borderBottomWidth: 2, borderBottomColor: color.text },
  customerLabel: { fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', fontFamily: font.heading, color: color.dim },
  customerName: { fontSize: 20, fontFamily: font.heading, color: color.text, marginTop: 3 },
  noLines: { padding: 18 },
  summaryBox: { padding: 16, paddingHorizontal: 18 },
  totalsBox: { paddingHorizontal: 18, paddingVertical: 10, borderTopWidth: 2, borderTopColor: color.text, marginTop: 8 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, paddingHorizontal: 18, borderTopWidth: 2, borderTopColor: color.text, marginTop: 8 },
  totalLabel: { fontSize: 13, fontFamily: font.heading, color: color.dim },
  totalValue: { fontSize: 20, fontFamily: font.heading, color: color.text },
  actions: { flexDirection: 'row', gap: 10, padding: 18 },
  rejectBtn: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: color.text },
  rejectBtnText: { fontFamily: font.heading, fontSize: 13.5, color: color.text },
  approveBtn: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: color.accent },
  approveBtnText: { fontFamily: font.heading, fontSize: 13.5, color: color.bg },
});
