/**
 * The sandbox banner states the TTL the cleanup job deletes on (B356).
 *
 * `SANDBOX_TTL_HOURS` has one reader, `sandboxTtlHours()` in
 * `server/config/sandbox.js`. The cleanup job deletes on it and the feature
 * snapshot hands it to the client as `sandboxTtlHours`; the banner fills the
 * `{hours}` placeholder of `sandbox.banner.text` with it. Three rules:
 *
 *   1. **The snapshot carries the configured TTL** in sandbox mode, and null
 *      outside it (nothing expires there).
 *   2. **The banner shows that number**, in the shipped EN and NL copy — not a
 *      hardcoded 24.
 *   3. **No locale hardcodes a number** in `sandbox.banner.text`; every one
 *      carries `{hours}`.
 *
 * Run with: node --test tests/sandbox-banner-ttl.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { JSDOM } from 'jsdom';

import { getFeatureFlags } from '../server/config/flags-snapshot.js';
import { sandboxTtlHours } from '../server/config/sandbox.js';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.Event = dom.window.Event;

// The locale loader fetches `/client/i18n/<locale>/<component>.json`; serve
// the files from disk so the test reads the copy that ships.
globalThis.fetch = async (url) => {
  const rel = decodeURIComponent(String(url)).replace(/^\//, '');
  try {
    const body = await fs.readFile(path.join(process.cwd(), rel), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const { setFeatures } = await import('../client/lib/state/features.js');
const { setUiLocale } = await import('../client/lib/ui-i18n.js');
const { syncSandboxBanner } =
  await import('../client/views/shared/sandbox-banner.js');

function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(env)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

function bannerText() {
  return document.querySelector('.sandbox-banner-text')?.textContent;
}

test('the feature snapshot carries the configured TTL in sandbox mode only', () => {
  withEnv({ SANDBOX_MODE: '1', SANDBOX_TTL_HOURS: '48' }, () => {
    assert.equal(getFeatureFlags().sandboxTtlHours, 48);
  });
  withEnv({ SANDBOX_MODE: '1', SANDBOX_TTL_HOURS: undefined }, () => {
    assert.equal(getFeatureFlags().sandboxTtlHours, 24, 'default is 24');
  });
  withEnv({ SANDBOX_MODE: undefined, SANDBOX_TTL_HOURS: '48' }, () => {
    assert.equal(getFeatureFlags().sandboxTtlHours, null);
  });
});

test('a TTL below one whole hour falls back to the default', () => {
  // The old reader floored 0.5 to 0 and so expired every deck immediately.
  for (const raw of ['0', '0.5', '-3', 'soon']) {
    withEnv({ SANDBOX_TTL_HOURS: raw }, () => {
      assert.equal(sandboxTtlHours(), 24, `SANDBOX_TTL_HOURS=${raw}`);
    });
  }
});

test('the banner shows the configured TTL in the shipped EN and NL copy', async () => {
  setFeatures(
    withEnv({ SANDBOX_MODE: '1', SANDBOX_TTL_HOURS: '48' }, () =>
      getFeatureFlags(),
    ),
  );

  await setUiLocale('en', { persist: false });
  syncSandboxBanner();
  assert.equal(
    bannerText(),
    'Temporary Deckyard sandbox - your work is deleted after 48 hours.',
  );

  // A locale switch refreshes the mounted banner in place.
  await setUiLocale('nl', { persist: false });
  syncSandboxBanner();
  assert.equal(
    bannerText(),
    'Tijdelijke Deckyard-sandbox - je werk wordt na 48 uur verwijderd.',
  );
  assert.equal(document.querySelectorAll('.sandbox-banner').length, 1);

  setFeatures({ sandboxMode: false });
  syncSandboxBanner();
  assert.equal(document.querySelector('.sandbox-banner'), null);
});

test('no locale hardcodes the TTL in sandbox.banner.text', async () => {
  const root = path.join(process.cwd(), 'client/i18n');
  const locales = (await fs.readdir(root, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  assert.ok(locales.length >= 2);
  for (const loc of locales) {
    const file = path.join(root, loc, 'common.json');
    const dict = JSON.parse(await fs.readFile(file, 'utf8'));
    const text = dict['sandbox.banner.text'];
    if (text === undefined) continue;
    assert.match(text, /\{hours\}/, `${loc}: carries {hours}`);
    assert.doesNotMatch(text, /\d/, `${loc}: no hardcoded number`);
  }
});
