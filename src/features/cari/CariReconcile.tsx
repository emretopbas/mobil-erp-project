import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BodyText, Button, CollapsibleSection, color, Field, font, Input } from '@/design-system';
import { formatCari } from '@/lib/cari';
import { formatMoney } from '@/lib/money';
import { parseDecimal } from '@/lib/quantity';
import { paymentMethodLabel, revenueCategoryLabel } from '@/lib/roleLabels';
import type { Account, Customer, RevenueCategory } from '@/models';
import {
  accountService,
  cariService,
  customerService,
  hasPermission,
  type ActorContext,
  type CariContact,
  type MigrationReportRow,
  type PendingEntry,
} from '@/services';
import { useReloadOnMount } from '@/hooks/use-reload';

type Target = 'customer' | 'account' | 'excluded';
const REVENUE_CATEGORIES: RevenueCategory[] = ['interest', 'scrap_sale', 'rent_income', 'other'];

/** Göç sonrası "eşleştirme": carisi olmayan, "Cari dışı" onaylanmamış eski
 * gelir/giderleri listeler — kullanıcı her birine bir cari atar (cari hareketi
 * oluşur) ya da bilinçli "Cari dışı" onaylar. Ayrıca eski bakiye mantığı ile yeni
 * defteri karşılaştıran doğrulama raporunu gösterir. Bekleyen kayıt yoksa
 * yalnızca rapor bölümü kalır. */
export function CariReconcile({ ctx, onChanged }: { ctx: ActorContext; onChanged: () => void | Promise<void> }) {
  const [pending, setPending] = useState<PendingEntry[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [report, setReport] = useState<MigrationReportRow[] | null>(null);
  const [showReport, setShowReport] = useState(false);

  const canWrite = hasPermission(ctx.employee.role, 'finance', 'update');

  const load = useCallback(async () => {
    const [p, c, a] = await Promise.all([cariService.pendingEntries(ctx), customerService.list(ctx), accountService.list(ctx)]);
    setPending(p);
    setCustomers(c);
    setAccounts(a);
    setReport(await cariService.migrationReport(ctx));
  }, [ctx]);
  useReloadOnMount(load);

  const changed = async () => {
    await load();
    await onChanged();
  };

  const differing = (report ?? []).filter((r) => r.diffMinor !== 0);

  return (
    <CollapsibleSection title={`Cari eşleştirme${pending.length > 0 ? ` (${pending.length})` : ''}`} defaultOpen={pending.length > 0}>
      {pending.length === 0 && <BodyText muted>Carisi atanmamış kayıt yok.</BodyText>}
      {pending.length > 0 && (
        <BodyText muted>Bu kayıtların carisi belirlenmemiş. Bir cari atayın (bakiyeye işlenir) ya da &quot;Cari dışı&quot; olarak onaylayın.</BodyText>
      )}
      {pending.map((p) => (
        <PendingRow key={`${p.kind}-${p.entry.id}`} ctx={ctx} item={p} customers={customers} accounts={accounts} canWrite={canWrite} onChanged={changed} />
      ))}

      <Pressable onPress={() => setShowReport((s) => !s)} style={styles.reportToggle} hitSlop={6}>
        <Text style={styles.reportToggleText}>{showReport ? 'Doğrulama raporunu gizle' : `Doğrulama raporu${differing.length ? ` (${differing.length} fark)` : ''}`}</Text>
      </Pressable>
      {showReport && (
        <View style={styles.report}>
          <BodyText muted>Eski bakiye mantığı (siparişler − siparişe bağlı tahsilatlar) ile yeni defter karşılaştırması. Fark: taslak siparişler artık sayılmıyor, Para ekranından bağlanan tahsilatlar artık bakiyede.</BodyText>
          {(report ?? []).map((r) => (
            <View key={`${r.contact.type}-${r.contact.id}`} style={styles.reportRow}>
              <Text style={styles.reportName}>{r.name}</Text>
              <Text style={styles.reportCell}>eski {formatCari(r.legacyMinor, r.currency)}</Text>
              <Text style={styles.reportCell}>yeni {formatCari(r.ledgerMinor, r.currency)}</Text>
              <Text style={[styles.reportCell, r.diffMinor !== 0 && styles.reportDiff]}>fark {formatCari(r.diffMinor, r.currency)}</Text>
            </View>
          ))}
          {(report ?? []).length === 0 && <BodyText muted>Cari yok.</BodyText>}
        </View>
      )}
    </CollapsibleSection>
  );
}

function PendingRow({
  ctx,
  item,
  customers,
  accounts,
  canWrite,
  onChanged,
}: {
  ctx: ActorContext;
  item: PendingEntry;
  customers: Customer[];
  accounts: Account[];
  canWrite: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [target, setTarget] = useState<Target | null>(null);
  const [rate, setRate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { entry, kind } = item;

  const assign = async (payload: Parameters<typeof cariService.assignEntry>[1]['target']) => {
    setBusy(true);
    setError(null);
    try {
      await cariService.assignEntry(ctx, { kind, entryId: entry.id, target: payload });
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const pickContact = (contact: CariContact, contactCurrency: string) => {
    const needsRate = entry.currency !== contactCurrency;
    void assign({ contact, exchange_rate: needsRate ? parseDecimal(rate) : null });
  };

  const rows = target === 'customer' ? customers : target === 'account' ? accounts : [];
  const foreignHint = (currency: string | null) => (currency && currency !== entry.currency ? currency : null);

  return (
    <View style={styles.pendingRow}>
      <View style={styles.pendingHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.pendingMeta}>
            {kind === 'revenue' ? 'Gelir' : 'Gider'} · {paymentMethodLabel[entry.payment_method]} · {new Date(entry.date).toLocaleDateString('tr-TR')}
          </Text>
          {!!entry.note && <Text style={styles.pendingNote}>{entry.note}</Text>}
        </View>
        <Text style={[styles.pendingAmount, kind === 'expense' && { color: color.accent }]}>
          {kind === 'expense' ? '−' : '+'}
          {formatMoney(entry.amount_minor, entry.currency)}
        </Text>
      </View>

      {canWrite && (
        <View style={styles.chips}>
          {(
            [
              ['customer', 'Müşteri'],
              ['account', 'Hesap'],
              ['excluded', 'Cari dışı'],
            ] as [Target, string][]
          ).map(([value, label]) => (
            <Pressable key={value} onPress={() => setTarget(target === value ? null : value)} style={[styles.chip, target === value && styles.chipOn]} disabled={busy}>
              <Text style={[styles.chipText, target === value && styles.chipTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {(target === 'customer' || target === 'account') && (
        <View style={styles.picker}>
          {rows.some((r) => foreignHint(r.currency ?? ctx.business.base_currency)) && (
            <Field label="Kur (cari para birimi farklıysa)">
              <Input value={rate} onChangeText={setRate} keyboardType="decimal-pad" placeholder="0.00" />
            </Field>
          )}
          {rows.map((r) => {
            const rowCurrency = r.currency ?? ctx.business.base_currency;
            return (
              <Pressable key={r.id} onPress={() => pickContact({ type: target as 'customer' | 'account', id: r.id }, rowCurrency)} style={styles.pickerRow} disabled={busy}>
                <Text style={styles.pickerText}>
                  {r.name}
                  {foreignHint(rowCurrency) ? ` · ${rowCurrency}` : ''}
                </Text>
              </Pressable>
            );
          })}
          {rows.length === 0 && <BodyText muted style={{ padding: 10 }}>Kayıtlı {target === 'customer' ? 'müşteri' : 'hesap'} yok.</BodyText>}
        </View>
      )}

      {target === 'excluded' && (
        <View style={styles.picker}>
          {kind === 'revenue' ? (
            <View style={styles.chips}>
              {REVENUE_CATEGORIES.map((c) => (
                <Pressable key={c} onPress={() => void assign({ excluded: true, category: c })} style={styles.chip} disabled={busy}>
                  <Text style={styles.chipText}>{revenueCategoryLabel[c]}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <Button label={busy ? '…' : 'Cari dışı olarak onayla'} variant="secondary" disabled={busy} onPress={() => void assign({ excluded: true })} />
          )}
        </View>
      )}
      {!!error && <BodyText style={styles.error}>{error}</BodyText>}
    </View>
  );
}

const styles = StyleSheet.create({
  pendingRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: color.divider, gap: 8 },
  pendingHead: { flexDirection: 'row', gap: 10 },
  pendingMeta: { fontSize: 11.5, color: color.dimmer, fontFamily: font.mono },
  pendingNote: { fontSize: 12, color: color.dim, marginTop: 2 },
  pendingAmount: { fontSize: 13.5, fontFamily: font.mono, fontWeight: '700', color: color.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, height: 34, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: color.text },
  chipOn: { backgroundColor: color.text },
  chipText: { fontSize: 12.5, color: color.text },
  chipTextOn: { color: color.bg, fontFamily: font.heading },
  picker: { borderWidth: 1, borderColor: color.divider, padding: 6, gap: 6 },
  pickerRow: { paddingVertical: 10, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: color.divider },
  pickerText: { fontSize: 13, color: color.text },
  error: { color: color.accentRamp[700] },

  reportToggle: { paddingVertical: 12 },
  reportToggleText: { fontFamily: font.heading, fontSize: 12.5, color: color.accent },
  report: { gap: 6 },
  reportRow: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: color.divider },
  reportName: { fontSize: 13.5, color: color.text, fontWeight: '700' },
  reportCell: { fontSize: 12, color: color.dim, fontFamily: font.mono },
  reportDiff: { color: color.accent },
});
