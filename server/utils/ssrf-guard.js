/**
 * SSRF guard for server-side image fetches (export/render paths).
 *
 * Blocks requests to loopback, private, link-local (incl. cloud metadata
 * 169.254.169.254), unique-local and other non-public IP ranges, so a
 * user-controlled image URL in a slide can't make the server (or headless
 * Chrome, via inlined images) reach internal services.
 *
 * See docs/plans/security-hardening.md item 2.
 *
 * NOTE on DNS rebinding: we resolve the hostname and validate every returned
 * address before fetching, then fetch by hostname (which re-resolves). A
 * determined attacker controlling an authoritative DNS server could return a
 * public address here and a private one on the real fetch (TOCTOU). Closing
 * that fully requires pinning the connection to the validated IP; this guard
 * blocks the straightforward metadata/internal-host SSRF, which is the
 * documented threat. Fetches are also capped in size and time.
 */

import dns from 'node:dns/promises';
import net from 'node:net';

/** Max bytes we will pull from a remote image (defense against memory DoS). */
const MAX_REMOTE_IMAGE_BYTES = 15 * 1024 * 1024; // 15 MB
/** Per-fetch timeout. */
const REMOTE_FETCH_TIMEOUT_MS = 8000;

/**
 * Parse an IPv4 dotted-quad into its 32-bit integer, or null.
 * @param {string} ip
 * @returns {number|null}
 */
function ipv4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

/**
 * Is an IPv4 address outside the publicly-routable ranges we allow?
 * @param {string} ip
 * @returns {boolean}
 */
function isPrivateIpv4(ip) {
  const n = ipv4ToInt(ip);
  if (n == null) return true; // unparseable → treat as unsafe
  const inRange = (base, bits) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) === (ipv4ToInt(base) & mask);
  };
  return (
    inRange('0.0.0.0', 8) || // "this" network
    inRange('10.0.0.0', 8) || // private
    inRange('100.64.0.0', 10) || // carrier-grade NAT
    inRange('127.0.0.0', 8) || // loopback
    inRange('169.254.0.0', 16) || // link-local (incl. 169.254.169.254 metadata)
    inRange('172.16.0.0', 12) || // private
    inRange('192.0.0.0', 24) || // IETF protocol assignments
    inRange('192.0.2.0', 24) || // TEST-NET-1
    inRange('192.168.0.0', 16) || // private
    inRange('198.18.0.0', 15) || // benchmarking
    inRange('198.51.100.0', 24) || // TEST-NET-2
    inRange('203.0.113.0', 24) || // TEST-NET-3
    inRange('224.0.0.0', 4) || // multicast
    inRange('240.0.0.0', 4) // reserved / broadcast
  );
}

/**
 * Expand an IPv6 literal into its 8 hextets (integers 0..0xffff). Handles
 * `::` compression and a trailing dotted-IPv4 group. Returns null if the
 * string is not a well-formed IPv6 address. Callers past net.isIP() already
 * know it is valid, but this stays defensive on its own.
 * @param {string} addr lowercased, zone-id already stripped
 * @returns {number[]|null}
 */
function expandIpv6(addr) {
  // Fold a trailing dotted-IPv4 group (::ffff:1.2.3.4) into two hextets.
  const v4 = addr.match(/^(.*:)((?:\d{1,3}\.){3}\d{1,3})$/);
  if (v4) {
    const octets = v4[2].split('.').map((o) => Number(o));
    if (octets.some((o) => !Number.isInteger(o) || o > 255)) return null;
    const h1 = ((octets[0] << 8) | octets[1]).toString(16);
    const h2 = ((octets[2] << 8) | octets[3]).toString(16);
    addr = `${v4[1]}${h1}:${h2}`;
  }

  const halves = addr.split('::');
  if (halves.length > 2) return null; // more than one '::' is invalid
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : null;

  let groups;
  if (tail === null) {
    groups = head;
  } else {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    groups = [...head, ...Array(fill).fill('0'), ...tail];
  }
  if (groups.length !== 8) return null;

  const out = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

/**
 * Is an IPv6 address non-public (loopback, link-local, unique-local, or an
 * IPv4-mapped/embedded address pointing at a private v4)?
 * @param {string} ip
 * @returns {boolean}
 */
function isPrivateIpv6(ip) {
  const addr = ip.toLowerCase().split('%')[0]; // strip zone id
  if (addr === '::1' || addr === '::') return true;

  // IPv4-mapped (::ffff:0:0/96) or IPv4-compatible (::/96) — reconstruct the
  // embedded v4 from the low 32 bits and test it, regardless of whether the
  // source used dotted-decimal (::ffff:169.254.169.254) or hex-group form
  // (::ffff:a9fe:a9fe). The hex-group form used to slip past a dotted-only
  // regex and reach an internal address (169.254.169.254, 127.0.0.1, ...).
  const hextets = expandIpv6(addr);
  if (hextets) {
    const highBitsZero = hextets.slice(0, 5).every((h) => h === 0);
    const isMapped = highBitsZero && hextets[5] === 0xffff; // ::ffff:0:0/96
    const isCompatible = highBitsZero && hextets[5] === 0; // ::/96 (deprecated)
    if (isMapped || isCompatible) {
      const embedded = `${hextets[6] >> 8}.${hextets[6] & 0xff}.${hextets[7] >> 8}.${hextets[7] & 0xff}`;
      return isPrivateIpv4(embedded);
    }
  }

  const first = addr.split(':')[0] || '';
  const head = parseInt(first || '0', 16);
  // fc00::/7 unique-local (fc00–fdff)
  if ((head & 0xfe00) === 0xfc00) return true;
  // fe80::/10 link-local (fe80–febf)
  if ((head & 0xffc0) === 0xfe80) return true;
  return false;
}

/**
 * True if a resolved IP literal is not a public, routable address.
 * @param {string} ip
 * @returns {boolean}
 */
export function isPrivateAddress(ip) {
  const kind = net.isIP(ip);
  if (kind === 4) return isPrivateIpv4(ip);
  if (kind === 6) return isPrivateIpv6(ip);
  return true; // not an IP → unsafe
}

/**
 * Validate that a URL is an http(s) URL whose host resolves only to public
 * addresses. Throws an Error (with .code) if not.
 * @param {string} rawUrl
 * @returns {Promise<URL>} the parsed URL when allowed
 */
export async function assertPublicHttpUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    const err = new Error('Invalid URL');
    err.code = 'SSRF_INVALID_URL';
    throw err;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    const err = new Error(`Blocked URL scheme: ${url.protocol}`);
    err.code = 'SSRF_BAD_SCHEME';
    throw err;
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets

  // Host is an IP literal → check directly, no DNS.
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      const err = new Error(`Blocked non-public address: ${hostname}`);
      err.code = 'SSRF_BLOCKED_ADDRESS';
      throw err;
    }
    return url;
  }

  // Resolve and reject if ANY resolved address is non-public.
  let addrs;
  try {
    addrs = await dns.lookup(hostname, { all: true });
  } catch {
    const err = new Error(`DNS resolution failed for ${hostname}`);
    err.code = 'SSRF_DNS_FAIL';
    throw err;
  }
  if (!addrs.length) {
    const err = new Error(`No addresses for ${hostname}`);
    err.code = 'SSRF_DNS_FAIL';
    throw err;
  }
  for (const { address } of addrs) {
    if (isPrivateAddress(address)) {
      const err = new Error(
        `Blocked host ${hostname} → non-public address ${address}`
      );
      err.code = 'SSRF_BLOCKED_ADDRESS';
      throw err;
    }
  }
  return url;
}

/**
 * True if a string is a remote http(s) URL (vs a local /path or data: URI).
 * @param {string} s
 * @returns {boolean}
 */
export function isRemoteHttpUrl(s) {
  return /^https?:\/\//i.test(String(s || '').trim());
}

/**
 * Fetch a remote image after SSRF validation. Returns the bytes + content-type,
 * or null if the URL is blocked, fails, is too large, or is not an image.
 * Never throws.
 * @param {string} rawUrl
 * @param {Object} [opts]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.maxBytes]
 * @returns {Promise<{buffer: Buffer, contentType: string}|null>}
 */
export async function safeFetchRemoteImage(rawUrl, opts = {}) {
  const timeoutMs = opts.timeoutMs || REMOTE_FETCH_TIMEOUT_MS;
  const maxBytes = opts.maxBytes || MAX_REMOTE_IMAGE_BYTES;
  try {
    await assertPublicHttpUrl(rawUrl);
  } catch {
    return null;
  }
  try {
    const response = await fetch(rawUrl, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error', // don't follow redirects into private space
    });
    if (!response.ok) return null;

    const contentType = String(
      response.headers.get('content-type') || ''
    ).split(';')[0].trim().toLowerCase();
    // Only accept images; reject e.g. an internal JSON metadata endpoint.
    if (contentType && !contentType.startsWith('image/')) return null;

    const declared = Number(response.headers.get('content-length') || 0);
    if (declared && declared > maxBytes) return null;

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) return null;
    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: contentType || 'application/octet-stream',
    };
  } catch {
    return null;
  }
}
