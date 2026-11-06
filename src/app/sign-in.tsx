import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BodyText, Button, color, Divider, Field, Heading, Input, space } from '@/design-system';
import { useSession } from '@/services/SessionProvider';

/** Sign-in / sign-up (CLAUDE.md §3, §7.1: "email + (opsiyonel) telefon").
 * On successful sign-up, SessionProvider's status flips to
 * 'needs_business' and the root layout's AuthGate redirects to
 * /create-business on its own — this screen doesn't navigate itself. */
export default function SignInScreen() {
  const { signIn, signUp, error } = useSession();
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      if (mode === 'sign-in') {
        await signIn(email.trim(), password);
      } else {
        await signUp(email.trim(), password);
      }
    } catch {
      // error is already surfaced via useSession().error
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Heading level={2}>Kuyruk Öncelikli ERP</Heading>
          <BodyText muted style={styles.subtitle}>
            {mode === 'sign-in' ? 'Hesabınıza giriş yapın.' : 'Yeni bir hesap oluşturun.'}
          </BodyText>

          <Divider />

          <View style={styles.fields}>
            <Field label="E-posta">
              <Input
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                placeholder="you@business.com"
              />
            </Field>
            <Field label="Şifre">
              <Input
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
                placeholder="••••••••"
              />
            </Field>
          </View>

          {!!error && <BodyText style={styles.error}>{error}</BodyText>}

          <Button
            label={submitting ? '…' : mode === 'sign-in' ? 'Giriş yap' : 'Hesap oluştur'}
            variant="primary"
            block
            disabled={submitting || !email.trim() || !password}
            onPress={submit}
          />
          <Button
            label={mode === 'sign-in' ? 'Hesabın yok mu? Kayıt ol' : 'Zaten hesabın var mı? Giriş yap'}
            variant="ghost"
            onPress={() => setMode((m) => (m === 'sign-in' ? 'sign-up' : 'sign-in'))}
          />
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
