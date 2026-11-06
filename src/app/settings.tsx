import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BodyText, Button, Divider, Field, Heading, Input, space, Tag } from '@/design-system';
import { ModuleScreen } from '@/components/module-screen';
import { hasPermission, settingsService, useActorContext, useSession } from '@/services';

/** Uygulama Ayarları — app-wide preferences, distinct from the Ayarlar hub's
 * (SettingsScreen.tsx) admin-module links (Personel/Ürünler/...). Dil and
 * Tema Tonu are deliberately inert placeholders here, not missing features:
 * a real language switch needs the "çeviri katmanı" CLAUDE.md §2/§10
 * explicitly defers to Faz 2 (this app is Turkish-only end to end today, so
 * there's nothing to switch TO yet), and the dark theme tone is coming back
 * later (progress.md: the queue-erp shell was ported from a fixed-dark
 * palette to the current light one — this is where its return gets wired in
 * once built) — not now. Para Birimi is real: `settingsService.updateBusiness`
 * already persists `base_currency`, this is just its first UI. */
export default function AppSettingsScreen() {
  const ctx = useActorContext();
  const { business, refreshBusiness } = useSession();
  const [currency, setCurrency] = useState(business?.base_currency ?? 'TRY');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ctx) return null;
  const canManage = hasPermission(ctx.employee.role, 'settings', 'update');

  const saveCurrency = async () => {
    const code = currency.trim().toUpperCase();
    if (code.length !== 3) return;
    setBusy(true);
    setError(null);
    try {
      await settingsService.updateBusiness(ctx, { base_currency: code });
      await refreshBusiness();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModuleScreen title="Ayarlar" subtitle="Dil, para birimi, üyelik ve tema tercihleri">
      <View style={styles.section}>
        <Heading level={5}>Dil</Heading>
        <View style={styles.langRow}>
          <Tag label="Türkçe" variant="accent" />
        </View>
        <BodyText muted>Şu an yalnızca Türkçe destekleniyor — diğer diller ileride eklenecek.</BodyText>
      </View>

      <Divider />

      <View style={styles.section}>
        <Heading level={5}>Para Birimi</Heading>
        {canManage ? (
          <>
            <Field label="Para birimi (ISO 4217)">
              <Input value={currency} onChangeText={setCurrency} autoCapitalize="characters" maxLength={3} placeholder="TRY" />
            </Field>
            {!!error && <BodyText style={styles.error}>{error}</BodyText>}
            <Button
              label={busy ? '…' : 'Kaydet'}
              variant="primary"
              disabled={busy || currency.trim().length !== 3}
              onPress={() => void saveCurrency()}
            />
          </>
        ) : (
          <BodyText muted>Para birimi yalnızca sahip/yönetici tarafından değiştirilebilir. Mevcut: {business?.base_currency}</BodyText>
        )}
      </View>

      <Divider />

      <View style={styles.section}>
        <Heading level={5}>Üyelik</Heading>
        <BodyText muted>
          {business?.created_at ? `Hesap açılış tarihi: ${new Date(business.created_at).toLocaleDateString('tr-TR')}` : '—'}
        </BodyText>
        <View style={styles.langRow}>
          {/* Gerçek bir faturalandırma/plan sistemi yok — şu an herkes Free.
           * `Business.plan_tier` (solo/team) altyapısal bir ayrım, bu
           * ücretlendirme etiketiyle karışmasın diye ayrı tutuldu. */}
          <Tag label="Free" variant="outline" />
        </View>
      </View>

      <Divider />

      <View style={styles.section}>
        <Heading level={5}>Tema Tonu</Heading>
        {/* Kasıtlı olarak işlevsiz — orijinal koyu tema ileride buraya
         * eklenecek (bkz. dosya başındaki not). Şimdilik sadece yer tutucu. */}
        <Button label="Koyu tema (yakında)" variant="secondary" disabled onPress={() => {}} />
      </View>
    </ModuleScreen>
  );
}

const styles = StyleSheet.create({
  section: { gap: space[2] },
  langRow: { flexDirection: 'row', gap: space[2] },
  error: { color: '#ae1800' },
});
