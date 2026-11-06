import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BodyText, Button, color, Divider, Field, Heading, Input, space } from '@/design-system';
import { useSession, type JoinResult } from '@/services/SessionProvider';

const JOIN_MESSAGES: Record<Exclude<JoinResult, 'joined'>, string> = {
  nothing: 'Bu hesap için kayıtlı bir işletme ya da bekleyen davet bulunamadı — aşağıdan yeni bir işletme oluşturabilirsiniz.',
  needs_verification:
    'Bu e-postaya bir işletme daveti var. Katılmak için önce e-posta adresini doğrula (gelen kutuna bir bağlantı gönderdik), sonra tekrar dene.',
  no_backup: 'İşletmeye erişimin var ama henüz bir bulut yedeği yok. Yöneticinden Ayarlar → "Şimdi yedekle" yapmasını iste, sonra tekrar dene.',
  not_in_backup: 'Son yedekte senin personel kaydın yok. Yöneticinden yeni bir yedek almasını iste, sonra tekrar dene.',
};

/** First-run onboarding (CLAUDE.md §3): reached only when status is
 * 'needs_business' — a signed-in Firebase user with no linked Employee row
 * yet. Creates the Business plus this user as its first `owner` Employee
 * (§5.2: a business always has at least one active owner; this is how it
 * gets its first one). */
export default function CreateBusinessScreen() {
  const { createBusiness, joinExistingBusiness, resendVerificationEmail, error, signOut } = useSession();
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('TRY');
  const [submitting, setSubmitting] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinResult, setJoinResult] = useState<JoinResult | null>(null);
  const [resent, setResent] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      await createBusiness({ name: name.trim(), base_currency: currency.trim().toUpperCase() });
    } catch {
      // error is already surfaced via useSession().error
    } finally {
      setSubmitting(false);
    }
  };

  // Reinstall / new-device / invited-employee case (CLAUDE.md §3: "yedekten
  // geri yükle birinci sınıf bir özellik olmalı"). On 'joined' the session
  // flips to 'ready' and AuthGate navigates away.
  const attemptJoin = async () => {
    setJoining(true);
    setResent(false);
    try {
      setJoinResult(await joinExistingBusiness());
    } catch {
      // error is already surfaced via useSession().error
      setJoinResult(null);
    } finally {
      setJoining(false);
    }
  };

  const resend = async () => {
    try {
      await resendVerificationEmail();
      setResent(true);
    } catch {
      setResent(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Heading level={2}>İşletmenizi kurun</Heading>
          <BodyText muted style={styles.subtitle}>
            Bu hesapla ilk kez giriş yapıyorsunuz — bir işletme oluşturun. Siz bu işletmenin ilk sahibi (owner) olarak eklenirsiniz.
          </BodyText>

          <Divider />

          <Heading level={5}>Yeni cihaz ya da davet mi?</Heading>
          <BodyText muted style={styles.subtitle}>
            Bu hesabın başka bir cihazda kurulmuş bir işletmesi varsa ya da bir işletmeye davet edildiyseniz, yeni bir işletme oluşturmak yerine yedekten katılabilirsiniz.
          </BodyText>
          <Button
            label={joining ? 'Kontrol ediliyor…' : joinResult && joinResult !== 'nothing' ? 'Tekrar dene' : 'Yedekten geri yükle / davete katıl'}
            variant="secondary"
            disabled={joining}
            onPress={() => void attemptJoin()}
          />
          {joinResult && joinResult !== 'joined' && !error && (
            <BodyText muted style={styles.subtitle}>
              {JOIN_MESSAGES[joinResult]}
            </BodyText>
          )}
          {joinResult === 'needs_verification' && (
            <Button
              label={resent ? 'Doğrulama e-postası gönderildi' : 'Doğrulama e-postasını yeniden gönder'}
              variant="ghost"
              disabled={resent}
              onPress={() => void resend()}
            />
          )}

          <Divider />

          <View style={styles.fields}>
            <Field label="İşletme adı">
              <Input value={name} onChangeText={setName} placeholder="Örn. Sanchez Textiles" />
            </Field>
            <Field label="Para birimi (ISO 4217)">
              <Input
                value={currency}
                onChangeText={setCurrency}
                autoCapitalize="characters"
                maxLength={3}
                placeholder="TRY"
              />
            </Field>
          </View>

          {!!error && <BodyText style={styles.error}>{error}</BodyText>}

          <Button
            label={submitting ? '…' : 'İşletmeyi oluştur'}
            variant="primary"
            block
            disabled={submitting || !name.trim() || currency.trim().length !== 3}
            onPress={submit}
          />
          <Button label="Çıkış yap" variant="ghost" onPress={() => void signOut()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  flex: { flex: 1 },
  content: { padding: space[4], gap: space[3] },
  subtitle: { marginTop: -space[2] },
  fields: { gap: space[3] },
  error: { color: color.accentRamp[700] },
});
