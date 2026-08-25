import { useRef } from 'react';
import { PanResponder, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomRail } from './components/BottomRail';
import { FooterCta } from './components/FooterCta';
import { Header } from './components/Header';
import { Toast } from './components/Toast';
import { AskClarifyScreen } from './screens/AskClarifyScreen';
import { CustomerScreen } from './screens/CustomerScreen';
import { ManualDraftScreen } from './screens/ManualDraftScreen';
import { MoneyScreen } from './screens/MoneyScreen';
import { OrderApprovalScreen } from './screens/OrderApprovalScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { StockScreen } from './screens/StockScreen';
import { TodayQueueScreen } from './screens/TodayQueueScreen';
import { WorkflowScreen } from './screens/WorkflowScreen';
import { ground } from './theme';
import { useQueueApp } from './useQueueApp';

const SWIPE_THRESHOLD = 55;

export function QueueApp() {
  const app = useQueueApp();
  const {
    header,
    goSettings,
    swipe,
    inRail,
    dots,
    swipeLabel,
    toast,
    primary,
    footNote,
    rail,
    screenFlags,
  } = app;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_evt, gesture) =>
        Math.abs(gesture.dx) > 20 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
      onPanResponderRelease: (_evt, gesture) => {
        if (Math.abs(gesture.dx) > SWIPE_THRESHOLD) swipe(gesture.dx < 0 ? 1 : -1);
      },
    }),
  ).current;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Header
        title={header.title}
        kicker={header.kicker}
        onSettings={goSettings}
        inRail={inRail}
        dots={dots}
        swipeLabel={swipeLabel}
      />

      <View style={styles.body} {...panResponder.panHandlers}>
        <ScrollView contentContainerStyle={styles.bodyContent}>
          {screenFlags.isQueue && <TodayQueueScreen data={app.queueScreen} />}
          {screenFlags.isApproval && <OrderApprovalScreen data={app.approvalScreen} />}
          {screenFlags.isFlow && <WorkflowScreen data={app.workflowScreen} />}
          {screenFlags.isStock && <StockScreen data={app.stockScreen} />}
          {screenFlags.isMoney && <MoneyScreen data={app.moneyScreen} />}
          {screenFlags.isCustomer && <CustomerScreen data={app.customerScreen} />}
          {screenFlags.isSettings && <SettingsScreen data={app.settingsScreen} />}
          {screenFlags.isAsk && <AskClarifyScreen data={app.askScreen} />}
          {screenFlags.isDraft && <ManualDraftScreen data={app.draftScreen} />}
        </ScrollView>
      </View>

      <Toast message={toast} />

      {primary && <FooterCta note={footNote ?? ''} label={primary.label} onPress={primary.act} />}

      <BottomRail items={rail} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: ground },
  body: { flex: 1, borderTopWidth: 2, borderTopColor: '#f3f2f2' },
  bodyContent: { flexGrow: 1 },
});
