// Local primary-key generator. Not cryptographically strong (Math.random-
// based) — fine for a local SQLite row id; nothing here is a security token.
// Swap for `expo-crypto`'s `randomUUID()` if that guarantee ever matters.
export function newId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function nowIso(): string {
  return new Date().toISOString();
}
