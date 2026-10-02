/**
 * `npm run doctor` (B428): every check on a red and a green stand.
 *
 * The checks read env the way boot does, so each case sets exactly the vars it
 * is about on top of a neutral base. Network, database, browser and storage go
 * through the seams in the check context; nothing here needs a live service.
 *
 * Run with: node --test tests/doctor.test.js
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  DOCTOR_CHECKS,
  doctorExitCode,
  formatDoctorReport,
  runDoctor,
} from '../server/doctor/index.js';
import {
  authCheck,
  customDirCheck,
  publicUrlCheck,
  storageModeCheck,
  trustProxyCheck,
} from '../server/doctor/config.js';
import { databaseCheck, migrationsCheck } from '../server/doctor/database.js';
import { oidcDiscoveryCheck, ssoConfigCheck } from '../server/doctor/sso.js';
import { themesCheck } from '../server/doctor/themes.js';
import {
  chromiumCheck,
  mailCheck,
  uploadsCheck,
} from '../server/doctor/runtime.js';
import { LocalProvider } from '../server/media/local.js';
import { createCoreFixtureRoot } from './helpers/core-fixture-root.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const SECRET = 'x'.repeat(32);
const ISSUER = 'https://idp.example.com';
const APP = 'https://slides.example.com';

/** Every var a check reads, unset unless a case sets it. */
const BASE = Object.freeze({
  NODE_ENV: undefined,
  AUTH_ENABLED: undefined,
  AUTH_SECRET: SECRET,
  AUTH_DEV_BYPASS: undefined,
  AUTH_ALLOW_WEAK_SECRET: undefined,
  SANDBOX_MODE: undefined,
  DEMO_MODE: undefined,
  APP_URL: APP,
  DOMAIN: undefined,
  STORAGE_MODE: undefined,
  SSO_ENABLED: undefined,
  SSO_PROVIDER: undefined,
  SSO_ENFORCE: undefined,
  OIDC_ISSUER_URL: undefined,
  OIDC_CLIENT_ID: undefined,
  OIDC_CLIENT_SECRET: undefined,
  OIDC_REDIRECT_URI: undefined,
  DEFAULT_THEME: undefined,
  ENABLED_THEMES: undefined,
  PUPPETEER_EXECUTABLE_PATH: undefined,
  CHROME_BIN: undefined,
  UPLOADS_ENABLED: undefined,
  DISABLE_UPLOADS: undefined,
  MEDIA_STORAGE_MODE: undefined,
  BREVO_API_KEY: undefined,
  TRUST_PROXY: undefined,
  UPLOADS_DIR: undefined,
  DATA_DIR: undefined,
});

const SSO = Object.freeze({
  SSO_ENABLED: 'true',
  SSO_PROVIDER: 'oidc',
  OIDC_ISSUER_URL: ISSUER,
  OIDC_CLIENT_ID: 'deckyard',
  OIDC_CLIENT_SECRET: 'secret',
  OIDC_REDIRECT_URI: `${APP}/api/auth/oidc/callback`,
});

/**
 * Run one check with `vars` over the neutral base, then restore the env.
 * @param {import('../server/doctor/finding.js').DoctorCheck} check
 * @param {Record<string, string|undefined>} vars
 * @param {object} [ctx]
 */
async function run(check, vars = {}, ctx = {}) {
  const env = { ...BASE, ...vars };
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await check.run({ repoRoot, results: new Map(), ...ctx });
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/**
 * Call `fn` with `vars` set, then restore the env.
 * @template T
 * @param {Record<string, string>} vars
 * @param {() => T} fn
 * @returns {T}
 */
function withEnv(vars, fn) {
  const saved = Object.fromEntries(
    Object.keys(vars).map((k) => [k, process.env[k]]),
  );
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const after1 = (id, status) => new Map([[id, { status, message: '' }]]);

// ── auth ────────────────────────────────────────────────────────────────────

test('auth: red without AUTH_SECRET, green with one', async () => {
  const red = await run(authCheck, { AUTH_SECRET: undefined });
  assert.equal(red.status, 'fail');
  assert.match(red.message, /AUTH_SECRET is missing/);
  assert.equal((await run(authCheck)).status, 'ok');
});

test('auth: red on a leftover AUTH_DEV_BYPASS in production', async () => {
  const red = await run(authCheck, {
    NODE_ENV: 'production',
    AUTH_DEV_BYPASS: 'true',
  });
  assert.equal(red.status, 'fail');
  assert.match(red.message, /AUTH_DEV_BYPASS/);
});

test('auth: an explicit AUTH_ENABLED=false warns, it does not fail', async () => {
  const found = await run(authCheck, {
    AUTH_ENABLED: 'false',
    AUTH_SECRET: undefined,
  });
  assert.equal(found.status, 'warn');
});

// ── public-url ──────────────────────────────────────────────────────────────

test('public-url: red in production without APP_URL, green with https', async () => {
  const red = await run(publicUrlCheck, {
    NODE_ENV: 'production',
    APP_URL: undefined,
  });
  assert.equal(red.status, 'fail');
  assert.ok(red.fix);
  const green = await run(publicUrlCheck, { NODE_ENV: 'production' });
  assert.deepEqual(green, { status: 'ok', message: APP });
});

test('public-url: http is red in production and a warning elsewhere', async () => {
  const vars = { APP_URL: 'http://slides.example.com' };
  assert.equal(
    (await run(publicUrlCheck, { ...vars, NODE_ENV: 'production' })).status,
    'fail',
  );
  assert.equal((await run(publicUrlCheck, vars)).status, 'warn');
});

test('public-url: red when APP_URL and DOMAIN name different hosts', async () => {
  const red = await run(publicUrlCheck, { DOMAIN: 'other.example.com' });
  assert.equal(red.status, 'fail');
  assert.match(red.message, /different hosts/);
  const green = await run(publicUrlCheck, { DOMAIN: 'slides.example.com' });
  assert.equal(green.status, 'ok');
});

// ── trust-proxy ─────────────────────────────────────────────────────────────

test('trust-proxy: an https origin without TRUST_PROXY warns, with it passes', async () => {
  const found = await run(trustProxyCheck);
  assert.equal(found.status, 'warn');
  assert.match(found.message, /TRUST_PROXY is not set/);
  assert.match(found.fix, /TRUST_PROXY=true/);
  assert.equal(
    (await run(trustProxyCheck, { TRUST_PROXY: 'true' })).status,
    'ok',
  );
});

test('trust-proxy: skipped without an https origin', async () => {
  const found = await run(trustProxyCheck, {
    APP_URL: 'http://localhost:4177',
  });
  assert.equal(found.status, 'skip');
  assert.equal(
    (await run(trustProxyCheck, { APP_URL: undefined })).status,
    'skip',
  );
});

// ── storage-mode ────────────────────────────────────────────────────────────

test('storage-mode: red on a retired mode, green unset', async () => {
  const red = await run(storageModeCheck, { STORAGE_MODE: 'file' });
  assert.equal(red.status, 'fail');
  assert.match(red.message, /no longer supported/);
  assert.equal((await run(storageModeCheck)).status, 'ok');
});

// ── database + migrations ───────────────────────────────────────────────────

test('database: red with the boot message when unreachable, green when connected', async () => {
  const refused = Object.assign(new Error('connect ECONNREFUSED'), {
    code: 'ECONNREFUSED',
  });
  const red = await run(
    databaseCheck,
    {},
    {
      connect: async () => {
        throw refused;
      },
    },
  );
  assert.equal(red.status, 'fail');
  assert.match(red.message, /Cannot reach PostgreSQL/);
  const green = await run(databaseCheck, {}, { connect: async () => {} });
  assert.equal(green.status, 'ok');
});

test('migrations: red when pending, green when applied, skipped without a database', async () => {
  const results = after1('database', 'ok');
  const red = await run(
    migrationsCheck,
    {},
    { results, pendingMigrations: async () => 'The database is behind' },
  );
  assert.equal(red.status, 'fail');
  const green = await run(
    migrationsCheck,
    {},
    { results, pendingMigrations: async () => null },
  );
  assert.equal(green.status, 'ok');
  const skipped = await run(
    migrationsCheck,
    {},
    {
      results: after1('database', 'fail'),
      pendingMigrations: async () => assert.fail('must not query'),
    },
  );
  assert.equal(skipped.status, 'skip');
});

// ── sso-config ──────────────────────────────────────────────────────────────

test('sso-config: skipped when off, red when half-configured, green when complete', async () => {
  assert.equal((await run(ssoConfigCheck)).status, 'skip');
  const red = await run(ssoConfigCheck, {
    ...SSO,
    OIDC_ISSUER_URL: undefined,
  });
  assert.equal(red.status, 'fail');
  const green = await run(ssoConfigCheck, SSO);
  assert.equal(green.status, 'ok');
  assert.match(green.message, /\/api\/auth\/oidc\/callback/);
});

test('sso-config: a redirect URI on the wrong path warns with the expected one', async () => {
  const found = await run(ssoConfigCheck, {
    ...SSO,
    OIDC_REDIRECT_URI: `${APP}/wrong`,
  });
  assert.equal(found.status, 'warn');
  assert.ok(found.message.includes(`${APP}/api/auth/oidc/callback`));
});

// ── oidc-discovery ──────────────────────────────────────────────────────────

/** @param {number} status @param {object} body */
const answer = (status, body) => async (url) => {
  assert.equal(url, `${ISSUER}/.well-known/openid-configuration`);
  return new Response(JSON.stringify(body), { status });
};
const configured = after1('sso-config', 'ok');

test('oidc-discovery: red when the issuer does not answer', async () => {
  const red = await run(oidcDiscoveryCheck, SSO, {
    results: configured,
    fetch: async () => {
      throw new TypeError('fetch failed', {
        cause: { code: 'ENOTFOUND' },
      });
    },
  });
  assert.equal(red.status, 'fail');
  assert.match(red.message, /ENOTFOUND/);
  assert.ok(red.fix);
});

test('oidc-discovery: red on HTTP 404 and on another issuer, green on a match', async () => {
  const notFound = await run(oidcDiscoveryCheck, SSO, {
    results: configured,
    fetch: answer(404, {}),
  });
  assert.equal(notFound.status, 'fail');
  const other = await run(oidcDiscoveryCheck, SSO, {
    results: configured,
    fetch: answer(200, { issuer: 'https://elsewhere.example.com' }),
  });
  assert.equal(other.status, 'fail');
  assert.match(other.message, /elsewhere/);
  const green = await run(oidcDiscoveryCheck, SSO, {
    results: configured,
    fetch: answer(200, { issuer: `${ISSUER}/` }),
  });
  assert.deepEqual(green, { status: 'ok', message: ISSUER });
});

test('oidc-discovery: skipped when SSO is off or its config failed', async () => {
  const never = async () => assert.fail('must not fetch');
  for (const status of ['skip', 'fail']) {
    const found = await run(oidcDiscoveryCheck, SSO, {
      results: after1('sso-config', status),
      fetch: never,
    });
    assert.equal(found.status, 'skip');
  }
});

// ── custom-dir ──────────────────────────────────────────────────────────────

const scratch = mkdtempSync(path.join(tmpdir(), 'deckyard-doctor-'));
after(() => rm(scratch, { recursive: true, force: true }));

test('custom-dir: red when DECKYARD_CUSTOM_DIR points nowhere, green when it exists', async () => {
  const red = await run(
    customDirCheck,
    {},
    { customDir: path.join(scratch, 'missing'), override: true },
  );
  assert.equal(red.status, 'fail');
  assert.ok(red.fix);
  const green = await run(
    customDirCheck,
    {},
    { customDir: scratch, override: true },
  );
  assert.deepEqual(green, { status: 'ok', message: scratch });
});

test('custom-dir: no ./custom without an override is core only, not an error', async () => {
  const found = await run(
    customDirCheck,
    {},
    { customDir: path.join(scratch, 'missing'), override: false },
  );
  assert.equal(found.status, 'skip');
});

// ── themes ──────────────────────────────────────────────────────────────────

const core = createCoreFixtureRoot('deckyard-doctor-themes-');
after(core.remove);

test('themes: green on the six core seeds, red on an unknown DEFAULT_THEME', async () => {
  const green = await run(themesCheck, {}, { repoRoot: core.root });
  assert.deepEqual(green, { status: 'ok', message: '6 seeds' });
  const red = await run(
    themesCheck,
    { DEFAULT_THEME: 'nope' },
    { repoRoot: core.root },
  );
  assert.equal(red.status, 'fail');
  assert.match(red.message, /DEFAULT_THEME=nope/);
  assert.match(red.fix, /midnight/);
});

test('themes: red on an unknown ENABLED_THEMES slug and on a default outside it', async () => {
  const unknown = await run(
    themesCheck,
    { ENABLED_THEMES: 'midnight,nope' },
    { repoRoot: core.root },
  );
  assert.equal(unknown.status, 'fail');
  assert.match(unknown.message, /ENABLED_THEMES names nope/);
  const outside = await run(
    themesCheck,
    { ENABLED_THEMES: 'midnight', DEFAULT_THEME: 'editorial' },
    { repoRoot: core.root },
  );
  assert.equal(outside.status, 'fail');
  const green = await run(
    themesCheck,
    { ENABLED_THEMES: 'midnight, editorial', DEFAULT_THEME: 'editorial' },
    { repoRoot: core.root },
  );
  assert.equal(green.status, 'ok');
});

test('themes: red on a fork seed that boot would refuse', async () => {
  const fork = createCoreFixtureRoot('deckyard-doctor-fork-seed-');
  try {
    mkdirSync(path.join(fork.root, 'custom', 'themes'), { recursive: true });
    writeFileSync(
      path.join(fork.root, 'custom', 'themes', 'broken.json'),
      JSON.stringify({ slug: 'not-the-filename' }),
    );
    const red = await run(themesCheck, {}, { repoRoot: fork.root });
    assert.equal(red.status, 'fail');
    assert.match(red.message, /broken\.json/);
  } finally {
    await fork.remove();
  }
});

// ── chromium ────────────────────────────────────────────────────────────────

const importOk = async () => ({});

test('chromium: red without puppeteer-core or without a browser, green with both', async () => {
  const noPackage = await run(
    chromiumCheck,
    {},
    {
      importPuppeteer: async () => {
        throw new Error('Cannot find package');
      },
      resolveChrome: async () => '/usr/bin/chromium',
    },
  );
  assert.equal(noPackage.status, 'fail');
  assert.match(noPackage.message, /puppeteer-core/);
  const noBrowser = await run(
    chromiumCheck,
    {},
    { importPuppeteer: importOk, resolveChrome: async () => '' },
  );
  assert.equal(noBrowser.status, 'fail');
  const green = await run(
    chromiumCheck,
    {},
    {
      importPuppeteer: importOk,
      resolveChrome: async () => '/usr/bin/chromium',
    },
  );
  assert.deepEqual(green, { status: 'ok', message: '/usr/bin/chromium' });
});

test('chromium: a configured path that is not there warns about the fallback', async () => {
  const found = await run(
    chromiumCheck,
    { PUPPETEER_EXECUTABLE_PATH: '/nope/chrome' },
    {
      importPuppeteer: importOk,
      resolveChrome: async () => '/usr/bin/chromium',
    },
  );
  assert.equal(found.status, 'warn');
  assert.match(found.message, /\/nope\/chrome/);
});

// ── uploads ─────────────────────────────────────────────────────────────────

/**
 * An in-memory provider. `fail` names the probe whose write throws (`public`,
 * `private`); `corrupt` reads back other bytes.
 */
function fakeProvider({ fail = '', corrupt = false } = {}) {
  const files = new Map();
  const deleted = [];
  const put = (key, buffer) => {
    files.set(key, corrupt ? Buffer.from('x') : buffer);
    return { key, size: buffer.length, contentType: 'image/png' };
  };
  return {
    deleted,
    async uploadBuffer({ buffer }) {
      if (fail === 'public') throw new Error('EACCES: permission denied');
      return put('probe.png', buffer);
    },
    async uploadPrivateBuffer({ buffer, folder }) {
      if (fail === 'private') throw new Error('EACCES: permission denied');
      return put(`private/${folder}/probe.png`, buffer);
    },
    async readFile(key) {
      return files.get(key) ?? null;
    },
    async deleteFile(key) {
      deleted.push(key);
      return files.delete(key);
    },
  };
}

test('uploads: red when either probe cannot be written, green on two round trips that clean up', async () => {
  for (const [side, dir] of [
    ['public', /uploads \(/],
    ['private', /private media \(/],
  ]) {
    const red = await run(
      uploadsCheck,
      {},
      { provider: fakeProvider({ fail: side }) },
    );
    assert.equal(red.status, 'fail', side);
    assert.match(red.message, /EACCES/);
    assert.match(red.message, dir);
    assert.match(red.fix, /writable/);
  }
  const provider = fakeProvider();
  const green = await run(uploadsCheck, {}, { provider });
  assert.equal(green.status, 'ok');
  assert.deepEqual(provider.deleted, ['probe.png', 'private/doctor/probe.png']);
});

test('uploads: red when the probe reads back different bytes, and it is still deleted', async () => {
  const provider = fakeProvider({ corrupt: true });
  const red = await run(uploadsCheck, {}, { provider });
  assert.equal(red.status, 'fail');
  assert.deepEqual(provider.deleted, ['probe.png']);
});

test('uploads: red when the probe cannot be deleted, naming the key', async () => {
  const provider = fakeProvider();
  provider.deleteFile = async () => {
    throw new Error('AccessDenied');
  };
  const red = await run(uploadsCheck, {}, { provider });
  assert.equal(red.status, 'fail');
  assert.match(red.message, /probe\.png: AccessDenied/);
});

// A root-owned mount point (what Docker makes of a volume path the image does
// not have) is a directory the server user cannot write. Root writes anyway,
// so the case means nothing when the suite runs as root.
test(
  'uploads: the local provider is red on an unwritable uploads dir, even with a writable data dir',
  { skip: process.getuid?.() === 0 && 'running as root' },
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'doctor-uploads-'));
    const uploads = path.join(root, 'uploads');
    const data = path.join(root, 'data');
    mkdirSync(uploads, { mode: 0o555 });
    mkdirSync(data);
    const vars = { UPLOADS_DIR: uploads, DATA_DIR: data };
    try {
      const provider = await withEnv(vars, () => new LocalProvider(repoRoot));
      const red = await run(uploadsCheck, vars, { provider });
      assert.equal(red.status, 'fail');
      assert.match(red.message, /^local: could not write a probe to uploads/);
      assert.ok(red.fix.includes(uploads), red.fix);

      chmodSync(uploads, 0o755);
      const green = await run(uploadsCheck, vars, { provider });
      assert.equal(green.status, 'ok', green.message);
      assert.ok(green.message.includes(uploads), green.message);
      assert.ok(green.message.includes(path.join(data, 'private-media')));
    } finally {
      chmodSync(uploads, 0o755);
      await rm(root, { recursive: true, force: true });
    }
  },
);

test('uploads: skipped when uploads are disabled', async () => {
  const found = await run(
    uploadsCheck,
    { UPLOADS_ENABLED: 'false' },
    { provider: fakeProvider({ fail: 'upload' }) },
  );
  assert.equal(found.status, 'skip');
});

// ── mail ────────────────────────────────────────────────────────────────────

test('mail: a warning without a transport, green with Brevo', async () => {
  const red = await run(mailCheck);
  assert.equal(red.status, 'warn');
  assert.match(red.message, /magic links/);
  assert.ok(red.fix);
  assert.equal((await run(mailCheck, { BREVO_API_KEY: 'k' })).status, 'ok');
});

test('mail: SSO-only says sign-in is unaffected; auth off skips', async () => {
  const ssoOnly = await run(mailCheck, { ...SSO, SSO_ENFORCE: 'true' });
  assert.equal(ssoOnly.status, 'warn');
  assert.match(ssoOnly.message, /SSO-only/);
  const off = await run(mailCheck, {
    AUTH_ENABLED: 'false',
    AUTH_SECRET: undefined,
  });
  assert.equal(off.status, 'skip');
});

// ── runner, report, CLI ─────────────────────────────────────────────────────

test('every check has a unique id and a label', () => {
  const ids = DOCTOR_CHECKS.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length);
  for (const check of DOCTOR_CHECKS) assert.ok(check.label, check.id);
});

test('a check that throws is one red line, and the rest still run', async () => {
  const report = await runDoctor({
    repoRoot,
    checks: [
      {
        id: 'boom',
        label: 'Boom',
        run() {
          throw new Error('kaput');
        },
      },
      {
        id: 'fine',
        label: 'Fine',
        run: () => ({ status: 'ok', message: 'x' }),
      },
    ],
  });
  assert.deepEqual(
    report.map(({ id, status }) => [id, status]),
    [
      ['boom', 'fail'],
      ['fine', 'ok'],
    ],
  );
  assert.match(report[0].message, /kaput/);
  assert.equal(doctorExitCode(report), 1);
  assert.equal(doctorExitCode([report[1]]), 0);
});

test('the report puts the fix under its line and counts per status', () => {
  const text = formatDoctorReport([
    {
      id: 'a',
      label: 'Alpha',
      status: 'fail',
      message: 'broken',
      fix: 'mend it',
    },
    { id: 'b', label: 'Be', status: 'warn', message: 'meh' },
    { id: 'c', label: 'Ce', status: 'ok', message: 'fine' },
  ]);
  const lines = text.split('\n');
  assert.equal(lines[0], '✗ Alpha  broken');
  assert.equal(lines[1], '         fix: mend it');
  assert.equal(lines[2], '! Be     meh');
  assert.match(text, /1 failed, 1 warning, 1 passed, 0 skipped\./);
});

test('the CLI turns an import-time env refusal into one red line and exit 1', async () => {
  const run = promisify(execFile);
  const cli = path.join(repoRoot, 'scripts', 'doctor.js');
  const err = await run(process.execPath, [cli, '--json'], {
    env: { ...process.env, DECKYARD_CUSTOM_DIR: 'relative/custom' },
  }).then(
    () => assert.fail('expected exit 1'),
    (e) => e,
  );
  assert.equal(err.code, 1);
  const report = JSON.parse(err.stdout);
  assert.equal(report[0].id, 'startup');
  assert.equal(report[0].status, 'fail');
  assert.match(
    report[0].message,
    /DECKYARD_CUSTOM_DIR must be an absolute path/,
  );
});
