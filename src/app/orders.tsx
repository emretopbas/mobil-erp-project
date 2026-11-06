import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardScrollProvider, useKeyboardScroll } from '@/components/keyboard-scroll';
import { BodyText, Button, Card, CardMeta, CardTitle, color, DatePicker, Field, font, Heading, space, Tag } from '@/design-system';
import { orderStatusLabel } from '@/lib/roleLabels';
import type { Customer, Order, OrderLine, OrderLineGroup } from '@/models';
import { type ActorContext, accountService, customerService, hasPermission, orderService, purchaseService, useActorContext, useSession } from '@/services';
import { useReloadOnMount } from '@/hooks/use-reload';
import { OrderLinesSummary } from '@/features/orders/OrderLinesSummary';
import { OrderTotalsBlock } from '@/features/orders/OrderTotalsBlock';
import { loadVariantIndex, type IndexedVariant } from '@/features/orders/variantIndex';
import { AccountsScreen } from '@/features/queue-erp/screens/AccountsScreen';
import { CustomerScreen } from '@/features/queue-erp/screens/CustomerScreen';
import { ManualDraftScreen } from '@/features/queue-erp/screens/ManualDraftScreen';
import { PurchasesScreen } from '@/features/queue-erp/screens/PurchasesScreen';

type Tab = 'customers' | 'orders' | 'purchases' | 'accounts';

/** Siparişler & Müşteriler — now a compact 4-tab page (same stage-pill bar
 * shape as the queue shell's İş Akışı screen) instead of one long
 * always-everything-stacked scroll: Müşteriler, Siparişler, Satın Almalar,
 * Hesaplar each get their own tab, since a small producer/B2B team tracks
 * each of these somewhat separately day to day — who they sell to, what's
 * on order, what they're buying in to make/resell, and who they owe or are
 * owed money by outside of an order/purchase's own total.
 *
 * Müşteriler and the two new tabs (Satın Almalar, Hesaplar) directly reuse
 * the queue shell's own screens — same list→detail design as the main
 * Müşteri screen, per the explicit ask, and one fewer place to keep two
 * implementations in sync. Siparişler keeps this page's existing
 * card-based order editor (unchanged logic) since it already worked well;
 * only its old always-visible Müşteriler section was split out. */
export default function OrdersScreen() {
  const ctx = useActorContext();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('customers');
  const [counts, setCounts] = useState<Record<Tab, number>>({ customers: 0, orders: 0, purchases: 0, accounts: 0 });
  const { scrollRef, onScroll, keyboardHeight, scroller } = useKeyboardScroll();

  const reloadCounts = useCallback(async () => {
    if (!ctx) return;
    const [c, o, p, a] = await Promise.all([
      customerService.list(ctx),
      orderService.list(ctx),
      hasPermission(ctx.employee.role, 'purchase', 'read') ? purchaseService.list(ctx) : Promise.resolve([]),
      hasPermission(ctx.employee.role, 'finance', 'read') ? accountService.list(ctx) : Promise.resolve([]),
    ]);
    setCounts({ customers: c.length, orders: o.length, purchases: p.length, accounts: a.length });
  }, [ctx]);

  useReloadOnMount(reloadCounts);

  if (!ctx) return null;

  const TABS: { key: Tab; label: string; visible: boolean }[] = [
    { key: 'customers', label: 'Müşteriler', visible: true },
    { key: 'orders', label: 'Siparişler', visible: true },
    { key: 'purchases', label: 'Satın Almalar', visible: hasPermission(ctx.employee.role, 'purchase', 'read') },
    { key: 'accounts', label: 'Hesaplar', visible: hasPermission(ctx.employee.role, 'finance', 'read') },
  ];
  const visibleTabs = TABS.filter((t) => t.visible);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <BodyText style={styles.backLabel}>‹ Geri</BodyText>
        </Pressable>
        <Heading level={3}>Siparişler &amp; Müşteriler</Heading>
        <BodyText muted style={styles.subtitle}>
          Müşteriler, siparişler, satın almalar ve hesaplar
        </BodyText>
      </View>

      <View style={styles.tabRow}>
        {visibleTabs.map((t, i) => (
          <Pressable
            key={t.key}
            onPress={() => setTab(t.key)}
            style={[
              styles.tabBtn,
              { backgroundColor: tab === t.key ? color.text : 'transparent', borderRightWidth: i === visibleTabs.length - 1 ? 0 : 1 },
            ]}>
            <Text style={[styles.tabCount, { color: tab === t.key ? color.bg : color.text }]}>{counts[t.key]}</Text>
            <Text style={[styles.tabLabel, { color: tab === t.key ? color.bg : color.text }]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={scrollRef}
          onScroll={onScroll}
          scrollEventThrottle={32}
          contentContainerStyle={[styles.content, keyboardHeight > 0 && { paddingBottom: space[8] + keyboardHeight }]}
          keyboardShouldPersistTaps="handled">
          <KeyboardScrollProvider scroller={scroller}>
            {tab === 'customers' && <CustomerScreen ctx={ctx} />}
            {tab === 'orders' && <OrdersTab ctx={ctx} onChanged={reloadCounts} />}
            {tab === 'purchases' && <PurchasesScreen ctx={ctx} />}
            {tab === 'accounts' && <AccountsScreen ctx={ctx} />}
          </KeyboardScrollProvider>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Siparişler sekmesi. Sipariş oluşturma ve kalem düzenleme, kuyruk
 * kabuğundaki "Manuel Sipariş" ekranının AYNISIDIR (`ManualDraftScreen` — ürün
 * başına tek satır + adet matrisi); burada sadece gömülüyor, ikinci bir düz
 * varyant listesi tutulmuyor. */
function OrdersTab({ ctx, onChanged }: { ctx: ActorContext; onChanged: () => Promise<void> }) {
  const { business } = useSession();
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [variantIndex, setVariantIndex] = useState<Map<string, IndexedVariant>>(new Map());
  const [editor, setEditor] = useState<{ orderId: string | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [c, o, index] = await Promise.all([customerService.list(ctx), orderService.list(ctx), loadVariantIndex(ctx)]);
    setCustomers(c);
    setOrders(o);
    setVariantIndex(index);
  }, [ctx]);

  useReloadOnMount(reload);

  const currency = business?.base_currency ?? 'TRY';
  const nameFor = (id: string) => customers?.find((c) => c.id === id)?.name ?? '—';
  const canCreate = hasPermission(ctx.employee.role, 'order', 'create');

  const changed = async () => {
    await reload();
    await onChanged();
  };

  if (editor) {
    return (
      <View>
        <Pressable onPress={() => setEditor(null)} style={styles.editorBack} hitSlop={8}>
          <BodyText style={styles.backLabel}>‹ Siparişler</BodyText>
        </Pressable>
        <ManualDraftScreen
          key={editor.orderId ?? 'new'}
          ctx={ctx}
          orderId={editor.orderId}
          flash={setNotice}
          onDone={() => {
            setEditor(null);
            void changed();
          }}
        />
      </View>
    );
  }

  return (
    <View style={styles.padded}>
      {!!notice && <BodyText muted>{notice}</BodyText>}

      {canCreate && <Button label="+ Yeni sipariş" variant="primary" disabled={!customers?.length} onPress={() => setEditor({ orderId: null })} />}
      {!customers?.length && <BodyText muted>Sipariş oluşturmak için önce Müşteriler sekmesinden bir müşteri ekleyin.</BodyText>}

      {orders === null && <BodyText muted>Yükleniyor…</BodyText>}
      {orders?.length === 0 && <BodyText muted>Henüz sipariş yok.</BodyText>}
      <View style={styles.list}>
        {orders?.map((o) => (
          <OrderCard
            key={o.id}
            ctx={ctx}
            order={o}
            customerName={nameFor(o.customer_id)}
            variantIndex={variantIndex}
            currency={currency}
            onChanged={changed}
            onEdit={() => setEditor({ orderId: o.id })}
          />
        ))}
      </View>
    </View>
  );
}

function OrderCard({
  ctx,
  order,
  customerName,
  variantIndex,
  currency,
  onChanged,
  onEdit,
}: {
  ctx: ActorContext;
  order: Order;
  customerName: string;
  variantIndex: Map<string, IndexedVariant>;
  currency: string;
  onChanged: () => Promise<void>;
  onEdit: () => void;
}) {
  const [lines, setLines] = useState<OrderLine[] | null>(null);
  const [groups, setGroups] = useState<OrderLineGroup[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDeliveryEdit, setShowDeliveryEdit] = useState(false);
  const [deliveryDate, setDeliveryDate] = useState(() => (order.delivery_date ? new Date(order.delivery_date) : new Date()));
  const [confirmDelete, setConfirmDelete] = useState(false);

  const reloadLines = useCallback(async () => {
    const [l, g] = await Promise.all([orderService.lines(ctx, order.id), orderService.lineGroups(ctx, order.id)]);
    setLines(l);
    setGroups(g);
  }, [ctx, order.id]);

  useReloadOnMount(reloadLines);

  const canDelete = hasPermission(ctx.employee.role, 'order', 'delete');
  const canEdit = hasPermission(ctx.employee.role, 'order', 'update') && order.status !== 'shipped';

  const deleteOrder = async () => {
    setBusy(true);
    setError(null);
    try {
      await orderService.softDelete(ctx, order.id);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await orderService.confirm(ctx, order.id);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Teslim tarihi — status'tan bağımsız (CLAUDE.md'nin para/durum ayrımı
  // burada da geçerli: sipariş bugün onaylanıp üç hafta sonra teslim
  // edilebilir), bu yüzden her aşamada düzenlenebilir.
  const saveDeliveryDate = async () => {
    setBusy(true);
    setError(null);
    try {
      await orderService.setDeliveryDate(ctx, order.id, deliveryDate.toISOString());
      setShowDeliveryEdit(false);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const clearDeliveryDate = async () => {
    setBusy(true);
    setError(null);
    try {
      await orderService.setDeliveryDate(ctx, order.id, null);
      setShowDeliveryEdit(false);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardMeta>
        <Tag label={orderStatusLabel[order.status]} variant={order.status === 'draft' ? 'neutral' : 'accent2'} />
      </CardMeta>
      <CardTitle>{customerName}</CardTitle>
      {!!error && <BodyText style={styles.error}>{error}</BodyText>}
      {lines && lines.length > 0 && <OrderTotalsBlock order={order} />}

      <View style={styles.deliveryRow}>
        <BodyText muted>
          {order.delivery_date ? `Teslim tarihi: ${new Date(order.delivery_date).toLocaleDateString('tr-TR')}` : 'Teslim tarihi belirlenmedi'}
        </BodyText>
        <Button
          label={showDeliveryEdit ? 'Kapat' : order.delivery_date ? 'Değiştir' : '+ Ekle'}
          variant="ghost"
          onPress={() => setShowDeliveryEdit((s) => !s)}
        />
      </View>
      {showDeliveryEdit && (
        <View style={styles.lineForm}>
          <Field label="Teslim tarihi">
            <DatePicker value={deliveryDate} onChange={setDeliveryDate} />
          </Field>
          <View style={styles.actionRow}>
            <Button label={busy ? '…' : 'Kaydet'} variant="primary" disabled={busy} onPress={() => void saveDeliveryDate()} />
            {!!order.delivery_date && <Button label="Kaldır" variant="secondary" disabled={busy} onPress={() => void clearDeliveryDate()} />}
          </View>
        </View>
      )}

      {!!lines?.length && <OrderLinesSummary lines={lines} groups={groups} index={variantIndex} currency={currency} />}
      {lines?.length === 0 && <BodyText muted>Bu siparişin henüz kalemi yok.</BodyText>}

      {confirmDelete ? (
        <View style={styles.confirmBox}>
          <BodyText>
            {order.status === 'shipped'
              ? 'Bu sipariş silinsin mi? Sevk edildiği için stok ters hareketle önceki haline döner, cari borcu kapanır.'
              : 'Bu sipariş silinsin mi?'}
          </BodyText>
          <View style={styles.actionRow}>
            <Button label={busy ? '…' : 'Evet, sil'} variant="primary" disabled={busy} onPress={() => void deleteOrder()} />
            <Button label="Vazgeç" variant="ghost" disabled={busy} onPress={() => setConfirmDelete(false)} />
          </View>
        </View>
      ) : (
        <View style={styles.actionRow}>
          {canEdit && <Button label="Kalemleri düzenle" variant="secondary" disabled={busy} onPress={onEdit} />}
          {order.status === 'draft' && <Button label={busy ? '…' : 'Onayla'} variant="primary" disabled={busy || !lines?.length} onPress={() => void confirm()} />}
          {canDelete && <Button label="Siparişi sil" variant="secondary" disabled={busy} onPress={() => setConfirmDelete(true)} />}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  flex: { flex: 1 },
  header: {
    paddingHorizontal: space[4],
    paddingTop: space[2],
    paddingBottom: space[3],
    borderBottomWidth: 2,
    borderBottomColor: color.divider,
    gap: space[1],
  },
  back: { alignSelf: 'flex-start', paddingVertical: space[1] },
  backLabel: { color: color.accent },
  subtitle: { marginTop: 2 },
  content: { flexGrow: 1 },

  tabRow: { flexDirection: 'row', borderBottomWidth: 2, borderBottomColor: color.text },
  tabBtn: { flex: 1, minHeight: 54, padding: 8, paddingHorizontal: 4, justifyContent: 'center', gap: 2, borderRightColor: color.divider },
  tabCount: { fontSize: 16, lineHeight: 18, fontFamily: font.heading },
  tabLabel: { fontSize: 8, letterSpacing: 0.2, textTransform: 'uppercase', fontFamily: font.heading },

  padded: { padding: space[4], gap: space[4] },
  error: { color: '#ae1800' },
  list: { gap: space[3] },
  lineForm: { gap: space[3], marginTop: space[2] },
  editorBack: { paddingHorizontal: space[4], paddingVertical: space[2], alignSelf: 'flex-start' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  deliveryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] },
  confirmBox: { gap: space[2], marginTop: space[2] },
});
