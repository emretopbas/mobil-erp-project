function errorCode(e: unknown): string | undefined {
  if (typeof e !== 'object' || e === null || !('code' in e)) return undefined;
  return String((e as { code: unknown }).code);
}

/** RNFirebase reports a security-rules rejection as `firestore/permission-denied`
 * or `storage/unauthorized`; anything else (offline, timeout) is a transport error. */
export function isPermissionDenied(e: unknown): boolean {
  const code = errorCode(e);
  return code === 'firestore/permission-denied' || code === 'storage/unauthorized';
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
