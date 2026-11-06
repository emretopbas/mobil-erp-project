// Manuel sipariş matrisi: satır grupları, düzenleme, sık alınanlar, asorti
// desenleri ve hayalet default varyant kuralı. Çalıştırma:
// `node scripts/run-ts-tests.mjs OrderMatrix`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeRepository } from './fakeRepository.ts';
import { OrderService } from '../OrderService.ts';
import { AssortmentService } from '../AssortmentService.ts';
import { ProductService } from '../ProductService.ts';
import { StockService } from '../StockService.ts';
import type { ActorContext } from '../context.ts';
import type { EmployeeRole } from '../../models/index.ts';
import { canonicalVariantKey, type Combination } from '../../lib/variantAxes.ts';

async function setup(role: EmployeeRole = 'owner') {
  const repository = createFakeRepository();
  const business = await repository.business.create({ name: 'Test Co', base_currency: 'USD', plan_tier: 'solo' });
  const employee = await repository.employees.create({ business_id: business.id, firebase_uid: 'u', display_name: 'T', email: null, phone: null, role });
  const customer = await repository.customers.create({ business_id: business.id, name: 'Perviz', primary_channel: null, contact_ref: null });
  const product = await repository.products.create({ business_id: business.id, name: '25770', sku: '25770', base_price_minor: 4500, currency: 'USD' });
  const other = await repository.products.create({ business_id: business.id, name: '30100', sku: '30100', base_price_minor: 2000, currency: 'USD' });
  const mk = (p: { id: string }, sku: string, key = sku) =>
    repository.productVariants.create({ product_id: p.id, business_id: business.id, attributes: '{}', sku, variant_key: key });
  const v1 = await mk(product, '25770-K-42', 'color=K|size=42');
  const v2 = await mk(product, '25770-K-43', 'color=K|size=43');
  const v3 = await mk(other, '30100-1', '');
  const ctx: ActorContext = { employee, business, repository };
  return { repository, ctx, customer, product, other, v1, v2, v3, orders: new OrderService(), assortments: new AssortmentService(), products: new ProductService(), stock: new StockService() };
}

const header = (customerId: string) => ({ customer_id: customerId, currency: 'USD' });

test('matristen sipariş: her >0 hücre tek varyantlı satır; satırlar ortak line_group_id taşır', async () => {
  const { ctx, customer, product, v1, v2, orders } = await setup();
  const order = await orders.createWithLines(ctx, header(customer.id), [
    {
      product_id: product.id,
      assortment_pattern: '1-2',
      assortment_sets: 3,
      lines: [
        { variant_id: v1.id, quantity: 3, unit_price_minor: 4500 },
        { variant_id: v2.id, quantity: 6, unit_price_minor: 4500 },
      ],
    },
  ]);
  const lines = await orders.lines(ctx, order.id);
  const groups = await orders.lineGroups(ctx, order.id);
  assert.equal(lines.length, 2);
  assert.equal(groups.length, 1);
  assert.ok(lines.every((l) => l.line_group_id === groups[0].id));
  assert.deepEqual([groups[0].assortment_pattern, groups[0].assortment_sets, groups[0].product_id], ['1-2', 3, product.id]);
});

test('0 adetli hücre satıra dönüşmez; hiç adet yoksa grup da oluşmaz', async () => {
  const { ctx, customer, product, v1, v2, orders } = await setup();
  const order = await orders.createWithLines(ctx, header(customer.id), [
    { product_id: product.id, lines: [{ variant_id: v1.id, quantity: 0, unit_price_minor: 4500 }, { variant_id: v2.id, quantity: 0, unit_price_minor: 4500 }] },
  ]);
  assert.equal((await orders.lines(ctx, order.id)).length, 0);
  assert.equal((await orders.lineGroups(ctx, order.id)).length, 0);
});

test('düzenleme: kaydedilen değerler geri gelir, saveLines eskisini toptan değiştirir', async () => {
  const { ctx, customer, product, v1, v2, orders } = await setup();
  const order = await orders.createWithLines(ctx, header(customer.id), [
    { product_id: product.id, lines: [{ variant_id: v1.id, quantity: 5, unit_price_minor: 4500 }] },
  ]);
  const before = await orders.lines(ctx, order.id);
  assert.deepEqual(before.map((l) => [l.variant_id, l.quantity]), [[v1.id, 5]]);

  await orders.saveLines(ctx, order.id, [
    { product_id: product.id, lines: [{ variant_id: v1.id, quantity: 2, unit_price_minor: 4500 }, { variant_id: v2.id, quantity: 7, unit_price_minor: 4000 }] },
  ]);
  const after = await orders.lines(ctx, order.id);
  assert.deepEqual(after.map((l) => [l.variant_id, l.quantity, l.unit_price_minor]).sort(), [[v1.id, 2, 4500], [v2.id, 7, 4000]].sort());
  assert.equal((await orders.lineGroups(ctx, order.id)).length, 1, 'eski grup silindi, yenisi yazıldı');
});

test('geçersiz girişler: ondalık adet, başka ürünün varyantı, tekrar eden varyant', async () => {
  const { ctx, customer, product, v1, v3, orders } = await setup();
  const order = await orders.create(ctx, header(customer.id));
  await assert.rejects(() => orders.saveLines(ctx, order.id, [{ product_id: product.id, lines: [{ variant_id: v1.id, quantity: 1.5, unit_price_minor: 100 }] }]));
  await assert.rejects(() => orders.saveLines(ctx, order.id, [{ product_id: product.id, lines: [{ variant_id: v3.id, quantity: 1, unit_price_minor: 100 }] }]));
  await assert.rejects(() =>
    orders.saveLines(ctx, order.id, [
      { product_id: product.id, lines: [{ variant_id: v1.id, quantity: 1, unit_price_minor: 100 }, { variant_id: v1.id, quantity: 2, unit_price_minor: 100 }] },
    ]),
  );
});

test('sevk edilmiş siparişin kalemleri değiştirilemez', async () => {
  const { ctx, repository, customer, product, v1, orders } = await setup();
  const order = await orders.createWithLines(ctx, header(customer.id), [{ product_id: product.id, lines: [{ variant_id: v1.id, quantity: 1, unit_price_minor: 100 }] }]);
  await repository.orders.updateStatus(order.id, 'shipped');
  await assert.rejects(() => orders.saveLines(ctx, order.id, []));
});

test('sık alınanlar: sipariş sayısına, eşitlikte toplam adede göre sıralanır; başka müşteri karışmaz', async () => {
  const { ctx, repository, customer, product, other, v1, v2, v3, orders } = await setup();
  const price = 100;
  await orders.createWithLines(ctx, header(customer.id), [{ product_id: product.id, lines: [{ variant_id: v1.id, quantity: 2, unit_price_minor: price }] }]);
  await orders.createWithLines(ctx, header(customer.id), [
    { product_id: product.id, lines: [{ variant_id: v1.id, quantity: 3, unit_price_minor: price }, { variant_id: v2.id, quantity: 1, unit_price_minor: price }] },
    { product_id: other.id, lines: [{ variant_id: v3.id, quantity: 50, unit_price_minor: price }] },
  ]);
  const stranger = await repository.customers.create({ business_id: ctx.business.id, name: 'Başka', primary_channel: null, contact_ref: null });
  await orders.createWithLines(ctx, header(stranger.id), [{ product_id: other.id, lines: [{ variant_id: v3.id, quantity: 999, unit_price_minor: price }] }]);

  const frequent = await orders.frequentProducts(ctx, customer.id);
  assert.deepEqual(frequent.map((f) => [f.product_id, f.orderCount, f.totalQuantity]), [
    [product.id, 2, 6],
    [other.id, 1, 50],
  ]);
});

test('asorti desenleri: müşteriye özel önce, işletme geneli sonra; aynı desen tekrar açılmaz', async () => {
  const { ctx, customer, assortments } = await setup();
  const shared = await assortments.save(ctx, { pattern: '1-2-2-2-1' });
  const own = await assortments.save(ctx, { pattern: '2 2 2 2 2', customer_id: customer.id });
  const again = await assortments.save(ctx, { pattern: '1-2-2-2-1' });
  assert.equal(again.id, shared.id);
  assert.equal(own.pattern, '2-2-2-2-2');

  assert.deepEqual((await assortments.list(ctx, customer.id)).map((p) => p.pattern), ['2-2-2-2-2', '1-2-2-2-1']);
  assert.deepEqual((await assortments.list(ctx)).map((p) => p.pattern), ['1-2-2-2-1']);
  await assert.rejects(() => assortments.save(ctx, { pattern: 'abc' }));

  await assortments.remove(ctx, shared.id);
  assert.deepEqual((await assortments.list(ctx, customer.id)).map((p) => p.pattern), ['2-2-2-2-2']);
});

test('viewer sipariş satırı yazamaz', async () => {
  const { ctx, customer, orders } = await setup('viewer');
  await assert.rejects(() => orders.createWithLines(ctx, header(customer.id), []));
});

// ─── Hayalet default varyant ─────────────────────────────────────────

async function comboFor(ctx: ActorContext, attributeCode: string, label: string): Promise<Combination> {
  const attribute = await ctx.repository.attributes.create({ business_id: ctx.business.id, code: attributeCode, name: attributeCode, data_type: 'text' });
  return { picks: [{ attributeId: attribute.id, code: attributeCode, dataType: 'text', value: { label, canonicalValue: label } }] } as Combination;
}

async function ghostSetup() {
  const s = await setup();
  const product = await s.repository.products.create({ business_id: s.ctx.business.id, name: 'Bot', sku: 'BOT', base_price_minor: 100, currency: 'USD' });
  const ghost = await s.repository.productVariants.create({ product_id: product.id, business_id: s.ctx.business.id, attributes: '{}', sku: 'BOT-1', variant_key: '' });
  return { ...s, ghostProduct: product, ghost };
}

test('ilk eksen eklenince hareketsiz default varyant silinir', async () => {
  const { ctx, repository, ghostProduct, products } = await ghostSetup();
  const combo = await comboFor(ctx, 'renk', 'Kırmızı');
  const key = canonicalVariantKey(combo);
  await products.commitVariants(ctx, ghostProduct.id, [combo], new Map([[key, { sku: 'BOT-K' }]]));
  const variants = await repository.productVariants.listByProduct(ghostProduct.id, { includeInactive: true });
  assert.deepEqual(variants.map((v) => v.variant_key), [key]);
});

test('stok hareketi olan default varyant seçilen kombinasyona dönüşür; yeni varyant açılmaz, stok korunur', async () => {
  const { ctx, repository, ghostProduct, ghost, products, stock } = await ghostSetup();
  await stock.recordMovement(ctx, { variant_id: ghost.id, type: 'in', quantity: 12, reason: 'opening_stock' });
  const red = await comboFor(ctx, 'renk', 'Kırmızı');
  const key = canonicalVariantKey(red);

  await assert.rejects(() => products.commitVariants(ctx, ghostProduct.id, [red], new Map([[key, { sku: 'X' }]])), /dönüştürül/);

  await products.commitVariants(ctx, ghostProduct.id, [red], new Map([[key, { sku: 'BOT-K' }]]), { convertDefaultToKey: key });
  const variants = await repository.productVariants.listByProduct(ghostProduct.id, { includeInactive: true });
  assert.equal(variants.length, 1);
  assert.equal(variants[0].id, ghost.id);
  assert.equal(variants[0].variant_key, key);
  assert.equal((await repository.stockMovements.listByVariant(ghost.id)).length, 1);
  assert.equal((await repository.variantAttributes.listByVariant(ghost.id)).length, 1);
});

test('sipariş satırı olan default varyant da "kullanılmış" sayılır', async () => {
  const { ctx, customer, ghostProduct, ghost, products, orders } = await ghostSetup();
  await orders.createWithLines(ctx, header(customer.id), [{ product_id: ghostProduct.id, lines: [{ variant_id: ghost.id, quantity: 1, unit_price_minor: 100 }] }]);
  const usage = await products.getDefaultVariantUsage(ctx, ghostProduct.id);
  assert.equal(usage?.inUse, true);
  assert.equal(usage?.orderLineCount, 1);
});

test('eksenli üründe eksensiz default varyant oluşturulamaz', async () => {
  const { ctx, product, products } = await setup();
  await assert.rejects(() => products.createDefaultVariant(ctx, product.id, 'X'), /eksenli varyant/);
});

test('tek seferlik düzeltme: hareketsiz hayaletler silinir, kullanılmışlar raporlanır', async () => {
  const s = await setup();
  const { ctx, repository, product, other, products, stock } = s;
  // product: eksenli varyantlı (v1,v2) + hareketli hayalet
  const ghostUsed = await repository.productVariants.create({ product_id: product.id, business_id: ctx.business.id, attributes: '{}', sku: '25770-1', variant_key: '' });
  await stock.recordMovement(ctx, { variant_id: ghostUsed.id, type: 'in', quantity: 4, reason: 'opening_stock' });
  // other: yalnızca default (v3) → hayalet DEĞİL; ayrıca eksenli + hareketsiz hayalet
  const keyed = await repository.productVariants.create({ product_id: other.id, business_id: ctx.business.id, attributes: '{}', sku: '30100-K', variant_key: 'color=K' });
  assert.ok(keyed);

  const found = await products.findGhostDefaultVariants(ctx);
  assert.equal(found.length, 2);

  const report = await products.cleanupGhostDefaultVariants(ctx);
  assert.deepEqual(report.removed.map((r) => r.sku), ['30100-1']);
  assert.deepEqual(report.kept.map((k) => [k.productName, k.usage.variant.sku, k.usage.movementCount]), [['25770', '25770-1', 1]]);
  assert.equal((await repository.productVariants.listByProduct(other.id, { includeInactive: true })).length, 1);
  assert.ok(await repository.productVariants.getById(ghostUsed.id), 'hareketli hayalet silinmedi');
});
