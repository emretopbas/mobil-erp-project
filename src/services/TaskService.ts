// Görev / mesai atama (CLAUDE.md §5.3): a Task is assigned to one employee;
// status flows todo → in_progress → done (reversible). `production`/`sales`
// may only touch their *own* assigned tasks — `owner`/`manager` touch any.

import type { Task, TaskStatus, UUID } from '../models';
import { requirePermission } from './rbac';
import type { ActorContext } from './context';
import { notifyTaskAssigned } from './NotificationService';

export class TaskService {
  /** Assigning a task to someone else is a 'manager'+ action (the RBAC
   * 'own' tier only grants production/sales the ability to act on tasks
   * assigned to *themselves* — see rbac/permissions.ts's own-tier note). */
  async create(
    ctx: ActorContext,
    input: { title: string; description?: string | null; assignee_id: UUID; due_date?: string | null },
  ): Promise<Task> {
    const isOwn = input.assignee_id === ctx.employee.id;
    requirePermission(ctx.employee.role, 'task', 'create', { isOwn });
    const task = await ctx.repository.tasks.create({
      business_id: ctx.employee.business_id,
      title: input.title,
      description: input.description ?? null,
      assignee_id: input.assignee_id,
      due_date: input.due_date ?? null,
      related_order_id: null,
      created_by: ctx.employee.id,
    });
    void notifyTaskAssigned(task.id, task.assignee_id, task.title);
    return task;
  }

  /** owner/manager see the whole board; production/sales/viewer see only
   * what's assigned to them — §5.3 scopes *changing* status to "own", but
   * there's no reason to hand a production worker the entire company's task
   * list just to find their own three rows, so listing is scoped the same
   * way for those roles. */
  async list(ctx: ActorContext): Promise<Task[]> {
    if (ctx.employee.role === 'owner' || ctx.employee.role === 'manager') {
      return ctx.repository.tasks.listByBusiness(ctx.employee.business_id);
    }
    return ctx.repository.tasks.listByAssignee(ctx.employee.id);
  }

  async updateStatus(ctx: ActorContext, taskId: UUID, status: TaskStatus): Promise<void> {
    const task = await ctx.repository.tasks.getById(taskId);
    if (!task) throw new Error('Task not found');
    requirePermission(ctx.employee.role, 'task', 'update', { isOwn: task.assignee_id === ctx.employee.id });
    await ctx.repository.tasks.updateStatus(taskId, status);
  }

  async reassign(ctx: ActorContext, taskId: UUID, assigneeId: UUID): Promise<void> {
    const task = await ctx.repository.tasks.getById(taskId);
    if (!task) throw new Error('Task not found');
    // Reassignment is an 'update' — the *current* assignment must already be
    // "own" (or the actor is manager+) to touch it at all.
    requirePermission(ctx.employee.role, 'task', 'update', { isOwn: task.assignee_id === ctx.employee.id });
    await ctx.repository.tasks.update(taskId, { assignee_id: assigneeId });
    void notifyTaskAssigned(taskId, assigneeId, task.title);
  }

  async remove(ctx: ActorContext, taskId: UUID): Promise<void> {
    const task = await ctx.repository.tasks.getById(taskId);
    if (!task) return;
    requirePermission(ctx.employee.role, 'task', 'delete', { isOwn: task.assignee_id === ctx.employee.id });
    await ctx.repository.tasks.softDelete(taskId);
  }
}

export const taskService = new TaskService();
