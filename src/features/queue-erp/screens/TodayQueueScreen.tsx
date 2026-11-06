import { useCallback, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BodyText, color, font } from '@/design-system';
import { formatMoney } from '@/lib/money';
import { orderStatusLabel } from '@/lib/roleLabels';
import { isLowStock } from '@/lib/stockMatrix';
import { financeService, hasPermission, orderService, reportService, stockService, taskService, productService, type ActorContext } from '@/services';
import { useReloadOnMount } from '@/hooks/use-reload';

interface QueueItem {
  key: string;
  type: string;
  time: string;
  title: string;
  detail: string;
  cta: string;
  onAct: () => void;
}

/** Screen 1 — merges everything that genuinely needs today's attention from
 * real data: open tasks, low-stock variants, draft orders awaiting
 * approval, and (owner/manager only) checks due soon. Replaces the mock
 * `queueDefs` feed entirely. "Atla" only dismisses locally for this
 * session, same as the original mockup's `done` map — never persisted,
 * so nothing is lost by not writing it anywhere. */
export function TodayQueueScreen({
  ctx,
  openApproval,
  goTo,
}: {
  ctx: ActorContext;
  openApproval: (orderId: string) => void;
  goTo: (n: number) => void;
}) {
  const router = useRouter();
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [netThisMonth, setNetThisMonth] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const next: QueueItem[] = [];

    const tasks = (await taskService.list(ctx)).filter((t) => t.status !== 'done');
    for (const t of tasks) {
      next.push({
        key: `task-${t.id}`,
        type: 'Görev',
        time: '',
        title: t.title,
        detail: t.description ?? 'Görevler ekranında detay var',
        cta: 'Görevlere git',
        onAct: () => router.push('/tasks'),
      });
    }

    if (hasPermission(ctx.employee.role, 'stockMovement', 'read')) {
      const products = await productService.list(ctx);
      for (const p of products) {
        const variants = await productService.listVariants(ctx, p.id);
        for (const v of variants) {
          const level = await stockService.getLevel(ctx, v.id);
          const onHand = level?.on_hand ?? 0;
          const threshold = level?.low_stock_threshold ?? 0;
          // Eşik manuel >0 ayarlanmadıkça uyarma (product feedback) — bkz.
          // lib/stockMatrix.ts'in isLowStock() yorumu.
          if (isLowStock(onHand, threshold)) {
            next.push({
              key: `stock-${v.id}`,
              type: 'Stok',
              time: '',
              title: `${p.name} — düşük stok`,
              detail: `${onHand} adet kaldı`,
              cta: 'Stoğa git',
              onAct: () => goTo(4),
            });
          }
        }
      }
    }

    if (hasPermission(ctx.employee.role, 'order', 'read')) {
      const orders = await orderService.list(ctx);
      for (const o of orders.filter((o) => o.status === 'draft')) {
        next.push({
          key: `order-${o.id}`,
          type: 'Onay',
          time: '',
          title: `Taslak sipariş — ${orderStatusLabel[o.status]}`,
          detail: 'Onay bekliyor',
          cta: 'İncele',
          onAct: () => openApproval(o.id),
        });
      }
    }

    if (hasPermission(ctx.employee.role, 'finance', 'read')) {
      const checks = await financeService.upcomingDueChecks(ctx);
      for (const c of checks) {
        next.push({
          key: `check-${c.id}`,
          type: 'Çek',
          time: new Date(c.due_date).toLocaleDateString('tr-TR'),
          title: c.direction === 'received' ? 'Tahsil edilecek çek' : 'Ödenecek çek',
          detail: formatMoney(c.amount_minor, c.currency),
          cta: 'Gelir/Gider',
          onAct: () => router.push('/finance'),
        });
      }
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const summary = await reportService.monthlySummary(ctx, { from: monthStart, to: now.toISOString() });
      setNetThisMonth(summary.length === 0 ? null : summary.map((s) => formatMoney(s.netMinor, s.currency)).join(' · '));
    } else {
      setNetThisMonth(null);
    }

    setItems(next);
  }, [ctx, router, goTo, openApproval]);

  useReloadOnMount(reload);

  const visible = (items ?? []).filter((q) => !dismissed.has(q.key));

  return (
    <View>
      <View style={styles.pulseRow}>
        <View>
          <Text style={styles.pulseLabel}>Bekleyen karar</Text>
          <Text style={[styles.pulseValue, { color: visible.length ? color.accent : color.text }]}>{visible.length}</Text>
        </View>
        {netThisMonth !== null && (
          <View>
            <Text style={styles.pulseLabel}>Bu ay net</Text>
            <Text style={styles.pulseValue}>{netThisMonth}</Text>
          </View>
        )}
      </View>

      {items === null ? (
        <View style={styles.empty}>
          <BodyText muted>Yükleniyor…</BodyText>
        </View>
      ) : visible.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Kuyruk{'\n'}temiz.</Text>
          <Text style={styles.emptyBody}>Bugün bekleyen iş yok. Yeni görev/sipariş/uyarı geldiğinde kart burada görünür.</Text>
        </View>
      ) : (
        visible.map((q) => (
          <View key={q.key} style={styles.card}>
            <View style={styles.cardTop}>
              <View style={styles.typeTag}>
                <Text style={styles.typeTagText}>{q.type}</Text>
              </View>
              {!!q.time && <Text style={styles.time}>{q.time}</Text>}
            </View>
            <Text style={styles.cardTitle}>{q.title}</Text>
            <Text style={styles.cardDetail}>{q.detail}</Text>
            <View style={styles.actions}>
              <Pressable onPress={() => setDismissed((d) => new Set(d).add(q.key))} style={styles.skipBtn}>
                <Text style={styles.skipText}>Atla</Text>
              </Pressable>
              <Pressable onPress={q.onAct} style={styles.actBtn}>
                <Text style={styles.actText}>{q.cta}</Text>
              </Pressable>
            </View>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pulseRow: { padding: 14, paddingHorizontal: 18, flexDirection: 'row', gap: 18, borderBottomWidth: 2, borderBottomColor: color.text },
  pulseLabel: { fontSize: 9.5, letterSpacing: 1, textTransform: 'uppercase', fontFamily: font.heading, color: color.dim },
  pulseValue: { fontSize: 22, lineHeight: 24, fontFamily: font.heading, marginTop: 2, color: color.text },

  empty: { padding: 22, paddingVertical: 46 },
  emptyTitle: { fontSize: 44, lineHeight: 42, fontFamily: font.heading, color: color.text },
  emptyBody: { fontSize: 13.5, lineHeight: 19, color: color.dim, marginTop: 14 },

  card: { borderBottomWidth: 2, borderBottomColor: color.divider, padding: 16, paddingHorizontal: 18 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  typeTag: { paddingHorizontal: 6, paddingVertical: 3, backgroundColor: color.accentRamp[100] },
  typeTagText: { fontSize: 9.5, letterSpacing: 1, textTransform: 'uppercase', fontFamily: font.heading, color: color.accentRamp[800] },
  time: { fontSize: 11, fontFamily: font.mono, color: color.dimmer },
  cardTitle: { fontSize: 19, lineHeight: 22, fontFamily: font.heading, color: color.text, marginTop: 9 },
  cardDetail: { fontSize: 13, lineHeight: 19, color: color.dim, marginTop: 5 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  skipBtn: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: color.text },
  skipText: { fontFamily: font.heading, fontSize: 13.5, color: color.text },
  actBtn: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: color.accent },
  actText: { fontFamily: font.heading, fontSize: 13.5, color: color.bg },
});
