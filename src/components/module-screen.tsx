import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BodyText, color, Heading, space } from '@/design-system';

/** Shared shell for every admin module screen reached by pushing off the
 * queue shell's Ayarlar hub (CLAUDE.md §9 step 5 modules) — these live at
 * the app root (sibling to sign-in/create-business/index), so they get a
 * plain back button rather than being part of any tab/rail chrome.
 *
 * Keyboard handling, so a field deep in a long form (e.g. products.tsx's
 * per-product variant form) is never left stuck behind the keyboard with no
 * way to reach it:
 * - **iOS**: `KeyboardAvoidingView behavior="padding"` — the standard fix.
 * - **Android**: `KeyboardAvoidingView` is deliberately NOT used — the
 *   native manifest already sets `windowSoftInputMode="adjustResize"`,
 *   which resizes the window itself; stacking a `KeyboardAvoidingView` on
 *   top double-counts the keyboard height and shrinks the scrollable area
 *   more than necessary (confirmed on-device: even after adding it, fields
 *   near the bottom of a form — e.g. the "Renk" field below Beden — stayed
 *   unreachable no matter how far you scrolled). Instead, a
 *   `Keyboard.addListener('keyboardDidShow', ...)` tracks the live keyboard
 *   height and adds it as extra `paddingBottom` on the ScrollView content —
 *   this guarantees there's always enough scroll room to bring the very
 *   last field fully above the keyboard, on top of whatever adjustResize
 *   already reclaimed. */
export function ModuleScreen({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const show = Keyboard.addListener('keyboardDidShow', (e) => setKeyboardHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <BodyText style={styles.backLabel}>‹ Geri</BodyText>
        </Pressable>
        <Heading level={3}>{title}</Heading>
        {!!subtitle && (
          <BodyText muted style={styles.subtitle}>
            {subtitle}
          </BodyText>
        )}
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          contentContainerStyle={[styles.content, keyboardHeight > 0 && { paddingBottom: space[8] + keyboardHeight }]}
          keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  flex: { flex: 1 },
  header: {
    paddingHorizontal: space[4],
    paddingTop: space[2],
    paddingBottom: space[3],
    borderBottomWidth: 2,
    borderBottomColor: color.divider,
    gap: space[1],
  },
  back: { alignSelf: 'flex-start', paddingVertical: space[1] },
  backLabel: { color: color.accent },
  subtitle: { marginTop: 2 },
  content: { padding: space[4], gap: space[4], paddingBottom: space[8] },
});
