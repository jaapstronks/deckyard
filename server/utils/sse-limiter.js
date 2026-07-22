/**
 * Connection limiter for public Server-Sent Events streams.
 *
 * The follow/questions/present-session `/events` endpoints are unauthenticated
 * and long-lived: a client can open one and hold it open indefinitely. Without a
 * cap, thousands of open streams exhaust file descriptors and memory (a cheap
 * DoS, since each only needs a GET). See docs/plans security audit MH3.
 *
 * Defense (all env-tunable):
 *   1. A global concurrent-stream cap — the hard file-descriptor/memory bound.
 *   2. A per-IP concurrent cap — bounds a single abuser. Applied ONLY when the
 *      observed client IP is a real, public address that distinguishes clients.
 *      Behind a reverse proxy / NAT the observed IP is the proxy's (loopback or
 *      private) address shared by the whole audience, so a per-IP cap there
 *      would throttle legitimate followers en masse; in that case we fall back
 *      to the global cap only. When TRUST_PROXY feeds real client IPs via
 *      X-Forwarded-For, the per-IP cap works per device again.
 *   3. An absolute lifetime after which a stream is force-closed. SSE clients
 *      (EventSource) auto-reconnect, so this only bounds how long any single
 *      connection can pin resources; it is not visible to well-behaved clients.
 */

import { getClientIp } from './rate-limit.js';
import { isPrivateAddress } from './ssrf-guard.js';

function num(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

/** Total concurrent public SSE streams allowed across the server. */
function globalMax() {
  return num(process.env.SSE_MAX_CONNECTIONS, 2000);
}
/** Concurrent streams allowed per distinguishable client IP. */
function perIpMax() {
  return num(process.env.SSE_MAX_CONNECTIONS_PER_IP, 50);
}
/** Absolute stream lifetime before a force-close (ms). */
function maxLifetimeMs() {
  return num(process.env.SSE_MAX_LIFETIME_MS, 6 * 60 * 60 * 1000);
}

let globalCount = 0;
/** @type {Map<string, number>} live stream count per distinguishable IP. */
const perIpCount = new Map();

/**
 * Whether a per-IP cap can meaningfully be applied to this IP. Loopback/private
 * addresses mean we're almost certainly behind a proxy and the IP is shared by
 * many clients, so per-IP counting is skipped (global cap still applies).
 * @param {string} ip
 * @returns {boolean}
 */
function ipIsDistinguishable(ip) {
  return !!ip && ip !== 'unknown' && !isPrivateAddress(ip);
}

/**
 * Try to reserve a slot for a new SSE stream. Increments counters on success.
 * @param {import('http').IncomingMessage} req
 * @returns {{ ok: true, release: () => void, ip: string } | { ok: false, reason: 'global'|'per-ip' }}
 */
export function tryAcquireSseSlot(req) {
  const ip = getClientIp(req);
  const perIp = ipIsDistinguishable(ip);

  if (globalCount >= globalMax()) return { ok: false, reason: 'global' };
  if (perIp && (perIpCount.get(ip) || 0) >= perIpMax())
    return { ok: false, reason: 'per-ip' };

  globalCount += 1;
  if (perIp) perIpCount.set(ip, (perIpCount.get(ip) || 0) + 1);

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    globalCount = Math.max(0, globalCount - 1);
    if (perIp) {
      const next = (perIpCount.get(ip) || 1) - 1;
      if (next <= 0) perIpCount.delete(ip);
      else perIpCount.set(ip, next);
    }
  };

  return { ok: true, release, ip };
}

/**
 * Guard a public SSE handler: reserve a connection slot, send 429 (before any
 * event-stream headers) if over a cap, and otherwise wire the release + an
 * absolute-lifetime force-close to the response lifecycle.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @returns {{ release: () => void } | null} null when a 429 was sent (caller
 *   should stop and return true — the request is fully handled).
 */
export function guardSseConnection(req, res) {
  const slot = tryAcquireSseSlot(req);
  if (!slot.ok) {
    res.writeHead(429, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': '30',
    });
    res.end('Too many streaming connections, retry shortly.');
    return null;
  }

  const timer = setTimeout(() => {
    try {
      res.end();
    } catch {}
  }, maxLifetimeMs());
  timer.unref?.();

  let done = false;
  const release = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    slot.release();
  };

  res.on?.('close', release);
  res.on?.('finish', release);

  return { release };
}

/**
 * Current live counts. Exposed for tests/monitoring; not part of the contract.
 * @returns {{ global: number, distinctIps: number }}
 */
export function sseConnectionCounts() {
  return { global: globalCount, distinctIps: perIpCount.size };
}

/** Reset all counters. Test helper only. */
export function resetSseConnectionCounts() {
  globalCount = 0;
  perIpCount.clear();
}
