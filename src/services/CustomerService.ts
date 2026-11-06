// Customer is a Faz 2 seed model (CLAUDE.md §4) populated manually in Faz 1.
// Gated on the 'order' resource, not a separate one — the spec's §5.4 matrix
// has no row for "customer" on its own; customers only exist in service of
// orders, so they inherit that row's permissions.

import type { Customer, UUID } from '../models';
import { requirePermission } from './rbac';
import type { ActorContext } from './context';

export class CustomerService {
  async create(ctx: ActorContext, input: { name: string; primary_channel?: string | null; contact_ref?: string | null }): Promise<Customer> {
    requirePermission(ctx.employee.role, 'order', 'create');
    return ctx.repository.customers.create({
      business_id: ctx.employee.business_id,
      name: input.name,
      primary_channel: input.primary_channel ?? null,
      contact_ref: input.contact_ref ?? null,
    });
  }

  async list(ctx: ActorContext, opts?: { includeInactive?: boolean }): Promise<Customer[]> {
    requirePermission(ctx.employee.role, 'order', 'read');
    return ctx.repository.customers.listByBusiness(ctx.employee.business_id, opts);
  }

  async update(ctx: ActorContext, id: UUID, patch: Partial<Pick<Customer, 'name' | 'primary_channel' | 'contact_ref'>>): Promise<void> {
    requirePermission(ctx.employee.role, 'order', 'update');
    await ctx.repository.customers.update(id, patch);
  }

  async softDelete(ctx: ActorContext, id: UUID): Promise<void> {
    requirePermission(ctx.employee.role, 'order', 'delete');
    await ctx.repository.customers.softDelete(id);
  }
}

export const customerService = new CustomerService();
