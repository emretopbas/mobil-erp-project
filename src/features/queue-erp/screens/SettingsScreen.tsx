import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BodyText, Button, color, font, Tag } from '@/design-system';
import { roleLabel } from '@/lib/roleLabels';
import { backupService, hasPermission, useSession, type ActorContext } from '@/services';

/** Screen 7 — the real admin hub. Replaces both the mockup's Settings
 * screen (which was channel-connection/translation-toggle Faz-2 content,
 * dropped per this session's plan, not stubbed) and the old `(app)/explore`
 * Profil tab (business info + Backup button — merged in here, that route no
 * longer exists). Also the entry point to the admin screens the queue shell
 * has no room for on its 5-slot rail: Personel, Görevler, Ürünler,
 * Raporlar — each already RBAC-gated end to end by its own screen/service,
 * so this only needs to hide the *row*, not re-implement any gating. */
export function SettingsScreen({ ctx }: { ctx: ActorContext }) {
  const router = useRouter();
  const { user, business, refreshBusiness, signOut } = useSession();
  const [backingUp, setBackingUp] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);

  const { employee } = ctx;
  const canManageBackup = hasPermission(employee.role, 'settings', 'update');

  const links: { label: string; visible: boolean; go: () => void }[] = [
    { label: 'Personel', visible: hasPermission(employee.role, 'employee', 'read'), go: () => router.push('/employees') },
    { label: 'Görevler & Mesai', visible: true, go: () => router.push('/tasks') },
    { label: 'Ürünler', visible: hasPermission(employee.role, 'product', 'read'), go: () => router.push('/products') },
    { label: 'Siparişler & Müşteriler', visible: hasPermission(employee.role, 'order', 'read'), go: () => router.push('/orders') },
    { label: 'Raporlar', visible: hasPermission(employee.role, 'report', 'read'), go: () => router.push('/reports') },
    // Dil/para birimi/üyelik/tema — RBAC'a bağlı bir modül değil, herkes
    // görebilir (para birimi değiştirme kendi ekranında ayrıca kapılı).
    { label: 'Ayarlar', visible: true, go: () => router.push('/settings') },
  ];

  const runBackup = async () => {
    setBackingUp(true);
    setBackupError(null);
    try {
      await backupService.backupNow(ctx);
      await refreshBusiness();
    } catch (e) {
      setBackupError(e instanceof Error ? e.message : String(e));
    } finally {
      setBackingUp(false);
    }
  };

  return (
    <View style={styles.content}>
      <View style={styles.profileCard}>
        <Tag label={roleLabel[employee.role]} variant="accent" />
        <Text style={styles.name}>{employee.display_name}</Text>
        {!!user?.email && <Text style={styles.meta}>{user.email}</Text>}
      </View>

      <View style={styles.businessCard}>
        <Text style={styles.sectionLabel}>İşletme</Text>
        <Text style={styles.businessName}>{business?.name}</Text>
        <Text style={styles.meta}>
          {business?.base_currency} · {business?.plan_tier === 'solo' ? 'Solo' : 'Takım'}
        </Text>
      </View>

      <Text style={styles.sectionLabel}>Yönetim</Text>
      <View style={styles.linkList}>
        {links
          .filter((l) => l.visible)
          .map((l) => (
            <Pressable key={l.label} onPress={l.go} style={styles.linkRow}>
              <Text style={styles.linkLabel}>{l.label}</Text>
              <Text style={styles.linkCaret}>›</Text>
            </Pressable>
          ))}
      </View>

      <Text style={styles.sectionLabel}>Yedekleme</Text>
      <View style={styles.backupCard}>
        <Text style={styles.meta}>
          {business?.last_backup_at ? `Son yedek: ${new Date(business.last_backup_at).toLocaleString('tr-TR')}` : 'Henüz yedek alınmadı.'}
        </Text>
        {canManageBackup ? (
          <>
            <Button label={backingUp ? 'Yedekleniyor…' : 'Şimdi yedekle'} variant="secondary" disabled={backingUp} onPress={() => void runBackup()} />
            {!!backupError && <BodyText style={styles.error}>{backupError}</BodyText>}
          </>
        ) : (
          <BodyText muted>Yedekleme yalnızca sahip/yönetici tarafından başlatılabilir.</BodyText>
        )}
      </View>

      <Button label="Çıkış yap" variant="secondary" onPress={() => void signOut()} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, gap: 18 },
  profileCard: { gap: 6 },
  name: { fontSize: 20, fontFamily: font.heading, color: color.text },
  meta: { fontSize: 12.5, color: color.dimmer },
  businessCard: { gap: 4, borderTopWidth: 2, borderTopColor: color.text, paddingTop: 14 },
  businessName: { fontSize: 17, fontFamily: font.heading, color: color.text },
  sectionLabel: { fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', fontFamily: font.heading, color: color.dim },
  linkList: { borderTopWidth: 1, borderTopColor: color.divider },
  linkRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: color.divider },
  linkLabel: { fontSize: 15, fontWeight: '700', color: color.text },
  linkCaret: { fontSize: 18, color: color.dimmer },
  backupCard: { gap: 10 },
  error: { color: color.accentRamp[700] },
});
