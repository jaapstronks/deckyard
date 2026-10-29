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
 * Plus where it is mounted: not on the presenter or follow-along screens the
 * audience sees (B357), and the two exits it carries (A4): install it
 * yourself, the main route, and ask us to host it.
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
const { syncSandboxBanner, SELF_HOST_URL, HOSTED_CONTACT_URL } =
  await import('../client/lib/dom/sandbox-banner.js');

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

test('the banner stays off the screens the audience sees (B357)', () => {
  setFeatures({ sandboxMode: true, sandboxTtlHours: 24 });
  for (const name of ['present', 'presentWindow', 'follow']) {
    syncSandboxBanner(name);
    assert.equal(document.querySelector('.sandbox-banner'), null, name);
  }
  // Back in the editor it is mounted again, once.
  syncSandboxBanner('edit');
  assert.equal(document.querySelectorAll('.sandbox-banner').length, 1);
  // Navigating to the presenter unmounts the banner that was there.
  syncSandboxBanner('present');
  assert.equal(document.querySelector('.sandbox-banner'), null);
  setFeatures({ sandboxMode: false });
});

test('the banner carries the self-host and the hosted exit (A4)', async () => {
  setFeatures({ sandboxMode: true, sandboxTtlHours: 24 });
  await setUiLocale('en', { persist: false });
  syncSandboxBanner('home');

  const links = [...document.querySelectorAll('.sandbox-banner a')];
  assert.equal(links.length, 2, 'two exits, nothing else to click');
  const [selfHost, hosted] = links;

  assert.equal(
    SELF_HOST_URL,
    'https://deckyard.eu/docs/deployment/quickstart/',
  );
  assert.equal(selfHost.getAttribute('href'), SELF_HOST_URL);
  assert.equal(selfHost.textContent, 'Install Deckyard yourself');
  assert.equal(selfHost.getAttribute('target'), '_blank');
  assert.match(selfHost.getAttribute('rel'), /noopener/);

  assert.match(HOSTED_CONTACT_URL, /^mailto:jaap@jaapstronks\.nl\?/);
  assert.equal(hosted.getAttribute('href'), HOSTED_CONTACT_URL);
  assert.equal(hosted.textContent, 'Or let us host it for you');

  // The status line announces the TTL only, not the links.
  const status = document.querySelector('.sandbox-banner [role="status"]');
  assert.ok(status && !status.querySelector('a'));

  // A locale switch refreshes the link copy in place too.
  await setUiLocale('nl', { persist: false });
  syncSandboxBanner('edit');
  assert.equal(selfHost.isConnected, true, 'same node, not rebuilt');
  assert.equal(selfHost.textContent, 'Deckyard zelf installeren');
  assert.equal(hosted.textContent, 'Of laat ons het voor je hosten');

  // The audience screens carry neither exit.
  for (const name of ['present', 'presentWindow', 'follow']) {
    syncSandboxBanner(name);
    assert.equal(document.querySelector('.sandbox-banner a'), null, name);
  }
  setFeatures({ sandboxMode: false });
  syncSandboxBanner('home');
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
