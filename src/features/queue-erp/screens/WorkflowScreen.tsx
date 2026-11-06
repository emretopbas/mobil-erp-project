import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BodyText, color, font } from '@/design-system';
import { OrderLinesSummary } from '@/features/orders/OrderLinesSummary';
import { OrderTotalsBlock } from '@/features/orders/OrderTotalsBlock';
import { loadVariantIndex, type IndexedVariant } from '@/features/orders/variantIndex';
import { orderStatusLabel } from '@/lib/roleLabels';
import type { Customer, Order, OrderLine, OrderLineGroup, OrderStatus } from '@/models';
import { customerService, hasPermission, orderService, type ActorContext } from '@/services';
import { useReloadOnMount } from '@/hooks/use-reload';

const STAGES: OrderStatus[] = ['draft', 'confirmed', 'in_production', 'ready', 'shipped'];
const NEXT: Record<OrderStatus, OrderStatus | null> = {
  draft: null, // draft orders move via Approval (screen 2), not "advance"
  confirmed: 'in_production',
  in_production: 'ready',
  ready: 'shipped',
  shipped: null,
};

/** Screen 3 — real `Order`s grouped by the real `OrderStatus` enum, labeled
 * via the existing `orderStatusLabel` map instead of the mockup's invented
 * Turkish stage names. "Advance" calls `orderService.setStatus()` for
 * real. Each row shows the order date and — tap to expand, same pattern as
 * CustomerScreen's order rows — its real lines (product/variant/qty/price),
 * not just a customer name and an ID fragment. */
export function WorkflowScreen({ ctx, goTo, onEditOrder }: { ctx: ActorContext; goTo: (n: number) => void; onEditOrder: (orderId: string) => void }) {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [customerNames, setCustomerNames] = useState<Record<string, string>>({});
  const [variantInfo, setVariantInfo] = useState<Map<string, IndexedVariant>>(new Map());
  const [stage, setStage] = useState<OrderStatus>('confirmed');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canAdvance = hasPermission(ctx.employee.role, 'order', 'update');

  const reload = useCallback(async () => {
    const [o, customers, index] = await Promise.all([
      orderService.list(ctx),
      customerService.list(ctx, { includeInactive: true }),
      loadVariantIndex(ctx),
    ]);
    setOrders(o);
    const names: Record<string, string> = {};
    for (const c of customers as Customer[]) names[c.id] = c.name;
    setCustomerNames(names);
    setVariantInfo(index);
  }, [ctx]);

  useReloadOnMount(reload);

  const advance = async (order: Order) => {
    const next = NEXT[order.status];
    if (!next) return;
    setBusyId(order.id);
    setError(null);
    try {
      await orderService.setStatus(ctx, order.id, next);
      await reload();
    } catch (e) {
      // Most likely a NegativeStockError from the shipped→stock deduction
      // (§5.1's negative-stock guard) — surface it instead of failing
      // silently, since the order stays wherever it was.
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const stageOrders = (orders ?? []).filter((o) => o.status === stage);

  return (
    <View>
      {!!error && (
        <Text style={styles.error} numberOfLines={3}>
          {error}
        </Text>
      )}
      <View style={styles.stageRow}>
        {STAGES.map((st, i) => (
          <Pressable
            key={st}
            onPress={() => setStage(st)}
            style={[
              styles.stageBtn,
              { backgroundColor: stage === st ? color.text : 'transparent', borderRightWidth: i === STAGES.length - 1 ? 0 : 1 },
            ]}>
            <Text style={[styles.stageCount, { color: stage === st ? color.bg : color.text }]}>
              {(orders ?? []).filter((o) => o.status === st).length}
            </Text>
            <Text style={[styles.stageLabel, { color: stage === st ? color.bg : color.text }]}>{orderStatusLabel[st]}</Text>
          </Pressable>
        ))}
      </View>

      {orders === null ? (
        <View style={styles.empty}>
          <BodyText muted>Yükleniyor…</BodyText>
        </View>
      ) : stageOrders.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Bu aşama boş.</Text>
          <Text style={styles.emptyBody}>Bir sipariş bu aşamaya geldiğinde burada listelenir.</Text>
          {stage === 'draft' && (
            <Pressable onPress={() => goTo(9)} style={styles.emptyBtn}>
              <Text style={styles.emptyBtnText}>Sipariş ekle</Text>
            </Pressable>
          )}
        </View>
      ) : (
        stageOrders.map((o) => (
          <WorkflowOrderRow
            key={o.id}
            ctx={ctx}
            order={o}
            customerName={customerNames[o.customer_id] ?? '—'}
            variantInfo={variantInfo}
            next={NEXT[o.status]}
            canAdvance={canAdvance}
            busy={busyId === o.id}
            onAdvance={() => void advance(o)}
            onEdit={() => onEditOrder(o.id)}
          />
        ))
      )}
    </View>
  );
}

/** One order at its current stage — always shows the customer, order date,
 * and the "advance to next stage" action; tap the row (not the advance
 * button) to expand its real lines, lazy-loaded on first expand, same
 * shape as CustomerScreen's CustomerOrderRow. */
function WorkflowOrderRow({
  ctx,
  order,
  customerName,
  variantInfo,
  next,
  canAdvance,
  busy,
  onAdvance,
  onEdit,
}: {
  ctx: ActorContext;
  order: Order;
  customerName: string;
  variantInfo: Map<string, IndexedVariant>;
  next: OrderStatus | null;
  canAdvance: boolean;
  busy: boolean;
  onAdvance: () => void;
  onEdit: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [lines, setLines] = useState<OrderLine[] | null>(null);
  const [groups, setGroups] = useState<OrderLineGroup[]>([]);

  const toggle = async () => {
    if (!expanded && lines === null) {
      const [l, g] = await Promise.all([orderService.lines(ctx, order.id), orderService.lineGroups(ctx, order.id)]);
      setLines(l);
      setGroups(g);
    }
    setExpanded((e) => !e);
  };

  return (
    <Pressable onPress={() => void toggle()} style={styles.orderRow}>
      <View style={styles.orderMain}>
        <View style={{ flex: 1 }}>
          <Text style={styles.customer}>{customerName}</Text>
          <Text style={styles.orderMeta}>
            {new Date(order.created_at).toLocaleDateString('tr-TR')} · {order.id.slice(0, 8)}
          </Text>
        </View>
        {canAdvance && next && (
          <Pressable onPress={onAdvance} style={styles.advanceBtn} disabled={busy}>
            <Text style={styles.advanceText}>{busy ? '…' : orderStatusLabel[next]}</Text>
          </Pressable>
        )}
        <Text style={styles.orderCaret}>{expanded ? '▲' : '▼'}</Text>
      </View>

      {expanded && (
        <View style={styles.orderLines}>
          {lines === null && <BodyText muted style={styles.orderLinesLoading}>Yükleniyor…</BodyText>}
          {lines?.length === 0 && <BodyText muted style={styles.orderLinesLoading}>Bu siparişin kalemi yok.</BodyText>}
          {!!lines?.length && <OrderLinesSummary lines={lines} groups={groups} index={variantInfo} currency={order.currency} />}
          {!!lines?.length && <OrderTotalsBlock order={order} />}
          {canAdvance && order.status !== 'shipped' && (
            <Pressable onPress={onEdit} style={styles.editBtn}>
              <Text style={styles.editBtnText}>Kalemleri düzenle</Text>
            </Pressable>
          )}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  editBtn: { alignSelf: 'flex-start', marginTop: 10, height: 36, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: color.text },
  editBtnText: { fontSize: 12.5, fontFamily: font.heading, color: color.text },
  error: { color: color.accentRamp[700], padding: 14, paddingHorizontal: 18 },
  stageRow: { flexDirection: 'row', borderBottomWidth: 2, borderBottomColor: color.text },
  stageBtn: { flex: 1, minHeight: 58, padding: 8, paddingHorizontal: 4, justifyContent: 'center', gap: 2, borderRightColor: color.divider },
  stageCount: { fontSize: 18, lineHeight: 20, fontFamily: font.heading },
  stageLabel: { fontSize: 8.5, letterSpacing: 0.3, textTransform: 'uppercase', fontFamily: font.heading },

  empty: { padding: 18, paddingVertical: 38 },
  emptyTitle: { fontSize: 30, fontFamily: font.heading, color: color.text },
  emptyBody: { fontSize: 13, lineHeight: 19, color: color.dim, marginTop: 12, marginBottom: 16 },
  emptyBtn: { minHeight: 46, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: color.text, alignSelf: 'flex-start' },
  emptyBtnText: { fontFamily: font.heading, fontSize: 13.5, color: color.text },

  orderRow: { padding: 15, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: color.divider },
  orderMain: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  customer: { fontSize: 15, fontWeight: '700', color: color.text },
  orderMeta: { fontSize: 10.5, fontFamily: font.mono, color: color.dimmer, marginTop: 2 },
  advanceBtn: { minHeight: 40, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: color.text },
  advanceText: { fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase', fontWeight: '700', color: color.text },
  orderCaret: { fontSize: 10, color: color.dimmer, marginLeft: 4 },

  orderLines: { marginTop: 10, gap: 6 },
  orderLinesLoading: { paddingVertical: 4 },
  lineRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  lineName: { flex: 1, fontSize: 12.5, color: color.text },
  lineValue: { fontSize: 12.5, fontFamily: font.mono, color: color.text },
  lineTotalRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: color.divider },
  lineTotalLabel: { fontSize: 11, fontFamily: font.heading, color: color.dim },
  lineTotalValue: { fontSize: 13.5, fontFamily: font.heading, color: color.text },
});
