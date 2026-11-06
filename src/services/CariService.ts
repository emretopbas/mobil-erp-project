// Cari hesap defteri — bakiyenin TEK kaynağı `cari_movement`.
//
// İlkeler (product feedback):
//  • Bakiye = Σ borç − Σ alacak, yalnızca bu tablodan. Siparişlerden, satın
//    almalardan ya da gelir/gider tablolarından ASLA hesaplanmaz.
//  • Defter yalnızca EKLENİR. Sevk edilmiş siparişin iptali / tutar değişimi,
//    silinen satın alma vb. eski hareketi düzenlemez; yeni bir ters ('reversal')
//    hareket yazılır.
//  • Kasa hareketi + cari hareketi aynı işlemde yazılır (FinanceService).
//  • Tahsilat/ödeme siparişlere dağıtılmaz; doğrudan cari bakiyeden düşer.
//
// Olay → hareket: sevkiyat → müşteri BORÇ · tahsilat/müşteri iadesi → müşteri
// ALACAK · tedarikçiden alım → hesap ALACAK · tedarikçiye ödeme/iade → hesap BORÇ
// · karşılıksız çek → müşteri BORÇ · bakiye kapatma → bakiyeyi sıfıra yaklaştıran
// yön.
//
// `post*`/`sync*` metotları İÇ kullanım içindir: çağıran servis kendi RBAC
// kapısını zaten geçmiştir (ör. sales rolü sevkiyatı işaretleyebilir ama cari
// yazma izni yoktur). Dışarı açık metotlar (`ledger`, `recordReturn`,
// `closeBalance`, …) kendi izinlerini kontrol eder.

import type {
  CariContactType,
  CariDirection,
  CariMovement,
  CariMovementType,
  CariSourceType,
  Check,
  CurrencyCode,
  ExpenseEntry,
  RevenueCategory,
  RevenueEntry,
  UUID,
} from '../models';
import { movementsBalance, signedMovement, toCariAmount } from '../lib/cari';
import { requirePermission } from './rbac';
import type { ActorContext } from './context';

export interface CariContact {
  type: CariContactType;
  id: UUID;
}

interface PostInput {
  contact: CariContact;
  type: CariMovementType;
  side: CariDirection;
  amount_minor: number;
  currency: CurrencyCode;
  exchange_rate?: number | null;
  date?: string;
  source_type: CariSourceType;
  source_id?: UUID | null;
  reverses_id?: UUID | null;
  reason?: string | null;
}

export interface CariLedger {
  contact: CariContact;
  /** Carinin ana para birimi — bakiye daima bunda gösterilir. */
  currency: CurrencyCode;
  balanceMinor: number;
  /** Yeniden eskiye. */
  entries: CariMovement[];
}

export type PendingEntry = { kind: 'revenue'; entry: RevenueEntry } | { kind: 'expense'; entry: ExpenseEntry };

export interface MigrationReportRow {
  contact: CariContact;
  name: string;
  currency: CurrencyCode;
  /** Göç öncesi mantıkla (siparişler − siparişe bağlı tahsilatlar / eski hesap defteri) bakiye. */
  legacyMinor: number;
  /** Yeni defterden bakiye. */
  ledgerMinor: number;
  diffMinor: number;
}

const signedSum = (movements: CariMovement[]) => movementsBalance(movements);

export class CariService {
  // ─── iç: yazma ────────────────────────────────────────────────────────

  async cariCurrency(ctx: ActorContext, contact: CariContact): Promise<CurrencyCode> {
    const row = contact.type === 'customer' ? await ctx.repository.customers.getById(contact.id) : await ctx.repository.accounts.getById(contact.id);
    if (!row || row.business_id !== ctx.employee.business_id) throw new Error('Cari bulunamadı.');
    return row.currency ?? ctx.business.base_currency;
  }

  /** Tek hareket yazar. Para birimi carininkinden farklıysa kur zorunludur. */
  async post(ctx: ActorContext, input: PostInput): Promise<CariMovement> {
    if (!Number.isInteger(input.amount_minor) || input.amount_minor <= 0) throw new Error('Cari hareket tutarı sıfırdan büyük tam sayı olmalı.');
    const cariCurrency = await this.cariCurrency(ctx, input.contact);
    const { amountInCari, rate } = toCariAmount(input.amount_minor, input.currency, cariCurrency, input.exchange_rate);
    return ctx.repository.cariMovements.create({
      business_id: ctx.employee.business_id,
      contact_type: input.contact.type,
      contact_id: input.contact.id,
      movement_date: input.date ?? new Date().toISOString(),
      type: input.type,
      side: input.side,
      amount_minor: input.amount_minor,
      currency: input.currency,
      exchange_rate: rate,
      amount_in_cari_minor: amountInCari,
      source_type: input.source_type,
      source_id: input.source_id ?? null,
      reverses_id: input.reverses_id ?? null,
      reason: input.reason ?? null,
      created_by: ctx.employee.id,
    });
  }

  /** Kaynağa bağlı hareketlerin net etkisini `desired` ile eşitler (idempotent):
   * eksikse `openType` hareketi, fazlaysa ters hareket yazar. `sign`: borç
   * yönünde birikiyorsa 'debit' (sevkiyat, çek), alacak yönünde 'credit'. */
  private async reconcileSource(
    ctx: ActorContext,
    args: {
      contact: CariContact;
      sourceType: CariSourceType;
      sourceId: UUID;
      openType: CariMovementType;
      direction: CariDirection;
      desiredMinor: number;
      currency: CurrencyCode;
      date?: string;
    },
  ): Promise<void> {
    const all = await ctx.repository.cariMovements.listBySource(args.sourceType, args.sourceId);
    // `direction` yönündeki net tutar (cari para biriminde).
    const factor = args.direction === 'debit' ? 1 : -1;
    // Kaynak başka bir cariye yazılmış olabilir (satın almanın hesabı sonradan
    // değişti): eski carideki net etki ters hareketle kapatılır, yenisine yazılır.
    const sameContact = (m: CariMovement) => m.contact_type === args.contact.type && m.contact_id === args.contact.id;
    const otherContacts = new Map<string, CariMovement[]>();
    for (const m of all.filter((x) => !sameContact(x))) {
      const key = `${m.contact_type}:${m.contact_id}`;
      otherContacts.set(key, [...(otherContacts.get(key) ?? []), m]);
    }
    for (const group of otherContacts.values()) {
      const net = signedSum(group) * factor;
      if (net === 0) continue;
      await this.post(ctx, {
        contact: { type: group[0].contact_type, id: group[0].contact_id },
        type: 'reversal',
        side: net > 0 ? (args.direction === 'debit' ? 'credit' : 'debit') : args.direction,
        amount_minor: Math.abs(net),
        currency: group[0].currency === args.currency ? args.currency : group[0].currency,
        exchange_rate: group[0].exchange_rate,
        source_type: args.sourceType,
        source_id: args.sourceId,
        reverses_id: group[group.length - 1].id,
        reason: 'Cari değişti — otomatik düzeltme',
      });
    }
    const existing = all.filter(sameContact);
    const booked = signedSum(existing) * factor;
    const delta = args.desiredMinor - booked;
    if (delta === 0) return;
    if (delta > 0) {
      await this.post(ctx, {
        contact: args.contact,
        type: args.openType,
        side: args.direction,
        amount_minor: delta,
        currency: args.currency,
        date: args.date,
        source_type: args.sourceType,
        source_id: args.sourceId,
      });
    } else {
      const last = [...existing].reverse().find((m) => m.side === args.direction);
      await this.post(ctx, {
        contact: args.contact,
        type: 'reversal',
        side: args.direction === 'debit' ? 'credit' : 'debit',
        amount_minor: -delta,
        currency: args.currency,
        source_type: args.sourceType,
        source_id: args.sourceId,
        reverses_id: last?.id ?? null,
        reason: 'Otomatik düzeltme',
      });
    }
  }

  /** Sevk edilmiş sipariş → müşteri BORÇ (net tutar). Sipariş sevk edilmemişse,
   * iptal/silinmişse hedef 0: önceki borç ters hareketle kapatılır. Borç
   * sipariş oluşturulunca DEĞİL sevkiyatta doğar. */
  async syncOrderShipment(ctx: ActorContext, orderId: UUID): Promise<void> {
    const order = await ctx.repository.orders.getById(orderId);
    if (!order) return;
    const shipped = order.status === 'shipped' && !order.deleted_at;
    await this.reconcileSource(ctx, {
      contact: { type: 'customer', id: order.customer_id },
      sourceType: 'order',
      sourceId: order.id,
      openType: 'shipment',
      direction: 'debit',
      desiredMinor: shipped ? order.net_total_minor : 0,
      currency: order.currency,
    });
  }

  /** Teslim alınmış satın alma → hesap ALACAK. Teslim alınmadıysa / silindiyse 0. */
  async syncPurchaseReceipt(ctx: ActorContext, purchaseId: UUID): Promise<void> {
    const purchase = await ctx.repository.purchases.getById(purchaseId);
    if (!purchase) return;
    const lines = await ctx.repository.purchaseLines.listByPurchase(purchaseId);
    const total = lines.reduce((sum, l) => sum + l.line_total_minor, 0);
    const counted = purchase.is_received === 1 && !purchase.deleted_at;
    await this.reconcileSource(ctx, {
      contact: { type: 'account', id: purchase.account_id },
      sourceType: 'purchase',
      sourceId: purchase.id,
      openType: 'purchase',
      direction: 'credit',
      desiredMinor: counted ? total : 0,
      currency: purchase.currency,
      date: purchase.purchase_date,
    });
  }

  /** Karşılıksız çıkan (alınmış) çek → cari yeniden BORÇLANIR; durum
   * sonradan geri alınırsa ters hareket. Çeki alan carinin kim olduğu, çekin
   * bağlı olduğu gelir kaydından okunur. */
  async syncCheckBounce(ctx: ActorContext, check: Check): Promise<void> {
    if (check.direction !== 'received' || check.related_entry_type !== 'RevenueEntry') return;
    const entry = await ctx.repository.revenues.getById(check.related_entry_id);
    const contact = entry ? contactOf(entry) : null;
    if (!contact) return;
    await this.reconcileSource(ctx, {
      contact,
      sourceType: 'check',
      sourceId: check.id,
      openType: 'check_bounce',
      direction: 'debit',
      desiredMinor: check.status === 'bounced' ? check.amount_minor : 0,
      currency: check.currency,
    });
  }

  /** Gelir/gider kaydının cari etkisi: gelir → ALACAK (tahsilat), gider → BORÇ (ödeme). */
  async postCashEntry(
    ctx: ActorContext,
    args: { kind: 'revenue' | 'expense'; entry: RevenueEntry | ExpenseEntry; contact: CariContact; exchange_rate?: number | null },
  ): Promise<CariMovement> {
    return this.post(ctx, {
      contact: args.contact,
      type: args.kind === 'revenue' ? 'collection' : 'payment',
      side: args.kind === 'revenue' ? 'credit' : 'debit',
      amount_minor: args.entry.amount_minor,
      currency: args.entry.currency,
      exchange_rate: args.exchange_rate,
      date: args.entry.date,
      source_type: 'cash_entry',
      source_id: args.entry.id,
      reason: args.entry.note,
    });
  }

  /** Bir kasa hareketi (gelir/gider kaydı) silinirken/iptal edilirken çağrılır
   * — o kaydın `source_type: 'cash_entry'` ile yazdığı cari etkisini TERS
   * hareketle sıfırlar. Orijinal hareket asla silinmez/düzenlenmez (defterin
   * append-only ilkesi); `FinanceService.voidRevenue/voidExpense` bunu kaydı
   * soft-delete etmeden ÖNCE/aynı işlemde çağırır. Kayıt hiç cariye bağlı
   * değilse (carisi "Cari dışı" idiyse) hiçbir hareket bulunmaz, no-op. */
  async voidCashEntry(ctx: ActorContext, entryId: UUID, reason = 'Kayıt silindi — otomatik düzeltme'): Promise<void> {
    const all = await ctx.repository.cariMovements.listBySource('cash_entry', entryId);
    const byContact = new Map<string, CariMovement[]>();
    for (const m of all) {
      const key = `${m.contact_type}:${m.contact_id}`;
      byContact.set(key, [...(byContact.get(key) ?? []), m]);
    }
    for (const group of byContact.values()) {
      const net = signedSum(group); // borç +, alacak −
      if (net === 0) continue;
      await this.post(ctx, {
        contact: { type: group[0].contact_type, id: group[0].contact_id },
        type: 'reversal',
        side: net > 0 ? 'credit' : 'debit',
        amount_minor: Math.abs(net),
        currency: group[0].currency,
        exchange_rate: group[0].exchange_rate,
        source_type: 'cash_entry',
        source_id: entryId,
        reverses_id: group[group.length - 1].id,
        reason,
      });
    }
  }

  // ─── dışarı açık: okuma ───────────────────────────────────────────────

  async ledger(ctx: ActorContext, contact: CariContact): Promise<CariLedger> {
    requirePermission(ctx.employee.role, 'cari', 'read');
    const [currency, entries] = await Promise.all([
      this.cariCurrency(ctx, contact),
      ctx.repository.cariMovements.listByContact(contact.type, contact.id),
    ]);
    return { contact, currency, balanceMinor: movementsBalance(entries), entries };
  }

  /** Tüm carilerin bakiyesi (liste ekranları için), cari para biriminde. */
  async balances(ctx: ActorContext, contactType: CariContactType): Promise<Map<UUID, { balanceMinor: number; currency: CurrencyCode }>> {
    requirePermission(ctx.employee.role, 'cari', 'read');
    const [movements, contacts] = await Promise.all([
      ctx.repository.cariMovements.listByBusiness(ctx.employee.business_id),
      contactType === 'customer'
        ? ctx.repository.customers.listByBusiness(ctx.employee.business_id, { includeInactive: true })
        : ctx.repository.accounts.listByBusiness(ctx.employee.business_id, { includeInactive: true }),
    ]);
    const result = new Map<UUID, { balanceMinor: number; currency: CurrencyCode }>();
    for (const c of contacts) result.set(c.id, { balanceMinor: 0, currency: c.currency ?? ctx.business.base_currency });
    for (const m of movements) {
      if (m.contact_type !== contactType) continue;
      const row = result.get(m.contact_id);
      if (row) row.balanceMinor += signedMovement(m);
    }
    return result;
  }

  // ─── dışarı açık: yazma ───────────────────────────────────────────────

  /** Müşteri iadesi (müşteri ALACAK) / tedarikçiye iade (hesap BORÇ). Tutar her
   * durumda tam olarak yazılır; açık bakiye bilgisi arayüzde gösterilir
   * (`returnBalanceNotice`), hesabı değiştirmez. */
  async recordReturn(
    ctx: ActorContext,
    input: { contact: CariContact; amount_minor: number; currency?: CurrencyCode; exchange_rate?: number | null; date?: string; note?: string | null },
  ): Promise<CariMovement> {
    requirePermission(ctx.employee.role, 'cari', 'create');
    const isCustomer = input.contact.type === 'customer';
    return ctx.repository.transaction(async () => {
      const currency = input.currency ?? (await this.cariCurrency(ctx, input.contact));
      return this.post(ctx, {
        contact: input.contact,
        type: isCustomer ? 'return_in' : 'return_out',
        side: isCustomer ? 'credit' : 'debit',
        amount_minor: input.amount_minor,
        currency,
        exchange_rate: input.exchange_rate,
        date: input.date,
        source_type: 'return',
        reason: input.note ?? null,
      });
    });
  }

  /** Bakiye kapatma (küsurat): AYRI bir hareket, sipariş tutarlarına dokunmaz.
   * Bakiyeyi sıfıra yaklaştıran yönde yazılır; gerekçe zorunlu; tutar
   * varsayılan olarak tüm bakiye (kısmi kapatma için ≤ bakiye). */
  async closeBalance(ctx: ActorContext, contact: CariContact, input: { amount_minor?: number; reason: string }): Promise<CariMovement> {
    requirePermission(ctx.employee.role, 'cariClose', 'update');
    const reason = input.reason.trim();
    if (!reason) throw new Error('Bakiye kapatmak için gerekçe zorunlu.');
    return ctx.repository.transaction(async () => {
      const ledger = await this.ledger(ctx, contact);
      if (ledger.balanceMinor === 0) throw new Error('Kapatılacak bakiye yok.');
      const max = Math.abs(ledger.balanceMinor);
      const amount = input.amount_minor ?? max;
      if (!Number.isInteger(amount) || amount <= 0) throw new Error('Tutar sıfırdan büyük olmalı.');
      if (amount > max) throw new Error('Kapatma tutarı mevcut bakiyeyi aşamaz.');
      return this.post(ctx, {
        contact,
        type: 'discount_close',
        side: ledger.balanceMinor > 0 ? 'credit' : 'debit',
        amount_minor: amount,
        currency: ledger.currency,
        source_type: 'manual',
        reason,
      });
    });
  }

  // ─── eşleştirme (göç sonrası) ─────────────────────────────────────────

  /** Carisi olmayan ve "Cari dışı" onaylanmamış gelir/giderler. */
  async pendingEntries(ctx: ActorContext): Promise<PendingEntry[]> {
    requirePermission(ctx.employee.role, 'finance', 'read');
    const [revenues, expenses] = await Promise.all([
      ctx.repository.revenues.listByBusiness(ctx.employee.business_id),
      ctx.repository.expenses.listByBusiness(ctx.employee.business_id),
    ]);
    const pending = (e: RevenueEntry | ExpenseEntry) => !e.cari_excluded && !e.related_customer_id && !e.related_account_id && !e.related_employee_id;
    return [
      ...revenues.filter(pending).map((entry): PendingEntry => ({ kind: 'revenue', entry: entry as RevenueEntry })),
      ...expenses.filter(pending).map((entry): PendingEntry => ({ kind: 'expense', entry: entry as ExpenseEntry })),
    ].sort((a, b) => b.entry.date.localeCompare(a.entry.date));
  }

  /** Bekleyen kaydı bir cariye bağlar (cari hareketi oluşur) ya da "Cari dışı"
   * onaylar (yalnızca kasa hareketi kalır; gelirde kategori zorunlu). */
  async assignEntry(
    ctx: ActorContext,
    args: { kind: 'revenue' | 'expense'; entryId: UUID; target: { contact: CariContact; exchange_rate?: number | null } | { excluded: true; category?: RevenueCategory | null } },
  ): Promise<void> {
    requirePermission(ctx.employee.role, 'finance', 'update');
    await ctx.repository.transaction(async () => {
      const entry = args.kind === 'revenue' ? await ctx.repository.revenues.getById(args.entryId) : await ctx.repository.expenses.getById(args.entryId);
      if (!entry || entry.business_id !== ctx.employee.business_id || entry.deleted_at) throw new Error('Kayıt bulunamadı.');
      if (entry.cari_excluded || entry.related_customer_id || entry.related_account_id || entry.related_employee_id) throw new Error('Bu kaydın carisi zaten belirlenmiş.');
      if ('excluded' in args.target) {
        if (args.kind === 'revenue') {
          if (!args.target.category) throw new Error('Cari dışı gelir için kategori seçin.');
          await ctx.repository.revenues.update(entry.id, { cari_excluded: 1, category: args.target.category });
        } else {
          await ctx.repository.expenses.update(entry.id, { cari_excluded: 1 });
        }
        return;
      }
      const { contact } = args.target;
      const link = contact.type === 'customer' ? { related_customer_id: contact.id } : { related_account_id: contact.id };
      // Önce hareketi yaz (kur eksikse burada patlar), sonra bağlantıyı işle.
      await this.postCashEntry(ctx, { kind: args.kind, entry: entry as RevenueEntry | ExpenseEntry, contact, exchange_rate: args.target.exchange_rate });
      if (args.kind === 'revenue') await ctx.repository.revenues.update(entry.id, link);
      else await ctx.repository.expenses.update(entry.id, link);
    });
  }

  // ─── göç doğrulaması ──────────────────────────────────────────────────

  /** Eski bakiye mantığı ile yeni defteri tüm cariler için karşılaştırır
   * (spec §7.7). Eski müşteri bakiyesi = tüm siparişlerin brüt toplamı −
   * siparişe bağlı tahsilatlar; eski hesap bakiyesi = teslim alınmış alımlar
   * (alacak) − hesaba/alıma bağlı ödemeler + hesaba bağlı gelirler. Fark, göçün
   * bilinçli değişiklikleridir: taslak siparişler artık sayılmaz, para
   * ekranından bağlanan tahsilatlar artık bakiyeye girer, iskonto net tutar. */
  async migrationReport(ctx: ActorContext): Promise<MigrationReportRow[]> {
    requirePermission(ctx.employee.role, 'cari', 'read');
    const bid = ctx.employee.business_id;
    const [orders, customers, accounts, purchases, revenues, expenses, movements] = await Promise.all([
      ctx.repository.orders.listByBusiness(bid),
      ctx.repository.customers.listByBusiness(bid, { includeInactive: true }),
      ctx.repository.accounts.listByBusiness(bid, { includeInactive: true }),
      ctx.repository.purchases.listByBusiness(bid),
      ctx.repository.revenues.listByBusiness(bid),
      ctx.repository.expenses.listByBusiness(bid),
      ctx.repository.cariMovements.listByBusiness(bid),
    ]);
    const ledgerOf = (type: CariContactType, id: UUID) => movementsBalance(movements.filter((m) => m.contact_type === type && m.contact_id === id));
    const rows: MigrationReportRow[] = [];

    for (const c of customers) {
      let legacy = 0;
      for (const o of orders.filter((x) => x.customer_id === c.id)) {
        const lines = await ctx.repository.orderLines.listByOrder(o.id);
        legacy += lines.reduce((sum, l) => sum + l.quantity * l.unit_price_minor, 0);
        legacy -= revenues.filter((r) => r.related_order_id === o.id).reduce((sum, r) => sum + r.amount_minor, 0);
      }
      const ledger = ledgerOf('customer', c.id);
      rows.push({ contact: { type: 'customer', id: c.id }, name: c.name, currency: c.currency ?? ctx.business.base_currency, legacyMinor: legacy, ledgerMinor: ledger, diffMinor: ledger - legacy });
    }
    for (const a of accounts) {
      let legacy = 0;
      const mine = purchases.filter((p) => p.account_id === a.id);
      for (const p of mine) {
        if (p.is_received !== 1) continue;
        const lines = await ctx.repository.purchaseLines.listByPurchase(p.id);
        legacy -= lines.reduce((sum, l) => sum + l.line_total_minor, 0);
      }
      const mineIds = new Set(mine.map((p) => p.id));
      legacy += expenses.filter((e) => e.related_account_id === a.id || (e.related_purchase_id && mineIds.has(e.related_purchase_id))).reduce((sum, e) => sum + e.amount_minor, 0);
      legacy -= revenues.filter((r) => r.related_account_id === a.id).reduce((sum, r) => sum + r.amount_minor, 0);
      const ledger = ledgerOf('account', a.id);
      rows.push({ contact: { type: 'account', id: a.id }, name: a.name, currency: a.currency ?? ctx.business.base_currency, legacyMinor: legacy, ledgerMinor: ledger, diffMinor: ledger - legacy });
    }
    return rows;
  }
}

/** Bir gelir/gider kaydının bağlı olduğu cari (müşteri ya da hesap); yoksa null. */
export function contactOf(entry: Pick<RevenueEntry, 'related_customer_id' | 'related_account_id'>): CariContact | null {
  if (entry.related_customer_id) return { type: 'customer', id: entry.related_customer_id };
  if (entry.related_account_id) return { type: 'account', id: entry.related_account_id };
  return null;
}

export const cariService = new CariService();
