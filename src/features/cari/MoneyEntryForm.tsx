import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { BodyText, Button, color, DatePicker, Field, font, Input, SegmentedControl } from '@/design-system';
import { parseDecimal, parseMinorAmount } from '@/lib/quantity';
import { expenseCategoryLabel, paymentMethodLabel, revenueCategoryLabel } from '@/lib/roleLabels';
import type { Account, Customer, Employee, ExpenseCategory, PaymentMethod, RevenueCategory } from '@/models';
import { accountService, customerService, employeeService, financeService, type ActorContext } from '@/services';
import { useReloadOnMount } from '@/hooks/use-reload';

type EntryKind = 'revenue' | 'expense';
type PartyKind = 'customer' | 'account' | 'employee' | 'excluded';

const EXPENSE_CATEGORIES: ExpenseCategory[] = ['raw_material', 'rent', 'labor', 'shipping', 'other'];
const REVENUE_CATEGORIES: RevenueCategory[] = ['interest', 'scrap_sale', 'rent_income', 'other'];
const METHODS: PaymentMethod[] = ['cash', 'credit_card', 'check', 'deposit'];
const EXTRA_CURRENCIES = ['USD', 'TRY', 'EUR'];

export interface FixedContact {
  type: 'customer' | 'account';
  id: string;
  name: string;
  /** Carinin ana para birimi. */
  currency: string;
}

/** Para giriş/çıkış formu — Para ekranı, müşteri ekranı, hesap ekranı ve
 * sipariş "Tahsilat ekle" AYNI formu ve AYNI servis çağrısını kullanır
 * (FinanceService.createRevenue/createExpense → kasa + cari hareketi tek
 * işlemde). Nereden açıldığı yalnızca neyin önceden seçili geldiğini belirler:
 *   • `fixedContact` verilirse "Kimden/Kime" alanı gizlenir (cari önceden seçili),
 *   • `fixedKind` verilirse Gelir/Gider seçimi gizlenir,
 *   • `orderId` sadece referanstır (kayıt `source: 'order'` olur) — bakiyeye etkisi yok.
 * Serbest kullanımda (Para ekranı) "Kimden?/Kime?" ZORUNLU ve varsayılanı yok:
 * bir cari ya da bilinçli "Cari dışı" seçilmeden kaydedilemez. */
export function MoneyEntryForm({
  ctx,
  fixedContact,
  fixedKind,
  orderId,
  onSaved,
}: {
  ctx: ActorContext;
  fixedContact?: FixedContact;
  fixedKind?: EntryKind;
  orderId?: string | null;
  onSaved: () => void | Promise<void>;
}) {
  const baseCurrency = ctx.business.base_currency;
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  const [kind, setKind] = useState<EntryKind>(fixedKind ?? 'revenue');
  const [partyKind, setPartyKind] = useState<PartyKind | null>(null);
  const [partyId, setPartyId] = useState<string | null>(null);
  const [partyQuery, setPartyQuery] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<string | null>(null);
  const [rate, setRate] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [dueDate, setDueDate] = useState(new Date());
  const [expenseCategory, setExpenseCategory] = useState<ExpenseCategory>('raw_material');
  const [revenueCategory, setRevenueCategory] = useState<RevenueCategory | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (fixedContact) return;
    const [c, a, e] = await Promise.all([customerService.list(ctx), accountService.list(ctx), employeeService.list(ctx).catch(() => [] as Employee[])]);
    setCustomers(c);
    setAccounts(a);
    setEmployees(e);
  }, [ctx, fixedContact]);
  useReloadOnMount(reload);

  const effectiveKind = fixedKind ?? kind;
  const selectedCustomer = partyKind === 'customer' ? customers.find((c) => c.id === partyId) : undefined;
  const selectedAccount = partyKind === 'account' ? accounts.find((a) => a.id === partyId) : undefined;
  const selectedEmployee = partyKind === 'employee' ? employees.find((e) => e.id === partyId) : undefined;

  // Carinin ana para birimi (kur sorusu buna göre).
  const contactCurrency: string | null = fixedContact
    ? fixedContact.currency
    : selectedCustomer
      ? (selectedCustomer.currency ?? baseCurrency)
      : selectedAccount
        ? (selectedAccount.currency ?? baseCurrency)
        : null;
  const hasContact = !!fixedContact || !!selectedCustomer || !!selectedAccount;
  const activeCurrency = currency ?? contactCurrency ?? baseCurrency;
  const needsRate = hasContact && !!contactCurrency && activeCurrency !== contactCurrency;
  const currencyOptions = [...new Set([contactCurrency ?? baseCurrency, ...EXTRA_CURRENCIES])];

  const excluded = partyKind === 'excluded';
  const partyChosen = !!fixedContact || excluded || (!!partyKind && !!partyId);

  const q = partyQuery.toLocaleLowerCase('tr');
  const filteredCustomers = customers.filter((c) => !q || c.name.toLocaleLowerCase('tr').includes(q));
  const filteredAccounts = accounts.filter((a) => !q || a.name.toLocaleLowerCase('tr').includes(q));

  const submit = async () => {
    const amount_minor = parseMinorAmount(amount);
    if (amount_minor <= 0) {
      setError('Geçerli bir tutar girin.');
      return;
    }
    if (!partyChosen) {
      setError(effectiveKind === 'revenue' ? 'Kimden? — bir cari seçin ya da "Cari dışı" işaretleyin.' : 'Kime? — bir cari seçin ya da "Cari dışı" işaretleyin.');
      return;
    }
    if (excluded && effectiveKind === 'revenue' && !revenueCategory) {
      setError('Cari dışı gelir için kategori seçin.');
      return;
    }
    const exchange_rate = needsRate ? parseDecimal(rate) : null;
    if (needsRate && !(exchange_rate && exchange_rate > 0)) {
      setError(`Kur girin: 1 ${activeCurrency} = ? ${contactCurrency}`);
      return;
    }
    setBusy(true);
    setError(null);
    const date = new Date().toISOString();
    const check = method === 'check' ? { direction: effectiveKind === 'expense' ? ('issued' as const) : ('received' as const), due_date: dueDate.toISOString() } : undefined;
    const party = fixedContact
      ? fixedContact.type === 'customer'
        ? { related_customer_id: fixedContact.id }
        : { related_account_id: fixedContact.id }
      : {
          related_customer_id: partyKind === 'customer' ? partyId : null,
          related_account_id: partyKind === 'account' ? partyId : null,
          related_employee_id: partyKind === 'employee' ? partyId : null,
          cari_excluded: excluded,
        };
    try {
      if (effectiveKind === 'expense') {
        await financeService.createExpense(ctx, {
          category: expenseCategory,
          amount_minor,
          currency: activeCurrency,
          date,
          note: note.trim() || null,
          payment_method: method,
          check,
          exchange_rate,
          related_order_id: orderId ?? null,
          ...party,
        });
      } else {
        await financeService.createRevenue(ctx, {
          source: orderId ? 'order' : 'manual',
          amount_minor,
          currency: activeCurrency,
          date,
          note: note.trim() || null,
          payment_method: method,
          check,
          exchange_rate,
          related_order_id: orderId ?? null,
          category: excluded ? revenueCategory : null,
          ...party,
        });
      }
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const createAndPick = async (type: 'customer' | 'account') => {
    const name = partyQuery.trim();
    if (!name) return;
    if (type === 'customer') {
      const c = await customerService.create(ctx, { name });
      setCustomers((prev) => [...prev, c]);
      setPartyId(c.id);
    } else {
      const a = await accountService.create(ctx, { name });
      setAccounts((prev) => [...prev, a]);
      setPartyId(a.id);
    }
    setPartyQuery('');
  };

  const pickerLabel = selectedCustomer?.name ?? selectedAccount?.name ?? selectedEmployee?.display_name ?? null;

  return (
    <View style={styles.form}>
      {!fixedKind && (
        <SegmentedControl
          options={[
            { label: 'Gelir', value: 'revenue' },
            { label: 'Gider', value: 'expense' },
          ]}
          value={kind}
          onChange={(v) => setKind(v as EntryKind)}
        />
      )}

      {fixedContact ? (
        <View style={styles.fixedParty}>
          <Text style={styles.fixedPartyLabel}>{effectiveKind === 'revenue' ? 'Kimden' : 'Kime'}</Text>
          <Text style={styles.fixedPartyName}>{fixedContact.name}</Text>
        </View>
      ) : (
        <View style={styles.block}>
          <Text style={styles.blockLabel}>{effectiveKind === 'revenue' ? 'Kimden?' : 'Kime?'} (zorunlu)</Text>
          <View style={styles.chips}>
            {(
              [
                ['customer', 'Müşteri'],
                ['account', 'Hesap'],
                ['employee', 'Çalışan'],
                ['excluded', 'Cari dışı'],
              ] as [PartyKind, string][]
            ).map(([value, label]) => (
              <Pressable
                key={value}
                onPress={() => {
                  setPartyKind(value);
                  setPartyId(null);
                  setPartyQuery('');
                  setCurrency(null);
                }}
                style={[styles.chip, partyKind === value && styles.chipOn]}>
                <Text style={[styles.chipText, partyKind === value && styles.chipTextOn]}>{label}</Text>
              </Pressable>
            ))}
          </View>

          {!!pickerLabel && (
            <Pressable onPress={() => setPartyId(null)} style={styles.selectedParty}>
              <Text style={styles.selectedPartyText}>{pickerLabel}</Text>
              <Text style={styles.selectedPartyChange}>Değiştir</Text>
            </Pressable>
          )}

          {(partyKind === 'customer' || partyKind === 'account') && !partyId && (
            <View style={styles.pickerPanel}>
              <TextInput
                value={partyQuery}
                onChangeText={setPartyQuery}
                placeholder={partyKind === 'customer' ? 'Müşteri ara veya yeni ekle' : 'Hesap ara veya yeni ekle (tedarikçi/fasoncu)'}
                placeholderTextColor={color.textMuted}
                style={styles.pickerInput}
              />
              {(partyKind === 'customer' ? filteredCustomers : filteredAccounts).map((row) => (
                <Pressable key={row.id} onPress={() => setPartyId(row.id)} style={styles.pickerRow}>
                  <Text style={styles.pickerRowText}>{row.name}</Text>
                </Pressable>
              ))}
              {!!partyQuery.trim() && (
                <Pressable onPress={() => void createAndPick(partyKind)} style={styles.pickerRow}>
                  <Text style={[styles.pickerRowText, { color: color.accent }]}>
                    + &quot;{partyQuery.trim()}&quot; olarak yeni {partyKind === 'customer' ? 'müşteri' : 'hesap'} ekle
                  </Text>
                </Pressable>
              )}
            </View>
          )}

          {partyKind === 'employee' && !partyId && (
            <View style={styles.pickerPanel}>
              {employees.map((e) => (
                <Pressable key={e.id} onPress={() => setPartyId(e.id)} style={styles.pickerRow}>
                  <Text style={styles.pickerRowText}>{e.display_name}</Text>
                </Pressable>
              ))}
              {employees.length === 0 && <BodyText muted style={{ padding: 10 }}>Henüz çalışan yok.</BodyText>}
            </View>
          )}

          {excluded && effectiveKind === 'revenue' && (
            <View style={styles.block}>
              <Text style={styles.blockLabel}>Gelir kategorisi (zorunlu)</Text>
              <View style={styles.chips}>
                {REVENUE_CATEGORIES.map((c) => (
                  <Pressable key={c} onPress={() => setRevenueCategory(c)} style={[styles.chip, revenueCategory === c && styles.chipOn]}>
                    <Text style={[styles.chipText, revenueCategory === c && styles.chipTextOn]}>{revenueCategoryLabel[c]}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
        </View>
      )}

      <Field label="Tutar">
        <Input value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" />
      </Field>

      {hasContact && (
        <View style={styles.block}>
          <Text style={styles.blockLabel}>Para birimi</Text>
          <View style={styles.chips}>
            {currencyOptions.map((c) => (
              <Pressable key={c} onPress={() => setCurrency(c)} style={[styles.chip, activeCurrency === c && styles.chipOn]}>
                <Text style={[styles.chipText, activeCurrency === c && styles.chipTextOn]}>{c}</Text>
              </Pressable>
            ))}
          </View>
          {needsRate && (
            <Field label={`Kur: 1 ${activeCurrency} = ? ${contactCurrency}`}>
              <Input value={rate} onChangeText={setRate} keyboardType="decimal-pad" placeholder="0.00" />
            </Field>
          )}
        </View>
      )}

      {effectiveKind === 'expense' && (
        <View style={styles.block}>
          <Text style={styles.blockLabel}>Kategori</Text>
          <View style={styles.chips}>
            {EXPENSE_CATEGORIES.map((c) => (
              <Pressable key={c} onPress={() => setExpenseCategory(c)} style={[styles.chip, expenseCategory === c && styles.chipOn]}>
                <Text style={[styles.chipText, expenseCategory === c && styles.chipTextOn]}>{expenseCategoryLabel[c]}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      <SegmentedControl options={METHODS.map((m) => ({ label: paymentMethodLabel[m], value: m }))} value={method} onChange={(v) => setMethod(v as PaymentMethod)} />
      {method === 'check' && (
        <Field label="Vade tarihi">
          <DatePicker value={dueDate} onChange={setDueDate} />
        </Field>
      )}

      <Field label="Not (opsiyonel)">
        <Input value={note} onChangeText={setNote} placeholder="" />
      </Field>
      {!!error && <BodyText style={styles.error}>{error}</BodyText>}
      <Button label={busy ? '…' : effectiveKind === 'revenue' ? 'Tahsilatı kaydet' : 'Ödemeyi kaydet'} variant="primary" disabled={busy || !amount} onPress={() => void submit()} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 10, marginTop: 10, marginBottom: 16, padding: 14, borderWidth: 1, borderColor: color.divider },
  error: { color: color.accentRamp[700] },
  block: { gap: 6 },
  blockLabel: { fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: color.dim, fontFamily: font.heading },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, height: 36, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: color.text },
  chipOn: { backgroundColor: color.text },
  chipText: { fontSize: 13, color: color.text },
  chipTextOn: { color: color.bg, fontFamily: font.heading },

  fixedParty: { padding: 10, borderWidth: 1, borderColor: color.divider },
  fixedPartyLabel: { fontSize: 10.5, letterSpacing: 0.5, textTransform: 'uppercase', color: color.dim, fontFamily: font.heading },
  fixedPartyName: { fontSize: 15, fontFamily: font.heading, color: color.text, marginTop: 2 },

  selectedParty: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 10, borderWidth: 1, borderColor: color.divider },
  selectedPartyText: { fontSize: 13, fontWeight: '700', color: color.text },
  selectedPartyChange: { fontSize: 11, color: color.accent, fontFamily: font.heading },
  pickerPanel: { borderWidth: 1, borderColor: color.divider },
  pickerInput: { fontFamily: font.body, fontSize: 13.5, color: color.text, paddingVertical: 10, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: color.divider },
  pickerRow: { paddingVertical: 10, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: color.divider },
  pickerRowText: { fontSize: 13, color: color.text },
});
