import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BodyText, Card, CardBody, CardMeta, CardTitle, Divider, Heading, space, Table, Tag } from '@/design-system';
import { ModuleScreen } from '@/components/module-screen';
import { formatMoney } from '@/lib/money';
import { expenseCategoryLabel } from '@/lib/roleLabels';
import type { Customer, Product, ProductVariant } from '@/models';
import {
  customerService,
  productService,
  reportService,
  useActorContext,
  type CategoryBreakdown,
  type CustomerRevenue,
  type MonthlySummary,
  type TopVariant,
} from '@/services';
import { useReloadOnMount } from '@/hooks/use-reload';

interface VariantInfo {
  productName: string;
  sku: string;
}

/** Basit raporlar (CLAUDE.md §5.5/§9 step 6) — read-only, all four reports
 * the spec names for Faz 1: aylık özet, kategori dağılımı, en çok satan
 * varyant, müşteri bazlı ciro. No accounting/tax/invoicing — just these. */
export default function ReportsScreen() {
  const ctx = useActorContext();
  const [summary, setSummary] = useState<MonthlySummary[] | null>(null);
  const [categories, setCategories] = useState<CategoryBreakdown[] | null>(null);
  const [topVariants, setTopVariants] = useState<TopVariant[] | null>(null);
  const [byCustomer, setByCustomer] = useState<CustomerRevenue[] | null>(null);
  const [variantInfo, setVariantInfo] = useState<Record<string, VariantInfo>>({});
  const [customerNames, setCustomerNames] = useState<Record<string, string>>({});

  const reload = useCallback(async () => {
    if (!ctx) return;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const [s, cat, top, cust, products, customers] = await Promise.all([
      reportService.monthlySummary(ctx, { from: monthStart, to: now.toISOString() }),
      reportService.expenseByCategory(ctx),
      reportService.topSellingVariants(ctx),
      reportService.revenueByCustomer(ctx),
      productService.list(ctx),
      customerService.list(ctx, { includeInactive: true }),
    ]);
    setSummary(s);
    setCategories(cat);
    setTopVariants(top);
    setByCustomer(cust);

    const vInfo: Record<string, VariantInfo> = {};
    for (const p of products as Product[]) {
      const variants = await productService.listVariants(ctx, p.id, { includeInactive: true });
      for (const v of variants as ProductVariant[]) vInfo[v.id] = { productName: p.name, sku: v.sku };
    }
    setVariantInfo(vInfo);

    const cNames: Record<string, string> = {};
    for (const c of customers as Customer[]) cNames[c.id] = c.name;
    setCustomerNames(cNames);
  }, [ctx]);

  useReloadOnMount(reload);

  if (!ctx) return null;

  return (
    <ModuleScreen title="Raporlar" subtitle="Bu ayki özet ve dağılımlar">
      <Heading level={5}>Aylık Özet (bu ay)</Heading>
      {summary === null && <BodyText muted>Yükleniyor…</BodyText>}
      {summary?.length === 0 && <BodyText muted>Bu ay için kayıt yok.</BodyText>}
      <View style={styles.list}>
        {summary?.map((s) => (
          <Card key={s.currency} style={styles.summaryCard}>
            <CardMeta>
              <Tag label={s.currency} variant="neutral" />
            </CardMeta>
            <View style={styles.summaryRow}>
              <View>
                <BodyText muted>Gelir</BodyText>
                <CardTitle>{formatMoney(s.incomeMinor, s.currency)}</CardTitle>
              </View>
              <View>
                <BodyText muted>Gider</BodyText>
                <CardTitle>{formatMoney(s.expenseMinor, s.currency)}</CardTitle>
              </View>
              <View>
                <BodyText muted>Net</BodyText>
                <CardTitle>{formatMoney(s.netMinor, s.currency)}</CardTitle>
              </View>
            </View>
          </Card>
        ))}
      </View>

      <Divider />
      <Heading level={5}>Kategori Bazlı Gider Dağılımı</Heading>
      {categories?.length === 0 && <BodyText muted>Gider kaydı yok.</BodyText>}
      {!!categories?.length && (
        <Table
          columns={[
            { key: 'category', label: 'Kategori', render: (r: CategoryBreakdown) => expenseCategoryLabel[r.category as keyof typeof expenseCategoryLabel] ?? r.category },
            { key: 'amount', label: 'Tutar', render: (r: CategoryBreakdown) => formatMoney(r.amountMinor, r.currency) },
          ]}
          rows={categories}
          keyExtractor={(r) => `${r.currency}-${r.category}`}
        />
      )}

      <Divider />
      <Heading level={5}>En Çok Satan Varyantlar</Heading>
      {topVariants?.length === 0 && <BodyText muted>Henüz onaylanmış sipariş yok.</BodyText>}
      <View style={styles.list}>
        {topVariants?.map((v) => {
          const info = variantInfo[v.variantId];
          return (
            <Card key={`${v.currency}-${v.variantId}`}>
              <CardTitle>{info ? `${info.productName} (${info.sku})` : v.variantId}</CardTitle>
              <CardBody>{`${v.quantitySold} adet — ${formatMoney(v.revenueMinor, v.currency)}`}</CardBody>
            </Card>
          );
        })}
      </View>

      <Divider />
      <Heading level={5}>Müşteri Bazlı Ciro</Heading>
      {byCustomer?.length === 0 && <BodyText muted>Sipariş kaynaklı gelir yok.</BodyText>}
      <View style={styles.list}>
        {byCustomer?.map((c) => (
          <Card key={`${c.currency}-${c.customerId}`}>
            <CardTitle>{customerNames[c.customerId] ?? '—'}</CardTitle>
            <CardBody>{formatMoney(c.amountMinor, c.currency)}</CardBody>
          </Card>
        ))}
      </View>
    </ModuleScreen>
  );
}

const styles = StyleSheet.create({
  list: { gap: space[3] },
  summaryCard: { gap: space[3] },
  summaryRow: { flexDirection: 'row', gap: space[4] },
});
