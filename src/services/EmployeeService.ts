// Personel yönetimi (CLAUDE.md §5.2): every write goes through RBAC first,
// then this module's own rules — a business must always keep at least one
// active `owner`. The Repository layer has no idea what an "owner" is; all
// of that enforcement lives here, in front of it.
//
// Roster changes that affect cloud access (invite, role change, deactivation)
// are mirrored to Firestore membership BEFORE the local write — see
// MembershipService.ts. If the mirror fails nothing is written locally: a
// deactivated employee whose cloud membership survived would keep reading the
// business's backup and its encryption key.

import { isPermissionDenied } from '../lib/firebaseErrors';
import type { Employee, EmployeeRole, UUID } from '../models';
import type { ActorContext } from './context';
import { firestoreMembership, RosterRuleError, type MembershipMirror } from './MembershipService';
import { requirePermission } from './rbac';

export { RosterRuleError };

export class LastOwnerError extends Error {
  constructor() {
    super('En az bir aktif "owner" her zaman kalmalıdır — son owner pasifleştirilemez veya rolü değiştirilemez.');
    this.name = 'LastOwnerError';
  }
}

export class MembershipSyncError extends Error {
  constructor(cause: unknown) {
    super(
      isPermissionDenied(cause)
        ? 'Bu değişiklik bulutta reddedildi (yetki yok ya da bu e-posta başka bir işletmenin bekleyen davetinde). Değişiklik kaydedilmedi.'
        : 'Üyelik bulutta güncellenemedi — internet bağlantısını kontrol edip tekrar dene. Değişiklik kaydedilmedi.',
    );
    this.name = 'MembershipSyncError';
    this.cause = cause;
  }
}

export class EmployeeService {
  constructor(private readonly membership: MembershipMirror = firestoreMembership) {}

  async create(
    ctx: ActorContext,
    input: { display_name: string; role: EmployeeRole; email?: string | null; phone?: string | null },
  ): Promise<Employee> {
    requirePermission(ctx.employee.role, 'employee', 'create');
    if (input.role === 'owner') {
      throw new RosterRuleError('Owner rolü davetle verilemez — yalnızca işletmeyi kuran kişi owner olur.');
    }
    const email = input.email?.trim() || null;
    if (email) {
      const actorUid = this.actorUid(ctx);
      await this.mirror(() => this.membership.invite(ctx.employee.business_id, email, input.role, actorUid));
    }
    return ctx.repository.employees.create({
      business_id: ctx.employee.business_id,
      firebase_uid: null, // bound when the invite is accepted (§7.1)
      display_name: input.display_name,
      email,
      phone: input.phone ?? null,
      role: input.role,
    });
  }

  async list(ctx: ActorContext, opts?: { includeInactive?: boolean }): Promise<Employee[]> {
    // Every role can at least *read* the roster per the matrix's implicit
    // floor — §5.4's table has no row for "who can view the employee list"
    // separately from CRUD, but every other resource's 'none' tier still
    // reads fine for viewers, so employee listing (not employee *records*
    // like phone/email — full detail — just the roster) is allowed to
    // everyone signed into the business. Screens that show sensitive detail
    // should still gate on 'employee'/'read' where that distinction matters.
    return ctx.repository.employees.listByBusiness(ctx.employee.business_id, opts);
  }

  async update(
    ctx: ActorContext,
    id: UUID,
    patch: Partial<Pick<Employee, 'display_name' | 'email' | 'phone' | 'role'>>,
  ): Promise<void> {
    requirePermission(ctx.employee.role, 'employee', 'update');
    const target = await this.getTarget(ctx, id);
    const roleChanges = patch.role !== undefined && patch.role !== target.role;
    if (roleChanges) {
      if (patch.role !== 'owner') await this.assertNotLastOwner(ctx, target);
      if (target.id === ctx.employee.id) throw new RosterRuleError('Kendi rolünü değiştiremezsin.');
      if ((target.role === 'owner' || patch.role === 'owner') && ctx.employee.role !== 'owner') {
        throw new RosterRuleError('Owner rolünü yalnızca bir owner verebilir veya geri alabilir.');
      }
      const actorUid = this.actorUid(ctx);
      await this.mirror(() => this.membership.setRole(ctx.employee.business_id, target, patch.role!, actorUid));
    }
    await ctx.repository.employees.update(id, patch);
  }

  /** §5.2: "Çıkarma = soft delete ... Bir işletmede en az 1 owner her zaman
   * aktif kalmalı — son owner pasifleştirilemez." */
  async deactivate(ctx: ActorContext, id: UUID): Promise<void> {
    requirePermission(ctx.employee.role, 'employee', 'delete');
    const target = await this.getTarget(ctx, id);
    await this.assertNotLastOwner(ctx, target);
    if (target.id === ctx.employee.id) throw new RosterRuleError('Kendini pasifleştiremezsin.');
    if (target.role === 'owner' && ctx.employee.role !== 'owner') {
      throw new RosterRuleError('Bir owner\'ı yalnızca başka bir owner pasifleştirebilir.');
    }
    if (target.firebase_uid || target.email) {
      await this.mirror(() => this.membership.revoke(ctx.employee.business_id, target));
    }
    await ctx.repository.employees.softDelete(id);
  }

  private async getTarget(ctx: ActorContext, id: UUID): Promise<Employee> {
    const target = await ctx.repository.employees.getById(id);
    if (!target || target.business_id !== ctx.employee.business_id) throw new Error('Personel bulunamadı.');
    return target;
  }

  private actorUid(ctx: ActorContext): string {
    if (!ctx.employee.firebase_uid) throw new Error('Oturumdaki personelin Firebase hesabı yok.');
    return ctx.employee.firebase_uid;
  }

  private async mirror(op: () => Promise<void>): Promise<void> {
    try {
      await op();
    } catch (e) {
      if (e instanceof RosterRuleError) throw e;
      throw new MembershipSyncError(e);
    }
  }

  private async assertNotLastOwner(ctx: ActorContext, target: Employee): Promise<void> {
    if (target.role !== 'owner' || !target.is_active) return; // not an active owner — nothing to protect
    const roster = await ctx.repository.employees.listByBusiness(ctx.employee.business_id);
    const activeOwners = roster.filter((e) => e.role === 'owner' && e.is_active);
    if (activeOwners.length <= 1) throw new LastOwnerError();
  }
}

export const employeeService = new EmployeeService();
