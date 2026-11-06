// Firestore membership mirror. The local SQLite `employee` table stays the
// app's own source of roles, but security rules can't read it — so whoever may
// touch a business's backup blob and encryption key is mirrored here as
// `businesses/{businessId}/members/{uid}`, the ONLY thing firestore.rules and
// storage.rules accept as proof of membership.
//
// CLAUDE.md §2 still holds: nothing operational is written here — only
// once-per-employee metadata (business identity, membership, invites, the
// new-device hint), the same "small config/metadata" carve-out the backup key
// already uses.

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from '@react-native-firebase/firestore';

import { isPermissionDenied, normalizeEmail } from '../lib/firebaseErrors';
import type { Business, Employee, EmployeeRole, UUID } from '../models';
import { nowIso } from '../repository/id';
import type { FirebaseUser } from './AuthService';

const BUSINESSES = 'businesses';
const MEMBERS = 'members';
const INVITES = 'invites';
/** uid -> business_id. A hint only ("which business should a fresh install of
 * this account look at"), written by the user themselves — never proof of
 * membership; every real access still goes through `members`. */
const BUSINESS_HINTS = 'employee_business_map';

/** A roster rule that mirrors firestore.rules, so the local roster can never
 * hold a state the cloud would refuse. */
export class RosterRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RosterRuleError';
  }
}

/** What EmployeeService needs to keep Firestore membership in step with the
 * local roster. Every method hits the network; callers run it BEFORE the local
 * write so a failure leaves both sides unchanged. */
export interface MembershipMirror {
  invite(businessId: UUID, email: string, role: EmployeeRole, invitedByUid: string): Promise<void>;
  setRole(businessId: UUID, employee: Employee, role: EmployeeRole, actorUid: string): Promise<void>;
  revoke(businessId: UUID, employee: Employee): Promise<void>;
}

function memberRef(businessId: UUID, uid: string) {
  return doc(getFirestore(), BUSINESSES, businessId, MEMBERS, uid);
}

function inviteRef(email: string) {
  return doc(getFirestore(), INVITES, normalizeEmail(email));
}

/** An employee whose invite was accepted on another device still has
 * `firebase_uid = null` in THIS device's SQLite (solo tier has no sync), so
 * fall back to the email stored on the member document. */
async function findMemberUid(businessId: UUID, employee: Employee): Promise<string | null> {
  if (employee.firebase_uid) return employee.firebase_uid;
  if (!employee.email) return null;
  const members = collection(getFirestore(), BUSINESSES, businessId, MEMBERS);
  const result = await getDocs(query(members, where('email', '==', normalizeEmail(employee.email)), limit(1)));
  return result.docs[0]?.id ?? null;
}

/** The invite for `email`, but only if it belongs to `businessId`. Rules deny
 * reading another business's invite — that's "not ours", not a failure. */
async function findOwnInvite(businessId: UUID, email: string) {
  const ref = inviteRef(email);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return (snap.data() as { business_id?: string }).business_id === businessId ? ref : null;
  } catch (e) {
    if (isPermissionDenied(e)) return null;
    throw e;
  }
}

export const firestoreMembership: MembershipMirror = {
  async invite(businessId, email, role, invitedByUid) {
    await setDoc(inviteRef(email), { business_id: businessId, role, invited_by: invitedByUid, created_at: nowIso() });
  },

  async setRole(businessId, employee, role, actorUid) {
    const uid = await findMemberUid(businessId, employee);
    if (uid) {
      await updateDoc(memberRef(businessId, uid), { role });
      return;
    }
    if (!employee.email) return;
    const pending = await findOwnInvite(businessId, employee.email);
    if (!pending) return;
    if (role === 'owner') {
      throw new RosterRuleError('Daveti henüz kabul edilmemiş bir personele owner rolü verilemez.');
    }
    await setDoc(pending, { business_id: businessId, role, invited_by: actorUid, created_at: nowIso() });
  },

  async revoke(businessId, employee) {
    const uid = await findMemberUid(businessId, employee);
    if (uid) await deleteDoc(memberRef(businessId, uid));
    if (employee.email) {
      const pending = await findOwnInvite(businessId, employee.email);
      if (pending) await deleteDoc(pending);
    }
  },
};

export async function findBusinessHint(uid: string): Promise<string | null> {
  const snap = await getDoc(doc(getFirestore(), BUSINESS_HINTS, uid));
  if (!snap.exists()) return null;
  return (snap.data() as { business_id?: string }).business_id ?? null;
}

/** Idempotent bootstrap for the business founder: creates `businesses/{id}`,
 * the owner's member document and the new-device hint in ONE batch — the rules
 * only accept an owner bootstrap inside the batch that creates the business.
 * Runs on every `ready` session of an owner, so a business created offline — or
 * before these rules existed — catches up on the next launch; once the member
 * document exists it costs one read and returns. If the business already exists
 * without this owner as a member (removed by a co-owner), the batch is denied. */
export async function ensureOwnerMembership(user: FirebaseUser, business: Business): Promise<void> {
  const member = memberRef(business.id, user.uid);
  if ((await getDoc(member)).exists()) return;
  if (!user.email) throw new Error('Owner hesabının e-postası yok — üyelik yazılamaz.');

  const db = getFirestore();
  const batch = writeBatch(db);
  batch.set(doc(db, BUSINESSES, business.id), { owner_uid: user.uid, name: business.name, created_at: business.created_at });
  batch.set(member, { role: 'owner', email: normalizeEmail(user.email), created_at: nowIso() });
  batch.set(doc(db, BUSINESS_HINTS, user.uid), { business_id: business.id });
  await batch.commit();
}

export type InviteAcceptance =
  | { kind: 'none' }
  | { kind: 'needs_verification' }
  | { kind: 'joined'; businessId: UUID };

/** Turns a pending invite into a member document. `user` must be freshly
 * reloaded with a force-refreshed ID token — the rules check the token's
 * `email_verified` claim, which a stale token still reports as false. */
export async function acceptPendingInvite(user: FirebaseUser): Promise<InviteAcceptance> {
  if (!user.email) return { kind: 'none' };
  const email = normalizeEmail(user.email);
  const invite = inviteRef(email);
  const snap = await getDoc(invite);
  if (!snap.exists()) return { kind: 'none' };
  if (!user.emailVerified) return { kind: 'needs_verification' };

  const { business_id: businessId, role } = snap.data() as { business_id: UUID; role: EmployeeRole };
  const member = memberRef(businessId, user.uid);
  if (!(await getDoc(member)).exists()) {
    await setDoc(member, { role, email, created_at: nowIso() });
  }
  await setDoc(doc(getFirestore(), BUSINESS_HINTS, user.uid), { business_id: businessId });
  try {
    await deleteDoc(invite);
  } catch (e) {
    console.log('[Membership] accepted invite could not be deleted (harmless):', e);
  }
  return { kind: 'joined', businessId };
}
