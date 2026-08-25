import { useCallback, useMemo, useRef, useState } from 'react';

import {
  askClarifyContext,
  askLangOptions,
  askTemplateDefs,
  catalog,
  channelDefs,
  custStats,
  expenses,
  footNotes,
  identities,
  lineDefs,
  monthData,
  orderDefs,
  queueDefs,
  railDefs,
  railOrder,
  screenKickers,
  screenNames,
  stageNames,
  stockDefs,
  teamDefs,
  timeline,
  toggleDefs,
  customerBook,
} from './mock/mockContent';
import { formatEUR, groupThousands } from './format';
import { accent, ground, ink } from './theme';
import type { AskLang, ChannelKey, QueueAppState, StockFilter, TranslateKey } from './types';

const initialState: QueueAppState = {
  screen: 1,
  done: {},
  stage: 'Üretimde',
  stockFilter: 'Tümü',
  connected: { wa: true, tg: false, em: false, sms: false },
  qty: [35, 30, 12],
  tr: { inMsg: true, outMsg: true, voice: false },
  toast: '',
  waError: true,
  askTpl: 0,
  askLang: 'ES',
  draft: { customer: '', lines: {} },
  custOpen: false,
  custQuery: '',
};

export function useQueueApp() {
  const [s, setS] = useState<QueueAppState>(initialState);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((message: string) => {
    setS((st) => ({ ...st, toast: message }));
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setS((st) => ({ ...st, toast: '' })), 2400);
  }, []);

  const go = useCallback((n: number) => {
    setS((st) => ({ ...st, screen: n, toast: '' }));
  }, []);

  const swipe = useCallback((dir: 1 | -1) => {
    setS((st) => {
      const i = railOrder.indexOf(st.screen as (typeof railOrder)[number]);
      if (i === -1) return st;
      const next = railOrder[i + dir];
      return next ? { ...st, screen: next, toast: '' } : st;
    });
  }, []);

  const goSettings = useCallback(() => go(7), [go]);

  // ── derived data (mirrors the original Component.renderVals()) ──────────

  const openQueue = useMemo(() => queueDefs.filter((q) => !s.done[q.key]), [s.done]);

  const queue = useMemo(
    () =>
      openQueue.map((q) => ({
        ...q,
        typeBg: q.type === 'Stok' ? accent : 'transparent',
        typeFg: q.type === 'Stok' ? ink : '#a6a19f',
        skip: () => {
          setS((st) => ({ ...st, done: { ...st.done, [q.key]: true } }));
          flash(`${q.type} kartı yarına ertelendi`);
        },
        act: () => {
          if (q.screen) go(q.screen);
          else {
            setS((st) => ({ ...st, done: { ...st.done, [q.key]: true } }));
            flash('Netleştirme sorusu İngilizce gönderildi');
          }
        },
      })),
    [openQueue, flash, go],
  );

  const pulse = useMemo(
    () => [
      { label: 'Bekleyen karar', value: String(openQueue.length), fg: openQueue.length ? accent : ink },
      { label: 'Bugün gelir', value: '€2.140', fg: ink },
      { label: 'Sevk edilecek', value: '2', fg: ink },
    ],
    [openQueue.length],
  );

  const orderLines = useMemo(
    () =>
      lineDefs.map((l, i) => ({
        name: l.name,
        meta: l.meta,
        qty: s.qty[i],
        inc: () =>
          setS((st) => {
            const q = [...st.qty] as [number, number, number];
            q[i]++;
            return { ...st, qty: q };
          }),
        dec: () =>
          setS((st) => {
            const q = [...st.qty] as [number, number, number];
            q[i] = Math.max(0, q[i] - 1);
            return { ...st, qty: q };
          }),
      })),
    [s.qty],
  );

  const orderTotal = useMemo(
    () => formatEUR(s.qty.reduce((a, q, i) => a + q * lineDefs[i].price, 0)),
    [s.qty],
  );

  const stages = useMemo(
    () =>
      stageNames.map((n) => ({
        label: n,
        count: orderDefs.filter((o) => o.stage === n).length,
        bg: s.stage === n ? ink : 'transparent',
        fg: s.stage === n ? ground : ink,
        select: () => setS((st) => ({ ...st, stage: n })),
      })),
    [s.stage],
  );

  const stageOrders = useMemo(
    () =>
      orderDefs
        .filter((o) => o.stage === s.stage)
        .map((o) => ({ ...o, advance: () => flash(`${o.id} → ${o.next.toLowerCase()}`) })),
    [s.stage, flash],
  );

  const stockFilters = useMemo(
    () =>
      (['Tümü', 'Düşük stok', 'Üretimde'] as StockFilter[]).map((f) => ({
        label: f,
        bg: s.stockFilter === f ? ink : 'transparent',
        fg: s.stockFilter === f ? ground : ink,
        border: s.stockFilter === f ? ink : '#3a3634',
        select: () => setS((st) => ({ ...st, stockFilter: f })),
      })),
    [s.stockFilter],
  );

  const visibleStock = useMemo(() => {
    return stockDefs
      .map((p) => ({ ...p, low: p.qty / p.cap < 0.2 }))
      .filter((p) =>
        s.stockFilter === 'Tümü'
          ? true
          : s.stockFilter === 'Düşük stok'
            ? p.low
            : p.stage === 'Üretimde',
      )
      .map((p) => {
        const filled = Math.max(1, Math.round((p.qty / p.cap) * 12));
        return {
          name: p.name,
          sku: p.sku,
          qty: p.qty,
          stage: p.stage,
          warn: p.warn || '',
          qtyFg: p.low ? '#ff6a52' : ink,
          cells: Array.from({ length: 12 }, (_, i) => ({ bg: i < filled ? (p.low ? accent : ink) : '#3a3634' })),
        };
      });
  }, [s.stockFilter]);

  const months = useMemo(
    () =>
      monthData.map((m) => ({
        label: m.label,
        revH: `${Math.round((m.rev / 22) * 100)}%`,
        expH: `${Math.round((m.exp / 22) * 100)}%`,
      })),
    [],
  );

  const channels = useMemo(
    () =>
      channelDefs.map((c) => {
        const on = s.connected[c.key as ChannelKey];
        return {
          ...c,
          pill: on ? 'Bağlı' : 'Bağla',
          pillBg: on ? accent : 'transparent',
          pillFg: ink,
          toggle: () => {
            setS((st) => ({ ...st, connected: { ...st.connected, [c.key]: !st.connected[c.key as ChannelKey] } }));
            flash(on ? `${c.name} kaldırıldı` : `${c.name} bağlandı`);
          },
        };
      }),
    [s.connected, flash],
  );

  const team = useMemo(
    () =>
      teamDefs.map((p) => ({
        ...p,
        badgeBg: p.state === 'Vardiyada' ? ink : 'transparent',
        badgeFg: p.state === 'Vardiyada' ? ground : '#a6a19f',
      })),
    [],
  );

  const toggles = useMemo(
    () =>
      toggleDefs.map((t) => ({
        label: t.label,
        sub: t.sub,
        trackBg: s.tr[t.key as TranslateKey] ? accent : '#3a3634',
        knobEnd: s.tr[t.key as TranslateKey],
        toggle: () => setS((st) => ({ ...st, tr: { ...st.tr, [t.key]: !st.tr[t.key as TranslateKey] } })),
      })),
    [s.tr],
  );

  const rail = useMemo(
    () =>
      railDefs.map((r) => ({
        ...r,
        count: r.n === 1 ? openQueue.length || null : null,
        active: s.screen === r.n,
        bg: s.screen === r.n ? ink : 'transparent',
        fg: s.screen === r.n ? ground : '#a6a19f',
        go: () => go(r.n),
      })),
    [s.screen, openQueue.length, go],
  );

  const railIndex = railOrder.indexOf(s.screen as (typeof railOrder)[number]);
  const dots = useMemo(
    () =>
      railOrder.map((_n, i) => ({
        bg: i === railIndex ? ink : '#3a3634',
        w: i === railIndex ? 22 : 10,
      })),
    [railIndex],
  );

  const askTemplates = useMemo(
    () =>
      askTemplateDefs.map((t, i) => ({
        label: t.label,
        bg: s.askTpl === i ? ink : 'transparent',
        fg: s.askTpl === i ? ground : ink,
        border: s.askTpl === i ? ink : '#3a3634',
        select: () => setS((st) => ({ ...st, askTpl: i })),
      })),
    [s.askTpl],
  );

  const askLangs = useMemo(
    () =>
      askLangOptions.map((l) => ({
        label: l,
        bg: s.askLang === l ? accent : 'transparent',
        fg: ink,
        border: s.askLang === l ? accent : '#3a3634',
        select: () => setS((st) => ({ ...st, askLang: l as AskLang })),
      })),
    [s.askLang],
  );

  const tpl = askTemplateDefs[s.askTpl];
  const askPreview = s.askLang === 'TR' ? tpl.tr : tpl[s.askLang];

  const draftLines = useMemo(
    () =>
      catalog.map((c) => {
        const q = s.draft.lines[c.sku] || 0;
        return {
          name: c.name,
          sku: c.sku,
          qty: q,
          price: `€${c.price}`,
          rowBg: q ? '#2b2827' : 'transparent',
          inc: () =>
            setS((st) => ({
              ...st,
              draft: { ...st.draft, lines: { ...st.draft.lines, [c.sku]: (st.draft.lines[c.sku] || 0) + 1 } },
            })),
          dec: () =>
            setS((st) => ({
              ...st,
              draft: { ...st.draft, lines: { ...st.draft.lines, [c.sku]: Math.max(0, (st.draft.lines[c.sku] || 0) - 1) } },
            })),
        };
      }),
    [s.draft.lines],
  );

  const draftTotalRaw = useMemo(
    () => catalog.reduce((a, c) => a + (s.draft.lines[c.sku] || 0) * c.price, 0),
    [s.draft.lines],
  );

  const custResults = useMemo(() => {
    const q = s.custQuery.toLocaleLowerCase('tr');
    return customerBook
      .filter((c) => !q || c.name.toLocaleLowerCase('tr').includes(q) || c.place.toLocaleLowerCase('tr').includes(q))
      .map((c) => ({
        ...c,
        bg: s.draft.customer === c.name ? '#2b2827' : 'transparent',
        mark: s.draft.customer === c.name ? '●' : '',
        select: () =>
          setS((st) => ({ ...st, draft: { ...st.draft, customer: c.name }, custOpen: false, custQuery: '' })),
      }));
  }, [s.custQuery, s.draft.customer]);

  const draftReady = !!s.draft.customer && draftTotalRaw > 0;

  const basket = useMemo(
    () =>
      catalog
        .filter((c) => s.draft.lines[c.sku])
        .map((c) => {
          const n = s.draft.lines[c.sku];
          return {
            name: c.name,
            sku: c.sku,
            qty: n,
            calc: `${n} × €${c.price}`,
            sum: formatEUR(n * c.price),
            remove: () =>
              setS((st) => {
                const lines = { ...st.draft.lines };
                delete lines[c.sku];
                return { ...st, draft: { ...st.draft, lines } };
              }),
          };
        }),
    [s.draft.lines],
  );

  const basketEmpty = Object.values(s.draft.lines).every((v) => !v);
  const basketCount = `${catalog.filter((c) => s.draft.lines[c.sku]).length} kalem · ${catalog.reduce(
    (a, c) => a + (s.draft.lines[c.sku] || 0),
    0,
  )} adet`;

  const toggleCust = useCallback(
    () => setS((st) => ({ ...st, custOpen: !st.custOpen, custQuery: '' })),
    [],
  );
  const setCustQuery = useCallback((text: string) => setS((st) => ({ ...st, custQuery: text })), []);
  const newCustomer = useCallback(() => {
    const n = s.custQuery.trim() || 'Yeni müşteri';
    setS((st) => ({ ...st, draft: { ...st.draft, customer: n }, custOpen: false, custQuery: '' }));
    flash(`${n} eklendi · kart sonra tamamlanabilir`);
  }, [s.custQuery, flash]);

  const approveOrder = useCallback(() => {
    setS((st) => ({ ...st, stage: 'Yeni', done: { ...st.done, q1: true }, screen: 3, toast: '' }));
    flash('ORD-2294 oluşturuldu');
  }, [flash]);

  const rejectOrder = useCallback(() => {
    go(1);
    flash('Düzeltme sorusu İspanyolca gönderildi');
  }, [go, flash]);

  const fixWaError = useCallback(() => {
    setS((st) => ({ ...st, waError: false }));
    flash('WhatsApp bağlantısı yenilendi');
  }, [flash]);

  const clearStockFilter = useCallback(() => setS((st) => ({ ...st, stockFilter: 'Tümü' })), []);

  const resetQueue = useCallback(() => {
    setS((st) => ({ ...st, done: {} }));
    flash('Kuyruk geri yüklendi');
  }, [flash]);

  const sendAskQuestion = useCallback(() => {
    setS((st) => ({ ...st, done: { ...st.done, q2: true } }));
    go(1);
    flash(`Soru ${s.askLang} dilinde gönderildi`);
  }, [go, flash, s.askLang]);

  const createDraftOrder = useCallback(() => {
    if (!draftReady) {
      flash('Müşteri ve en az bir kalem gerekli');
      return;
    }
    setS((st) => ({ ...st, stage: 'Yeni', draft: { customer: '', lines: {} }, screen: 3, toast: '' }));
    flash(`Manuel sipariş oluşturuldu · ${formatEUR(draftTotalRaw)}`);
  }, [draftReady, draftTotalRaw, flash]);

  const primary = useMemo(() => {
    const map: Record<number, { label: string; act: () => void }> = {
      1: {
        label: openQueue.length ? 'Sıradaki kartı aç' : 'Yenile',
        act: () => (openQueue.length ? go(openQueue[0].screen || 1) : flash('Yeni iş yok')),
      },
      2: { label: 'Siparişe çevir', act: approveOrder },
      3: { label: 'Sipariş ekle', act: () => go(9) },
      4: { label: 'Tedarik siparişi', act: () => flash('Keten kumaş için tedarikçi talebi hazırlandı') },
      5: { label: 'Gider ekle', act: () => flash('Fiş fotoğrafı ile gider girişi') },
      6: { label: 'Mesaj yaz', act: () => flash('WhatsApp üzerinden yanıt · çeviri açık') },
      7: { label: "Pro'ya geç", act: () => flash('Pro: sınırsız kanal, 5 kullanıcı') },
      8: { label: 'Soruyu gönder', act: sendAskQuestion },
      9: { label: draftReady ? 'Siparişi oluştur' : 'Eksik bilgi var', act: createDraftOrder },
    };
    return map[s.screen];
  }, [s.screen, openQueue, go, flash, approveOrder, sendAskQuestion, draftReady, createDraftOrder]);

  return {
    state: s,
    header: { title: screenNames[s.screen - 1], kicker: screenKickers[s.screen - 1] },
    go,
    swipe,
    goSettings,
    flash,
    toast: s.toast,
    rail,
    dots,
    inRail: railIndex !== -1,
    swipeLabel: railIndex === -1 ? '' : `Kaydırarak geç · ${railIndex + 1}/5`,
    primary,
    footNote: footNotes[s.screen],
    screenFlags: {
      isQueue: s.screen === 1,
      isApproval: s.screen === 2,
      isFlow: s.screen === 3,
      isStock: s.screen === 4,
      isMoney: s.screen === 5,
      isCustomer: s.screen === 6,
      isSettings: s.screen === 7,
      isAsk: s.screen === 8,
      isDraft: s.screen === 9,
    },
    queueScreen: { pulse, queue, queueEmpty: openQueue.length === 0, waError: s.waError, fixWaError, resetQueue },
    approvalScreen: { orderLines, orderTotal, approveOrder, rejectOrder },
    workflowScreen: { stages, stageOrders, stageEmpty: stageOrders.length === 0 },
    stockScreen: { stockFilters, visibleStock, stockEmpty: visibleStock.length === 0, clearStockFilter },
    moneyScreen: { months, expenses },
    customerScreen: { identities, custStats, timeline },
    settingsScreen: { channels, team, toggles },
    askScreen: {
      askTemplates,
      askLangs,
      askPreview,
      askSource: tpl.label,
      askLang: s.askLang,
      context: askClarifyContext,
    },
    draftScreen: {
      draftLines,
      draftReady,
      draftTotal: formatEUR(draftTotalRaw),
      draftHint: !s.draft.customer ? 'Müşteri seçilmedi' : draftTotalRaw === 0 ? 'Kalem eklenmedi' : 'Hazır',
      basket,
      basketEmpty,
      basketCount,
      lineCount: `${catalog.length} kalem · kaydırın`,
      custOpen: s.custOpen,
      custQuery: s.custQuery,
      custLabel: s.draft.customer || 'Müşteri seçin',
      custLabelFg: s.draft.customer ? ink : '#807b79',
      custCaret: s.custOpen ? '▲' : '▼',
      custCount: `${customerBook.length} kayıtlı müşteri`,
      custEmpty: custResults.length === 0,
      custResults,
      toggleCust,
      setCustQuery,
      newCustomer,
    },
  };
}

export type QueueAppApi = ReturnType<typeof useQueueApp>;
export { groupThousands };
