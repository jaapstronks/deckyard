/**
 * The published name of every core slide type, in English and Dutch (B322).
 *
 * deckyard.eu shows the slide-type list on its English and its Dutch pages, and
 * reads it out of core (`deckyard-website/scripts/generate-slide-types.js`).
 * The registry's `label` is English only, so the Dutch pages showed English
 * type names between Dutch copy. The Dutch name already exists: the editor's
 * picker shows it, from the `slideType.<name>.label` key the registry stamps
 * on every definition. This module puts both under one key, `labels`, without
 * a second source of truth:
 *
 * - `en` is the registry's `label` — the English catalog is generated from it.
 * - `nl` is the Dutch catalog's entry for the definition's `labelKey`.
 *
 * Only these two locales: they are the ones deckyard.eu publishes, and the
 * other catalogs may still hold the English placeholders `i18n:sync` backfills.
 *
 * A missing Dutch name is refused, not filled with the English one: a fallback
 * here would publish exactly the mixed page this module exists to end.
 * `tests/slide-type-labels.test.js` pins that every core type has one.
 *
 * Node only (it reads the catalog off disk), so it lives in `server/`, not
 * `shared/`.
 */

import fs from 'node:fs';

import {
  CORE_SLIDE_TYPE_NAMES,
  SLIDE_TYPES,
} from '../../shared/slide-types/registry.js';

const NL_CATALOG_URL = new URL(
  '../../client/i18n/nl/slide-types.json',
  import.meta.url,
);

/**
 * `{ en, nl }` per core slide type, keyed by registry name.
 *
 * @returns {Record<string, { en: string, nl: string }>}
 * @throws {Error} when a core type has no Dutch name in the catalog
 */
export function coreSlideTypeLabels() {
  const nl = JSON.parse(fs.readFileSync(NL_CATALOG_URL, 'utf8'));
  /** @type {Record<string, { en: string, nl: string }>} */
  const out = {};
  for (const name of CORE_SLIDE_TYPE_NAMES) {
    const def = SLIDE_TYPES[name];
    const nlLabel = nl[def.labelKey];
    if (typeof nlLabel !== 'string' || !nlLabel.trim()) {
      throw new Error(
        `slide type "${name}" has no Dutch name: add "${def.labelKey}" to client/i18n/nl/slide-types.json`,
      );
    }
    out[name] = { en: def.label, nl: nlLabel };
  }
  return out;
}
