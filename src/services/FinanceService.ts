// Gelir / gider + çek takibi (CLAUDE.md §5.5, §5.6). Both entry types and
// Check share the single 'finance' RBAC gate (owner/manager only — see
// rbac/permissions.ts). The one business rule that lives here: any entry
// with payment_method='check' must get a linked Check row, created in the
// same call so the two can never drift out of sync.
//
// Cari (product feedback): her gelir/gider "Kimden?/Kime?" sorusunu yanıtlar —
// bir cari (müşteri/hesap) ya da bilinçli "Cari dışı". Cari seçilirse kasa
// kaydı ile cari hareketi AYNI işlemde yazılır (biri yazılıp diğeri
// yazılamazsa hepsi geri alınır). Üç giriş noktası (Para ekranı, müşteri
// ekranı, sipariş) aynı kayıt tipini üretir; sipariş yalnızca referanstır.

import type {
  Check,
  CurrencyCode,
  ExpenseCategory,
  ExpenseEntry,
  MinorUnitAmount,
  PaymentMethod,
  RevenueCategory,
  RevenueEntry,
  UUID,
} from '../models';
import { requirePermission } from './rbac';
import type { ActorContext } from './context';
import { cariService, type CariContact } from './CariService';
import { notifyCheckDueSoon } from './NotificationService';

interface CheckDetails {
  direction: 'received' | 'issued';
  due_date: string;
  issue_date?: string;
  check_number?: string | null;
  bank_name?: string | null;
}

/** Who a Gelir/Gider entry belongs to, when it isn't already implied by
 * `related_order_id` — at most one of these three, ever (§8's service-layer
 * business-rule split: this is enforced here, not by a DB constraint). */
interface PartyLink {
  related_customer_id?: UUID | null;
  related_employee_id?: UUID | null;
  related_account_id?: UUID | null;
}

function resolvePartyLink(input: PartyLink): Pick<PartyLink, 'related_customer_id' | 'related_employee_id' | 'related_account_id'> {
  const set = [input.related_customer_id, input.related_employee_id, input.related_account_id].filter((v) => v != null);
  if (set.length > 1) {
    throw new Error('Bir kayıt aynı anda yalnızca bir hesaba (müşteri, çalışan veya diğer) bağlanabilir.');
  }
  return {
    related_customer_id: input.related_customer_id ?? null,
    related_employee_id: input.related_employee_id ?? null,
    related_account_id: input.related_account_id ?? null,
  };
}

/** Kaydın carisi: kime/kimden — ya bir cari, ya çalışan (cari değil) ya da
 * bilinçli "Cari dışı". Hiçbiri seçilmeden kayıt yazılamaz. */
interface CariChoice {
  /** true: "Cari dışı" — yalnızca kasa hareketi. Cari seçiliyken verilemez. */
  cari_excluded?: boolean;
  /** İşlem para birimi carinin para biriminden farklıysa zorunlu (1 işlem birimi = kaç cari birimi). */
  exchange_rate?: number | null;
}

interface ResolvedCari {
  party: ReturnType<typeof resolvePartyLink>;
  contact: CariContact | null;
  excluded: boolean;
}

async function resolveCari(
  ctx: ActorContext,
  input: PartyLink & CariChoice & { related_order_id?: UUID | null; related_purchase_id?: UUID | null },
): Promise<ResolvedCari> {
  let party = resolvePartyLink(input);
  // Sipariş / satın alma referansı, cariyi kendiliğinden belirler.
  if (!party.related_customer_id && !party.related_employee_id && !party.related_account_id) {
    if (input.related_order_id) {
      const order = await ctx.repository.orders.getById(input.related_order_id);
      if (order) party = { ...party, related_customer_id: order.customer_id };
    } else if (input.related_purchase_id) {
      const purchase = await ctx.repository.purchases.getById(input.related_purchase_id);
      if (purchase) party = { ...party, related_account_id: purchase.account_id };
    }
  }
  const contact: CariContact | null = party.related_customer_id
    ? { type: 'customer', id: party.related_customer_id }
    : party.related_account_id
      ? { type: 'account', id: party.related_account_id }
      : null;
  const isEmployee = !!party.related_employee_id;
  if (contact && input.cari_excluded) throw new Error('Bir cari seçiliyken "Cari dışı" işaretlenemez.');
  if (!contact && !isEmployee && !input.cari_excluded) {
    throw new Error('Kimden/Kime alanı zorunlu: bir cari seçin ya da bilinçli olarak "Cari dışı" işaretleyin.');
  }
  return { party, contact, excluded: !contact };
}

export class FinanceService {
  async createExpense(
    ctx: ActorContext,
    input: {
      category: ExpenseCategory;
      amount_minor: MinorUnitAmount;
      currency: CurrencyCode;
      date: string;
      note?: string | null;
      payment_method: PaymentMethod;
      related_order_id?: UUID | null;
      related_purchase_id?: UUID | null;
      check?: CheckDetails; // required when payment_method === 'check'
    } & PartyLink &
      CariChoice,
  ): Promise<{ entry: ExpenseEntry; check: Check | null }> {
    requirePermission(ctx.employee.role, 'finance', 'create');
    const { party, contact, excluded } = await resolveCari(ctx, input);
    return ctx.repository.transaction(async () => {
      const entry = await ctx.repository.expenses.create({
        business_id: ctx.employee.business_id,
        category: input.category,
        amount_minor: input.amount_minor,
        currency: input.currency,
        date: input.date,
        note: input.note ?? null,
        related_order_id: input.related_order_id ?? null,
        related_purchase_id: input.related_purchase_id ?? null,
        ...party,
        cari_excluded: excluded ? 1 : 0,
        payment_method: input.payment_method,
        created_by: ctx.employee.id,
      });
      const check = await this.maybeCreateCheck(ctx, input.payment_method, input.check, {
        related_entry_id: entry.id,
        related_entry_type: 'ExpenseEntry',
        // §5.6: expenses are money going out → 'issued' checks by default.
        defaultDirection: 'issued',
        amount_minor: input.amount_minor,
        currency: input.currency,
      });
      if (contact) await cariService.postCashEntry(ctx, { kind: 'expense', entry, contact, exchange_rate: input.exchange_rate });
      return { entry, check };
    });
  }

  async createRevenue(
    ctx: ActorContext,
    input: {
      source: 'order' | 'manual';
      amount_minor: MinorUnitAmount;
      currency: CurrencyCode;
      date: string;
      note?: string | null;
      payment_method: PaymentMethod;
      related_order_id?: UUID | null;
      /** Yalnızca "Cari dışı" gelirde: faiz, hurda satışı, kira geliri … */
      category?: RevenueCategory | null;
      check?: CheckDetails;
    } & PartyLink &
      CariChoice,
  ): Promise<{ entry: RevenueEntry; check: Check | null }> {
    requirePermission(ctx.employee.role, 'finance', 'create');
    const { party, contact, excluded } = await resolveCari(ctx, input);
    if (excluded && !party.related_employee_id && !input.category) throw new Error('Cari dışı gelir için kategori seçin.');
    return ctx.repository.transaction(async () => {
      const entry = await ctx.repository.revenues.create({
        business_id: ctx.employee.business_id,
        source: input.source,
        related_order_id: input.related_order_id ?? null,
        ...party,
        category: excluded ? (input.category ?? null) : null,
        cari_excluded: excluded ? 1 : 0,
        amount_minor: input.amount_minor,
        currency: input.currency,
        date: input.date,
        note: input.note ?? null,
        payment_method: input.payment_method,
        created_by: ctx.employee.id,
      });
      const check = await this.maybeCreateCheck(ctx, input.payment_method, input.check, {
        related_entry_id: entry.id,
        related_entry_type: 'RevenueEntry',
        // Revenue is money coming in → 'received' checks by default.
        defaultDirection: 'received',
        amount_minor: input.amount_minor,
        currency: input.currency,
      });
      if (contact) await cariService.postCashEntry(ctx, { kind: 'revenue', entry, contact, exchange_rate: input.exchange_rate });
      return { entry, check };
    });
  }

  private async maybeCreateCheck(
    ctx: ActorContext,
    method: PaymentMethod,
    details: CheckDetails | undefined,
    fixed: {
      related_entry_id: UUID;
      related_entry_type: 'ExpenseEntry' | 'RevenueEntry';
      defaultDirection: 'received' | 'issued';
      amount_minor: MinorUnitAmount;
      currency: CurrencyCode;
    },
  ): Promise<Check | null> {
    if (method !== 'check') return null;
    if (!details) {
      throw new Error('payment_method="check" requires check details (direction, due_date at minimum) — §5.6.');
    }
    return ctx.repository.checks.create({
      business_id: ctx.employee.business_id,
      direction: details.direction ?? fixed.defaultDirection,
      related_entry_id: fixed.related_entry_id,
      related_entry_type: fixed.related_entry_type,
      check_number: details.check_number ?? null,
      bank_name: details.bank_name ?? null,
      amount_minor: fixed.amount_minor,
      currency: fixed.currency,
      issue_date: details.issue_date ?? new Date().toISOString(),
      due_date: details.due_date,
      status: 'pending',
      note: null,
      created_by: ctx.employee.id,
    });
  }

  async listExpenses(ctx: ActorContext, opts?: { from?: string; to?: string }): Promise<ExpenseEntry[]> {
    requirePermission(ctx.employee.role, 'finance', 'read');
    return ctx.repository.expenses.listByBusiness(ctx.employee.business_id, opts);
  }

  async listRevenues(ctx: ActorContext, opts?: { from?: string; to?: string }): Promise<RevenueEntry[]> {
    requirePermission(ctx.employee.role, 'finance', 'read');
    return ctx.repository.revenues.listByBusiness(ctx.employee.business_id, opts);
  }

  async listChecks(ctx: ActorContext): Promise<Check[]> {
    requirePermission(ctx.employee.role, 'finance', 'read');
    return ctx.repository.checks.listByBusiness(ctx.employee.business_id);
  }

  /** §5.6: "vadesi yaklaşan çekler" reminder feed — 3 days out by default,
   * matching the spec's example window. The actual FCM push (§9 step 7)
   * isn't wired yet; this is the query a NotificationService would poll. */
  async upcomingDueChecks(ctx: ActorContext, withinDays = 3): Promise<Check[]> {
    requirePermission(ctx.employee.role, 'finance', 'read');
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + withinDays);
    const due = await ctx.repository.checks.listPendingDueBefore(ctx.employee.business_id, cutoff.toISOString());
    // §5.6 hook point — fired every time this is called (a screen opening
    // the finance/due-checks view), not on a background schedule; see
    // NotificationService.ts's header for why a real push needs more than
    // this client can provide on its own.
    for (const check of due) void notifyCheckDueSoon(check.id, check.due_date, check.amount_minor);
    return due;
  }

  /** Çek durumu. Alınmış bir müşteri çeki 'bounced' olursa cari yeniden
   * BORÇLANIR (`check_bounce`); durum sonradan geri alınırsa ters hareket. */
  async updateCheckStatus(ctx: ActorContext, id: UUID, status: Check['status']): Promise<void> {
    requirePermission(ctx.employee.role, 'finance', 'update');
    await ctx.repository.transaction(async () => {
      await ctx.repository.checks.updateStatus(id, status);
      const check = await ctx.repository.checks.getById(id);
      if (check) await cariService.syncCheckBounce(ctx, check);
    });
  }

  /** Girilmiş bir tahsilatı siler (product feedback: "girilen ödemeler"
   * silinebilmeli) — `finance` kaynağı zaten owner/manager'a özel, başka rol
   * bu yetkiye hiç sahip değil. Kayıt soft-delete edilir, bağlı çek varsa o
   * da; cari defterdeki etkisi SİLİNMEZ, ters hareketle kapatılır
   * (`CariService.voidCashEntry` — defter asla üzerine yazılmaz). */
  async voidRevenue(ctx: ActorContext, id: UUID): Promise<void> {
    requirePermission(ctx.employee.role, 'finance', 'delete');
    const entry = await ctx.repository.revenues.getById(id);
    if (!entry || entry.business_id !== ctx.employee.business_id || entry.deleted_at) throw new Error('Kayıt bulunamadı.');
    await ctx.repository.transaction(async () => {
      await ctx.repository.revenues.softDelete(id);
      if (entry.payment_method === 'check') {
        const check = await ctx.repository.checks.getByRelatedEntry(id, 'RevenueEntry');
        if (check) await ctx.repository.checks.softDelete(check.id);
      }
      await cariService.voidCashEntry(ctx, id);
    });
  }

  /** Girilmiş bir ödemeyi siler — `voidRevenue`'nun gider tarafı (satın alma
   * ödemeleri de buradan geçer, `PurchaseService.recordPayment` bunu
   * çağırır). */
  async voidExpense(ctx: ActorContext, id: UUID): Promise<void> {
    requirePermission(ctx.employee.role, 'finance', 'delete');
    const entry = await ctx.repository.expenses.getById(id);
    if (!entry || entry.business_id !== ctx.employee.business_id || entry.deleted_at) throw new Error('Kayıt bulunamadı.');
    await ctx.repository.transaction(async () => {
      await ctx.repository.expenses.softDelete(id);
      if (entry.payment_method === 'check') {
        const check = await ctx.repository.checks.getByRelatedEntry(id, 'ExpenseEntry');
        if (check) await ctx.repository.checks.softDelete(check.id);
      }
      await cariService.voidCashEntry(ctx, id);
    });
  }
}

export const financeService = new FinanceService();
