// Sevkiyat ↔ stok eşitlemesi (OrderService.reconcileShipmentStock) ve
// silme/rol yetkileri (product feedback: "owner/manager yapılan satışları,
// alımları, siparişleri, girilen ödemeleri silebilmeli"). Çalıştırma:
// `node scripts/run-ts-tests.mjs OrderShipment`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeRepository } from './fakeRepository.ts';
import { OrderService } from '../OrderService.ts';
import { PurchaseService } from '../PurchaseService.ts';
import { FinanceService } from '../FinanceService.ts';
import { CariService } from '../CariService.ts';
import { StockService } from '../StockService.ts';
import { PermissionError } from '../rbac/permissions.ts';
import type { ActorContext } from '../context.ts';
import type { EmployeeRole } from '../../models/index.ts';

async function setup(role: EmployeeRole = 'owner') {
  const repository = createFakeRepository();
  const business = await repository.business.create({ name: 'Test Co', base_currency: 'USD', plan_tier: 'solo' });
  const employee = await repository.employees.create({ business_id: business.id, firebase_uid: 'u', display_name: 'T', email: null, phone: null, role });
  const customer = await repository.customers.create({ business_id: business.id, name: 'Perviz', primary_channel: null, contact_ref: null });
  const account = await repository.accounts.create({ business_id: business.id, name: 'Topbas' });
  const product = await repository.products.create({ business_id: business.id, name: 'Bot', sku: 'B', base_price_minor: 10000, currency: 'USD' });
  const variant = await repository.productVariants.create({ product_id: product.id, business_id: business.id, attributes: '{}', sku: 'B-1', variant_key: '' });
  const ctx: ActorContext = { employee, business, repository };
  return {
    repository,
    ctx,
    customer,
    account,
    product,
    variant,
    orders: new OrderService(),
    purchases: new PurchaseService(),
    finance: new FinanceService(),
    cari: new CariService(),
    stock: new StockService(),
  };
}
type S = Awaited<ReturnType<typeof setup>>;

const now = () => new Date().toISOString();
const onHand = async (s: S) => (await s.stock.getLevel(s.ctx, s.variant.id))?.on_hand ?? 0;

async function makeOrder(s: S, qty = 3) {
  return s.orders.createWithLines(s.ctx, { customer_id: s.customer.id, currency: 'USD' }, [
    { product_id: s.product.id, lines: [{ variant_id: s.variant.id, quantity: qty, unit_price_minor: 10000 }] },
  ]);
}

// ─── Sevkiyat ↔ stok ────────────────────────────────────────────────────

test('sevkiyat stoğu düşürür, tagged related_order_id ile; aynı duruma tekrar geçiş hareket yazmaz', async () => {
  const s = await setup();
  await s.stock.recordMovement(s.ctx, { variant_id: s.variant.id, type: 'in', quantity: 10, reason: 'opening_stock' });
  const order = await makeOrder(s);
  await s.orders.setStatus(s.ctx, order.id, 'shipped');
  assert.equal(await onHand(s), 7);
  const moves = await s.repository.stockMovements.listByOrder(order.id);
  assert.equal(moves.length, 1);
  assert.deepEqual([moves[0].type, moves[0].quantity], ['out', 3]);

  await s.orders.setStatus(s.ctx, order.id, 'shipped');
  assert.equal(await onHand(s), 7, 'idempotent — ikinci kez aynı durumu yazmak tekrar düşürmez');
  assert.equal((await s.repository.stockMovements.listByOrder(order.id)).length, 1);
});

test('sevkiyattan geri alma (shipped → ready) stoğu geri yazar', async () => {
  const s = await setup();
  await s.stock.recordMovement(s.ctx, { variant_id: s.variant.id, type: 'in', quantity: 10, reason: 'opening_stock' });
  const order = await makeOrder(s);
  await s.orders.setStatus(s.ctx, order.id, 'shipped');
  assert.equal(await onHand(s), 7);
  await s.orders.setStatus(s.ctx, order.id, 'ready');
  assert.equal(await onHand(s), 10);
  const moves = await s.repository.stockMovements.listByOrder(order.id);
  assert.equal(moves.length, 2);
  assert.deepEqual(moves.map((m) => m.type).sort(), ['in', 'out']);
});

test('sevk edilmiş bir siparişi silmek stoğu VE cari borcu ters hareketle geri alır', async () => {
  const s = await setup();
  await s.stock.recordMovement(s.ctx, { variant_id: s.variant.id, type: 'in', quantity: 10, reason: 'opening_stock' });
  const order = await makeOrder(s);
  await s.orders.setStatus(s.ctx, order.id, 'shipped');
  assert.equal(await onHand(s), 7);
  assert.equal((await s.cari.ledger(s.ctx, { type: 'customer', id: s.customer.id })).balanceMinor, 30000);

  await s.orders.softDelete(s.ctx, order.id);
  assert.equal(await onHand(s), 10, 'stok eski haline döndü');
  const ledger = await s.cari.ledger(s.ctx, { type: 'customer', id: s.customer.id });
  assert.equal(ledger.balanceMinor, 0, 'cari borç ters hareketle kapandı');
  assert.equal(ledger.entries.length, 2, 'orijinal borç hareketi SİLİNMEDİ, üstüne ters hareket eklendi');
});

test('taslak bir siparişi silmek stok hareketi yazmaz (zaten düşmemişti)', async () => {
  const s = await setup();
  await s.stock.recordMovement(s.ctx, { variant_id: s.variant.id, type: 'in', quantity: 10, reason: 'opening_stock' });
  const order = await makeOrder(s);
  await s.orders.softDelete(s.ctx, order.id);
  assert.equal(await onHand(s), 10);
  assert.equal((await s.repository.stockMovements.listByOrder(order.id)).length, 0);
});

// ─── Silme yetkisi: yalnızca owner/manager ─────────────────────────────

test('sales taslak bir siparişi bile silemez; owner ve manager her durumda silebilir', async () => {
  const draftOwner = await setup('owner');
  const order = await makeOrder(draftOwner);

  const sSales = await setup('sales');
  await assert.rejects(() => sSales.orders.softDelete(sSales.ctx, order.id), PermissionError);

  const sManager = await setup('manager');
  await assert.doesNotReject(() => sManager.orders.softDelete(sManager.ctx, order.id));
  void draftOwner;
});

test('production bir alımı teslim alabilir ama silemez; owner silebilir', async () => {
  const s = await setup('production');
  const p = await s.purchases.save(s.ctx, {
    account_id: s.account.id,
    purchase_date: now(),
    is_received: true,
    lines: [{ line_type: 'product', variant_id: s.variant.id, quantity: 1, unit_cost_minor: 500 }],
  });
  assert.equal(p.is_received, 1);
  await assert.rejects(() => s.purchases.softDelete(s.ctx, p.id), PermissionError);

  const sOwner = await setup('owner');
  const p2 = await sOwner.purchases.save(sOwner.ctx, {
    account_id: sOwner.account.id,
    purchase_date: now(),
    is_received: true,
    lines: [{ line_type: 'product', variant_id: sOwner.variant.id, quantity: 1, unit_cost_minor: 500 }],
  });
  await assert.doesNotReject(() => sOwner.purchases.softDelete(sOwner.ctx, p2.id));
});

// ─── Girilen ödemelerin silinmesi (FinanceService.voidRevenue/voidExpense) ──

test('bir tahsilat silinince kayıt soft-delete edilir ve cari etkisi ters hareketle sıfırlanır', async () => {
  const s = await setup();
  const { entry } = await s.finance.createRevenue(s.ctx, {
    source: 'manual',
    related_customer_id: s.customer.id,
    amount_minor: 5000,
    currency: 'USD',
    date: now(),
    payment_method: 'cash',
  });
  assert.equal((await s.cari.ledger(s.ctx, { type: 'customer', id: s.customer.id })).balanceMinor, -5000);

  await s.finance.voidRevenue(s.ctx, entry.id);
  const ledger = await s.cari.ledger(s.ctx, { type: 'customer', id: s.customer.id });
  assert.equal(ledger.balanceMinor, 0);
  assert.equal(ledger.entries.length, 2, 'orijinal tahsilat hareketi kalır, ters hareket eklenir');
  assert.equal((await s.repository.revenues.listByBusiness(s.ctx.business.id)).length, 0, 'soft-delete edilen kayıt listede görünmez');
  const raw = await s.repository.revenues.getById(entry.id);
  assert.ok(raw?.deleted_at);
});

test('çekle girilmiş bir ödeme silinince bağlı çek de soft-delete edilir', async () => {
  const s = await setup();
  const { entry, check } = await s.finance.createExpense(s.ctx, {
    category: 'other',
    related_account_id: s.account.id,
    amount_minor: 4000,
    currency: 'USD',
    date: now(),
    payment_method: 'check',
    check: { direction: 'issued', due_date: now() },
  });
  assert.ok(check);
  await s.finance.voidExpense(s.ctx, entry.id);
  const rawCheck = await s.repository.checks.getById(check!.id);
  assert.ok(rawCheck?.deleted_at);
});

test('girilen bir ödemeyi silme yetkisi finance:delete ile sınırlı — sales/production/viewer reddedilir, owner/manager geçer', async () => {
  const owner = await setup('owner');
  const { entry } = await owner.finance.createRevenue(owner.ctx, {
    source: 'manual',
    related_customer_id: owner.customer.id,
    amount_minor: 1000,
    currency: 'USD',
    date: now(),
    payment_method: 'cash',
  });
  for (const role of ['sales', 'production', 'viewer'] as const) {
    const s = await setup(role);
    await assert.rejects(() => s.finance.voidRevenue(s.ctx, entry.id), PermissionError);
  }
  await assert.doesNotReject(() => owner.finance.voidRevenue(owner.ctx, entry.id));
});

test('satın almaya yapılmış bir ödeme de aynı yoldan (voidExpense) silinir ve hesabın borcunu geri getirir', async () => {
  const s = await setup();
  const p = await s.purchases.save(s.ctx, {
    account_id: s.account.id,
    purchase_date: now(),
    is_received: true,
    lines: [{ line_type: 'product', variant_id: s.variant.id, quantity: 1, unit_cost_minor: 10000 }],
  });
  await s.purchases.recordPayment(s.ctx, p.id, { amount_minor: 4000, payment_method: 'cash' });
  assert.equal((await s.cari.ledger(s.ctx, { type: 'account', id: s.account.id })).balanceMinor, -6000);

  const [payment] = await s.purchases.payments(s.ctx, p.id);
  await s.finance.voidExpense(s.ctx, payment.entry.id);
  assert.equal((await s.cari.ledger(s.ctx, { type: 'account', id: s.account.id })).balanceMinor, -10000, 'ödeme geri alındı, tüm alım borcu kaldı');
  assert.equal((await s.purchases.payments(s.ctx, p.id)).length, 0);
});

test('regresyon: bir satın alma silindikten SONRA ona yapılmış ödeme hâlâ silinebilir ("kayıt bulunamadı" hatası vermemeli)', async () => {
  // Bug: PurchaseService.softDelete sadece alımın kendi 'purchase' cari
  // hareketini (reconcileStock + syncPurchaseReceipt) geri alır — ona
  // yapılmış ödemenin ExpenseEntry'sine hiç dokunmaz, o kasıtlı olarak ayrı
  // bir kayıt kalır. Bu test o ayrımın hâlâ geçerli olduğunu, yani silinen
  // alımdan SONRA ödemenin voidExpense ile normal şekilde silinebildiğini
  // doğrular (gerçek raporlanan sorun: ikinci bir UI hatası yüzünden bu
  // çağrı "Kayıt bulunamadı" ile patlıyordu — bkz. CariLedgerView'daki
  // alreadyVoidedMovementIds düzeltmesi).
  const s = await setup();
  const p = await s.purchases.save(s.ctx, {
    account_id: s.account.id,
    purchase_date: now(),
    is_received: true,
    lines: [{ line_type: 'product', variant_id: s.variant.id, quantity: 1, unit_cost_minor: 10000 }],
  });
  await s.purchases.recordPayment(s.ctx, p.id, { amount_minor: 4000, payment_method: 'cash' });
  const [payment] = await s.purchases.payments(s.ctx, p.id);

  await s.purchases.softDelete(s.ctx, p.id);
  // Alımın kendi borcu kapandı, ödeme hâlâ ayakta — hesap şimdi fazla ödenmiş görünür.
  assert.equal((await s.cari.ledger(s.ctx, { type: 'account', id: s.account.id })).balanceMinor, 4000);
  assert.equal((await s.repository.expenses.getById(payment.entry.id))?.deleted_at, null);

  await assert.doesNotReject(() => s.finance.voidExpense(s.ctx, payment.entry.id));
  assert.equal((await s.cari.ledger(s.ctx, { type: 'account', id: s.account.id })).balanceMinor, 0);

  // İKİNCİ silme denemesi (CariLedgerView artık bu düğmeyi hiç göstermiyor —
  // ama servis katmanı da kendi başına güvenli ve anlaşılır şekilde reddetmeli).
  await assert.rejects(() => s.finance.voidExpense(s.ctx, payment.entry.id), /bulunamadı/);
});
