// AuthService — Firebase Auth wrapper (CLAUDE.md §6: "giriş, davet,
// uid ↔ Employee eşleme"). This is the ONLY file that imports
// @react-native-firebase/auth directly; everything else in the app talks to
// Firebase Auth through this.
//
// Identity vs. profile split, on purpose: Firebase Auth owns identity
// (uid, email, password) — nothing else. Everything about WHO that person
// is inside a business (display name, role, which business, active/soft-
// deleted) lives in the local `employee` table (repository/), keyed by
// `firebase_uid`. Firebase Auth is never asked "what's this user's role" —
// only the Repository is.
//
// API note: @react-native-firebase/auth v26 uses the modular firebase-js-sdk
// v9-style API (getAuth() + free functions), not the older namespaced
// `auth()` default-export object some tutorials still show — that older
// form doesn't exist in this version, and every call below takes the `Auth`
// instance as an explicit first argument, matching it.

import {
  createUserWithEmailAndPassword,
  getAuth,
  getIdToken,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
  type User,
  type UserCredential,
} from '@react-native-firebase/auth';

import { normalizeEmail } from '../lib/firebaseErrors';
import type { Employee, UUID } from '../models';
import type { Repository } from '../repository';

export type FirebaseUser = User;

export class AuthService {
  private readonly auth: Auth;

  constructor(private readonly repository: Repository) {
    this.auth = getAuth();
  }

  signInWithEmail(email: string, password: string): Promise<UserCredential> {
    return signInWithEmailAndPassword(this.auth, email, password);
  }

  /** For the very first owner of a business only — see the note on
   * `resolveEmployee` below. Everyday teammates are invited (an Employee
   * row exists for them before they ever sign in), not self-registered. */
  async signUpWithEmail(email: string, password: string): Promise<UserCredential> {
    const credential = await createUserWithEmailAndPassword(this.auth, email, password);
    // Accepting an invite requires a verified email (firestore.rules); founders
    // don't need it, so a failed send must not fail the signup.
    try {
      await sendEmailVerification(credential.user);
    } catch (e) {
      console.log('[AuthService] verification email not sent:', e);
    }
    return credential;
  }

  async resendVerificationEmail(): Promise<void> {
    const user = this.auth.currentUser;
    if (user && !user.emailVerified) await sendEmailVerification(user);
  }

  /** Reloads the user and force-refreshes the ID token: security rules read
   * `email_verified` from the token, which stays stale after the user clicks
   * the verification link until it is refreshed. */
  async refreshCurrentUser(): Promise<FirebaseUser | null> {
    const user = this.auth.currentUser;
    if (!user) return null;
    await reload(user);
    await getIdToken(user, true);
    return this.auth.currentUser;
  }

  signOut(): Promise<void> {
    return signOut(this.auth);
  }

  getCurrentUser(): FirebaseUser | null {
    return this.auth.currentUser;
  }

  /** Returns an unsubscribe function — call it on unmount. */
  onAuthStateChanged(callback: (user: FirebaseUser | null) => void): () => void {
    return onAuthStateChanged(this.auth, callback);
  }

  /**
   * §5.2: "firebase_uid davet kabul edilince bağlanır" — after a Firebase
   * sign-in, resolve which Employee row this uid belongs to.
   *
   * - Already linked (firebase_uid set on some Employee) → return it.
   * - Not linked → null: a new signup, a fresh install, or an invite not yet
   *   accepted. The session's join flow (Firestore invite → restore backup →
   *   `bindInvitedEmployee`) handles the latter two.
   */
  async resolveEmployee(user: FirebaseUser): Promise<Employee | null> {
    return this.repository.employees.getByFirebaseUid(user.uid);
  }

  /** After an invited user restores their business's backup, their Employee
   * row exists (created by the inviter) but has no `firebase_uid` yet — bind
   * it by email. Returns null if the backup predates the invite. */
  async bindInvitedEmployee(user: FirebaseUser, businessId: UUID): Promise<Employee | null> {
    const linked = await this.repository.employees.getByFirebaseUid(user.uid);
    if (linked) return linked;
    if (!user.email) return null;
    const email = normalizeEmail(user.email);
    const roster = await this.repository.employees.listByBusiness(businessId);
    const match = roster.find((e) => !e.firebase_uid && e.email && normalizeEmail(e.email) === email);
    if (!match) return null;
    await this.repository.employees.update(match.id, { firebase_uid: user.uid });
    return { ...match, firebase_uid: user.uid };
  }
}
