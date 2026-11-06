// Personel kuralları (CLAUDE.md §5.2, §8) + Firestore üyelik aynası: son-owner
// koruması, owner-yetkisi kuralları ve "önce bulut, sonra yerel" sırası.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeRepository } from './fakeRepository.ts';
import { EmployeeService, LastOwnerError, MembershipSyncError, RosterRuleError } from '../EmployeeService.ts';
import type { MembershipMirror } from '../MembershipService.ts';
import { PermissionError } from '../rbac/permissions.ts';
import type { ActorContext } from '../context.ts';
import type { Employee, EmployeeRole } from '../../models/index.ts';

type MirrorCall = [op: 'invite' | 'setRole' | 'revoke', ...args: unknown[]];

function recordingMirror(opts: { fail?: boolean } = {}) {
  const calls: MirrorCall[] = [];
  const maybeFail = async () => {
    if (opts.fail) throw Object.assign(new Error('offline'), { code: 'firestore/unavailable' });
  };
  const mirror: MembershipMirror = {
    async invite(businessId, email, role, invitedBy) {
      await maybeFail();
      calls.push(['invite', businessId, email, role, invitedBy]);
    },
    async setRole(businessId, employee, role) {
      await maybeFail();
      calls.push(['setRole', businessId, employee.id, role]);
    },
    async revoke(businessId, employee) {
      await maybeFail();
      calls.push(['revoke', businessId, employee.id]);
    },
  };
  return { mirror, calls };
}

async function setup(opts: { fail?: boolean } = {}) {
  const repository = createFakeRepository();
  const business = await repository.business.create({ name: 'Test Co', base_currency: 'TRY', plan_tier: 'solo' });
  const owner = await repository.employees.create({
    business_id: business.id,
    firebase_uid: 'uid-owner',
    display_name: 'Owner',
    email: 'owner@test.co',
    phone: null,
    role: 'owner',
  });
  const { mirror, calls } = recordingMirror(opts);
  const service = new EmployeeService(mirror);
  const ctx: ActorContext = { employee: owner, business, repository };
  const addEmployee = (role: EmployeeRole, extra: Partial<Employee> = {}) =>
    repository.employees.create({
      business_id: business.id,
      firebase_uid: extra.firebase_uid ?? `uid-${role}-${Math.random()}`,
      display_name: role,
      email: extra.email ?? null,
      phone: null,
      role,
    });
  const ctxAs = (employee: Employee): ActorContext => ({ employee, business, repository });
  return { repository, business, owner, service, ctx, calls, addEmployee, ctxAs };
}

test('the sole owner cannot be deactivated', async () => {
  const { service, ctx, owner } = await setup();
  await assert.rejects(() => service.deactivate(ctx, owner.id), LastOwnerError);
});

test('the sole owner cannot be demoted to another role', async () => {
  const { service, ctx, owner } = await setup();
  await assert.rejects(() => service.update(ctx, owner.id, { role: 'manager' }), LastOwnerError);
});

test('a second owner CAN be deactivated by an owner (guard only blocks the last one)', async () => {
  const { service, ctx, repository, addEmployee, calls, business } = await setup();
  const secondOwner = await addEmployee('owner');
  await service.deactivate(ctx, secondOwner.id);
  assert.equal((await repository.employees.getById(secondOwner.id))?.is_active, 0);
  assert.deepEqual(calls, [['revoke', business.id, secondOwner.id]]);
});

test('a role without employee:delete permission is rejected before anything else runs', async () => {
  const { owner, service, addEmployee, ctxAs } = await setup();
  const viewer = await addEmployee('viewer');
  await assert.rejects(() => service.deactivate(ctxAs(viewer), owner.id), PermissionError);
});

test('deactivation revokes cloud membership BEFORE the local soft delete', async () => {
  const { service, ctx, repository, addEmployee, calls } = await setup();
  const sales = await addEmployee('sales');
  await service.deactivate(ctx, sales.id);
  assert.equal(calls[0][0], 'revoke');
  assert.equal((await repository.employees.getById(sales.id))?.is_active, 0);
});

test('if the cloud revoke fails the employee stays active locally (no half-removed state)', async () => {
  const { service, ctx, repository, addEmployee } = await setup({ fail: true });
  const sales = await addEmployee('sales');
  await assert.rejects(() => service.deactivate(ctx, sales.id), MembershipSyncError);
  assert.equal((await repository.employees.getById(sales.id))?.is_active, 1);
});

test('an employee with no Firebase account and no email is deactivated locally only', async () => {
  const { service, ctx, repository, calls, business } = await setup({ fail: true });
  const offline = await repository.employees.create({
    business_id: business.id,
    firebase_uid: null,
    display_name: 'No account',
    email: null,
    phone: null,
    role: 'production',
  });
  await service.deactivate(ctx, offline.id);
  assert.equal(calls.length, 0);
  assert.equal((await repository.employees.getById(offline.id))?.is_active, 0);
});

test('nobody can deactivate themselves or change their own role', async () => {
  const { service, addEmployee, ctxAs } = await setup();
  const manager = await addEmployee('manager');
  await assert.rejects(() => service.deactivate(ctxAs(manager), manager.id), RosterRuleError);
  await assert.rejects(() => service.update(ctxAs(manager), manager.id, { role: 'viewer' }), RosterRuleError);
});

test('a manager cannot grant owner, demote an owner, or deactivate an owner', async () => {
  const { service, addEmployee, ctxAs } = await setup();
  const manager = await addEmployee('manager');
  const sales = await addEmployee('sales');
  const secondOwner = await addEmployee('owner');
  await assert.rejects(() => service.update(ctxAs(manager), sales.id, { role: 'owner' }), RosterRuleError);
  await assert.rejects(() => service.update(ctxAs(manager), secondOwner.id, { role: 'viewer' }), RosterRuleError);
  await assert.rejects(() => service.deactivate(ctxAs(manager), secondOwner.id), RosterRuleError);
});

test('a role change is mirrored to the cloud first, and a failed mirror leaves the local role untouched', async () => {
  const ok = await setup();
  const sales = await ok.addEmployee('sales');
  await ok.service.update(ok.ctx, sales.id, { role: 'viewer' });
  assert.deepEqual(ok.calls, [['setRole', ok.business.id, sales.id, 'viewer']]);
  assert.equal((await ok.repository.employees.getById(sales.id))?.role, 'viewer');

  const failing = await setup({ fail: true });
  const other = await failing.addEmployee('sales');
  await assert.rejects(() => failing.service.update(failing.ctx, other.id, { role: 'viewer' }), MembershipSyncError);
  assert.equal((await failing.repository.employees.getById(other.id))?.role, 'sales');
});

test('editing only the name does not touch cloud membership', async () => {
  const { service, ctx, addEmployee, calls } = await setup({ fail: true });
  const sales = await addEmployee('sales');
  await service.update(ctx, sales.id, { display_name: 'Renamed' });
  assert.equal(calls.length, 0);
});

test('creating an employee with an email sends the invite before the local row exists', async () => {
  const { service, ctx, calls, business } = await setup();
  const created = await service.create(ctx, { display_name: 'Ayşe', role: 'sales', email: ' ayse@test.co ' });
  assert.deepEqual(calls, [['invite', business.id, 'ayse@test.co', 'sales', 'uid-owner']]);
  assert.equal(created.email, 'ayse@test.co');

  const failing = await setup({ fail: true });
  const before = (await failing.repository.employees.listByBusiness(failing.business.id)).length;
  await assert.rejects(() => failing.service.create(failing.ctx, { display_name: 'X', role: 'sales', email: 'x@test.co' }), MembershipSyncError);
  assert.equal((await failing.repository.employees.listByBusiness(failing.business.id)).length, before);
});

test('owner cannot be granted through an invite', async () => {
  const { service, ctx } = await setup();
  await assert.rejects(() => service.create(ctx, { display_name: 'Boss', role: 'owner', email: 'b@test.co' }), RosterRuleError);
});
