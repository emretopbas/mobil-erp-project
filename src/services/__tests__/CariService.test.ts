// Cari defter (CariService + FinanceService/OrderService/PurchaseService
// entegrasyonu): tek kaynak `cari_movement`. Çalıştırma:
// `node scripts/run-ts-tests.mjs CariService`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeRepository } from './fakeRepository.ts';
import { CariService } from '../CariService.ts';
import { FinanceService } from '../FinanceService.ts';
import { OrderService } from '../OrderService.ts';
import { PurchaseService } from '../PurchaseService.ts';
import type { ActorContext } from '../context.ts';
import type { EmployeeRole } from '../../models/index.ts';
import { returnBalanceNotice } from '../../lib/cari.ts';

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
    cari: new CariService(),
    finance: new FinanceService(),
    orders: new OrderService(),
    purchases: new PurchaseService(),
    cust: { type: 'customer' as const, id: customer.id },
    acct: { type: 'account' as const, id: account.id },
  };
}
type S = Awaited<ReturnType<typeof setup>>;

/** Perviz'e 3 × 100,00 = 300,00 brüt bir sipariş (henüz sevk edilmemiş). */
async function makeOrder(s: S, discount?: { type: 'amount' | 'percent'; value: number }) {
  const order = await s.orders.createWithLines(
    s.ctx,
    { customer_id: s.customer.id, currency: 'USD' },
    [{ product_id: s.product.id, lines: [{ variant_id: s.variant.id, quantity: 3, unit_price_minor: 10000 }] }],
    discount,
  );
  return order;
}
async function ship(s: S, orderId: string) {
  // sevk stok düşer: stok kaydı olmadığı için negatife izin ver.
  await s.repository.business.update(s.ctx.business.id, { allow_negative_stock: 1 });
  s.ctx.business.allow_negative_stock = 1;
  await s.orders.setStatus(s.ctx, orderId, 'shipped');
}
const balance = async (s: S, contact: S['cust'] | S['acct']) => (await s.cari.ledger(s.ctx, contact)).balanceMinor;
const now = () => new Date().toISOString();

// ─── Sevkiyat ─────────────────────────────────────────────────────────

test('borç sipariş oluşturulunca değil SEVKİYATTA doğar; taslak/onaylı sipariş bakiyeye girmez', async () => {
  const s = await setup();
  const order = await makeOrder(s);
  assert.equal(await balance(s, s.cust), 0);
  await s.orders.confirm(s.ctx, order.id);
  assert.equal(await balance(s, s.cust), 0);
  await ship(s, order.id);
  assert.equal(await balance(s, s.cust), 30000);
  const { entries } = await s.cari.ledger(s.ctx, s.cust);
  assert.deepEqual(entries.map((e) => [e.type, e.side, e.source_type, e.source_id]), [['shipment', 'debit', 'order', order.id]]);
});

test('iskonto: brüt/iskonto/net ayrı saklanır; cariye NET tutar yazılır (%10)', async () => {
  const s = await setup();
  const order = await makeOrder(s, { type: 'percent', value: 1000 });
  const saved = await s.repository.orders.getById(order.id);
  assert.deepEqual(
    [saved?.gross_total_minor, saved?.discount_type, saved?.discount_value, saved?.discount_amount_minor, saved?.net_total_minor],
    [30000, 'percent', 1000, 3000, 27000],
  );
  await ship(s, order.id);
  assert.equal(await balance(s, s.cust), 27000);
});

test('tutar iskontosu brüt tutarı aşamaz; sevk edilmiş siparişin iskontosu değiştirilemez', async () => {
  const s = await setup();
  const order = await makeOrder(s);
  await assert.rejects(() => s.orders.saveLines(s.ctx, order.id, [{ product_id: s.product.id, lines: [{ variant_id: s.variant.id, quantity: 1, unit_price_minor: 100 }] }], { type: 'amount', value: 500 }), /aşamaz/);
  await s.orders.saveLines(s.ctx, order.id, [{ product_id: s.product.id, lines: [{ variant_id: s.variant.id, quantity: 1, unit_price_minor: 10000 }] }], { type: 'amount', value: 500 });
  assert.equal((await s.repository.orders.getById(order.id))?.net_total_minor, 9500);
  await ship(s, order.id);
  await assert.rejects(() => s.orders.saveLines(s.ctx, order.id, [], null), /Sevk edilmiş/);
});

test('sevk edilmiş sipariş iptal edilirse eski hareket düzenlenmez, ters hareket eklenir', async () => {
  const s = await setup();
  const order = await makeOrder(s);
  await ship(s, order.id);
  const before = (await s.cari.ledger(s.ctx, s.cust)).entries[0];
  await s.orders.softDelete(s.ctx, order.id);
  const { entries, balanceMinor } = await s.cari.ledger(s.ctx, s.cust);
  assert.equal(balanceMinor, 0);
  assert.equal(entries.length, 2);
  assert.ok(entries.some((e) => e.id === before.id && e.amount_minor === 30000 && e.side === 'debit'), 'orijinal hareket dokunulmadı');
  const reversal = entries.find((e) => e.type === 'reversal');
  assert.deepEqual([reversal?.side, reversal?.amount_minor, reversal?.reverses_id], ['credit', 30000, before.id]);
});

test('sevkiyat geri alınırsa ters hareket; yeniden sevk edilirse yeniden borç (idempotent)', async () => {
  const s = await setup();
  const order = await makeOrder(s);
  await ship(s, order.id);
  await s.orders.setStatus(s.ctx, order.id, 'ready');
  assert.equal(await balance(s, s.cust), 0);
  await s.orders.setStatus(s.ctx, order.id, 'shipped');
  assert.equal(await balance(s, s.cust), 30000);
  await s.orders.setStatus(s.ctx, order.id, 'shipped');
  assert.equal(await balance(s, s.cust), 30000, 'aynı durumu tekrar ayarlamak çift borç yazmaz');
});

// ─── Tahsilat: üç giriş, tek kayıt tipi ────────────────────────────────

test('para ekranı, müşteri ekranı ve sipariş referanslı tahsilat AYNI kayıt tipini üretir ve bakiyeyi düşürür', async () => {
  const s = await setup();
  const order = await makeOrder(s);
  await ship(s, order.id);
  const base = { source: 'manual' as const, currency: 'USD', date: now(), payment_method: 'cash' as const };
  await s.finance.createRevenue(s.ctx, { ...base, amount_minor: 5000, related_customer_id: s.customer.id }); // Para ekranı
  await s.finance.createRevenue(s.ctx, { ...base, amount_minor: 4000, related_customer_id: s.customer.id, note: 'müşteri ekranı' });
  await s.finance.createRevenue(s.ctx, { ...base, source: 'order', amount_minor: 3000, related_order_id: order.id }); // sipariş referansı
  const { entries, balanceMinor } = await s.cari.ledger(s.ctx, s.cust);
  assert.equal(balanceMinor, 30000 - 12000);
  const collections = entries.filter((e) => e.type === 'collection');
  assert.equal(collections.length, 3);
  assert.ok(collections.every((e) => e.side === 'credit' && e.source_type === 'cash_entry'));
});

test('siparişe bağlı tahsilat siparişe DAĞITILMAZ: fazla tahsilat bakiyeyi eksiye (alacak) geçirir', async () => {
  const s = await setup();
  const order = await makeOrder(s);
  await ship(s, order.id);
  await s.finance.createRevenue(s.ctx, { source: 'order', related_order_id: order.id, amount_minor: 35000, currency: 'USD', date: now(), payment_method: 'cash' });
  assert.equal(await balance(s, s.cust), -5000);
});

test('kimden/kime seçilmeden gelir-gider yazılamaz; "Cari dışı" bilinçli seçilir ve gelirde kategori ister', async () => {
  const s = await setup();
  const base = { currency: 'USD', date: now(), payment_method: 'cash' as const, amount_minor: 1000 };
  await assert.rejects(() => s.finance.createRevenue(s.ctx, { ...base, source: 'manual' }), /Kimden\/Kime/);
  await assert.rejects(() => s.finance.createExpense(s.ctx, { ...base, category: 'other' }), /Kimden\/Kime/);
  await assert.rejects(() => s.finance.createRevenue(s.ctx, { ...base, source: 'manual', cari_excluded: true }), /kategori/);
  const ok = await s.finance.createRevenue(s.ctx, { ...base, source: 'manual', cari_excluded: true, category: 'interest' });
  assert.deepEqual([ok.entry.cari_excluded, ok.entry.category, ok.entry.related_customer_id], [1, 'interest', null]);
  await s.finance.createExpense(s.ctx, { ...base, category: 'rent', cari_excluded: true });
  await assert.rejects(() => s.finance.createRevenue(s.ctx, { ...base, source: 'manual', cari_excluded: true, category: 'other', related_customer_id: s.customer.id }), /Cari dışı/);
  assert.equal((await s.repository.cariMovements.listByBusiness(s.ctx.business.id)).length, 0, 'cari dışı kayıt cari hareket yazmaz');
});

test('kasa + cari tek işlemde: cari yazılamazsa kasa kaydı da geri alınır', async () => {
  const s = await setup();
  await assert.rejects(() =>
    s.finance.createRevenue(s.ctx, { source: 'manual', related_customer_id: s.customer.id, amount_minor: 5000, currency: 'TRY', date: now(), payment_method: 'cash' }),
  );
  assert.equal((await s.repository.revenues.listByBusiness(s.ctx.business.id)).length, 0);
  assert.equal((await s.repository.cariMovements.listByBusiness(s.ctx.business.id)).length, 0);
});

test('USD cariye TL tahsilat: kur sorulur, kasaya TL, cariye USD karşılığı yazılır', async () => {
  const s = await setup();
  const input = { source: 'manual' as const, related_customer_id: s.customer.id, amount_minor: 100000, currency: 'TRY', date: now(), payment_method: 'cash' as const };
  await assert.rejects(() => s.finance.createRevenue(s.ctx, input), /Kur gerekli/);
  await s.finance.createRevenue(s.ctx, { ...input, exchange_rate: 0.03 });
  const [revenue] = await s.repository.revenues.listByBusiness(s.ctx.business.id);
  assert.deepEqual([revenue.amount_minor, revenue.currency], [100000, 'TRY']);
  const [m] = (await s.cari.ledger(s.ctx, s.cust)).entries;
  assert.deepEqual([m.amount_minor, m.currency, m.exchange_rate, m.amount_in_cari_minor], [100000, 'TRY', 0.03, 3000]);
  assert.equal(await balance(s, s.cust), -3000, 'bakiye USD olarak düşer');
});

// ─── Bakiye kapatma ───────────────────────────────────────────────────

test('bakiye kapatma: gerekçe zorunlu, ayrı hareket, sipariş tutarları değişmez, kısmi kapatılabilir', async () => {
  const s = await setup();
  const order = await makeOrder(s);
  await ship(s, order.id);
  await s.finance.createRevenue(s.ctx, { source: 'manual', related_customer_id: s.customer.id, amount_minor: 29400, currency: 'USD', date: now(), payment_method: 'cash' });
  assert.equal(await balance(s, s.cust), 600);
  await assert.rejects(() => s.cari.closeBalance(s.ctx, s.cust, { reason: '  ' }), /gerekçe/);
  await assert.rejects(() => s.cari.closeBalance(s.ctx, s.cust, { amount_minor: 601, reason: 'x' }), /aşamaz/);
  await s.cari.closeBalance(s.ctx, s.cust, { amount_minor: 100, reason: 'kısmi küsurat' });
  assert.equal(await balance(s, s.cust), 500);
  const close = await s.cari.closeBalance(s.ctx, s.cust, { reason: 'küsurat' });
  assert.deepEqual([close.type, close.side, close.amount_minor, close.reason, close.created_by], ['discount_close', 'credit', 500, 'küsurat', s.ctx.employee.id]);
  assert.equal(await balance(s, s.cust), 0);
  assert.equal((await s.repository.orders.getById(order.id))?.net_total_minor, 30000);
  await assert.rejects(() => s.cari.closeBalance(s.ctx, s.cust, { reason: 'yine' }), /Kapatılacak/);
});

test('alacak (bizim borcumuz) bakiyesi borç hareketiyle kapatılır', async () => {
  const s = await setup();
  const p = await s.purchases.save(s.ctx, { account_id: s.account.id, purchase_date: now(), is_received: true, lines: [{ line_type: 'product', variant_id: s.variant.id, quantity: 1, unit_cost_minor: 700 }] });
  assert.equal(p.is_received, 1);
  const close = await s.cari.closeBalance(s.ctx, s.acct, { reason: 'küsurat' });
  assert.deepEqual([close.side, close.amount_minor], ['debit', 700]);
});

test('bakiye kapatma ayrı yetki: sales ve viewer yapamaz, manager yapabilir', async () => {
  for (const role of ['sales', 'viewer', 'production'] as const) {
    const s = await setup(role);
    await assert.rejects(() => s.cari.closeBalance(s.ctx, s.cust, { reason: 'x' }));
  }
  const s = await setup('manager');
  const order = await makeOrder(s);
  await ship(s, order.id);
  await s.cari.closeBalance(s.ctx, s.cust, { reason: 'x' });
});

// ─── İade ─────────────────────────────────────────────────────────────

test('müşteri iadesi müşteriyi ALACAKLANDIRIR (tam tutar); açık bakiye bilgisi hesabı değiştirmez', async () => {
  const s = await setup();
  const order = await makeOrder(s);
  await ship(s, order.id);
  await s.finance.createRevenue(s.ctx, { source: 'manual', related_customer_id: s.customer.id, amount_minor: 24000, currency: 'USD', date: now(), payment_method: 'cash' });
  assert.equal(await balance(s, s.cust), 6000);
  assert.deepEqual(returnBalanceNotice(6000, 20000), { closesMinor: 6000, refundMinor: 14000 });
  assert.equal(returnBalanceNotice(0, 5000), null);
  assert.equal(returnBalanceNotice(-100, 5000), null);
  const m = await s.cari.recordReturn(s.ctx, { contact: s.cust, amount_minor: 20000 });
  assert.deepEqual([m.type, m.side, m.amount_minor], ['return_in', 'credit', 20000]);
  assert.equal(await balance(s, s.cust), 6000 - 20000);
});

test('tedarikçiye iade hesabı BORÇLANDIRIR', async () => {
  const s = await setup();
  const m = await s.cari.recordReturn(s.ctx, { contact: s.acct, amount_minor: 900 });
  assert.deepEqual([m.type, m.side], ['return_out', 'debit']);
});

// ─── Çek ──────────────────────────────────────────────────────────────

test('çekle tahsilat cariyi hemen alacaklandırır; karşılıksız çıkarsa yeniden borçlandırır, geri alınırsa ters hareket', async () => {
  const s = await setup();
  const { check } = await s.finance.createRevenue(s.ctx, {
    source: 'manual', related_customer_id: s.customer.id, amount_minor: 8000, currency: 'USD', date: now(), payment_method: 'check', check: { direction: 'received', due_date: now() },
  });
  assert.ok(check);
  assert.equal(await balance(s, s.cust), -8000);
  await s.finance.updateCheckStatus(s.ctx, check.id, 'bounced');
  assert.equal(await balance(s, s.cust), 0);
  const types = (await s.cari.ledger(s.ctx, s.cust)).entries.map((e) => e.type).sort();
  assert.deepEqual(types, ['check_bounce', 'collection']);
  await s.finance.updateCheckStatus(s.ctx, check.id, 'bounced');
  assert.equal((await s.cari.ledger(s.ctx, s.cust)).entries.length, 2, 'aynı durum tekrarında yeni hareket yok');
  await s.finance.updateCheckStatus(s.ctx, check.id, 'cleared');
  assert.equal(await balance(s, s.cust), -8000);
});

// ─── Satın alma ───────────────────────────────────────────────────────

test('teslim alınan satın alma hesabı ALACAKLANDIRIR, ödeme BORÇLANDIRIR, silme ters hareket yazar; bekleyen alım girmez', async () => {
  const s = await setup();
  const line = { line_type: 'product' as const, variant_id: s.variant.id, quantity: 10, unit_cost_minor: 1400 };
  const pending = await s.purchases.save(s.ctx, { account_id: s.account.id, purchase_date: now(), is_received: false, lines: [line] });
  assert.equal(await balance(s, s.acct), 0);
  await s.purchases.setReceived(s.ctx, pending.id, true);
  assert.equal(await balance(s, s.acct), -14000);
  await s.purchases.recordPayment(s.ctx, pending.id, { amount_minor: 4000, payment_method: 'cash' });
  assert.equal(await balance(s, s.acct), -10000);
  const entries = (await s.cari.ledger(s.ctx, s.acct)).entries;
  assert.deepEqual(entries.map((e) => [e.type, e.side]).sort(), [['payment', 'debit'], ['purchase', 'credit']]);

  await s.purchases.save(s.ctx, { id: pending.id, account_id: s.account.id, purchase_date: now(), is_received: true, lines: [{ ...line, quantity: 5 }] });
  assert.equal(await balance(s, s.acct), -3000, 'alım 7000\'e indi (−7000), yapılan ödeme (+4000) sabit');
  await s.purchases.softDelete(s.ctx, pending.id);
  assert.equal(await balance(s, s.acct), 4000, 'alım tamamen kapandı, geriye yapılan ödeme (borç) kaldı');
});

test('satın almanın hesabı değişirse eski hesabın alacağı ters hareketle kapanır, yenisine yazılır', async () => {
  const s = await setup();
  const other = await s.repository.accounts.create({ business_id: s.ctx.business.id, name: 'Diğer' });
  const line = { line_type: 'product' as const, variant_id: s.variant.id, quantity: 1, unit_cost_minor: 5000 };
  const p = await s.purchases.save(s.ctx, { account_id: s.account.id, purchase_date: now(), is_received: true, lines: [line] });
  await s.purchases.save(s.ctx, { id: p.id, account_id: other.id, purchase_date: now(), is_received: true, lines: [line] });
  assert.equal(await balance(s, s.acct), 0);
  assert.equal(await balance(s, { type: 'account', id: other.id }), -5000);
});

// ─── Eşleştirme ve göç doğrulaması ────────────────────────────────────

test('carisiz eski kayıtlar listelenir; cari atanınca hareket oluşur, "Cari dışı" onaylanınca listeden düşer', async () => {
  const s = await setup();
  const base = { business_id: s.ctx.business.id, currency: 'USD', date: now(), note: null, payment_method: 'cash' as const, created_by: s.ctx.employee.id };
  const rev = await s.repository.revenues.create({ ...base, source: 'manual', amount_minor: 7000 });
  const exp = await s.repository.expenses.create({ ...base, category: 'other', amount_minor: 2000 });
  const emp = await s.repository.expenses.create({ ...base, category: 'labor', amount_minor: 1500, related_employee_id: s.ctx.employee.id });
  void emp;
  assert.equal((await s.cari.pendingEntries(s.ctx)).length, 2, 'çalışana bağlı kayıt cari değildir, beklemez');

  await s.cari.assignEntry(s.ctx, { kind: 'revenue', entryId: rev.id, target: { contact: s.cust } });
  assert.equal(await balance(s, s.cust), -7000);
  assert.equal((await s.repository.revenues.getById(rev.id))?.related_customer_id, s.customer.id);
  await assert.rejects(() => s.cari.assignEntry(s.ctx, { kind: 'revenue', entryId: rev.id, target: { contact: s.cust } }), /zaten/);

  await assert.rejects(() => s.cari.assignEntry(s.ctx, { kind: 'expense', entryId: exp.id, target: { excluded: true } }).then(() => s.cari.assignEntry(s.ctx, { kind: 'expense', entryId: exp.id, target: { excluded: true } })), /zaten/);
  assert.equal((await s.cari.pendingEntries(s.ctx)).length, 0);
});

test('göç doğrulama raporu: eski (siparişler − sipariş tahsilatı) ile yeni defter arasındaki farkı listeler', async () => {
  const s = await setup();
  const order = await makeOrder(s);
  const draft = await makeOrder(s);
  void draft;
  await ship(s, order.id);
  await s.finance.createRevenue(s.ctx, { source: 'manual', related_customer_id: s.customer.id, amount_minor: 6000, currency: 'USD', date: now(), payment_method: 'cash' });
  const rows = await s.cari.migrationReport(s.ctx);
  const row = rows.find((r) => r.contact.id === s.customer.id)!;
  // eski: iki sipariş (sevk + taslak) 60000, sipariş tahsilatı yok → 60000; yeni: 30000 − 6000
  assert.deepEqual([row.legacyMinor, row.ledgerMinor, row.diffMinor], [60000, 24000, -36000]);
});

test('bakiyeler listesi ve okuma yetkisi: viewer okur, yazamaz', async () => {
  const s = await setup('viewer');
  const map = await s.cari.balances(s.ctx, 'customer');
  assert.equal(map.get(s.customer.id)?.balanceMinor, 0);
  await assert.rejects(() => s.cari.recordReturn(s.ctx, { contact: s.cust, amount_minor: 100 }));
});
