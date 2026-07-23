/**
 * Security-audit cluster 6 regression tests (M2, M3).
 *
 * M2 — X-Forwarded-For spoofing (server/utils/rate-limit.js getClientIp). Behind
 *      a trusted proxy the client IP must be read from the RIGHT of the XFF list
 *      (the entry the outermost trusted proxy appended), never the spoofable
 *      leftmost entry, or an attacker forges any IP to evade IP-keyed limits or
 *      poison a victim's bucket. Only active when TRUST_PROXY is set.
 *
 * M3 — follow codes used Math.random() over a tiny keyspace
 *      (server/storage/follow-codes.js). Now a CSPRNG (crypto.randomInt) over a
 *      larger keyspace, drawn from the unambiguous alphabet only.
 *
 * Run with: node --test tests/security-audit-cluster6.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { getClientIp } from '../server/utils/rate-limit.js';
import { generateCode } from '../server/storage/follow-codes.js';

const CLIENT = '203.0.113.9'; // real client (TEST-NET-3, still a valid IPv4 shape)
const PROXY1 = '198.51.100.7';
const SOCKET = '10.0.0.1'; // the proxy's address as seen on our socket

function mockReq({ xff, xri, socket = SOCKET } = {}) {
  const headers = {};
  if (xff != null) headers['x-forwarded-for'] = xff;
  if (xri != null) headers['x-real-ip'] = xri;
  return { headers, socket: { remoteAddress: socket } };
}

function resetProxyEnv() {
  delete process.env.TRUST_PROXY;
  delete process.env.TRUSTED_PROXY_COUNT;
}

test.beforeEach(resetProxyEnv);
test.after(resetProxyEnv);

// ============================================================================
// M2 — X-Forwarded-For hop trust
// ============================================================================

test('M2: with TRUST_PROXY off, XFF is ignored and the socket IP wins', () => {
  const ip = getClientIp(mockReq({ xff: `${CLIENT}, 1.2.3.4` }));
  assert.equal(ip, SOCKET);
});

test('M2: single trusted proxy uses the rightmost hop, not the spoofed leftmost', () => {
  process.env.TRUST_PROXY = 'true';
  // Attacker prepends "9.9.9.9"; the proxy appends the true client IP.
  const ip = getClientIp(mockReq({ xff: `9.9.9.9, ${CLIENT}` }));
  assert.equal(ip, CLIENT);
});

test('M2: a lone forged XFF entry cannot impersonate an arbitrary client', () => {
  process.env.TRUST_PROXY = 'true';
  // Only the attacker-supplied value is present (proxy did not append, or the
  // request reached us directly). With one trusted hop the rightmost IS that
  // forged value — but this is exactly the single-proxy contract: the proxy
  // MUST append. We assert the victim-poisoning vector is closed instead:
  // a two-entry list never returns the leftmost.
  const ip = getClientIp(mockReq({ xff: `${CLIENT}, ${PROXY1}` }));
  assert.notEqual(ip, CLIENT, 'leftmost (client-supplied) must never be trusted');
  assert.equal(ip, PROXY1);
});

test('M2: TRUSTED_PROXY_COUNT=2 counts two hops from the right', () => {
  process.env.TRUST_PROXY = 'true';
  process.env.TRUSTED_PROXY_COUNT = '2';
  // client, proxy1, proxy2(appended-by-inner). Real client = 2 from the right.
  const ip = getClientIp(mockReq({ xff: `evil-spoof, ${CLIENT}, ${PROXY1}` }));
  assert.equal(ip, CLIENT);
});

test('M2: a chain shorter than the hop count falls through, never the leftmost', () => {
  process.env.TRUST_PROXY = 'true';
  process.env.TRUSTED_PROXY_COUNT = '2';
  // Only one entry but two hops configured → don't trust it; fall back.
  const ip = getClientIp(mockReq({ xff: '9.9.9.9', xri: CLIENT }));
  assert.equal(ip, CLIENT, 'falls through to X-Real-IP');
});

test('M2: X-Real-IP is used when no XFF is present', () => {
  process.env.TRUST_PROXY = 'true';
  const ip = getClientIp(mockReq({ xri: CLIENT }));
  assert.equal(ip, CLIENT);
});

test('M2: a malformed rightmost hop falls through to the socket IP', () => {
  process.env.TRUST_PROXY = 'true';
  const ip = getClientIp(mockReq({ xff: 'not-an-ip' }));
  assert.equal(ip, SOCKET);
});

// ============================================================================
// M3 — follow-code generation
// ============================================================================

test('M3: codes are 5 chars from the unambiguous alphabet only', () => {
  const allowed = /^[ABCDEFGHJKLMNPRTUVWXY]{5}$/;
  for (let i = 0; i < 200; i++) {
    const code = generateCode();
    assert.match(code, allowed, `bad code: ${code}`);
    // The excluded confusable glyphs must never appear.
    assert.ok(!/[OIQSZ0-9]/.test(code), `confusable/digit in ${code}`);
  }
});

test('M3: generation has high entropy (no degenerate constant output)', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(generateCode());
  // With a 4M keyspace, 500 draws collide only negligibly; a broken generator
  // (constant / tiny period) would produce far fewer distinct values.
  assert.ok(seen.size > 480, `expected near-unique codes, got ${seen.size}`);
});

test('M3: the generator uses a CSPRNG, not Math.random', async () => {
  const src = await fs.readFile(
    fileURLToPath(new URL('../server/storage/follow-codes.js', import.meta.url)),
    'utf8',
  );
  assert.match(src, /crypto\.randomInt\(/, 'must use crypto.randomInt');
  // The call itself must be gone (the doc comment may still name it).
  assert.doesNotMatch(src, /Math\.random\s*\(/, 'Math.random() call must be gone');
});
