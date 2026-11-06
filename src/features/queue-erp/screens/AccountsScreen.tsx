import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BodyText, Button, color, Field, font, Input, space } from '@/design-system';
import { CariLedgerView } from '@/features/cari/CariLedgerView';
import { formatCari, weOwe } from '@/lib/cari';
import type { Account } from '@/models';
import { accountService, cariService, hasPermission, type ActorContext } from '@/services';
import { useReloadOnMount } from '@/hooks/use-reload';

/** Hesaplar — list→detail for `Account` (a supplier/subcontractor/other
 * third party), same shape as CustomerScreen. Detay, müşteri ekranıyla AYNI
 * bileşendir (`CariLedgerView`): tek **Bakiye** (Borç `+`, Alacak `−`, borçluysak
 * kırmızı) ve altında `cari_movement` defterinden bütün **Kayıtlar** — satın
 * almalar (tedarikçiden alım = Alacak), ödemeler (Borç), iadeler, bakiye
 * kapatmalar. Liste her hesabın bakiyesini de gösterir. */
export function AccountsScreen({ ctx }: { ctx: ActorContext }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [balances, setBalances] = useState<Map<string, { balanceMinor: number; currency: string }>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const canWrite = hasPermission(ctx.employee.role, 'finance', 'create');

  const reload = useCallback(async () => {
    setAccounts(await accountService.list(ctx));
    setBalances(await cariService.balances(ctx, 'account'));
  }, [ctx]);

  useReloadOnMount(reload);

  const selected = accounts?.find((a) => a.id === selectedId) ?? null;

  const createAccount = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const a = await accountService.create(ctx, { name });
      setNewName('');
      setShowCreate(false);
      await reload();
      setSelectedId(a.id);
    } finally {
      setBusy(false);
    }
  };

  if (selected) {
    return <AccountDetail ctx={ctx} account={selected} onBack={() => { setSelectedId(null); void reload(); }} />;
  }

  return (
    <View>
      {canWrite && (
        <>
          <Pressable onPress={() => setShowCreate((s) => !s)} style={styles.createToggle}>
            <Text style={styles.createToggleText}>{showCreate ? '✕ Vazgeç' : '+ Yeni hesap'}</Text>
          </Pressable>
          {showCreate && (
            <View style={styles.createForm}>
              <Field label="Hesap adı (örn. bir tedarikçi/taşeron)">
                <Input value={newName} onChangeText={setNewName} placeholder="Ahmet Usta" />
              </Field>
              <Button label={busy ? '…' : 'Ekle'} variant="primary" disabled={busy || !newName.trim()} onPress={() => void createAccount()} />
            </View>
          )}
        </>
      )}
      {accounts === null && (
        <View style={styles.empty}>
          <BodyText muted>Yükleniyor…</BodyText>
        </View>
      )}
      {accounts?.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Hesap{'\n'}yok.</Text>
          <BodyText muted>Bir tedarikçi/taşeron eklemek için yukarıdan &quot;+ Yeni hesap&quot;ı kullanın.</BodyText>
        </View>
      )}
      {accounts?.map((a) => (
        <Pressable key={a.id} onPress={() => setSelectedId(a.id)} style={styles.listRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.listName}>{a.name}</Text>
            {!!a.note && <Text style={styles.listMeta}>{a.note}</Text>}
          </View>
          {(balances.get(a.id)?.balanceMinor ?? 0) !== 0 && (
            <Text style={[styles.listBalance, weOwe(balances.get(a.id)!.balanceMinor) && styles.balanceOwed]}>
              {formatCari(balances.get(a.id)!.balanceMinor, balances.get(a.id)!.currency)}
            </Text>
          )}
        </Pressable>
      ))}
    </View>
  );
}

function AccountDetail({ ctx, account, onBack }: { ctx: ActorContext; account: Account; onBack: () => void }) {
  return (
    <View>
      <Pressable onPress={onBack} style={styles.backRow} hitSlop={8}>
        <Text style={styles.backText}>‹ Hesaplar</Text>
      </Pressable>
      <View style={styles.detailHeader}>
        <Text style={styles.detailName}>{account.name}</Text>
        {!!account.note && <Text style={styles.detailMeta}>{account.note}</Text>}
      </View>
      <CariLedgerView ctx={ctx} contact={{ type: 'account', id: account.id }} name={account.name} />
    </View>
  );
}

const styles = StyleSheet.create({
  createToggle: { paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 2, borderBottomColor: color.text },
  createToggleText: { fontFamily: font.heading, fontSize: 13.5, color: color.accent },
  createForm: { padding: 18, gap: space[3], borderBottomWidth: 1, borderBottomColor: color.divider },

  empty: { padding: 22, paddingVertical: 46, gap: 10 },
  emptyTitle: { fontSize: 34, lineHeight: 36, fontFamily: font.heading, color: color.text },

  listRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: color.divider },
  listName: { fontSize: 16, fontWeight: '700', color: color.text },
  listMeta: { fontSize: 12, color: color.dimmer, marginTop: 2 },

  backRow: { padding: 18, paddingBottom: 6 },
  backText: { fontFamily: font.heading, fontSize: 13, color: color.accent },
  detailHeader: { paddingHorizontal: 18, paddingBottom: 12, borderBottomWidth: 2, borderBottomColor: color.text },
  detailName: { fontSize: 24, fontFamily: font.heading, color: color.text },
  detailMeta: { fontSize: 12.5, color: color.dimmer, marginTop: 3 },
  listBalance: { fontSize: 14, fontFamily: font.mono, fontWeight: '700', color: color.text },
  balanceOwed: { color: color.accent },
});
