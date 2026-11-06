// Unit test skeleton for the RBAC gate (CLAUDE.md §8: "Her modül için birim
// test iskeleti (en azından ... RBAC kapıları, son-owner koruması, negatif
// stok engeli)"). Runs on Node's built-in test runner + native TS type
// stripping — no test framework installed yet (see progress.md); this file
// only exercises pure functions, so it doesn't need one.
//
//   node --test src/services/rbac/permissions.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hasPermission, requirePermission, PermissionError } from './permissions.ts';

test('owner and manager have full CRUD on every resource except settings (manager)', () => {
  for (const action of ['create', 'read', 'update', 'delete'] as const) {
    assert.equal(hasPermission('owner', 'employee', action), true);
    assert.equal(hasPermission('manager', 'employee', action), true);
  }
  // §5.4: "Ayarlar / plan: owner=CRUD, diğerleri=—" — manager does NOT get settings.
  assert.equal(hasPermission('manager', 'settings', 'read'), false);
  assert.equal(hasPermission('owner', 'settings', 'update'), true);
});

test('production/sales get read-only on product, full CRUD on their own tasks only', () => {
  assert.equal(hasPermission('production', 'product', 'read'), true);
  assert.equal(hasPermission('production', 'product', 'create'), false);

  // task: 'own' tier — read always allowed, write only when isOwn.
  assert.equal(hasPermission('production', 'task', 'read'), true);
  assert.equal(hasPermission('production', 'task', 'update', { isOwn: true }), true);
  assert.equal(hasPermission('production', 'task', 'update', { isOwn: false }), false);
  assert.equal(hasPermission('sales', 'task', 'update'), false); // isOwn defaults to false
});

test('viewer is read-only everywhere it has any access, and locked out of employee/finance entirely', () => {
  assert.equal(hasPermission('viewer', 'product', 'read'), true);
  assert.equal(hasPermission('viewer', 'product', 'create'), false);
  assert.equal(hasPermission('viewer', 'employee', 'read'), false); // §5.4: viewer row is "—"
  assert.equal(hasPermission('viewer', 'finance', 'read'), false);
});

test('order/purchase delete is owner/manager-only even though sales/production otherwise have crud there (product feedback)', () => {
  // sales places/edits orders day to day (crud per §5.4) but may not delete them.
  assert.equal(hasPermission('sales', 'order', 'create'), true);
  assert.equal(hasPermission('sales', 'order', 'update'), true);
  assert.equal(hasPermission('sales', 'order', 'delete'), false);
  // production receives purchases day to day (crud, mirrors stockMovement) but may not delete them.
  assert.equal(hasPermission('production', 'purchase', 'update'), true);
  assert.equal(hasPermission('production', 'purchase', 'delete'), false);
  // owner/manager keep full delete rights on both.
  for (const role of ['owner', 'manager'] as const) {
    assert.equal(hasPermission(role, 'order', 'delete'), true);
    assert.equal(hasPermission(role, 'purchase', 'delete'), true);
  }
  // a role with no access to the resource at all stays locked out (restriction only narrows, never widens).
  assert.equal(hasPermission('viewer', 'order', 'delete'), false);
});

test('requirePermission throws PermissionError with the role/resource/action that failed', () => {
  assert.throws(
    () => requirePermission('sales', 'employee', 'create'),
    (err: unknown) => {
      if (!(err instanceof PermissionError)) throw new Error('expected a PermissionError');
      assert.equal(err.role, 'sales');
      assert.equal(err.resource, 'employee');
      assert.equal(err.action, 'create');
      return true;
    },
  );
  assert.doesNotThrow(() => requirePermission('owner', 'employee', 'create'));
});
