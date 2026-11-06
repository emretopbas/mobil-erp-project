import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BodyText, Button, color, DatePicker, Field, font, Input, SegmentedControl, space, Tag } from '@/design-system';
import { PurchaseEditor } from '@/features/purchases/PurchaseEditor';
import { balanceLabel, formatCari, weOwe } from '@/lib/cari';
import { formatMoney } from '@/lib/money';
import { formatQuantity } from '@/lib/quantity';
import { paymentMethodLabel } from '@/lib/roleLabels';
import type { Account, Material, PaymentMethod, Purchase, PurchaseLine } from '@/models';
import {
  accountService,
  hasPermission,
  materialService,
  productService,
  purchaseService,
  type ActorContext,
  type PurchaseBalance,
  type PurchasePayment,
} from '@/services';
import { useReloadOnMount } from '@/hooks/use-reload';

const METHODS: PaymentMethod[] = ['cash', 'credit_card', 'check', 'deposit'];

/** Satın Almalar — Satın Almalar v2: tek ekran, tek katalog (malzeme + ürün).
 * Liste burada; oluşturma/düzenleme `PurchaseEditor`'da. "Teslim alındı"
 * kapalı kayıtlar ayrı bir "Bekleyen" bölümünde durur (şartname §4), stok
 * yalnızca teslim alınınca işlenir — bütün stok kuralları
 * `purchaseService`'te (bkz. o dosyanın başlığı), bu ekran sadece çağırır. */
export function PurchasesScreen({ ctx }: { ctx: ActorContext }) {
  const [purchases, setPurchases] = useState<Purchase[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [balances, setBalances] = useState<Record<string, PurchaseBalance>>({});
  const [materials, setMaterials] = useState<Material[]>([]);
  const [variantLabels, setVariantLabels] = useState<Record<string, string>>({});
  const [editor, setEditor] = useState<{ purchaseId: string | null } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canWrite = hasPermission(ctx.employee.role, 'purchase', 'update');
  const canCreate = hasPermission(ctx.employee.role, 'purchase', 'create');
  // Silme ayrı bir yetki: yalnızca owner/manager (bkz. rbac/permissions.ts'in
  // DELETE_RESTRICTED_TO_OWNER_MANAGER'ı) — production hâlâ alım oluşturup
  // teslim alabilir, ama yapılmış bir alımı silemez.
  const canDelete = hasPermission(ctx.employee.role, 'purchase', 'delete');

  const reload = useCallback(async () => {
    const [p, a, mats, products] = await Promise.all([
      purchaseService.list(ctx),
      accountService.list(ctx),
      materialService.list(ctx, { includeArchived: true }),
      productService.list(ctx),
    ]);
    const labels: Record<string, string> = {};
    for (const product of products) {
      for (const v of await productService.listVariantsWithAttributes(ctx, product.id, { includeInactive: true })) {
        labels[v.variant.id] = v.axes.length > 0 ? `${product.name} · ${v.axes.map((x) => x.valueLabel).join(' · ')}` : `${product.name} (${v.variant.sku})`;
      }
    }
    const bal: Record<string, PurchaseBalance> = {};
    for (const purchase of p) bal[purchase.id] = await purchaseService.balance(ctx, purchase.id);
    setPurchases(p);
    setAccounts(a);
    setMaterials(mats);
    setVariantLabels(labels);
    setBalances(bal);
  }, [ctx]);

  useReloadOnMount(reload);

  if (editor) {
    return (
      <PurchaseEditor
        key={editor.purchaseId ?? 'new'}
        ctx={ctx}
        purchaseId={editor.purchaseId}
        onCancel={() => setEditor(null)}
        onSaved={(msg) => {
          setEditor(null);
          setMessage(msg);
          void reload();
        }}
      />
    );
  }

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const materialById = new Map(materials.map((m) => [m.id, m]));
  const pending = (purchases ?? []).filter((p) => p.is_received === 0);
  const received = (purchases ?? []).filter((p) => p.is_received === 1);

  const renderRow = (p: Purchase) => (
    <PurchaseRow
      key={p.id}
      ctx={ctx}
      purchase={p}
      accountName={accountById.get(p.account_id)?.name ?? '—'}
      balance={balances[p.id] ?? null}
      materialById={materialById}
      variantLabels={variantLabels}
      canWrite={canWrite}
      canDelete={canDelete}
      onEdit={() => setEditor({ purchaseId: p.id })}
      onChanged={reload}
    />
  );

  return (
    <View>
      {canCreate && (
        <Pressable onPress={() => setEditor({ purchaseId: null })} style={styles.createToggle}>
          <Text style={styles.createToggleText}>+ Yeni satın alma</Text>
        </Pressable>
      )}
      {!!message && (
        <Pressable onPress={() => setMessage(null)}>
          <Text style={styles.message}>{message}</Text>
        </Pressable>
      )}

      {purchases === null && (
        <View style={styles.empty}>
          <BodyText muted>Yükleniyor…</BodyText>
        </View>
      )}
      {purchases?.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Satın alma{'\n'}yok.</Text>
          <BodyText muted>Malzeme veya ürün almaya başlamak için yukarıdan &quot;+ Yeni satın alma&quot;yı kullanın.</BodyText>
        </View>
      )}

      {pending.length > 0 && <Text style={styles.sectionLabel}>Bekleyen ({pending.length})</Text>}
      {pending.map(renderRow)}
      {received.length > 0 && <Text style={styles.sectionLabel}>Teslim alınan ({received.length})</Text>}
      {received.map(renderRow)}
    </View>
  );
}

function PurchaseRow({
  ctx,
  purchase,
  accountName,
  balance,
  materialById,
  variantLabels,
  canWrite,
  canDelete,
  onEdit,
  onChanged,
}: {
  ctx: ActorContext;
  purchase: Purchase;
  accountName: string;
  balance: PurchaseBalance | null;
  materialById: Map<string, Material>;
  variantLabels: Record<string, string>;
  canWrite: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onChanged: () => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [lines, setLines] = useState<PurchaseLine[] | null>(null);
  const [payments, setPayments] = useState<PurchasePayment[] | null>(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    const [l, p] = await Promise.all([purchaseService.lines(ctx, purchase.id), purchaseService.payments(ctx, purchase.id)]);
    setLines(l);
    setPayments(p);
  }, [ctx, purchase.id]);

  const toggle = async () => {
    if (!expanded && lines === null) await loadDetail();
    setExpanded((e) => !e);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const markReceived = () =>
    run(async () => {
      await purchaseService.setReceived(ctx, purchase.id, true);
      await onChanged();
      await loadDetail();
    });

  const remove = () =>
    run(async () => {
      await purchaseService.softDelete(ctx, purchase.id);
      await onChanged();
    });

  const lineName = (l: PurchaseLine) =>
    l.line_type === 'material' ? (materialById.get(l.material_id ?? '')?.name ?? 'Malzeme') : (variantLabels[l.variant_id ?? ''] ?? 'Ürün');

  return (
    <Pressable onPress={() => void toggle()} style={styles.row}>
      <View style={styles.rowHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowName}>{accountName}</Text>
          <Text style={styles.rowMeta}>
            {new Date(purchase.purchase_date).toLocaleDateString('tr-TR')} · {purchase.is_received === 1 ? 'Teslim alındı' : 'Bekliyor'}
          </Text>
        </View>
        {!!balance && balance.totalMinor > 0 && <Text style={styles.rowTotal}>{formatMoney(balance.totalMinor, balance.currency)}</Text>}
        <Text style={styles.rowCaret}>{expanded ? '▲' : '▼'}</Text>
      </View>

      {expanded && (
        <View style={styles.detail}>
          {!!error && <BodyText style={styles.error}>{error}</BodyText>}
          {lines === null && <BodyText muted>Yükleniyor…</BodyText>}
          {lines?.map((l) => (
            <View key={l.id} style={styles.lineRow}>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={styles.nameLine}>
                  <Text style={styles.lineName}>{lineName(l)}</Text>
                  <Tag label={l.line_type === 'material' ? 'Malzeme' : 'Ürün'} variant={l.line_type === 'material' ? 'neutral' : 'accent2'} />
                </View>
                <Text style={styles.lineSub}>
                  {formatQuantity(l.quantity)} {l.unit}
                  {l.unit_cost_minor > 0 ? ` × ${formatMoney(l.unit_cost_minor, purchase.currency)}` : ''}
                </Text>
              </View>
              {l.line_total_minor > 0 && <Text style={styles.lineValue}>{formatMoney(l.line_total_minor, purchase.currency)}</Text>}
            </View>
          ))}
          {!!purchase.note && <BodyText muted>{purchase.note}</BodyText>}

          {!!balance && !!lines?.length && (
            <>
              <View style={styles.balanceRow}>
                <Text style={styles.balanceLabel}>Toplam</Text>
                <Text style={styles.balanceValue}>{formatMoney(balance.totalMinor, balance.currency)}</Text>
              </View>
              <View style={styles.balanceRow}>
                <Text style={styles.balanceLabel}>Ödenen</Text>
                <Text style={styles.balanceValue}>{formatMoney(balance.paidMinor, balance.currency)}</Text>
              </View>
              {/* Cari bakiye (lib/cari.ts): tedarikçiden alım hesabın carisine
                  Alacak (−) yazılır, yaptığın ödeme Borç (+). Kalan Alacak =
                  sen tedarikçiye borçlusun. Teslim alınmamış alım henüz
                  cariye işlenmez (Hesaplar bakiyesine girmez). */}
              <View style={styles.balanceRow}>
                <Text style={styles.balanceLabel}>Bakiye · {balanceLabel(-balance.balanceMinor)}</Text>
                <Text style={[styles.balanceValue, weOwe(-balance.balanceMinor) && { color: color.accent }]}>
                  {formatCari(-balance.balanceMinor, balance.currency)}
                </Text>
              </View>
              {purchase.is_received === 0 && <BodyText muted>Teslim alınmadı — hesabın bakiyesine henüz işlenmedi.</BodyText>}
            </>
          )}

          {payments?.map((p) => (
            <View key={p.entry.id} style={styles.lineRow}>
              <Text style={styles.lineName}>
                {new Date(p.entry.date).toLocaleDateString('tr-TR')} · {paymentMethodLabel[p.entry.payment_method]}
              </Text>
              <Text style={styles.lineValue}>{formatMoney(p.entry.amount_minor, purchase.currency)}</Text>
            </View>
          ))}

          {confirmDelete ? (
            <View style={styles.confirmBox}>
              <BodyText>
                {purchase.is_received === 1
                  ? 'Bu satın alma silinsin mi? Teslim alındığı için stok, ters hareketle önceki haline döner.'
                  : 'Bu bekleyen satın alma silinsin mi? Stok etkilenmez.'}
              </BodyText>
              <View style={styles.actionRow}>
                <Button label={busy ? '…' : 'Evet, sil'} variant="primary" disabled={busy} onPress={() => void remove()} />
                <Button label="Vazgeç" variant="ghost" disabled={busy} onPress={() => setConfirmDelete(false)} />
              </View>
            </View>
          ) : (
            <View style={styles.actionRow}>
              {canWrite && purchase.is_received === 0 && !!lines?.length && (
                <Button label={busy ? '…' : 'Teslim alındı'} variant="primary" disabled={busy} onPress={() => void markReceived()} />
              )}
              {canWrite && <Button label="Düzenle" variant="secondary" disabled={busy} onPress={onEdit} />}
              {canWrite && (
                <Button label={showPaymentForm ? 'Vazgeç' : '+ Ödeme ekle'} variant="ghost" onPress={() => setShowPaymentForm((s) => !s)} />
              )}
              {canDelete && <Button label="Sil" variant="ghost" disabled={busy} onPress={() => setConfirmDelete(true)} />}
            </View>
          )}

          {showPaymentForm && (
            <PurchasePaymentForm
              ctx={ctx}
              purchase={purchase}
              defaultAmountMinor={Math.max(balance?.balanceMinor ?? 0, 0)}
              onDone={() => {
                setShowPaymentForm(false);
                void loadDetail();
                void onChanged();
              }}
            />
          )}
        </View>
      )}
    </Pressable>
  );
}

function PurchasePaymentForm({
  ctx,
  purchase,
  defaultAmountMinor,
  onDone,
}: {
  ctx: ActorContext;
  purchase: Purchase;
  defaultAmountMinor: number;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState(defaultAmountMinor > 0 ? (defaultAmountMinor / 100).toFixed(2) : '');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [dueDate, setDueDate] = useState(new Date());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const amountMajor = Number(amount.replace(',', '.'));
    if (!Number.isFinite(amountMajor) || amountMajor <= 0) {
      setError('Geçerli bir tutar girin.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await purchaseService.recordPayment(ctx, purchase.id, {
        amount_minor: Math.round(amountMajor * 100),
        payment_method: method,
        check: method === 'check' ? { due_date: dueDate.toISOString() } : undefined,
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pressable onPress={(e) => e.stopPropagation()} style={styles.paymentForm}>
      <Field label="Tutar">
        <Input value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" />
      </Field>
      <SegmentedControl
        options={METHODS.map((m) => ({ label: paymentMethodLabel[m], value: m }))}
        value={method}
        onChange={(v) => setMethod(v as PaymentMethod)}
      />
      {method === 'check' && (
        <Field label="Vade tarihi">
          <DatePicker value={dueDate} onChange={setDueDate} />
        </Field>
      )}
      {!!error && <BodyText style={styles.error}>{error}</BodyText>}
      <Button label={busy ? '…' : 'Ödemeyi kaydet'} variant="primary" disabled={busy} onPress={() => void submit()} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  error: { color: color.accentRamp[700], padding: 14, paddingHorizontal: 18 },
  message: { padding: 14, paddingHorizontal: 18, fontSize: 13, color: color.text, backgroundColor: color.surface, borderBottomWidth: 1, borderBottomColor: color.divider },
  createToggle: { paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 2, borderBottomColor: color.text },
  createToggleText: { fontFamily: font.heading, fontSize: 13.5, color: color.accent },

  sectionLabel: { fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', fontFamily: font.heading, color: color.dim, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 4 },
  empty: { padding: 18, paddingVertical: 38, gap: 12 },
  emptyTitle: { fontSize: 30, lineHeight: 32, fontFamily: font.heading, color: color.text },

  row: { paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: color.divider },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowName: { fontSize: 15, fontWeight: '700', color: color.text },
  rowMeta: { fontSize: 11, fontFamily: font.mono, color: color.dimmer, marginTop: 2 },
  rowTotal: { fontSize: 13, fontFamily: font.mono, color: color.text },
  rowCaret: { fontSize: 10, color: color.dimmer },

  detail: { marginTop: 10, gap: 6 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  lineRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  lineName: { fontSize: 12.5, color: color.text },
  lineSub: { fontSize: 11.5, color: color.dimmer },
  lineValue: { fontSize: 12.5, fontFamily: font.mono, color: color.text },

  balanceRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: color.divider },
  balanceLabel: { fontSize: 11, fontFamily: font.heading, color: color.dim },
  balanceValue: { fontSize: 13, fontFamily: font.heading, color: color.text },

  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  confirmBox: { gap: 8, marginTop: 8, padding: 12, borderWidth: 1, borderColor: color.accent },
  paymentForm: { marginTop: 10, gap: space[3], padding: 12, borderWidth: 1, borderColor: color.divider },
});
