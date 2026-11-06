// Security rules tests against the Firebase emulators — run with `npm run test:rules`
// (needs Java 11+ on PATH). Uses a demo- project id, so nothing touches the
// real Firebase project.

import { after, before, beforeEach, describe, test } from 'node:test';
import fs from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, getDocs, collection, query, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { getBytes, listAll, ref, uploadString } from 'firebase/storage';

const BIZ = 'biz-1';
const OTHER_BIZ = 'biz-2';
const NOW = '2026-10-15T00:00:00.000Z';
const BACKUP = '2026-10-15T10-00-00-000Z.enc';

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-erp-rules',
    firestore: { rules: fs.readFileSync(process.env.FIRESTORE_RULES ?? 'firestore.rules', 'utf8') },
    storage: { rules: fs.readFileSync(process.env.STORAGE_RULES ?? 'storage.rules', 'utf8') },
  });
});

after(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  // A business founded by `owner`, with a manager, a sales member and a backup key.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'businesses', BIZ), { owner_uid: 'owner', name: 'Topbas', created_at: NOW });
    await setDoc(doc(db, 'businesses', BIZ, 'members', 'owner'), { role: 'owner', email: 'owner@x.co', created_at: NOW });
    await setDoc(doc(db, 'businesses', BIZ, 'members', 'manager'), { role: 'manager', email: 'manager@x.co', created_at: NOW });
    await setDoc(doc(db, 'businesses', BIZ, 'members', 'sales'), { role: 'sales', email: 'sales@x.co', created_at: NOW });
    await setDoc(doc(db, 'business_backup_keys', BIZ), { key: 'secret', created_at: NOW });
    await setDoc(doc(db, 'businesses', OTHER_BIZ), { owner_uid: 'other-owner', name: 'Other', created_at: NOW });
    await setDoc(doc(db, 'businesses', OTHER_BIZ, 'members', 'other-owner'), { role: 'owner', email: 'boss@other.co', created_at: NOW });
    await uploadString(ref(ctx.storage(), `backups/${BIZ}/${BACKUP}`), 'ciphertext', 'raw');
  });
});

function as(uid, token = {}) {
  const ctx = env.authenticatedContext(uid, { email: `${uid}@x.co`, email_verified: false, ...token });
  return { db: ctx.firestore(), storage: ctx.storage() };
}

async function seedInvite(email, role, businessId = BIZ) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'invites', email), { business_id: businessId, role, invited_by: 'owner', created_at: NOW });
  });
}

describe('backup key', () => {
  test('a non-member cannot read the key', async () => {
    await assertFails(getDoc(doc(as('stranger').db, 'business_backup_keys', BIZ)));
  });

  test('an unauthenticated client cannot read the key', async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'business_backup_keys', BIZ)));
  });

  test('a member (any role) can read the key', async () => {
    await assertSucceeds(getDoc(doc(as('sales').db, 'business_backup_keys', BIZ)));
  });

  test('a member of ANOTHER business cannot read it', async () => {
    await assertFails(getDoc(doc(as('other-owner').db, 'business_backup_keys', BIZ)));
  });

  test('the key can never be updated or deleted, not even by the owner', async () => {
    const { db } = as('owner');
    await assertFails(setDoc(doc(db, 'business_backup_keys', BIZ), { key: 'new', created_at: NOW }));
    await assertFails(deleteDoc(doc(db, 'business_backup_keys', BIZ)));
  });

  test('only owner/manager can create a missing key', async () => {
    await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore(), 'business_backup_keys', BIZ)));
    await assertFails(setDoc(doc(as('sales').db, 'business_backup_keys', BIZ), { key: 'k', created_at: NOW }));
    await assertSucceeds(setDoc(doc(as('manager').db, 'business_backup_keys', BIZ), { key: 'k', created_at: NOW }));
  });
});

describe('founder bootstrap', () => {
  const bootstrap = (db, uid, businessId = 'new-biz', ownerUid = uid) => {
    const batch = writeBatch(db);
    batch.set(doc(db, 'businesses', businessId), { owner_uid: ownerUid, name: 'New', created_at: NOW });
    batch.set(doc(db, 'businesses', businessId, 'members', uid), { role: 'owner', email: `${uid}@x.co`, created_at: NOW });
    batch.set(doc(db, 'employee_business_map', uid), { business_id: businessId });
    return batch.commit();
  };

  test('a founder creates the business, owner membership and hint in one batch', async () => {
    const { db } = as('founder');
    await assertSucceeds(getDoc(doc(db, 'businesses', 'new-biz', 'members', 'founder'))); // own, not yet existing
    await assertSucceeds(bootstrap(db, 'founder'));
  });

  test('a business cannot be created without its owner membership, nor a membership without the business', async () => {
    const { db } = as('founder');
    await assertFails(setDoc(doc(db, 'businesses', 'new-biz'), { owner_uid: 'founder', name: 'New', created_at: NOW }));
    await assertFails(setDoc(doc(db, 'businesses', 'new-biz', 'members', 'founder'), { role: 'owner', email: 'founder@x.co', created_at: NOW }));
  });

  test('nobody can create a business naming someone else as owner', async () => {
    await assertFails(bootstrap(as('mallory').db, 'mallory', 'new-biz', 'founder'));
  });

  test('a founder removed by a co-owner cannot re-add themselves as owner', async () => {
    await assertSucceeds(updateDoc(doc(as('owner').db, 'businesses', BIZ, 'members', 'manager'), { role: 'owner' }));
    await assertSucceeds(deleteDoc(doc(as('manager').db, 'businesses', BIZ, 'members', 'owner')));
    await assertFails(setDoc(doc(as('owner').db, 'businesses', BIZ, 'members', 'owner'), { role: 'owner', email: 'owner@x.co', created_at: NOW }));
  });

  test('a non-founder cannot bootstrap themselves as owner of an existing business', async () => {
    await assertFails(setDoc(doc(as('mallory').db, 'businesses', BIZ, 'members', 'mallory'), { role: 'owner', email: 'mallory@x.co', created_at: NOW }));
  });

  test("a non-member cannot read someone else's business doc", async () => {
    await assertFails(getDoc(doc(as('mallory').db, 'businesses', BIZ)));
  });

  test('owner_uid can never be changed', async () => {
    await assertFails(updateDoc(doc(as('owner').db, 'businesses', BIZ), { owner_uid: 'manager' }));
    await assertSucceeds(updateDoc(doc(as('owner').db, 'businesses', BIZ), { name: 'Renamed' }));
  });
});

describe('invites and joining', () => {
  test('an uninvited user cannot create their own member document', async () => {
    await assertFails(setDoc(doc(as('stranger', { email_verified: true }).db, 'businesses', BIZ, 'members', 'stranger'), { role: 'viewer', email: 'stranger@x.co', created_at: NOW }));
  });

  test('an invited user with an UNVERIFIED email cannot join', async () => {
    await seedInvite('newbie@x.co', 'viewer');
    await assertFails(setDoc(doc(as('newbie').db, 'businesses', BIZ, 'members', 'newbie'), { role: 'viewer', email: 'newbie@x.co', created_at: NOW }));
  });

  test('a viewer invite cannot be accepted as manager; as viewer it can', async () => {
    await seedInvite('newbie@x.co', 'viewer');
    const { db } = as('newbie', { email_verified: true });
    await assertFails(setDoc(doc(db, 'businesses', BIZ, 'members', 'newbie'), { role: 'manager', email: 'newbie@x.co', created_at: NOW }));
    await assertSucceeds(setDoc(doc(db, 'businesses', BIZ, 'members', 'newbie'), { role: 'viewer', email: 'newbie@x.co', created_at: NOW }));
  });

  test("an invite for business A cannot be used to join business B", async () => {
    await seedInvite('newbie@x.co', 'viewer', OTHER_BIZ);
    await assertFails(setDoc(doc(as('newbie', { email_verified: true }).db, 'businesses', BIZ, 'members', 'newbie'), { role: 'viewer', email: 'newbie@x.co', created_at: NOW }));
  });

  test("a verified user cannot use someone else's invite", async () => {
    await seedInvite('victim@x.co', 'manager');
    await assertFails(setDoc(doc(as('mallory', { email_verified: true }).db, 'businesses', BIZ, 'members', 'mallory'), { role: 'manager', email: 'victim@x.co', created_at: NOW }));
  });

  test('the invitee can read and delete their own invite, a stranger cannot read it', async () => {
    await seedInvite('newbie@x.co', 'viewer');
    await assertFails(getDoc(doc(as('stranger').db, 'invites', 'newbie@x.co')));
    await assertSucceeds(getDoc(doc(as('newbie').db, 'invites', 'newbie@x.co')));
    await assertSucceeds(getDoc(doc(as('nobody').db, 'invites', 'nobody@x.co'))); // own, non-existent
    await assertSucceeds(deleteDoc(doc(as('newbie').db, 'invites', 'newbie@x.co')));
  });

  test('admins invite non-owner roles only; non-admins cannot invite', async () => {
    const invite = (uid, role) => ({ business_id: BIZ, role, invited_by: uid, created_at: NOW });
    await assertSucceeds(setDoc(doc(as('manager').db, 'invites', 'a@x.co'), invite('manager', 'sales')));
    await assertFails(setDoc(doc(as('owner').db, 'invites', 'b@x.co'), invite('owner', 'owner')));
    await assertFails(setDoc(doc(as('sales').db, 'invites', 'c@x.co'), invite('sales', 'viewer')));
    await assertFails(setDoc(doc(as('owner').db, 'invites', 'd@x.co'), invite('someone-else', 'viewer')));
    await assertFails(setDoc(doc(as('owner').db, 'invites', 'Mixed@x.co'), invite('owner', 'viewer')));
  });

  test("another business cannot take over a pending invite", async () => {
    await seedInvite('newbie@x.co', 'viewer');
    await assertFails(setDoc(doc(as('other-owner').db, 'invites', 'newbie@x.co'), { business_id: OTHER_BIZ, role: 'manager', invited_by: 'other-owner', created_at: NOW }));
    await assertFails(deleteDoc(doc(as('other-owner').db, 'invites', 'newbie@x.co')));
  });
});

describe('roles and removal', () => {
  const member = (db, uid) => doc(db, 'businesses', BIZ, 'members', uid);

  test('nobody can change their own role (not even to owner)', async () => {
    await assertFails(updateDoc(member(as('manager').db, 'manager'), { role: 'owner' }));
    await assertFails(updateDoc(member(as('sales').db, 'sales'), { role: 'owner' }));
    await assertFails(updateDoc(member(as('owner').db, 'owner'), { role: 'manager' }));
  });

  test('a manager can change non-owner roles but cannot grant or remove owner', async () => {
    await assertSucceeds(updateDoc(member(as('manager').db, 'sales'), { role: 'viewer' }));
    await assertFails(updateDoc(member(as('manager').db, 'sales'), { role: 'owner' }));
    await assertFails(updateDoc(member(as('manager').db, 'owner'), { role: 'viewer' }));
  });

  test('an owner can grant owner', async () => {
    await assertSucceeds(updateDoc(member(as('owner').db, 'manager'), { role: 'owner' }));
  });

  test('sales cannot change anyone', async () => {
    await assertFails(updateDoc(member(as('sales').db, 'manager'), { role: 'viewer' }));
  });

  test('removal: admin removes a member, manager cannot remove an owner, nobody removes themselves', async () => {
    await assertFails(deleteDoc(member(as('manager').db, 'owner')));
    await assertFails(deleteDoc(member(as('manager').db, 'manager')));
    await assertSucceeds(deleteDoc(member(as('manager').db, 'sales')));
  });

  test('a removed member immediately loses the key and the backups', async () => {
    await assertSucceeds(deleteDoc(member(as('owner').db, 'sales')));
    const { db, storage } = as('sales');
    await assertFails(getDoc(doc(db, 'business_backup_keys', BIZ)));
    await assertFails(getBytes(ref(storage, `backups/${BIZ}/${BACKUP}`)));
  });

  test('members can list the roster by email (used to find a member by email)', async () => {
    await assertSucceeds(getDocs(query(collection(as('manager').db, 'businesses', BIZ, 'members'), where('email', '==', 'sales@x.co'))));
    await assertFails(getDocs(collection(as('stranger').db, 'businesses', BIZ, 'members')));
  });
});

describe('new-device hint', () => {
  test('users write only their own hint, and it grants nothing', async () => {
    await assertSucceeds(setDoc(doc(as('mallory').db, 'employee_business_map', 'mallory'), { business_id: BIZ }));
    await assertFails(setDoc(doc(as('mallory').db, 'employee_business_map', 'owner'), { business_id: OTHER_BIZ }));
    await assertFails(getDoc(doc(as('mallory').db, 'business_backup_keys', BIZ)));
  });
});

describe('backup blobs (storage)', () => {
  const blob = (storage, name = BACKUP, biz = BIZ) => ref(storage, `backups/${biz}/${name}`);

  test('a non-member cannot list or download backups', async () => {
    const { storage } = as('stranger');
    await assertFails(listAll(ref(storage, `backups/${BIZ}`)));
    await assertFails(getBytes(blob(storage)));
  });

  test('any member can list and download backups', async () => {
    const { storage } = as('sales');
    await assertSucceeds(listAll(ref(storage, `backups/${BIZ}`)));
    await assertSucceeds(getBytes(blob(storage)));
  });

  test('owner/manager can upload a new backup; other roles cannot', async () => {
    await assertSucceeds(uploadString(blob(as('manager').storage, '2026-10-16T10-00-00-000Z.enc'), 'c', 'raw'));
    await assertFails(uploadString(blob(as('sales').storage, '2026-10-17T10-00-00-000Z.enc'), 'c', 'raw'));
  });

  test('an existing backup cannot be overwritten (update denied)', async () => {
    await assertFails(uploadString(blob(as('owner').storage), 'tampered', 'raw'));
  });

  test("uploads into another business's folder are denied", async () => {
    await assertFails(uploadString(blob(as('owner').storage, '2026-10-16T10-00-00-000Z.enc', OTHER_BIZ), 'c', 'raw'));
  });

  test('only timestamped .enc names under backups/ are accepted', async () => {
    const { storage } = as('owner');
    await assertFails(uploadString(blob(storage, 'evil.html'), 'c', 'raw'));
    await assertFails(uploadString(ref(storage, `${BIZ}/2026-10-16T10-00-00-000Z.enc`), 'c', 'raw'));
  });
});
