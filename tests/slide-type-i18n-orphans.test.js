import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CORE_SLIDE_TYPE_NAMES,
  CUSTOM_SLIDE_TYPE_NAMES,
} from '../shared/slide-types/registry.js';

/**
 * Guard against orphaned slide-type i18n keys.
 *
 * `client/i18n/<locale>/slide-types.json` carries a `slideType.<id>.*` namespace
 * per slide type. Nothing prunes those keys when a type leaves the registry, and
 * `i18n:validate` treats orphan keys as non-fatal — so a removed type's strings
 * ship in twelve locales forever unless someone remembers to delete them. That is
 * exactly what the split-partner removal did (#480): six keys × twelve locales
 * survived it, and only manual review caught them (#481).
 *
 * This fails the moment a namespace names an `<id>` that is not a live type,
 * naming the locale and the id. It iterates the registry rather than enumerating
 * type names, so adding or removing a type is covered for free — the same
 * discipline as tests/slide-type-docs.test.js.
 */

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const I18N_ROOT = path.join(REPO_ROOT, 'client/i18n');

/** Every registered type name: core plus any applied fork/custom type. */
const LIVE_TYPE_NAMES = new Set([
  ...CORE_SLIDE_TYPE_NAMES,
  ...CUSTOM_SLIDE_TYPE_NAMES,
]);

/** The per-locale `slide-types.json` files (skips the stale `en.json` artifact). */
function localeSlideTypeFiles() {
  return fs
    .readdirSync(I18N_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(d.name, 'slide-types.json'))
    .filter((rel) => fs.existsSync(path.join(I18N_ROOT, rel)));
}

/** The distinct `<id>`s appearing in a locale's `slideType.<id>.*` keys. */
function slideTypeNamespaces(json) {
  const ids = new Set();
  for (const key of Object.keys(json)) {
    const m = /^slideType\.([^.]+)\./.exec(key);
    if (m) ids.add(m[1]);
  }
  return ids;
}

test('no locale carries slide-type i18n keys for a type that no longer exists', () => {
  const files = localeSlideTypeFiles();
  assert.ok(files.length > 0, 'expected at least one locale slide-types.json');

  const orphans = [];
  for (const rel of files) {
    const json = JSON.parse(fs.readFileSync(path.join(I18N_ROOT, rel), 'utf8'));
    for (const id of slideTypeNamespaces(json)) {
      if (!LIVE_TYPE_NAMES.has(id)) orphans.push(`${rel} → slideType.${id}.*`);
    }
  }

  assert.deepEqual(
    orphans,
    [],
    'orphaned slide-type i18n namespaces (delete the keys, then `npm run i18n:validate`):\n' +
      orphans.join('\n'),
  );
});
