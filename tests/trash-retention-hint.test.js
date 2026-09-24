/**
 * The trash hint states the retention window the sweep deletes on (B405).
 *
 * `TRASH_RETENTION_DAYS` has one reader, `trashRetentionDays()` in
 * `server/config/retention.js`. The retention job deletes on it and the feature
 * snapshot hands it to the client as `trashRetentionDays`; the trash view fills
 * the `{days}` placeholder of `list.trash.hint` with it. Three rules:
 *
 *   1. **The snapshot always carries the configured window**, default 30.
 *   2. **The hint shows that number**, in the shipped EN and NL copy — the
 *      client keeps no default of its own.
 *   3. **No locale hardcodes a number** in `list.trash.hint`; every one
 *      carries `{days}`.
 *
 * Run with: node --test tests/trash-retention-hint.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { JSDOM } from 'jsdom';

import { getFeatureFlags } from '../server/config/flags-snapshot.js';

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
const { createTrashView } =
  await import('../client/views/list/views/trash-view.js');

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

function hintText() {
  const { el } = createTrashView({
    api: async () => [],
    renderCard: () => null,
  });
  return el.querySelector('p.help')?.textContent;
}

test('the feature snapshot always carries the configured window', () => {
  withEnv({ TRASH_RETENTION_DAYS: '7' }, () => {
    assert.equal(getFeatureFlags().trashRetentionDays, 7);
  });
  withEnv({ TRASH_RETENTION_DAYS: undefined }, () => {
    assert.equal(getFeatureFlags().trashRetentionDays, 30, 'default is 30');
  });
});

test('the trash hint shows the configured window in the shipped EN and NL copy', async () => {
  setFeatures(withEnv({ TRASH_RETENTION_DAYS: '7' }, () => getFeatureFlags()));

  await setUiLocale('en', { persist: false });
  assert.equal(
    hintText(),
    'Items in trash will be permanently deleted after 7 days. You can restore them before then.',
  );

  await setUiLocale('nl', { persist: false });
  assert.equal(
    hintText(),
    'Items in de prullenbak worden na 7 dagen definitief verwijderd. Je kunt ze daarvoor nog herstellen.',
  );
});

test('no locale hardcodes the window in list.trash.hint', async () => {
  const root = path.join(process.cwd(), 'client/i18n');
  const locales = (await fs.readdir(root, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  assert.ok(locales.length >= 2);
  for (const loc of locales) {
    const file = path.join(root, loc, 'list.json');
    const dict = JSON.parse(await fs.readFile(file, 'utf8').catch(() => '{}'));
    const text = dict['list.trash.hint'];
    if (text === undefined) continue;
    assert.match(text, /\{days\}/, `${loc}: carries {days}`);
    assert.doesNotMatch(text, /\d/, `${loc}: no hardcoded number`);
  }
});
