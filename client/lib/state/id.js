// Single place for client-side ID creation.
// Prefer cryptographically-strong UUIDs when available, but keep a safe fallback
// for older browsers / restricted environments.

export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();

  const c = globalThis.crypto;
  if (c?.getRandomValues) {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    // RFC4122 v4: set version + variant bits.
    // eslint-disable-next-line no-bitwise
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    // eslint-disable-next-line no-bitwise
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
  }

  // Last-resort fallback (not cryptographically strong, but unique enough for UI IDs).
  return `id-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}
