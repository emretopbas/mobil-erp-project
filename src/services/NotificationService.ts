// NotificationService — FCM wrapper (CLAUDE.md §6, §7.2, §9 step 7): "FCM
// ile düşük stok / görev atama bildirimi." This is the ONLY file that
// imports @react-native-firebase/messaging directly, same pattern as
// AuthService for @react-native-firebase/auth.
//
// Two genuinely different things live here, and it's important not to
// blur them:
//
// 1. **Device token registration** (real, working now): requests
//    notification permission, reads the device's FCM token, and saves it
//    on the signed-in Employee row (§7.2: "cihaz token'ı Employee ile
//    eşlenir"). Wired into SessionProvider — every session that reaches
//    `ready` registers/refreshes its token automatically.
//
// 2. **Actually sending a push for a business event** (low-stock, task
//    assigned, check due soon): CANNOT happen from here. FCM pushes are
//    sent BY a server holding this project's Admin SDK / server key — a
//    client app can register to *receive* pushes, but has no API to send
//    one to another device (or even itself) directly. Faz 1's data layer
//    is local SQLite (+ Turso for the team tier); there's no backend
//    process watching for a low-stock write and relaying it. §2 reserves
//    Cloud Functions for Faz 2 channel webhooks, but a low-stock/task-
//    assignment trigger is exactly the kind of small Cloud Function that
//    would need to exist for this to become real pushes — that's a
//    concrete Faz 1.5 task, not built here.
//
// So `notifyLowStock`/`notifyTaskAssigned`/`notifyCheckDueSoon` below are
// the exact hook points StockService/TaskService/FinanceService already
// call (see their own comments) — they log a structured, easy-to-grep
// intent record for now instead of pretending to push. Swapping the body
// of these three methods for a real server call (e.g. an HTTPS Cloud
// Function) is the entire migration once that backend piece exists —
// nothing calling them needs to change.

import {
  getMessaging,
  getToken,
  onTokenRefresh,
  requestPermission,
  AuthorizationStatus,
  type Messaging,
} from '@react-native-firebase/messaging';

import type { Employee, UUID } from '../models';
import type { Repository } from '../repository';

export class NotificationService {
  private readonly messaging: Messaging;

  constructor(private readonly repository: Repository) {
    this.messaging = getMessaging();
  }

  /** Requests permission (iOS prompts; Android <13 is granted implicitly,
   * 13+ prompts) and saves the current device token on `employee`. Safe to
   * call repeatedly — a denied/unavailable permission or a token read
   * failure (e.g. no Google Play Services on some emulator images) is
   * caught and logged, never thrown, since this must never block sign-in. */
  async registerDeviceToken(employee: Employee): Promise<void> {
    try {
      const status = await requestPermission(this.messaging);
      const granted = status === AuthorizationStatus.AUTHORIZED || status === AuthorizationStatus.PROVISIONAL;
      if (!granted) {
        console.log(`[NotificationService] permission not granted (status=${status}) — skipping token registration`);
        return;
      }
      const token = await getToken(this.messaging);
      if (token !== employee.fcm_token) {
        await this.repository.employees.update(employee.id, { fcm_token: token });
      }
    } catch (e) {
      console.log('[NotificationService] registerDeviceToken failed (non-fatal):', e);
    }
  }

  /** Returns an unsubscribe function — call it on unmount. Keeps the saved
   * token current if FCM rotates it (documented as happening on app
   * reinstall, storage clear, or token expiry). */
  onTokenRefresh(employee: Employee): () => void {
    return onTokenRefresh(this.messaging, (token) => {
      void this.repository.employees.update(employee.id, { fcm_token: token }).catch((e) => {
        console.log('[NotificationService] failed to persist refreshed token (non-fatal):', e);
      });
    });
  }

}

// The three notify* hooks are plain functions, not methods on the class
// above — they need neither a Messaging instance nor a Repository (they
// only log, for now; see the header comment), and other services
// (StockService, TaskService, FinanceService) call them directly without
// having to construct a NotificationService (which needs a live Repository
// only SessionProvider holds at the moment a session becomes 'ready').

/** §5.1 hook point, called from StockService.recordMovement() once
 * `nextOnHand <= threshold`. See this file's header comment for why this
 * logs instead of pushing today. */
export async function notifyLowStock(businessId: UUID, variantId: UUID, onHand: number, threshold: number): Promise<void> {
  console.log('[NotificationService] low-stock event (not yet pushed — see NotificationService.ts):', {
    businessId,
    variantId,
    onHand,
    threshold,
  });
}

/** §5.3 hook point, called from TaskService.create()/reassign(). */
export async function notifyTaskAssigned(taskId: UUID, assigneeId: UUID, title: string): Promise<void> {
  console.log('[NotificationService] task-assigned event (not yet pushed — see NotificationService.ts):', {
    taskId,
    assigneeId,
    title,
  });
}

/** §5.6 hook point — called from FinanceService.upcomingDueChecks() today
 * (on-demand, when a screen asks); a real "3 gün kala" reminder needs a
 * background scheduler polling this periodically, which doesn't exist yet
 * (same gap noted on BackupService's daily-backup side in progress.md). */
export async function notifyCheckDueSoon(checkId: UUID, dueDate: string, amountMinor: number): Promise<void> {
  console.log('[NotificationService] check-due-soon event (not yet pushed — see NotificationService.ts):', {
    checkId,
    dueDate,
    amountMinor,
  });
}
