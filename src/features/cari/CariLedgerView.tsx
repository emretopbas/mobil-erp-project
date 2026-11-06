import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BodyText, Button, color, Field, font, Input } from '@/design-system';
import {
  alreadyVoidedMovementIds,
  balanceLabel,
  cariMovementTypeLabel,
  cariSideLabel,
  directionToSide,
  formatCari,
  returnBalanceNotice,
  signedMovement,
  weOwe,
} from '@/lib/cari';
import { formatMoney } from '@/lib/money';
import { parseMinorAmount } from '@/lib/quantity';
import type { CariMovement } from '@/models';
import { cariService, financeService, hasPermission, type ActorContext, type CariContact, type CariLedger } from '@/services';
import { useReloadOnMount } from '@/hooks/use-reload';
import { MoneyEntryForm } from './MoneyEntryForm';

type Panel = 'money' | 'return' | 'close' | null;

/** Bir carinin (müşteri ya da hesap) tek defterden bakiyesi + hareket listesi +
 * işlem düğmeleri. Müşteri ve Hesaplar ekranları AYNI bileşeni kullanır: hangi
 * ekrandan girilirse girilsin aynı kayıt, aynı sonuç. Bakiye yalnızca
 * `cari_movement`'tan gelir (CariService.ledger). Açıklama cümlesi yok — bakiye
 * borçluysak kırmızı, aksi halde siyah. */
export function CariLedgerView({
  ctx,
  contact,
  name,
  onChanged,
  reloadKey,
}: {
  ctx: ActorContext;
  contact: CariContact;
  name: string;
  /** Bakiye değiştiğinde üst ekran kendi listelerini tazelesin. */
  onChanged?: () => void;
  /** Dışarıdan tetiklenen yenileme (ör. sipariş satırından tahsilat girildi). */
  reloadKey?: number;
}) {
  const [ledger, setLedger] = useState<CariLedger | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [confirmVoidId, setConfirmVoidId] = useState<string | null>(null);
  const [voidBusy, setVoidBusy] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  // `contact` her render'da yeni nesne olabilir: bağımlılık olarak yalnızca
  // (tip, id) ilkelleri kullanılır, yoksa her render yeniden yüklerdi.
  const contactType = contact.type;
  const contactId = contact.id;
  const load = useCallback(async () => {
    void reloadKey;
    setLedger(await cariService.ledger(ctx, { type: contactType, id: contactId }));
  }, [ctx, contactType, contactId, reloadKey]);
  useReloadOnMount(load);

  const isCustomer = contact.type === 'customer';
  const canMoney = hasPermission(ctx.employee.role, 'finance', 'create');
  const canReturn = hasPermission(ctx.employee.role, 'cari', 'create');
  const canClose = hasPermission(ctx.employee.role, 'cariClose', 'update');
  // Girilen ödemeleri/tahsilatları silme — yalnızca owner/manager (`finance`
  // kaynağı zaten başka hiçbir role erişim vermiyor, bkz. rbac/permissions.ts).
  const canVoidPayment = hasPermission(ctx.employee.role, 'finance', 'delete');

  const afterChange = async () => {
    setPanel(null);
    await load();
    onChanged?.();
  };

  const toggle = (p: Panel) => setPanel((cur) => (cur === p ? null : p));

  /** Kasa/cari defterinden gelmiş bir tahsilat/ödeme hareketi (`source_type
   * 'cash_entry'`) — `type` 'collection' ise gelir kaydı, 'payment' ise gider
   * kaydı (`CariService.postCashEntry`'nin ürettiği tek tip). Siler (soft-delete
   * + ters cari hareket); sipariş/satın alma kaynaklı sevkiyat/alım hareketleri
   * burada DEĞİL, kendi ekranlarından (Siparişler/Satın Almalar) silinir. */
  const voidMovement = async (m: CariMovement) => {
    if (!m.source_id) return;
    setVoidBusy(true);
    setVoidError(null);
    try {
      if (m.type === 'collection') await financeService.voidRevenue(ctx, m.source_id);
      else await financeService.voidExpense(ctx, m.source_id);
      setConfirmVoidId(null);
      await afterChange();
    } catch (e) {
      setVoidError(e instanceof Error ? e.message : String(e));
    } finally {
      setVoidBusy(false);
    }
  };

  if (!ledger) return <BodyText muted style={styles.pad}>Yükleniyor…</BodyText>;
  const { balanceMinor, currency } = ledger;
  // Defter asla düzenlenmez: silinen bir tahsilat/ödemenin orijinal hareketi
  // listede kalır (üstüne 'reversal' eklenir). Bu satırların "Sil"i artık
  // göstermemesi gerekir — göstermeye devam edersek ikinci tıklama
  // `voidRevenue/voidExpense`'te "Kayıt bulunamadı" ile patlar (kayıt zaten
  // soft-delete edilmiş olur).
  const voidedIds = alreadyVoidedMovementIds(ledger.entries);

  return (
    <View>
      <View style={styles.balanceBlock}>
        <Text style={styles.statLabel}>
          Bakiye ({currency}) · {balanceLabel(balanceMinor)}
        </Text>
        <Text style={[styles.balanceValue, weOwe(balanceMinor) && styles.owed]}>{formatCari(balanceMinor, currency)}</Text>
      </View>

      <View style={styles.actions}>
        {canMoney && <Button label={isCustomer ? '+ Tahsilat' : '+ Ödeme'} variant={panel === 'money' ? 'secondary' : 'primary'} onPress={() => toggle('money')} />}
        {canReturn && <Button label="+ İade" variant="secondary" onPress={() => toggle('return')} />}
        {canClose && balanceMinor !== 0 && <Button label="Bakiye kapat" variant="secondary" onPress={() => toggle('close')} />}
      </View>

      {panel === 'money' && (
        <MoneyEntryForm
          ctx={ctx}
          fixedContact={{ ...contact, name, currency }}
          fixedKind={isCustomer ? 'revenue' : 'expense'}
          onSaved={afterChange}
        />
      )}
      {panel === 'return' && <ReturnForm ctx={ctx} contact={contact} name={name} balanceMinor={balanceMinor} currency={currency} onDone={afterChange} />}
      {panel === 'close' && <CloseBalanceForm ctx={ctx} contact={contact} balanceMinor={balanceMinor} currency={currency} onDone={afterChange} />}

      <Text style={styles.sectionLabel}>Kayıtlar</Text>
      {ledger.entries.length === 0 && <BodyText muted style={styles.pad}>Henüz cari hareket yok.</BodyText>}
      {!!voidError && <BodyText style={styles.error}>{voidError}</BodyText>}
      {ledger.entries.map((m) => {
        const signed = signedMovement(m);
        const foreign = m.currency !== currency;
        const voided = voidedIds.has(m.id);
        const voidable = canVoidPayment && !voided && m.source_type === 'cash_entry' && (m.type === 'collection' || m.type === 'payment');
        return (
          <View key={m.id} style={[styles.row, voided && styles.rowVoided]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>
                {cariMovementTypeLabel[m.type]} · {new Date(m.movement_date).toLocaleDateString('tr-TR')}
              </Text>
              {foreign && (
                <Text style={styles.rowNote}>
                  {formatMoney(m.amount_minor, m.currency)} × {m.exchange_rate}
                </Text>
              )}
              {!!m.reason && <Text style={styles.rowNote}>{m.reason}</Text>}
              {voided && <Text style={styles.voidedTag}>Silindi — ters hareketle kapatıldı</Text>}
              {voidable && confirmVoidId === m.id && (
                <View style={styles.voidConfirm}>
                  <Text style={styles.rowNote}>Bu kayıt silinsin mi? Cari etkisi ters hareketle kapatılır.</Text>
                  <View style={styles.voidConfirmActions}>
                    <Button label={voidBusy ? '…' : 'Evet, sil'} variant="primary" disabled={voidBusy} onPress={() => void voidMovement(m)} />
                    <Button label="Vazgeç" variant="ghost" disabled={voidBusy} onPress={() => setConfirmVoidId(null)} />
                  </View>
                </View>
              )}
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[styles.rowValue, m.side === 'credit' && !isCustomer && styles.owed]}>{formatCari(signed, currency)}</Text>
              <Text style={styles.rowSide}>{cariSideLabel[directionToSide(m.side)]}</Text>
              {voidable && confirmVoidId !== m.id && (
                <Text style={styles.voidLink} onPress={() => setConfirmVoidId(m.id)}>
                  Sil
                </Text>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function ReturnForm({
  ctx,
  contact,
  name,
  balanceMinor,
  currency,
  onDone,
}: {
  ctx: ActorContext;
  contact: CariContact;
  name: string;
  balanceMinor: number;
  currency: string;
  onDone: () => void | Promise<void>;
}) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isCustomer = contact.type === 'customer';
  const minor = parseMinorAmount(amount);
  const notice = isCustomer ? returnBalanceNotice(balanceMinor, minor) : null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await cariService.recordReturn(ctx, { contact, amount_minor: minor, note: note.trim() || null });
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.form}>
      <Text style={styles.formTitle}>{isCustomer ? 'Müşteri iadesi' : 'Tedarikçiye iade'} · {name}</Text>
      <Field label="İade tutarı">
        <Input value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" />
      </Field>
      {!!notice && (
        <BodyText muted>
          Bu müşterinin {formatMoney(balanceMinor, currency)} açık bakiyesi var. Bu iadenin {formatMoney(notice.closesMinor, currency)}&apos;si bakiyeyi kapatacak
          {notice.refundMinor > 0 ? `; müşteriye ${formatMoney(notice.refundMinor, currency)} iade edilecek` : ''}.
        </BodyText>
      )}
      <Field label="Not (opsiyonel)">
        <Input value={note} onChangeText={setNote} />
      </Field>
      {!!error && <BodyText style={styles.error}>{error}</BodyText>}
      <Button label={busy ? '…' : 'İadeyi kaydet'} variant="primary" disabled={busy || minor <= 0} onPress={() => void submit()} />
    </View>
  );
}

function CloseBalanceForm({
  ctx,
  contact,
  balanceMinor,
  currency,
  onDone,
}: {
  ctx: ActorContext;
  contact: CariContact;
  balanceMinor: number;
  currency: string;
  onDone: () => void | Promise<void>;
}) {
  const max = Math.abs(balanceMinor);
  const [amount, setAmount] = useState(String(max / 100));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await cariService.closeBalance(ctx, contact, { amount_minor: parseMinorAmount(amount), reason });
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.form}>
      <Text style={styles.formTitle}>Bakiye kapat · en çok {formatMoney(max, currency)}</Text>
      <Field label="Kapatılacak tutar">
        <Input value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      </Field>
      <Field label="Gerekçe (zorunlu)">
        <Input value={reason} onChangeText={setReason} placeholder="örn. küsurat" />
      </Field>
      {!!error && <BodyText style={styles.error}>{error}</BodyText>}
      <Button label={busy ? '…' : 'Bakiyeyi kapat'} variant="primary" disabled={busy || !reason.trim()} onPress={() => void submit()} />
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: 18 },
  balanceBlock: { paddingHorizontal: 18, paddingVertical: 14 },
  statLabel: { fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', fontFamily: font.heading, color: color.dim },
  balanceValue: { fontSize: 24, fontFamily: font.heading, color: color.text, marginTop: 2 },
  owed: { color: color.accent },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 18 },
  form: { gap: 10, marginHorizontal: 18, marginTop: 10, padding: 14, borderWidth: 1, borderColor: color.divider },
  formTitle: { fontSize: 14, fontFamily: font.heading, color: color.text },
  error: { color: color.accentRamp[700] },
  sectionLabel: { fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', fontFamily: font.heading, color: color.dim, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 4 },
  row: { flexDirection: 'row', gap: 10, paddingVertical: 10, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: color.divider },
  rowVoided: { opacity: 0.5 },
  rowTitle: { fontSize: 13.5, color: color.text, fontWeight: '700' },
  rowNote: { fontSize: 11.5, color: color.dim, marginTop: 2 },
  voidedTag: { fontSize: 11, color: color.dim, marginTop: 2, fontStyle: 'italic' },
  rowValue: { fontSize: 14, fontFamily: font.mono, color: color.text, fontWeight: '700' },
  rowSide: { fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: color.dimmer, marginTop: 1 },
  voidLink: { fontSize: 11, color: color.accentRamp[700], marginTop: 4, fontFamily: font.heading },
  voidConfirm: { gap: 6, marginTop: 6 },
  voidConfirmActions: { flexDirection: 'row', gap: 8 },
});
