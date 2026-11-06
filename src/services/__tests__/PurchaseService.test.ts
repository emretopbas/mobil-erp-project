// Satın Almalar v2 iş kuralları (şartname §4/§5): stoğa yalnızca MİKTAR
// işlenir, "teslim alındı" kapalıyken stok değişmez, teslim alınmış bir satın
// alma düzenlenince/silinince stok ters kayıtla düzeltilir (üzerine
// yazılmaz), fiyat hiçbir stok/maliyet alanına yansımaz.
//
// Çalıştırma: `node scripts/run-ts-tests.mjs PurchaseService` — dosyalar
// TypeScript parametre-özelliği ve dizin import'ları kullandığı için çıplak
// `node --test` yerine önce transpile eden bu yardımcıyla koşar (jest-expo
// hâlâ kurulu değil; aynı yardımcı diğer __tests__ dosyalarını da çalıştırır).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeRepository } from './fakeRepository.ts';
import { PurchaseService } from '../PurchaseService.ts';
import type { ActorContext } from '../context.ts';
import type { EmployeeRole } from '../../models/index.ts';

async function setup(role: EmployeeRole = 'owner') {
  const repository = createFakeRepository();
  const business = await repository.business.create({ name: 'Test Co', base_currency: 'TRY', plan_tier: 'solo' });
  const employee = await repository.employees.create({
    business_id: business.id,
    firebase_uid: 'uid-1',
    display_name: 'Tester',
    email: null,
    phone: null,
    role,
  });
  const account = await repository.accounts.create({ business_id: business.id, name: 'Tedarikçi' });
  const product = await repository.products.create({
    business_id: business.id,
    name: 'Bot',
    sku: 'BOT-1',
    base_price_minor: 10000,
    currency: 'TRY',
  });
  const variant = await repository.productVariants.create({
    product_id: product.id,
    business_id: business.id,
    attributes: '{}',
    sku: 'BOT-1-42',
    variant_key: '',
    cost_price_minor: 777,
  });
  const material = await repository.materials.create({ business_id: business.id, name: 'Siyah dana derisi', unit: 'm²' });
  const ctx: ActorContext = { employee, business, repository };
  const service = new PurchaseService();
  const base = { account_id: account.id, purchase_date: '2026-09-20T00:00:00.000Z' };
  return { repository, ctx, service, account, variant, material, base };
}

const materialLine = (material_id: string, quantity: number, unit_cost_minor = 0) => ({
  line_type: 'material' as const,
  material_id,
  quantity,
  unit_cost_minor,
});
const productLine = (variant_id: string, quantity: number, unit_cost_minor = 0) => ({
  line_type: 'product' as const,
  variant_id,
  quantity,
  unit_cost_minor,
});

test('received material purchase raises stock by the (decimal) quantity and writes a ledger row', async () => {
  const { service, ctx, repository, material, base } = await setup();
  const p = await service.save(ctx, { ...base, is_received: true, lines: [materialLine(material.id, 2.5, 400)] });
  assert.equal((await repository.materials.getById(material.id))?.stock_quantity, 2.5);
  const moves = await repository.materialMovements.listByPurchase(p.id);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].quantity, 2.5);
  assert.equal(moves[0].reason, 'purchase_received');
  assert.equal(p.is_received, 1);
  assert.ok(p.received_at);
  assert.equal(p.status, 'received');
});

test('unreceived purchase leaves stock alone; marking it received later books it exactly once', async () => {
  const { service, ctx, repository, material, variant, base } = await setup();
  const p = await service.save(ctx, { ...base, is_received: false, lines: [materialLine(material.id, 4), productLine(variant.id, 6)] });
  assert.equal(p.is_received, 0);
  assert.equal((await repository.materials.getById(material.id))?.stock_quantity, 0);
  assert.equal(await repository.stockLevels.get(variant.id), null);
  assert.equal((await repository.stockMovements.listByPurchase(p.id)).length, 0);

  await service.setReceived(ctx, p.id, true);
  assert.equal((await repository.materials.getById(material.id))?.stock_quantity, 4);
  assert.equal((await repository.stockLevels.get(variant.id))?.on_hand, 6);

  // Idempotent: receiving again must not double-book.
  await service.setReceived(ctx, p.id, true);
  assert.equal((await repository.materials.getById(material.id))?.stock_quantity, 4);
  assert.equal((await repository.stockLevels.get(variant.id))?.on_hand, 6);
  assert.equal((await repository.stockMovements.listByPurchase(p.id)).length, 1);
});

test('price is stored on the line only — never touches variant cost_price or stock', async () => {
  const { service, ctx, repository, variant, base } = await setup();
  const p = await service.save(ctx, { ...base, is_received: true, lines: [productLine(variant.id, 3, 99999)] });
  const v = await repository.productVariants.getById(variant.id);
  assert.equal(v?.cost_price_minor, 777, 'cost_price_minor must be unchanged');
  assert.equal((await repository.stockLevels.get(variant.id))?.on_hand, 3, 'only quantity reaches stock');
  const lines = await service.lines(ctx, p.id);
  assert.equal(lines[0].unit_cost_minor, 99999);
  assert.equal(lines[0].line_total_minor, 3 * 99999);
});

test('editing a received purchase corrects stock with reverse/diff movements, never an overwrite', async () => {
  const { service, ctx, repository, variant, material, base } = await setup();
  const p = await service.save(ctx, { ...base, is_received: true, lines: [productLine(variant.id, 10), materialLine(material.id, 5)] });
  assert.equal((await repository.stockLevels.get(variant.id))?.on_hand, 10);

  // 10 → 6 pieces, material 5 → 7.5, edit through the same save().
  await service.save(ctx, { ...base, id: p.id, is_received: true, lines: [productLine(variant.id, 6), materialLine(material.id, 7.5)] });
  assert.equal((await repository.stockLevels.get(variant.id))?.on_hand, 6);
  assert.equal((await repository.materials.getById(material.id))?.stock_quantity, 7.5);

  const history = await repository.stockMovements.listByPurchase(p.id);
  assert.deepEqual(
    history.map((m) => [m.type, m.quantity, m.reason]),
    [
      ['in', 10, 'purchase_received'],
      ['out', 4, 'purchase_adjusted'],
    ],
    'original row untouched, correction appended',
  );
  const matHistory = await repository.materialMovements.listByPurchase(p.id);
  assert.deepEqual(matHistory.map((m) => m.quantity), [5, 2.5]);
});

test('removing a line from a received purchase reverses just that line', async () => {
  const { service, ctx, repository, variant, material, base } = await setup();
  const p = await service.save(ctx, { ...base, is_received: true, lines: [productLine(variant.id, 10), materialLine(material.id, 5)] });
  await service.save(ctx, { ...base, id: p.id, is_received: true, lines: [materialLine(material.id, 5)] });
  assert.equal((await repository.stockLevels.get(variant.id))?.on_hand, 0);
  assert.equal((await repository.materials.getById(material.id))?.stock_quantity, 5);
});

test('deleting a received purchase reverses its stock with ledger rows and soft-deletes it', async () => {
  const { service, ctx, repository, variant, material, base } = await setup();
  const p = await service.save(ctx, { ...base, is_received: true, lines: [productLine(variant.id, 10), materialLine(material.id, 2.5)] });
  await service.softDelete(ctx, p.id);
  assert.equal((await repository.stockLevels.get(variant.id))?.on_hand, 0);
  assert.equal((await repository.materials.getById(material.id))?.stock_quantity, 0);
  const history = await repository.stockMovements.listByPurchase(p.id);
  assert.equal(history.length, 2, 'in + reverse out, nothing deleted from the ledger');
  assert.equal(history[1].reason, 'purchase_reversed');
  assert.ok((await repository.purchases.getById(p.id))?.deleted_at);
  assert.equal((await service.list(ctx)).length, 0);
});

test('deleting a pending purchase writes no stock movements', async () => {
  const { service, ctx, repository, variant, base } = await setup();
  const p = await service.save(ctx, { ...base, is_received: false, lines: [productLine(variant.id, 10)] });
  await service.softDelete(ctx, p.id);
  assert.equal((await repository.stockMovements.listByPurchase(p.id)).length, 0);
});

test('un-receiving reverses; re-receiving books again', async () => {
  const { service, ctx, repository, variant, base } = await setup();
  const p = await service.save(ctx, { ...base, is_received: true, lines: [productLine(variant.id, 8)] });
  await service.setReceived(ctx, p.id, false);
  assert.equal((await repository.stockLevels.get(variant.id))?.on_hand, 0);
  assert.equal((await repository.purchases.getById(p.id))?.received_at, null);
  await service.setReceived(ctx, p.id, true);
  assert.equal((await repository.stockLevels.get(variant.id))?.on_hand, 8);
});

test('reversal is allowed even when it drives on_hand negative (a correction must always go through)', async () => {
  const { service, ctx, repository, variant, base } = await setup();
  const p = await service.save(ctx, { ...base, is_received: true, lines: [productLine(variant.id, 10)] });
  // 8 of the 10 already left the building.
  await repository.stockMovements.create({ business_id: ctx.business.id, variant_id: variant.id, type: 'out', quantity: 8, reason: null, note: null, created_by: ctx.employee.id });
  await repository.stockLevels.upsert({ variant_id: variant.id, on_hand: 2, low_stock_threshold: 0, reorder_quantity: 0 });
  await service.softDelete(ctx, p.id);
  assert.equal((await repository.stockLevels.get(variant.id))?.on_hand, -8);
});

test('balance is computed from stored line totals (decimal quantity × price)', async () => {
  const { service, ctx, material, base } = await setup();
  const p = await service.save(ctx, { ...base, is_received: false, lines: [materialLine(material.id, 2.5, 400)] });
  const b = await service.balance(ctx, p.id);
  assert.equal(b.totalMinor, 1000);
  assert.equal(b.balanceMinor, 1000);
});

test('line validation: exactly one target, positive quantity, whole pieces for products', async () => {
  const { service, ctx, variant, material, base } = await setup();
  const bad = (lines: Parameters<typeof service.save>[1]['lines']) => service.save(ctx, { ...base, is_received: false, lines });
  await assert.rejects(() => bad([]));
  await assert.rejects(() => bad([materialLine(material.id, 0)]));
  await assert.rejects(() => bad([materialLine(material.id, -1)]));
  await assert.rejects(() => bad([{ line_type: 'material', material_id: material.id, variant_id: variant.id, quantity: 1, unit_cost_minor: 0 }]));
  await assert.rejects(() => bad([{ line_type: 'product', material_id: material.id, quantity: 1, unit_cost_minor: 0 }]));
  await assert.rejects(() => bad([productLine(variant.id, 1.5)]));
  await assert.rejects(() => bad([materialLine(material.id, 1, -5)]));
});

test('RBAC: a viewer cannot save a purchase', async () => {
  const { service, ctx, material, base } = await setup('viewer');
  await assert.rejects(() => service.save(ctx, { ...base, is_received: false, lines: [materialLine(material.id, 1)] }));
});
