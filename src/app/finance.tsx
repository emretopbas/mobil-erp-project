import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useReloadOnMount } from '@/hooks/use-reload';
import { BodyText, Button, Card, CardBody, CardMeta, CardTitle, Divider, Heading, space, Tag } from '@/design-system';
import { ModuleScreen } from '@/components/module-screen';
import { MoneyEntryForm } from '@/features/cari/MoneyEntryForm';
import { formatMoney } from '@/lib/money';
import { expenseCategoryLabel, paymentMethodLabel } from '@/lib/roleLabels';
import type { Check, ExpenseEntry, RevenueEntry } from '@/models';
import { financeService, useActorContext, useSession } from '@/services';

/** Gelir / gider + çek takibi (CLAUDE.md §5.5, §5.6). `financeService`
 * already creates the linked Check row when payment_method='check' — this
 * screen just collects the extra due-date field in that case. */
export default function FinanceScreen() {
  const ctx = useActorContext();
  const { business } = useSession();
  const [expenses, setExpenses] = useState<ExpenseEntry[] | null>(null);
  const [revenues, setRevenues] = useState<RevenueEntry[] | null>(null);
  const [upcomingChecks, setUpcomingChecks] = useState<Check[] | null>(null);
  const [error] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const reload = useCallback(async () => {
    if (!ctx) return;
    const [e, r, c] = await Promise.all([
      financeService.listExpenses(ctx),
      financeService.listRevenues(ctx),
      financeService.upcomingDueChecks(ctx),
    ]);
    setExpenses(e);
    setRevenues(r);
    setUpcomingChecks(c);
  }, [ctx]);

  useReloadOnMount(reload);

  if (!ctx) return null;
  const currency = business?.base_currency ?? 'TRY';

  const totalExpense = (expenses ?? []).reduce((s, e) => s + e.amount_minor, 0);
  const totalRevenue = (revenues ?? []).reduce((s, e) => s + e.amount_minor, 0);

  return (
    <ModuleScreen title="Gelir / Gider" subtitle="Kayıtlar ve çek takibi">
      {!!error && <BodyText style={styles.error}>{error}</BodyText>}

      <View style={styles.summaryRow}>
        <Card style={styles.summaryCard}>
          <CardMeta>
            <Tag label="Gelir" variant="accent2" />
          </CardMeta>
          <CardTitle>{formatMoney(totalRevenue, currency)}</CardTitle>
        </Card>
        <Card style={styles.summaryCard}>
          <CardMeta>
            <Tag label="Gider" variant="accent" />
          </CardMeta>
          <CardTitle>{formatMoney(totalExpense, currency)}</CardTitle>
        </Card>
      </View>

      <Button label={showForm ? 'Formu kapat' : '+ Yeni kayıt'} variant={showForm ? 'secondary' : 'primary'} onPress={() => setShowForm((s) => !s)} />

      {showForm && (
        <MoneyEntryForm
          ctx={ctx}
          onSaved={async () => {
            setShowForm(false);
            await reload();
          }}
        />
      )}

      {!!upcomingChecks?.length && (
        <>
          <Divider />
          <Heading level={5}>Vadesi Yaklaşan Çekler</Heading>
          <View style={styles.list}>
            {upcomingChecks.map((c) => (
              <Card key={c.id}>
                <CardMeta>
                  <Tag label={c.direction === 'received' ? 'Alınan' : 'Verilen'} variant={c.direction === 'received' ? 'accent2' : 'accent'} />
                </CardMeta>
                <CardTitle>{formatMoney(c.amount_minor, c.currency)}</CardTitle>
                <CardBody>{`Vade: ${new Date(c.due_date).toLocaleDateString('tr-TR')}`}</CardBody>
              </Card>
            ))}
          </View>
        </>
      )}

      <Divider />
      <Heading level={5}>Son Kayıtlar</Heading>
      {expenses === null && revenues === null && <BodyText muted>Yükleniyor…</BodyText>}
      <View style={styles.list}>
        {revenues?.map((r) => (
          <Card key={r.id}>
            <CardMeta>
              <Tag label="Gelir" variant="accent2" />
              <Tag label={paymentMethodLabel[r.payment_method]} variant="neutral" />
            </CardMeta>
            <CardTitle>{formatMoney(r.amount_minor, r.currency)}</CardTitle>
            <CardBody>{`${new Date(r.date).toLocaleDateString('tr-TR')}${r.note ? ` — ${r.note}` : ''}`}</CardBody>
          </Card>
        ))}
        {expenses?.map((e) => (
          <Card key={e.id}>
            <CardMeta>
              <Tag label={expenseCategoryLabel[e.category]} variant="accent" />
              <Tag label={paymentMethodLabel[e.payment_method]} variant="neutral" />
            </CardMeta>
            <CardTitle>{formatMoney(e.amount_minor, e.currency)}</CardTitle>
            <CardBody>{`${new Date(e.date).toLocaleDateString('tr-TR')}${e.note ? ` — ${e.note}` : ''}`}</CardBody>
          </Card>
        ))}
        {expenses?.length === 0 && revenues?.length === 0 && <BodyText muted>Henüz kayıt yok.</BodyText>}
      </View>
    </ModuleScreen>
  );
}

const styles = StyleSheet.create({
  error: { color: '#ae1800' },
  summaryRow: { flexDirection: 'row', gap: space[3] },
  summaryCard: { flex: 1 },
  list: { gap: space[3] },
});
