// Mesai (CLAUDE.md §5.3: "Shift basit tutulur (tarih + not); bordro/ücret
// hesabı kapsam dışı"). The spec's §5.4 matrix has no dedicated row for
// Shift — it's covered under the same "Görev atama" heading as Task — so
// this gates on the 'task' resource rather than inventing a new one.
// Unlike Task, a Shift has no assignee-vs-actor distinction in the spec (no
// status to transition, no "own only" language), so there's no `own` check
// here — any role with task-level access can log/view shifts.

import type { Shift, UUID } from '../models';
import { requirePermission } from './rbac';
import type { ActorContext } from './context';

export class ShiftService {
  async create(ctx: ActorContext, input: { employee_id: UUID; date: string; duration_hours?: number; note?: string | null }): Promise<Shift> {
    requirePermission(ctx.employee.role, 'task', 'create');
    return ctx.repository.shifts.create({
      business_id: ctx.employee.business_id,
      employee_id: input.employee_id,
      date: input.date,
      duration_hours: input.duration_hours ?? 8,
      note: input.note ?? null,
    });
  }

  async listForEmployee(ctx: ActorContext, employeeId: UUID): Promise<Shift[]> {
    requirePermission(ctx.employee.role, 'task', 'read');
    return ctx.repository.shifts.listByEmployee(employeeId);
  }

  async listForBusiness(ctx: ActorContext): Promise<Shift[]> {
    requirePermission(ctx.employee.role, 'task', 'read');
    return ctx.repository.shifts.listByBusiness(ctx.employee.business_id);
  }
}

export const shiftService = new ShiftService();
