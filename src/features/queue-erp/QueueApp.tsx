import { useMemo } from 'react';
import { KeyboardAvoidingView, PanResponder, Platform, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardScrollProvider, useKeyboardScroll } from '@/components/keyboard-scroll';
import { BottomRail, color, FooterCta, QueueHeader, space, Toast } from '@/design-system';
import type { ActorContext } from '@/services';
import { CustomerScreen } from './screens/CustomerScreen';
import { ManualDraftScreen } from './screens/ManualDraftScreen';
import { MoneyScreen } from './screens/MoneyScreen';
import { OrderApprovalScreen } from './screens/OrderApprovalScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { StockScreen } from './screens/StockScreen';
import { TodayQueueScreen } from './screens/TodayQueueScreen';
import { WorkflowScreen } from './screens/WorkflowScreen';
import { useQueueApp } from './useQueueApp';

const SWIPE_THRESHOLD = 55;

/** The authenticated app's home — the queue-erp-styled shell, now wired to
 * real repository/service data throughout (see useQueueApp.ts and each
 * screen file for what changed vs. the original mockup). Mounted directly
 * as `src/app/index.tsx`'s content once the session is `ready`. */
export function QueueApp({ ctx }: { ctx: ActorContext }) {
  const app = useQueueApp(ctx.employee.role);
  const { header, goSettings, swipe, inRail, dots, swipeLabel, toast, rail, screen, flash, go, approvalOrderId, openApproval, editOrderId, openEditor } = app;

  // Klavye açılınca odaktaki alanı (ör. sipariş matrisindeki hücre) klavyenin
  // üstüne kaydırır ve içeriğe klavye kadar alt boşluk ekler — bkz.
  // components/keyboard-scroll.tsx. KeyboardAvoidingView Android'de kullanılmaz
  // (manifest'in adjustResize'ı ile çift sayılır).
  const { scrollRef, onScroll, keyboardHeight, scroller } = useKeyboardScroll();

  // useMemo, not the more common useRef(...).current — PanResponder.create()
  // doesn't need ref identity, just stable memoization, and useMemo avoids
  // reading a ref during render (the React Compiler's `react-hooks/refs`
  // lint flags that even though useRef(...).current is otherwise the
  // textbook RN PanResponder idiom).
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Ray dışı ekranlarda (ör. sipariş matrisi) yatay kaydırmayı çalma: hücre
        // şeridi/matris kendi yatay ScrollView'ında kayar.
        onMoveShouldSetPanResponderCapture: (_evt, gesture) => inRail && Math.abs(gesture.dx) > 20 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
        onPanResponderRelease: (_evt, gesture) => {
          if (Math.abs(gesture.dx) > SWIPE_THRESHOLD) swipe(gesture.dx < 0 ? 1 : -1);
        },
      }),
    [swipe, inRail],
  );

  const footNote: string | undefined = {
    1: 'Kartlardan birine dokunun veya kaydırarak diğer ekranlara geçin.',
    3: 'Bir siparişi ilerletmek için aşama içinden dokunun.',
    4: 'Düşük stok kalemleri kırmızı ile işaretlenir.',
    9: 'Müşteri seçin, ürüne dokunup matrise adetleri yazın, kaydedin.',
  }[screen];

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <QueueHeader title={header.title} kicker={header.kicker} onSettings={goSettings} inRail={inRail} dots={dots} swipeLabel={swipeLabel} />

      <KeyboardAvoidingView style={styles.body} behavior={Platform.OS === 'ios' ? 'padding' : undefined} {...panResponder.panHandlers}>
        <ScrollView
          ref={scrollRef}
          onScroll={onScroll}
          scrollEventThrottle={32}
          contentContainerStyle={[styles.bodyContent, keyboardHeight > 0 && { paddingBottom: space[8] + keyboardHeight }]}
          keyboardShouldPersistTaps="handled">
          <KeyboardScrollProvider scroller={scroller}>
          {screen === 1 && <TodayQueueScreen ctx={ctx} openApproval={openApproval} goTo={go} />}
          {screen === 2 && approvalOrderId && (
            <OrderApprovalScreen ctx={ctx} orderId={approvalOrderId} flash={flash} onDone={() => go(1)} onEdit={() => openEditor(approvalOrderId)} />
          )}
          {screen === 3 && <WorkflowScreen ctx={ctx} goTo={go} onEditOrder={openEditor} />}
          {screen === 4 && <StockScreen ctx={ctx} />}
          {screen === 5 && <MoneyScreen ctx={ctx} />}
          {screen === 6 && <CustomerScreen ctx={ctx} />}
          {screen === 7 && <SettingsScreen ctx={ctx} />}
          {screen === 9 && <ManualDraftScreen key={editOrderId ?? 'new'} ctx={ctx} flash={flash} onDone={() => go(3)} orderId={editOrderId} />}
          </KeyboardScrollProvider>
        </ScrollView>
      </KeyboardAvoidingView>

      <Toast message={toast} />

      {screen === 3 && <FooterCta note={footNote ?? ''} label="Sipariş ekle" onPress={() => go(9)} />}

      <BottomRail items={rail} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  body: { flex: 1, borderTopWidth: 2, borderTopColor: color.text },
  bodyContent: { flexGrow: 1 },
});
