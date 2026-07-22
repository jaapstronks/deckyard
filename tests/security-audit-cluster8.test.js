/**
 * Security-audit cluster 8 regression tests (LOW batch: L1, L3). Final cluster.
 *
 * L1 — scrypt cost + weak password policy.
 *      - Two byte-identical scrypt implementations unified into one shared,
 *        versioned util (server/utils/password-hash.js).
 *      - New hashes use OWASP-2024 cost (N=2^17) in a versioned format
 *        (`scrypt$N$r$p$salt$hash`); legacy `salt:hash` values still verify
 *        (backward compatibility is non-negotiable).
 *      - validatePassword now enforces an upper length bound; the hash util
 *        refuses over-length input (scrypt DoS guard).
 *
 * L3 — weak AUTH_SECRET only warned; stale-session sync path.
 *      - authConfigError() now refuses boot below the 32-char floor, with an
 *        explicit AUTH_ALLOW_WEAK_SECRET / sandbox-demo / AUTH_ENABLED=false
 *        escape hatch.
 *      - The sync getUserFromRequest takes no authz decision (no callers);
 *        source-verified below.
 *
 * Run with: node --test tests/security-audit-cluster8.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  hashPassword,
  verifyPassword,
  needsRehash,
  SCRYPT_PARAMS,
  MAX_PASSWORD_LENGTH,
} from '../server/utils/password-hash.js';
import { validatePassword } from '../server/storage/password-reset.js';
import {
  authConfigError,
  authConfigWarnings,
  MIN_AUTH_SECRET_LENGTH,
} from '../server/auth/auth.js';

const readSrc = (rel) =>
  fs.readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

// Reproduce a hash exactly as the OLD code produced it: scrypt Node defaults
// (N=16384, r=8, p=1), 64-byte key, "saltHex:keyHex" format.
function legacyHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const dk = crypto.scryptSync(password, salt, 64);
  return `${salt}:${dk.toString('hex')}`;
}

// ============================================================================
// L1 — backward compatibility (the hard requirement)
// ============================================================================

test('L1: a pre-existing legacy "salt:hash" still verifies after the cost bump', async () => {
  const stored = legacyHash('correct horse battery staple');
  assert.ok(!stored.startsWith('scrypt$'), 'fixture is a legacy-format hash');
  assert.equal(
    await verifyPassword('correct horse battery staple', stored),
    true,
    'legacy hash must keep verifying — existing logins/share-links must not break',
  );
  assert.equal(
    await verifyPassword('wrong password', stored),
    false,
    'legacy hash rejects a wrong password',
  );
});

test('L1: a new hash uses the versioned high-cost format and round-trips', async () => {
  const stored = await hashPassword('a strong passphrase');
  assert.match(
    stored,
    /^scrypt\$131072\$8\$1\$[0-9a-f]+\$[0-9a-f]+$/,
    'new hash is scrypt$N$r$p$salt$hash at the bumped cost',
  );
  assert.equal(SCRYPT_PARAMS.N, 131072, 'cost is OWASP 2024 N=2^17');
  assert.equal(await verifyPassword('a strong passphrase', stored), true);
  assert.equal(await verifyPassword('not it', stored), false);
});

test('L1: two independently produced hashes of the same password differ (random salt)', async () => {
  const a = await hashPassword('same');
  const b = await hashPassword('same');
  assert.notEqual(a, b, 'distinct salts → distinct hashes');
  assert.equal(await verifyPassword('same', a), true);
  assert.equal(await verifyPassword('same', b), true);
});

test('L1: needsRehash flags legacy + sub-cost hashes, not current ones', async () => {
  assert.equal(needsRehash(legacyHash('x')), true, 'legacy → rehash');
  assert.equal(needsRehash('scrypt$16384$8$1$aa$bb'), true, 'below current cost → rehash');
  assert.equal(needsRehash(await hashPassword('x')), false, 'current cost → no rehash');
  assert.equal(needsRehash(''), true, 'garbage → rehash');
});

// ============================================================================
// L1 — malformed / hostile input
// ============================================================================

test('L1: verifyPassword rejects malformed stored values without throwing', async () => {
  for (const bad of ['', null, undefined, ':', 'nosep', 'scrypt$', 'scrypt$a$b$c$d$e']) {
    assert.equal(await verifyPassword('pw', bad), false, JSON.stringify(bad));
  }
});

// ============================================================================
// L1 — password length policy (DoS bound)
// ============================================================================

test('L1: validatePassword enforces both a lower and an upper length bound', () => {
  assert.deepEqual(validatePassword('short'), { ok: false, reason: 'too_short' });
  assert.deepEqual(validatePassword('x'.repeat(8)), { ok: true });
  assert.deepEqual(validatePassword('x'.repeat(MAX_PASSWORD_LENGTH)), { ok: true });
  assert.deepEqual(
    validatePassword('x'.repeat(MAX_PASSWORD_LENGTH + 1)),
    { ok: false, reason: 'too_long' },
    'an unbounded password length is a scrypt DoS vector',
  );
});

test('L1: the hash util itself refuses over-length input (defense in depth)', async () => {
  const tooLong = 'x'.repeat(MAX_PASSWORD_LENGTH + 1);
  await assert.rejects(() => hashPassword(tooLong), /maximum length/);
  // verifyPassword short-circuits to false before doing any scrypt work.
  assert.equal(await verifyPassword(tooLong, await hashPassword('ok-length')), false);
});

// ============================================================================
// L1 — no duplicated scrypt implementation left behind
// ============================================================================

test('L1: both storage modules re-export the shared hash util, no local scrypt', async () => {
  const pwReset = await readSrc('../server/storage/password-reset.js');
  const shareLinks = await readSrc('../server/storage/share-links/index.js');

  for (const [name, src] of [['password-reset', pwReset], ['share-links', shareLinks]]) {
    assert.match(
      src,
      /from '\.\.?\/(\.\.\/)?utils\/password-hash\.js'/,
      `${name} imports the shared password-hash util`,
    );
    assert.doesNotMatch(
      src,
      /crypto\.scrypt\(\s*password/,
      `${name} no longer defines its own scrypt password hashing`,
    );
  }
});

// ============================================================================
// L3 — AUTH_SECRET boot floor
// ============================================================================

const AUTH_ENV_KEYS = [
  'AUTH_SECRET',
  'AUTH_ENABLED',
  'AUTH_ALLOW_WEAK_SECRET',
  'SANDBOX_MODE',
  'DEMO_MODE',
];

function withAuthEnv(overrides, fn) {
  const saved = {};
  for (const k of AUTH_ENV_KEYS) saved[k] = process.env[k];
  for (const k of AUTH_ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(overrides)) process.env[k] = v;
  try {
    return fn();
  } finally {
    for (const k of AUTH_ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const STRONG = 'x'.repeat(MIN_AUTH_SECRET_LENGTH);
const WEAK = 'x'.repeat(MIN_AUTH_SECRET_LENGTH - 1);

test('L3: a strong secret boots; a missing secret is fatal (default)', () => {
  withAuthEnv({ AUTH_SECRET: STRONG }, () => {
    assert.equal(authConfigError(), null);
  });
  withAuthEnv({}, () => {
    assert.match(String(authConfigError()), /AUTH_SECRET is missing/);
  });
});

test('L3: a sub-floor secret refuses boot', () => {
  withAuthEnv({ AUTH_SECRET: WEAK }, () => {
    const err = authConfigError();
    assert.match(String(err), /refuses to start with a secret shorter than 32/);
  });
});

test('L3: the weak-secret escape hatches all downgrade the fatal error', () => {
  for (const override of [
    { AUTH_SECRET: WEAK, AUTH_ALLOW_WEAK_SECRET: 'true' },
    { AUTH_SECRET: WEAK, AUTH_ENABLED: 'false' },
    { AUTH_SECRET: WEAK, SANDBOX_MODE: '1' },
    { AUTH_SECRET: WEAK, DEMO_MODE: 'yes' },
  ]) {
    withAuthEnv(override, () => {
      assert.equal(authConfigError(), null, JSON.stringify(override));
    });
  }
});

test('L3: authConfigWarnings still flags a sub-floor secret that reached boot', () => {
  withAuthEnv({ AUTH_SECRET: WEAK, AUTH_ALLOW_WEAK_SECRET: 'true' }, () => {
    const warnings = authConfigWarnings();
    assert.ok(
      warnings.some((w) => /only \d+ characters/.test(w)),
      'weak secret warns when booted via the override',
    );
  });
  withAuthEnv({ AUTH_SECRET: STRONG }, () => {
    assert.deepEqual(authConfigWarnings(), [], 'strong secret → no warning');
  });
});

// ============================================================================
// L3 — the sync getUserFromRequest takes no authz decision
// ============================================================================

async function jsFilesUnder(dir) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules') continue;
      out.push(...(await jsFilesUnder(full)));
    } else if (e.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

test('L3: nothing calls the sync getUserFromRequest (authz uses the async path)', async () => {
  const serverDir = fileURLToPath(new URL('../server', import.meta.url));
  const files = await jsFilesUnder(serverDir);
  const authDef = fileURLToPath(new URL('../server/auth/auth.js', import.meta.url));

  for (const file of files) {
    if (file === authDef) continue; // the definition itself
    const src = await fs.readFile(file, 'utf8');
    // A *call* to the sync variant. `getUserFromRequest\(` cannot match the
    // async `getUserFromRequestAsync(` (an "A", not "(", follows the name).
    const calls = src.match(/getUserFromRequest\(/g) || [];
    assert.deepEqual(
      calls,
      [],
      `${path.relative(serverDir, file)} must not call the sync getUserFromRequest`,
    );
  }
});

test('L3: routes/api/auth.js no longer imports the sync getUserFromRequest', async () => {
  const src = await readSrc('../server/routes/api/auth.js');
  assert.doesNotMatch(
    src,
    /^\s*getUserFromRequest,\s*$/m,
    'the dead sync import is removed',
  );
  assert.match(src, /getUserFromRequestAsync/, 'the async path is still used');
});
