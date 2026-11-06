// Session bootstrap (CLAUDE.md §3: "Firebase Auth entegrasyonu + Business /
// Employee oluşturma akışı"). Wraps AuthService + Repository into one
// context so screens never talk to either directly.
//
// Session shape, deliberately a small state machine rather than a loose
// bag of nullable fields — every screen can switch on `status` and know
// exactly what it's allowed to render:
//
//   loading       → still resolving auth state on boot
//   signed_out    → no Firebase user
//   needs_business→ Firebase user exists, but resolveEmployee() found no
//                   linked Employee row — either a brand-new signup with no
//                   business yet, or an invite not yet matched (see the
//                   caveat on AuthService.resolveEmployee)
//   ready         → user + employee + business all resolved

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { isPermissionDenied } from '../lib/firebaseErrors';
import type { Business, Employee } from '../models';
import { getRepository, resetRepository } from '../repository';
import type { Repository } from '../repository';
import { AuthService, type FirebaseUser } from './AuthService';
import { backupService } from './BackupService';
import { acceptPendingInvite, ensureOwnerMembership, findBusinessHint } from './MembershipService';
import { NotificationService } from './NotificationService';

type SessionStatus = 'loading' | 'signed_out' | 'needs_business' | 'ready';

/** Outcome of `joinExistingBusiness()` for the needs_business screen.
 * - nothing: no business on record for this account and no pending invite
 * - needs_verification: an invite exists, but the email isn't verified yet
 * - no_backup: membership is fine, the business just has no backup yet
 * - not_in_backup: the latest backup predates this person's invite
 * - joined: restored and signed in (status is now `ready`) */
export type JoinResult = 'nothing' | 'needs_verification' | 'no_backup' | 'not_in_backup' | 'joined';

interface SessionState {
  status: SessionStatus;
  user: FirebaseUser | null;
  employee: Employee | null;
  business: Business | null;
  /** Resolved once, in the boot effect. Exposed here (not just kept in the
   * ref) so `useActorContext()` and screens can read it synchronously once
   * `status` settles — no consumer should call `getRepository()` itself. */
  repository: Repository | null;
  /** Set by a failed signIn/signUp/createBusiness call; cleared on the next attempt. */
  error: string | null;
}

interface SessionContextValue extends SessionState {
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<void>;
  /** Only valid in `needs_business` — creates the Business plus this user as
   * its first `owner` Employee, then the state machine moves to `ready`. */
  createBusiness(input: { name: string; base_currency: string }): Promise<void>;
  /** Only valid in `needs_business`: the "yedekten geri yükle" flow (CLAUDE.md
   * §3) for both a returning member on a new device (via the
   * employee_business_map hint) and an invited employee (via their pending
   * invite, which requires a verified email). Restores the business's latest
   * backup and signs in. Non-success outcomes are results, not errors. */
  joinExistingBusiness(): Promise<JoinResult>;
  resendVerificationEmail(): Promise<void>;
  /** Re-reads the Business row from the repository and updates session
   * state — for screens that write to `business` directly via a service
   * (e.g. `SettingsService`) and need the session's copy to catch up,
   * since nothing else here watches for that write. */
  refreshBusiness(): Promise<void>;
  signOut(): Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession() must be used inside <SessionProvider>');
  return ctx;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({
    status: 'loading',
    user: null,
    employee: null,
    business: null,
    repository: null,
    error: null,
  });

  // Repository + AuthService are created once and kept in refs — both are
  // needed synchronously by signIn/signUp/etc, but Repository construction
  // is itself async (opens + migrates SQLite), so the ref starts null and
  // fills in once, in the boot effect below.
  const repoRef = useRef<Repository | null>(null);
  const authRef = useRef<AuthService | null>(null);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      const repository = await getRepository();
      if (cancelled) return;
      repoRef.current = repository;
      const authService = new AuthService(repository);
      authRef.current = authService;

      // Read through the refs: a backup restore swaps both for fresh
      // instances bound to the restored database file.
      unsubscribe = authService.onAuthStateChanged((user) => {
        void resolveSessionForUser(repoRef.current ?? repository, authRef.current ?? authService, user, setState);
      });
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  // §7.2/§9 step 7: once a session is fully resolved, register this
  // device's FCM token on the Employee row and keep it current. Doesn't
  // block anything else — a failed/denied registration is logged and
  // swallowed inside NotificationService itself.
  useEffect(() => {
    if (state.status !== 'ready' || !state.employee || !state.repository) return;
    const notificationService = new NotificationService(state.repository);
    const employee = state.employee;
    void notificationService.registerDeviceToken(employee);
    return notificationService.onTokenRefresh(employee);
  }, [state.status, state.employee, state.repository]);

  // Mirrors the founder's business + owner membership into Firestore so the
  // security rules can see it. Idempotent and retried on every launch, which
  // also covers businesses created offline or before these rules existed.
  const ownerUser = state.status === 'ready' && state.employee?.role === 'owner' ? state.user : null;
  const ownerBusiness = ownerUser ? state.business : null;
  useEffect(() => {
    if (!ownerUser || !ownerBusiness) return;
    ensureOwnerMembership(ownerUser, ownerBusiness).catch((e) => {
      console.log('[Session] owner membership not mirrored yet (retried next launch):', e);
    });
  }, [ownerUser, ownerBusiness]);

  const value = useMemo<SessionContextValue>(
    () => ({
      ...state,
      async signIn(email, password) {
        if (!authRef.current) throw new Error('Auth not ready yet');
        setState((s) => ({ ...s, error: null }));
        try {
          await authRef.current.signInWithEmail(email, password);
          // onAuthStateChanged fires and resolves the rest.
        } catch (e) {
          setState((s) => ({ ...s, error: messageFor(e) }));
          throw e;
        }
      },
      async signUp(email, password) {
        if (!authRef.current) throw new Error('Auth not ready yet');
        setState((s) => ({ ...s, error: null }));
        try {
          await authRef.current.signUpWithEmail(email, password);
        } catch (e) {
          setState((s) => ({ ...s, error: messageFor(e) }));
          throw e;
        }
      },
      async createBusiness(input) {
        const repository = repoRef.current;
        const user = state.user;
        if (!repository || !user) throw new Error('No signed-in user to attach a business to');
        if (state.status !== 'needs_business') {
          throw new Error('createBusiness() is only valid while status is "needs_business"');
        }
        setState((s) => ({ ...s, error: null }));
        try {
          const business = await repository.business.create({
            name: input.name,
            base_currency: input.base_currency,
            plan_tier: 'solo',
          });
          // Eksen tabanlı varyant sistemi: her yeni business, mevcut
          // business'lar için db/schema.ts migration 12'nin yaptığı aynı
          // iki sistem eksenini (Renk/Beden) hazır alır — bu ikisi artık
          // sıradan attribute satırları, ürün ekranı bunları özel olarak
          // bilmiyor, sadece `is_system=1` diye işaretli geliyor.
          await repository.attributes.create({ business_id: business.id, code: 'color', name: 'Renk', data_type: 'option', is_system: 1 });
          await repository.attributes.create({ business_id: business.id, code: 'size', name: 'Beden', data_type: 'option', is_system: 1 });
          const employee = await repository.employees.create({
            business_id: business.id,
            firebase_uid: user.uid,
            display_name: user.displayName ?? user.email ?? 'Owner',
            email: user.email,
            phone: user.phoneNumber,
            role: 'owner',
          });
          // Firestore business/member/hint documents are written by the owner
          // membership effect as soon as status is `ready`.
          setState({ status: 'ready', user, employee, business, repository, error: null });
        } catch (e) {
          setState((s) => ({ ...s, error: messageFor(e) }));
          throw e;
        }
      },
      async joinExistingBusiness() {
        const authService = authRef.current;
        if (!repoRef.current || !authService || !state.user) throw new Error('No signed-in user to restore a backup for');
        if (state.status !== 'needs_business') {
          throw new Error('joinExistingBusiness() is only valid while status is "needs_business"');
        }
        setState((s) => ({ ...s, error: null }));
        try {
          const user = (await authService.refreshCurrentUser()) ?? state.user;
          let businessId = await findBusinessHint(user.uid);
          if (!businessId) {
            const invite = await acceptPendingInvite(user);
            if (invite.kind === 'none') return 'nothing';
            if (invite.kind === 'needs_verification') return 'needs_verification';
            businessId = invite.businessId;
          }
          const restored = await backupService.restoreLatest(businessId);
          if (!restored) return 'no_backup';
          // restoreLatest() closed the live db connection and overwrote the
          // file on disk — the old repository's table wrappers are bound to
          // that stale handle, so build a fresh one before reading anything.
          resetRepository();
          const freshRepository = await getRepository();
          repoRef.current = freshRepository;
          const freshAuth = new AuthService(freshRepository);
          authRef.current = freshAuth;
          const employee = await freshAuth.bindInvitedEmployee(user, businessId);
          await resolveSessionForUser(freshRepository, freshAuth, user, setState);
          return employee ? 'joined' : 'not_in_backup';
        } catch (e) {
          setState((s) => ({ ...s, error: joinErrorMessage(e) }));
          throw e;
        }
      },
      async resendVerificationEmail() {
        await authRef.current?.resendVerificationEmail();
      },
      async refreshBusiness() {
        const repository = repoRef.current;
        if (!repository || !state.business) return;
        const business = await repository.business.getById(state.business.id);
        if (business) setState((s) => ({ ...s, business }));
      },
      async signOut() {
        if (!authRef.current) return;
        await authRef.current.signOut();
        // onAuthStateChanged fires with null and resets state.
      },
    }),
    [state],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

async function resolveSessionForUser(
  repository: Repository,
  authService: AuthService,
  user: FirebaseUser | null,
  setState: (updater: (s: SessionState) => SessionState) => void,
): Promise<void> {
  if (!user) {
    setState(() => ({ status: 'signed_out', user: null, employee: null, business: null, repository, error: null }));
    return;
  }

  const employee = await authService.resolveEmployee(user);
  if (!employee) {
    setState(() => ({ status: 'needs_business', user, employee: null, business: null, repository, error: null }));
    return;
  }

  const business = await repository.business.getById(employee.business_id);
  setState(() => ({ status: 'ready', user, employee, business, repository, error: null }));
}

function joinErrorMessage(e: unknown): string {
  if (isPermissionDenied(e)) {
    return 'Bu işletmeye erişimin yok — üyeliğin kaldırılmış olabilir. Yöneticinden yeniden davet iste.';
  }
  return messageFor(e);
}

function messageFor(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
