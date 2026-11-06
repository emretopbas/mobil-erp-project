import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BodyText, color, font } from '@/design-system';
import { CariLedgerView } from '@/features/cari/CariLedgerView';
import { MoneyEntryForm } from '@/features/cari/MoneyEntryForm';
import { OrderLinesSummary } from '@/features/orders/OrderLinesSummary';
import { OrderTotalsBlock } from '@/features/orders/OrderTotalsBlock';
import { loadVariantIndex, type IndexedVariant } from '@/features/orders/variantIndex';
import { formatCari, weOwe } from '@/lib/cari';
import { formatMoney } from '@/lib/money';
import { orderStatusLabel } from '@/lib/roleLabels';
import type { Customer, Order, OrderLine, OrderLineGroup } from '@/models';
import { cariService, customerService, hasPermission, orderService, reportService, type ActorContext, type CustomerRevenue } from '@/services';
import { useReloadOnMount } from '@/hooks/use-reload';

/** Screen 6 — list→detail. Detail: müşterinin tek defterden (`cari_movement`)
 * bakiyesi ve kayıtları (`CariLedgerView`, Hesaplar ekranıyla AYNI bileşen),
 * altında siparişleri. Sipariş satırlarında ödendi/kısmi/açık DURUMU YOK:
 * tahsilat siparişlere dağıtılmaz, doğrudan cari bakiyeden düşer; sipariş
 * altındaki "Tahsilat ekle" yalnızca aynı kaydı müşteri önceden seçili
 * açar (sipariş referans olarak saklanır). */
export function CustomerScreen({ ctx }: { ctx: ActorContext }) {
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [revenue, setRevenue] = useState<CustomerRevenue[]>([]);
  const [balances, setBalances] = useState<Map<string, { balanceMinor: number; currency: string }>>(new Map());
  const [variantInfo, setVariantInfo] = useState<Map<string, IndexedVariant>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ledgerKey, setLedgerKey] = useState(0);
  const canRecordPayment = hasPermission(ctx.employee.role, 'finance', 'create');

  const reload = useCallback(async () => {
    const [c, o, r, index, b] = await Promise.all([
      customerService.list(ctx),
      orderService.list(ctx),
      reportService.revenueByCustomer(ctx),
      loadVariantIndex(ctx),
      cariService.balances(ctx, 'customer'),
    ]);
    setCustomers(c);
    setOrders(o);
    setRevenue(r);
    setVariantInfo(index);
    setBalances(b);
  }, [ctx]);

  useReloadOnMount(reload);

  const selected = customers?.find((c) => c.id === selectedId) ?? null;

  if (selected) {
    const theirOrders = (orders ?? []).filter((o) => o.customer_id === selected.id);
    const theirRevenue = revenue.filter((r) => r.customerId === selected.id);
    const currency = selected.currency ?? ctx.business.base_currency;
    return (
      <View>
        <Pressable
          onPress={() => {
            setSelectedId(null);
            void reload();
          }}
          style={styles.backRow}
          hitSlop={8}>
          <Text style={styles.backText}>‹ Müşteriler</Text>
        </Pressable>
        <View style={styles.detailHeader}>
          <Text style={styles.detailName}>{selected.name}</Text>
          {!!selected.primary_channel && <Text style={styles.detailMeta}>{selected.primary_channel}</Text>}
        </View>

        <View style={styles.statsRow}>
          <View>
            <Text style={styles.statLabel}>Sipariş</Text>
            <Text style={styles.statValue}>{theirOrders.length}</Text>
          </View>
          {theirRevenue.map((r) => (
            <View key={r.currency}>
              <Text style={styles.statLabel}>Ciro ({r.currency})</Text>
              <Text style={styles.statValue}>{formatMoney(r.amountMinor, r.currency)}</Text>
            </View>
          ))}
        </View>

        <CariLedgerView ctx={ctx} contact={{ type: 'customer', id: selected.id }} name={selected.name} reloadKey={ledgerKey} onChanged={() => void reload()} />

        <Text style={styles.sectionLabel}>Siparişler</Text>
        {theirOrders.length === 0 && <BodyText muted style={{ paddingHorizontal: 18 }}>Henüz sipariş yok.</BodyText>}
        {theirOrders.map((o) => (
          <CustomerOrderRow
            key={o.id}
            ctx={ctx}
            order={o}
            customer={selected}
            currency={currency}
            variantInfo={variantInfo}
            canRecordPayment={canRecordPayment}
            onPaymentRecorded={() => {
              setLedgerKey((k) => k + 1);
              void reload();
            }}
          />
        ))}
      </View>
    );
  }

  return (
    <View>
      {customers === null && (
        <View style={styles.empty}>
          <BodyText muted>Yükleniyor…</BodyText>
        </View>
      )}
      {customers?.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Müşteri{'\n'}yok.</Text>
          <BodyText muted>Siparişler ekranından yeni müşteri ekleyebilirsiniz.</BodyText>
        </View>
      )}
      {customers?.map((c) => {
        const b = balances.get(c.id);
        return (
          <Pressable key={c.id} onPress={() => setSelectedId(c.id)} style={styles.listRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.listName}>{c.name}</Text>
              {!!c.primary_channel && <Text style={styles.listMeta}>{c.primary_channel}</Text>}
            </View>
            {!!b && b.balanceMinor !== 0 && <Text style={[styles.listBalance, weOwe(b.balanceMinor) && styles.balanceOwed]}>{formatCari(b.balanceMinor, b.currency)}</Text>}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Bir müşteri siparişi: tarih / durum / net tutar; açılınca ürün başına
 * sıkıştırılmış matris, brüt–iskonto–net ve "Tahsilat ekle". */
function CustomerOrderRow({
  ctx,
  order,
  customer,
  currency,
  variantInfo,
  canRecordPayment,
  onPaymentRecorded,
}: {
  ctx: ActorContext;
  order: Order;
  customer: Customer;
  currency: string;
  variantInfo: Map<string, IndexedVariant>;
  canRecordPayment: boolean;
  onPaymentRecorded: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [lines, setLines] = useState<OrderLine[] | null>(null);
  const [groups, setGroups] = useState<OrderLineGroup[]>([]);
  const [showForm, setShowForm] = useState(false);

  const toggle = async () => {
    if (!expanded && lines === null) {
      const [l, g] = await Promise.all([orderService.lines(ctx, order.id), orderService.lineGroups(ctx, order.id)]);
      setLines(l);
      setGroups(g);
    }
    setExpanded((e) => !e);
  };

  return (
    <View style={styles.orderRow}>
      <Pressable onPress={() => void toggle()} style={styles.orderHeader}>
        <Text style={styles.orderMeta}>{new Date(order.created_at).toLocaleDateString('tr-TR')}</Text>
        <Text style={styles.orderStatus}>
          {orderStatusLabel[order.status]} · {formatMoney(order.net_total_minor, order.currency)}
        </Text>
        <Text style={styles.orderCaret}>{expanded ? '▲' : '▼'}</Text>
      </Pressable>
      {expanded && (
        <View style={styles.orderLines}>
          {lines === null && <BodyText muted>Yükleniyor…</BodyText>}
          {lines?.length === 0 && <BodyText muted>Bu siparişin kalemi yok.</BodyText>}
          {!!lines?.length && <OrderLinesSummary lines={lines} groups={groups} index={variantInfo} currency={order.currency} />}
          {!!lines?.length && <OrderTotalsBlock order={order} />}
          {canRecordPayment && (
            <Pressable onPress={() => setShowForm((s) => !s)} style={styles.addPaymentBtn} hitSlop={6}>
              <Text style={styles.addPaymentBtnText}>{showForm ? 'Vazgeç' : '+ Tahsilat ekle'}</Text>
            </Pressable>
          )}
          {showForm && (
            <MoneyEntryForm
              ctx={ctx}
              fixedContact={{ type: 'customer', id: customer.id, name: customer.name, currency }}
              fixedKind="revenue"
              orderId={order.id}
              onSaved={() => {
                setShowForm(false);
                onPaymentRecorded();
              }}
            />
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { padding: 22, paddingVertical: 46, gap: 10 },
  emptyTitle: { fontSize: 34, lineHeight: 36, fontFamily: font.heading, color: color.text },

  listRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: color.divider },
  listName: { fontSize: 16, fontWeight: '700', color: color.text },
  listMeta: { fontSize: 12, color: color.dimmer, marginTop: 2 },
  listBalance: { fontSize: 14, fontFamily: font.mono, fontWeight: '700', color: color.text },

  backRow: { padding: 18, paddingBottom: 6 },
  backText: { fontFamily: font.heading, fontSize: 13, color: color.accent },
  detailHeader: { paddingHorizontal: 18, paddingBottom: 12, borderBottomWidth: 2, borderBottomColor: color.text },
  detailName: { fontSize: 24, fontFamily: font.heading, color: color.text },
  detailMeta: { fontSize: 12.5, color: color.dimmer, marginTop: 3 },
  statsRow: { flexDirection: 'row', gap: 24, padding: 18, borderBottomWidth: 1, borderBottomColor: color.divider },
  statLabel: { fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', fontFamily: font.heading, color: color.dim },
  statValue: { fontSize: 18, fontFamily: font.heading, color: color.text, marginTop: 2 },
  sectionLabel: { fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', fontFamily: font.heading, color: color.dim, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 4 },
  orderRow: { paddingHorizontal: 18, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: color.divider },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  orderMeta: { fontSize: 12.5, color: color.dimmer, fontFamily: font.mono },
  orderStatus: { fontSize: 12.5, color: color.text, fontWeight: '700', flex: 1, textAlign: 'right' },
  orderCaret: { fontSize: 10, color: color.dimmer },
  orderLines: { marginTop: 10, gap: 6 },
  addPaymentBtn: { marginTop: 8, alignSelf: 'flex-start' },
  addPaymentBtnText: { fontFamily: font.heading, fontSize: 12.5, color: color.accent },
  balanceOwed: { color: color.accent },
});
