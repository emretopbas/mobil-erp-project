// BackupService (CLAUDE.md §6, §7.3, §9 step 8): "Şifreli SQLite blob →
// Firebase Storage... günde 1 kez."
//
// Key management (decided with the user, see progress.md): no user-remembered
// passphrase and no device-only key — a device upgrade is the normal restore
// case for this app. Instead one random 256-bit key per business, generated
// once and stored in Firestore (`business_backup_keys/{businessId}`). Restoring
// on any device is then just "sign in as a member".
//
// Who counts as a member is decided by `businesses/{businessId}/members/{uid}`
// (see MembershipService.ts) — firestore.rules lets only members read the key
// and only owners/managers create it, never update or delete it (overwriting
// it would make every existing backup undecryptable); storage.rules applies the
// same membership check to `backups/{businessId}/…`. The key document is the
// §2 "small config/metadata" carve-out, not operational data.
//
// What this buys: the blob alone (leaked URL, misconfigured bucket) is useless
// without Firestore membership, and a removed employee loses both at once.

import { doc, getDoc, getFirestore, setDoc } from '@react-native-firebase/firestore';
import { getStorage, listAll, ref, uploadString, writeToFile } from '@react-native-firebase/storage';
import { EncodingType, File, Paths } from 'expo-file-system';
import CryptoJS from 'crypto-js';

import { closeDbConnection, DATABASE_NAME } from '../db/client';
import type { ActorContext } from './context';
import { requirePermission } from './rbac';

const KEYS_COLLECTION = 'business_backup_keys';

/** storage.rules only matches `backups/{businessId}/{file}` — a single-segment
 * match at the bucket root would match every path and is hard to restrict. */
function backupFolder(businessId: string): string {
  return `backups/${businessId}`;
}

function dbFile(): File {
  return new File(Paths.document, 'SQLite', DATABASE_NAME);
}

async function readBusinessKey(businessId: string): Promise<string | null> {
  const snap = await getDoc(doc(getFirestore(), KEYS_COLLECTION, businessId));
  return snap.exists() ? (snap.data() as { key: string }).key : null;
}

async function getOrCreateBusinessKey(businessId: string): Promise<string> {
  const existing = await readBusinessKey(businessId);
  if (existing) return existing;
  // Dynamic import, not a top-level one: expo-crypto's native module throws
  // synchronously the instant it's *required* (RNFirebase's modules are
  // lazier — they only touch native code once a function is actually
  // called), so a top-level `import * as Crypto from 'expo-crypto'` here
  // would crash every screen that transitively imports BackupService (most
  // of them, via services/index.ts) on any device whose installed build
  // predates this native dependency — not just the one flow that needs it.
  const Crypto = await import('expo-crypto');
  const randomBytes = await Crypto.getRandomBytesAsync(32);
  const key = CryptoJS.enc.Latin1.parse(String.fromCharCode(...randomBytes)).toString(CryptoJS.enc.Base64);
  await setDoc(doc(getFirestore(), KEYS_COLLECTION, businessId), { key, created_at: new Date().toISOString() });
  return key;
}

export class BackupService {
  /** §9 step 8: encrypts the local SQLite file and uploads it to
   * `backups/{businessId}/<timestamp>.enc` in Firebase Storage.
   * Owner/manager only (§5.4's `settings` row — same gate as
   * SettingsService). */
  async backupNow(ctx: ActorContext): Promise<void> {
    requirePermission(ctx.employee.role, 'settings', 'update');
    const business = ctx.business;

    const key = await getOrCreateBusinessKey(business.id);
    const file = dbFile();
    if (!file.exists) {
      throw new Error('Yedeklenecek yerel veritabanı bulunamadı.');
    }
    const rawBase64 = await file.base64();
    const ciphertext = CryptoJS.AES.encrypt(rawBase64, key).toString();

    const storage = getStorage();
    const fileName = `${new Date().toISOString().replace(/[:.]/g, '-')}.enc`;
    const storageRef = ref(storage, `${backupFolder(business.id)}/${fileName}`);
    await uploadString(storageRef, ciphertext, 'raw');

    const now = new Date().toISOString();
    await ctx.repository.business.update(business.id, { last_backup_at: now });
  }

  /** Restores the most recent backup for `businessId` onto THIS device,
   * overwriting the local SQLite file. Closes the live DB connection first
   * — `getDb()` re-opens the restored file on its next call. Returns false
   * if no backup exists yet for this business (not an error — a business
   * that's never been backed up has nothing to restore). Deliberately
   * takes a bare `businessId`, not an `ActorContext` — the "restore on a
   * fresh device" flow runs *before* a local Employee row (and therefore an
   * ActorContext) can exist. The real gate is the security rules: listing
   * the folder and reading the key both require a member document for this
   * business. Backups written before the `backups/` prefix existed are
   * intentionally not looked for. */
  async restoreLatest(businessId: string): Promise<boolean> {
    const storage = getStorage();
    const { items } = await listAll(ref(storage, backupFolder(businessId)));
    if (items.length === 0) return false;

    // Filenames are ISO timestamps with `:`/`.` replaced by `-` (see
    // backupNow) — still lexicographically sortable, so the last name after
    // a plain string sort is the most recent backup.
    const latestName = items.map((item) => item.name).sort().at(-1)!;
    const latestRef = ref(storage, `${backupFolder(businessId)}/${latestName}`);

    // Never create a key here: a fresh key cannot decrypt an existing blob.
    const key = await readBusinessKey(businessId);
    if (!key) throw new Error('Bu işletmenin yedek anahtarı bulunamadı — yedek çözülemez.');
    const tmpFile = new File(Paths.cache, `restore-${Date.now()}.enc`);
    try {
      await writeToFile(latestRef, tmpFile.uri);
      const ciphertext = await tmpFile.text();
      const rawBase64 = CryptoJS.AES.decrypt(ciphertext, key).toString(CryptoJS.enc.Utf8);
      if (!rawBase64) {
        throw new Error('Yedek şifresi çözülemedi (yanlış anahtar veya bozuk yedek).');
      }

      await closeDbConnection();
      const target = dbFile();
      target.write(rawBase64, { encoding: EncodingType.Base64 });
    } finally {
      if (tmpFile.exists) tmpFile.delete();
    }
    return true;
  }
}

export const backupService = new BackupService();
