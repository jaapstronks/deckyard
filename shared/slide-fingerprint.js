/**
 * Content fingerprints for slides, shared by client and server.
 *
 * The editor records a fingerprint of every slide as last acknowledged by the
 * server (its "base"). On a revision-conflicted save it sends the base
 * fingerprints of the slides it modified; the server compares them against
 * its *current* slides. A mismatch means the slide changed on the server too
 * since the client's base — a true concurrent edit — so the save conflicts
 * instead of letting the last (possibly stale) writer win.
 */

/**
 * Deterministic JSON serialization: object keys sorted, arrays in order,
 * `undefined` object values dropped (JSON.stringify drops them too).
 * @param {*} value - Any JSON-serializable value
 * @returns {string} Canonical JSON string
 */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
    .join(',')}}`;
}

/**
 * Fingerprint a slide's full content (FNV-1a 32-bit over canonical JSON).
 * Stable across client and server and across object key order.
 * @param {Object|null} slide - Slide document
 * @returns {string} 8-char lowercase hex fingerprint
 */
export function slideFingerprint(slide) {
  const str = canonicalJson(slide ?? null);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
