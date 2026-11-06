// `Account` — a third-party ledger entry (CLAUDE.md §8's service-layer RBAC
// split, §5.4's `finance` row): a supplier, a subcontractor, a landlord,
// anyone Gelir/Gider entries get tagged to that's neither an existing
// `Customer` (order-bound) nor an `Employee` (auth/RBAC-bound). Gated on
// 'finance' the same way Check/RevenueEntry/ExpenseEntry are — creating one
// only ever happens alongside recording a Gelir/Gider entry for them.

import type { Account, UUID } from '../models';
import { requirePermission } from './rbac';
import type { ActorContext } from './context';

export class AccountService {
  async create(ctx: ActorContext, input: { name: string; note?: string | null }): Promise<Account> {
    requirePermission(ctx.employee.role, 'finance', 'create');
    return ctx.repository.accounts.create({
      business_id: ctx.employee.business_id,
      name: input.name,
      note: input.note ?? null,
    });
  }

  async list(ctx: ActorContext, opts?: { includeInactive?: boolean }): Promise<Account[]> {
    requirePermission(ctx.employee.role, 'finance', 'read');
    return ctx.repository.accounts.listByBusiness(ctx.employee.business_id, opts);
  }

  async update(ctx: ActorContext, id: UUID, patch: Partial<Pick<Account, 'name' | 'note'>>): Promise<void> {
    requirePermission(ctx.employee.role, 'finance', 'update');
    await ctx.repository.accounts.update(id, patch);
  }

  async softDelete(ctx: ActorContext, id: UUID): Promise<void> {
    requirePermission(ctx.employee.role, 'finance', 'delete');
    await ctx.repository.accounts.softDelete(id);
  }
}

export const accountService = new AccountService();
