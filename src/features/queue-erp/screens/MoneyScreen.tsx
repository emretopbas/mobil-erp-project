import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BodyText, CollapsibleSection, color, font, Heading } from '@/design-system';
import { CariReconcile } from '@/features/cari/CariReconcile';
import { MoneyEntryForm } from '@/features/cari/MoneyEntryForm';
import { balanceLabel, formatCari, weOwe } from '@/lib/cari';
import { formatMoney } from '@/lib/money';
import { expenseCategoryLabel, paymentMethodLabel, revenueCategoryLabel } from '@/lib/roleLabels';
import {
  accountService,
  cariService,
  customerService,
  employeeService,
  financeService,
  hasPermission,
  reportService,
  type ActorContext,
  type CategoryBreakdown,
  type MonthlySummary,
} from '@/services';
import type { Account, Check, Customer, Employee, ExpenseEntry, PaymentMethod, RevenueEntry } from '@/models';
import { useReloadOnMount } from '@/hooks/use-reload';

interface Transaction {
  id: string;
  /** 'purchase' satırları nakit hareketi DEĞİL: bir hesabın satın alması (cari
   * Alacak) — "Son Kayıtlar"da görünsün diye buraya karışıyor ama Bu Ay
   * Gelir/Gider/Net toplamlarına girmez (onlar reportService'ten geliyor). */
  kind: 'revenue' | 'expense' | 'purchase';
  amount_minor: number;
  currency: string;
  date: string;
  note: string | null;
  payment_method: PaymentMethod;
  related_customer_id: string | null;
  related_employee_id: string | null;
  related_account_id: string | null;
  cari_excluded: boolean;
  category: string | null;
}

/** Screen 5 — Para. "+" burada genel para girişi/çıkışının TEK formu: her kayıt
 * "Kimden?/Kime?" sorusunu yanıtlar (bir cari ya da bilinçli "Cari dışı") ve
 * cari seçilirse kasa + cari hareketi tek işlemde yazılır (`MoneyEntryForm`).
 * Müşteri/hesap ekranları ve siparişin "Tahsilat ekle"si aynı formu, aynı
 * servis çağrısını kullanır. Hesaplar bölümü ve bekleyen eşleştirmeler tek
 * defterden (`cari_movement`) gelir. */
export function MoneyScreen({ ctx }: { ctx: ActorContext }) {
  const [summary, setSummary] = useState<MonthlySummary[] | null>(null);
  const [categories, setCategories] = useState<CategoryBreakdown[] | null>(null);
  const [dueChecks, setDueChecks] = useState<Check[] | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountBalances, setAccountBalances] = useState<Map<string, { balanceMinor: number; currency: string }>>(new Map());
  const [showForm, setShowForm] = useState(false);
  const [confirmVoid, setConfirmVoid] = useState<string | null>(null);
  const [voidBusy, setVoidBusy] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  const canWrite = hasPermission(ctx.employee.role, 'finance', 'create');
  const canVoid = hasPermission(ctx.employee.role, 'finance', 'delete');
  const currency = ctx.business.base_currency;

  const customerById = new Map(customers.map((c) => [c.id, c]));
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const reload = useCallback(async () => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const [s, cat, checks, revenues, expenses, custs, emps, accts] = await Promise.all([
      reportService.monthlySummary(ctx, { from: monthStart, to: now.toISOString() }),
      reportService.expenseByCategory(ctx),
      financeService.upcomingDueChecks(ctx),
      financeService.listRevenues(ctx),
      financeService.listExpenses(ctx),
      customerService.list(ctx),
      employeeService.list(ctx),
      accountService.list(ctx),
    ]);
    setSummary(s);
    setCategories(cat);
    setDueChecks(checks);
    setCustomers(custs);
    setEmployees(emps);
    setAccounts(accts);
    setAccountBalances(await cariService.balances(ctx, 'account'));

    // Satın almalar hesabın carisinde Alacak — nakit değil, sadece "Son Kayıtlar"da görünür.
    const purchaseRows: Transaction[] = [];
    for (const a of accts) {
      const ledger = await cariService.ledger(ctx, { type: 'account', id: a.id });
      for (const m of ledger.entries) {
        if (m.type !== 'purchase') continue;
        purchaseRows.push({
          id: m.id,
          kind: 'purchase',
          amount_minor: m.amount_in_cari_minor,
          currency: ledger.currency,
          date: m.movement_date,
          note: null,
          payment_method: 'cash',
          related_customer_id: null,
          related_employee_id: null,
          related_account_id: a.id,
          cari_excluded: false,
          category: null,
        });
      }
    }
    const toTx = (kindLabel: 'revenue' | 'expense') => (e: RevenueEntry | ExpenseEntry): Transaction => ({
      id: e.id,
      kind: kindLabel,
      amount_minor: e.amount_minor,
      currency: e.currency,
      date: e.date,
      note: e.note,
      payment_method: e.payment_method,
      related_customer_id: e.related_customer_id,
      related_employee_id: e.related_employee_id,
      related_account_id: e.related_account_id,
      cari_excluded: e.cari_excluded === 1,
      category: e.category ?? null,
    });
    setTransactions([...revenues.map(toTx('revenue')), ...expenses.map(toTx('expense')), ...purchaseRows].sort((x, y) => y.date.localeCompare(x.date)));
  }, [ctx]);

  useReloadOnMount(reload);

  const partyLabelForTx = (t: Transaction): string | null => {
    if (t.related_customer_id) return `Müşteri · ${customerById.get(t.related_customer_id)?.name ?? '—'}`;
    if (t.related_employee_id) return `Çalışan · ${employeeById.get(t.related_employee_id)?.display_name ?? '—'}`;
    if (t.related_account_id) return `Hesap · ${accountById.get(t.related_account_id)?.name ?? '—'}`;
    if (t.cari_excluded) {
      const cat = t.kind === 'revenue' ? revenueCategoryLabel[t.category as keyof typeof revenueCategoryLabel] : undefined;
      return `Cari dışı${cat ? ` · ${cat}` : ''}`;
    }
    return null;
  };

  /** "Son Kayıtlar"daki bir gelir/gider kaydını siler — sipariş/satın alma
   * kaynaklı satırlar ('purchase', ya da sevkiyat/alım hareketleri) burada
   * silinmez, onlar kendi ekranlarından kaldırılır. */
  const voidTransaction = async (t: Transaction) => {
    setVoidBusy(true);
    setVoidError(null);
    try {
      if (t.kind === 'revenue') await financeService.voidRevenue(ctx, t.id);
      else await financeService.voidExpense(ctx, t.id);
      setConfirmVoid(null);
      await reload();
    } catch (e) {
      setVoidError(e instanceof Error ? e.message : String(e));
    } finally {
      setVoidBusy(false);
    }
  };

  return (
    <View style={styles.content}>
      <View style={styles.headerRow}>
        <Heading level={5}>Bu Ay</Heading>
        {canWrite && (
          <Pressable onPress={() => setShowForm((s) => !s)} style={styles.addBtn} hitSlop={8}>
            <Text style={styles.addGlyph}>{showForm ? '✕' : '+'}</Text>
          </Pressable>
        )}
      </View>

      {showForm && (
        <MoneyEntryForm
          ctx={ctx}
          onSaved={async () => {
            setShowForm(false);
            await reload();
          }}
        />
      )}

      {summary === null && <BodyText muted>Yükleniyor…</BodyText>}
      {summary?.length === 0 && <BodyText muted>Bu ay için kayıt yok.</BodyText>}
      {summary?.map((s) => (
        <View key={s.currency} style={styles.summaryRow}>
          <View>
            <Text style={styles.summaryLabel}>Gelir</Text>
            <Text style={styles.summaryValue}>{formatMoney(s.incomeMinor, s.currency)}</Text>
          </View>
          <View>
            <Text style={styles.summaryLabel}>Gider</Text>
            <Text style={styles.summaryValue}>{formatMoney(s.expenseMinor, s.currency)}</Text>
          </View>
          <View>
            <Text style={styles.summaryLabel}>Net</Text>
            <Text style={[styles.summaryValue, { color: color.accent }]}>{formatMoney(s.netMinor, s.currency)}</Text>
          </View>
        </View>
      ))}

      <CariReconcile ctx={ctx} onChanged={reload} />

      <CollapsibleSection title="Son Kayıtlar">
        {transactions.length === 0 && <BodyText muted>Henüz kayıt yok.</BodyText>}
        {!!voidError && <BodyText style={styles.error}>{voidError}</BodyText>}
        {transactions.map((t) => {
          const partyLabel = partyLabelForTx(t);
          const isPurchase = t.kind === 'purchase';
          const voidable = canVoid && !isPurchase;
          return (
            <View key={`${t.kind}-${t.id}`} style={styles.txRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.txMeta}>
                  {isPurchase
                    ? `Satın alma · ${new Date(t.date).toLocaleDateString('tr-TR')}`
                    : `${t.kind === 'revenue' ? 'Gelir' : 'Gider'} · ${paymentMethodLabel[t.payment_method]} · ${new Date(t.date).toLocaleDateString('tr-TR')}`}
                </Text>
                {!!partyLabel && <Text style={styles.txParty}>{partyLabel}</Text>}
                {!partyLabel && !isPurchase && <Text style={styles.txPending}>Cari atanmadı</Text>}
                {!!t.note && <Text style={styles.txNote}>{t.note}</Text>}
                {voidable && confirmVoid === `${t.kind}-${t.id}` && (
                  <View style={styles.voidConfirm}>
                    <Text style={styles.txNote}>Bu kayıt silinsin mi? Cari etkisi ters hareketle kapatılır.</Text>
                    <View style={styles.voidConfirmActions}>
                      <Pressable onPress={() => void voidTransaction(t)} disabled={voidBusy} hitSlop={6}>
                        <Text style={styles.voidConfirmYes}>{voidBusy ? '…' : 'Evet, sil'}</Text>
                      </Pressable>
                      <Pressable onPress={() => setConfirmVoid(null)} disabled={voidBusy} hitSlop={6}>
                        <Text style={styles.voidLink}>Vazgeç</Text>
                      </Pressable>
                    </View>
                  </View>
                )}
              </View>
              {isPurchase ? (
                // Nakit değil: hesabın carisinde Alacak (−) — "+/−" burada gelir/gider sanılmasın.
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.txValue}>{formatCari(-t.amount_minor, t.currency)}</Text>
                  <Text style={styles.txSide}>Alacak</Text>
                </View>
              ) : (
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[styles.txValue, t.kind === 'expense' && { color: color.accent }]}>
                    {t.kind === 'expense' ? '−' : '+'}
                    {formatMoney(t.amount_minor, t.currency)}
                  </Text>
                  {voidable && confirmVoid !== `${t.kind}-${t.id}` && (
                    <Text style={styles.voidLink} onPress={() => setConfirmVoid(`${t.kind}-${t.id}`)}>
                      Sil
                    </Text>
                  )}
                </View>
              )}
            </View>
          );
        })}
      </CollapsibleSection>

      {accounts.length > 0 && (
        <CollapsibleSection title="Hesaplar">
          {accounts.map((a) => {
            const b = accountBalances.get(a.id);
            const open = !!b && b.balanceMinor !== 0;
            return (
              <View key={a.id} style={styles.accountBlock}>
                <Text style={styles.catLabel}>{a.name}</Text>
                {!open && <Text style={styles.catValue}>{formatMoney(0, currency)}</Text>}
                {open && (
                  <View style={styles.accountRow}>
                    <Text style={styles.accountRowLabel}>{balanceLabel(b.balanceMinor)}</Text>
                    <Text style={[styles.catValue, weOwe(b.balanceMinor) && { color: color.accent }]}>{formatCari(b.balanceMinor, b.currency)}</Text>
                  </View>
                )}
              </View>
            );
          })}
        </CollapsibleSection>
      )}

      <CollapsibleSection title="Kategori Bazlı Gider">
        {categories?.length === 0 && <BodyText muted>Gider kaydı yok.</BodyText>}
        {categories?.map((c) => (
          <View key={`${c.currency}-${c.category}`} style={styles.catRow}>
            <Text style={styles.catLabel}>{expenseCategoryLabel[c.category as keyof typeof expenseCategoryLabel] ?? c.category}</Text>
            <Text style={styles.catValue}>{formatMoney(c.amountMinor, c.currency)}</Text>
          </View>
        ))}
      </CollapsibleSection>

      <CollapsibleSection title="Yaklaşan Vadeler">
        {dueChecks?.length === 0 && <BodyText muted>Vadesi yaklaşan çek yok.</BodyText>}
        {dueChecks?.map((c) => (
          <View key={c.id} style={styles.catRow}>
            <Text style={styles.catLabel}>{c.direction === 'received' ? 'Tahsil' : 'Ödeme'} · {new Date(c.due_date).toLocaleDateString('tr-TR')}</Text>
            <Text style={styles.catValue}>{formatMoney(c.amount_minor, c.currency)}</Text>
          </View>
        ))}
      </CollapsibleSection>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, gap: 4 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  addBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: color.text },
  addGlyph: { color: color.text, fontSize: 17, fontFamily: font.heading, lineHeight: 19 },

  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 8, marginBottom: 8 },
  summaryLabel: { fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', fontFamily: font.heading, color: color.dim },
  summaryValue: { fontSize: 20, fontFamily: font.heading, color: color.text, marginTop: 2 },

  txRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: color.divider },
  txMeta: { fontSize: 11.5, color: color.dimmer, fontFamily: font.mono },
  txParty: { fontSize: 12.5, color: color.text, fontWeight: '700', marginTop: 2 },
  txPending: { fontSize: 12, color: color.accentRamp[700], marginTop: 2 },
  txNote: { fontSize: 11.5, color: color.dim, marginTop: 1 },
  txSide: { fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: color.dimmer, marginTop: 1 },
  txValue: { fontSize: 13.5, fontFamily: font.mono, color: color.text, fontWeight: '700' },
  voidLink: { fontSize: 11, color: color.accentRamp[700], marginTop: 4, fontFamily: font.heading },
  voidConfirm: { gap: 6, marginTop: 6 },
  voidConfirmActions: { flexDirection: 'row', gap: 14 },
  voidConfirmYes: { fontSize: 11, color: color.accentRamp[700], fontFamily: font.heading },
  error: { color: color.accentRamp[700] },

  catRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: color.divider },
  catLabel: { fontSize: 13.5, color: color.text },
  catValue: { fontFamily: font.mono, fontSize: 13.5, color: color.text, fontWeight: '700' },
  accountBlock: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: color.divider, gap: 4 },
  accountRow: { flexDirection: 'row', justifyContent: 'space-between' },
  accountRowLabel: { fontSize: 12, color: color.dim },
});
