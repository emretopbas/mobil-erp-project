// Negative-stock guard (CLAUDE.md §5.1, §8). Same caveat as
// EmployeeService.test.ts: StockService imports the RBAC barrel via
// `from './rbac'`, which Node's bare ESM loader can't resolve
// (ERR_UNSUPPORTED_DIR_IMPORT) without a bundler-aware resolver — Metro
// handles it fine, this is a test-runner gap, not an app bug. See
// progress.md; wire up jest-expo to actually execute this.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeRepository } from './fakeRepository.ts';
import { StockService, NegativeStockError } from '../StockService.ts';
import type { ActorContext } from '../context.ts';

async function setup() {
  const repository = createFakeRepository();
  const business = await repository.business.create({ name: 'Test Co', base_currency: 'TRY', plan_tier: 'solo' });
  const owner = await repository.employees.create({
    business_id: business.id,
    firebase_uid: 'uid-owner',
    display_name: 'Owner',
    email: null,
    phone: null,
    role: 'owner',
  });
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
  });
  const service = new StockService();
  const ctx: ActorContext = { employee: owner, business, repository };
  return { repository, ctx, variant, service };
}

test('an "in" movement raises on_hand', async () => {
  const { service, ctx, variant, repository } = await setup();
  await service.recordMovement(ctx, { variant_id: variant.id, type: 'in', quantity: 10 });
  const level = await repository.stockLevels.get(variant.id);
  assert.equal(level?.on_hand, 10);
});

test('an "out" movement larger than on_hand is rejected by default (§5.1)', async () => {
  const { service, ctx, variant, repository } = await setup();
  await service.recordMovement(ctx, { variant_id: variant.id, type: 'in', quantity: 5 });
  await assert.rejects(
    () => service.recordMovement(ctx, { variant_id: variant.id, type: 'out', quantity: 6 }),
    NegativeStockError,
  );
  // Rejected — on_hand must be unchanged, and no movement row was written.
  const level = await repository.stockLevels.get(variant.id);
  assert.equal(level?.on_hand, 5);
  const history = await service.history(ctx, variant.id);
  assert.equal(history.length, 1);
});

test('an "out" movement that exactly empties stock is allowed', async () => {
  const { service, ctx, variant, repository } = await setup();
  await service.recordMovement(ctx, { variant_id: variant.id, type: 'in', quantity: 5 });
  await service.recordMovement(ctx, { variant_id: variant.id, type: 'out', quantity: 5 });
  const level = await repository.stockLevels.get(variant.id);
  assert.equal(level?.on_hand, 0);
});

test('per-call allowNegative overrides the guard regardless of the business setting', async () => {
  const { service, ctx, variant, repository } = await setup();
  await service.recordMovement(ctx, { variant_id: variant.id, type: 'out', quantity: 3, allowNegative: true });
  const level = await repository.stockLevels.get(variant.id);
  assert.equal(level?.on_hand, -3);
});

test('business.allow_negative_stock=1 lets an out movement go negative with no per-call override', async () => {
  const { service, ctx, variant, repository } = await setup();
  const permissiveCtx = { ...ctx, business: { ...ctx.business, allow_negative_stock: 1 as const } };
  await service.recordMovement(permissiveCtx, { variant_id: variant.id, type: 'out', quantity: 4 });
  const level = await repository.stockLevels.get(variant.id);
  assert.equal(level?.on_hand, -4);
});
