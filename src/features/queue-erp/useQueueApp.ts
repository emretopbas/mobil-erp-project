// Navigation/shell state for the queue-erp-styled app shell — deliberately
// small. The original mockup version of this hook owned ALL data for every
// screen centrally (mock arrays, always loaded). That doesn't fit once the
// data is real: each screen below loads its own slice via useActorContext()
// + useReloadOnMount(), the same pattern every other screen in this app
// already uses (stock.tsx, tasks.tsx, orders.tsx, reports.tsx) — this hook
// only owns what's genuinely shell-level: which screen is showing, the
// swipe/rail navigation order, the toast, and the one piece of cross-screen
// navigation state (which order Approval is reviewing).
//
// Screen numbers keep the original mockup's numbering for continuity;
// screen 8 (AskClarifyScreen, Faz-2 NLP) is deliberately not reachable from
// here — dropped per this session's plan, not stubbed.

import { useCallback, useMemo, useRef, useState } from 'react';

import { color } from '@/design-system';
import type { EmployeeRole } from '@/models';
import { hasPermission } from '@/services';

export type StockFilter = 'Tümü' | 'Düşük stok';

const RAIL_ORDER = [1, 3, 4, 5, 6] as const;
type RailScreen = (typeof RAIL_ORDER)[number];

const RAIL_DEFS: { label: string; glyph: string; n: RailScreen }[] = [
  { label: 'Bugün', glyph: '●', n: 1 },
  { label: 'Akış', glyph: '→', n: 3 },
  { label: 'Stok', glyph: '▤', n: 4 },
  { label: 'Para', glyph: '€', n: 5 },
  { label: 'Müşteri', glyph: '◒', n: 6 },
];

const SCREEN_NAMES: Record<number, string> = {
  1: 'Bugün',
  2: 'Sipariş Onayı',
  3: 'İş Akışı',
  4: 'Stok',
  5: 'Para',
  6: 'Müşteri',
  7: 'Ayarlar',
  9: 'Manuel Sipariş',
};
const SCREEN_KICKERS: Record<number, string> = {
  1: 'Kuyruk',
  2: 'Onay bekliyor',
  3: 'Sipariş akışı',
  4: 'Stok & üretim',
  5: 'Finans',
  6: 'Müşteri',
  7: 'İşletme',
  9: 'Yeni sipariş',
};

export function useQueueApp(role: EmployeeRole) {
  const [screen, setScreen] = useState(1);
  const [toast, setToast] = useState('');
  const [approvalOrderId, setApprovalOrderId] = useState<string | null>(null);
  // Manuel sipariş ekranı (9) mevcut bir siparişi düzenlemek için açıldıysa onun id'si.
  const [editOrderId, setEditOrderId] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2400);
  }, []);

  const go = useCallback((n: number) => {
    setScreen(n);
    setToast('');
    if (n !== 9) setEditOrderId(null);
  }, []);

  const openEditor = useCallback((orderId: string) => {
    setEditOrderId(orderId);
    setScreen(9);
    setToast('');
  }, []);

  const openApproval = useCallback(
    (orderId: string) => {
      setApprovalOrderId(orderId);
      go(2);
    },
    [go],
  );

  // §5.4: `finance` is `none` for production/sales/viewer — Money is
  // dropped from navigation entirely for those roles, not just hidden.
  const canSeeMoney = hasPermission(role, 'finance', 'read');

  const visibleRailOrder = useMemo(
    () => RAIL_ORDER.filter((n) => (n === 5 ? canSeeMoney : true)),
    [canSeeMoney],
  );

  const swipe = useCallback(
    (dir: 1 | -1) => {
      setScreen((cur) => {
        const i = visibleRailOrder.indexOf(cur as RailScreen);
        if (i === -1) return cur;
        const next = visibleRailOrder[i + dir];
        return next ?? cur;
      });
    },
    [visibleRailOrder],
  );

  const goSettings = useCallback(() => go(7), [go]);

  const rail = useMemo(
    () =>
      RAIL_DEFS.filter((r) => visibleRailOrder.includes(r.n)).map((r) => ({
        ...r,
        count: null as number | null,
        bg: screen === r.n ? color.text : 'transparent',
        fg: screen === r.n ? color.bg : color.dimmer,
        go: () => go(r.n),
      })),
    [screen, go, visibleRailOrder],
  );

  const railIndex = visibleRailOrder.indexOf(screen as RailScreen);
  const dots = useMemo(
    () =>
      visibleRailOrder.map((_n, i) => ({
        bg: i === railIndex ? color.text : color.divider,
        w: i === railIndex ? 22 : 10,
      })),
    [railIndex, visibleRailOrder],
  );

  return {
    screen,
    go,
    swipe,
    goSettings,
    flash,
    toast,
    approvalOrderId,
    openApproval,
    editOrderId,
    openEditor,
    header:
      screen === 9 && editOrderId
        ? { title: 'Siparişi Düzenle', kicker: 'Sipariş kalemleri' }
        : { title: SCREEN_NAMES[screen] ?? '', kicker: SCREEN_KICKERS[screen] ?? '' },
    rail,
    dots,
    inRail: railIndex !== -1,
    swipeLabel: railIndex === -1 ? '' : `Kaydırarak geç · ${railIndex + 1}/${visibleRailOrder.length}`,
  };
}

export type QueueShell = ReturnType<typeof useQueueApp>;
