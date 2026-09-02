/**
 * The i18n manifest, read once — the single machine-readable answer to "which
 * locales are there, which one is the reference, and which module files make up
 * a locale".
 *
 * `client/i18n/manifest.json` is the source: the same file the browser fetches
 * for the language picker. Before B132 the tooling carried four hand-kept
 * spellings of that list — `i18n-sync.js` had a fill list of 8 and a prune list
 * of 12, `i18n-validate.js` had a third list of 12, and both had their own
 * module list (one with `follow`, one without). They drifted, which is how
 * `it`/`pl`/`fi` ended up outside the fill set for no recoverable reason and
 * `follow.json` ended up outside the prune set. Everything below derives from
 * the manifest instead, so a locale or module is added in exactly one place.
 * The fill list is gone entirely since D73 — there is no fill any more.
 *
 * The policy the `tier` field encodes (what a tier promises, why it exists) is
 * prose in docs/reference/i18n-locale-tiers.md.
 *
 * Tier 1 (en, nl): blocking. Every key the code uses must exist; `npm test`
 * fails otherwise (tests/i18n-coverage.test.js reads TIER_1 from here).
 * Tier 2 (the rest): best effort. Missing keys fall back to the inline English
 * `t(key, fallback)` string, so they degrade to English instead of breaking;
 * the tooling reports the gap but does not gate on it. Absence is how a Tier-2
 * gap is *written down* too (D73) — see TIER_2 below.
 *
 * Node-only (reads the file synchronously at import). The browser reads the
 * same fields straight off the fetched manifest.
 */

import fs from 'node:fs';
import path from 'node:path';

import { I18N_DIR } from './i18n-fs.js';

const MANIFEST_PATH = path.join(I18N_DIR, 'manifest.json');
const REL = 'client/i18n/manifest.json';

/** The loaders a module file can belong to. See MODULES below. */
const LOADERS = new Set(['ui', 'deck']);

/**
 * @type {{
 *   reference: string,
 *   locales: Array<{id: string, label: string, tier: number}>,
 *   modules: Array<{id: string, loader: string}>,
 * }}
 */
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

/**
 * The manifest is load-bearing for every i18n script now, so a malformed one
 * must fail loudly at import rather than quietly narrow a prune or a strip to
 * a shorter list.
 * @param {boolean} ok
 * @param {string} message
 */
function require_(ok, message) {
  if (!ok) throw new Error(`${REL}: ${message}`);
}

require_(Array.isArray(manifest.locales), '"locales" must be an array');
require_(Array.isArray(manifest.modules), '"modules" must be an array');

/** Every locale the app ships, in manifest order. */
export const LOCALES = manifest.locales.map((l) => {
  require_(l && typeof l.id === 'string' && l.id, 'a locale has no "id"');
  require_(
    l.tier === 1 || l.tier === 2,
    `locale "${l.id}" has tier ${JSON.stringify(l.tier)} — must be 1 or 2`,
  );
  return { id: l.id, label: String(l.label), tier: l.tier };
});

/** Every locale id, in manifest order — the prune and validation scope. */
export const LOCALE_IDS = LOCALES.map((l) => l.id);

/**
 * The locale the other eleven are measured against: its `t()` fallbacks are the
 * English source text, so it is the only locale a value cannot be a carbon copy
 * *of* — and the one a missing key everywhere else falls back to.
 */
export const REFERENCE_LOCALE = String(manifest.reference || '');
require_(
  LOCALE_IDS.includes(REFERENCE_LOCALE),
  `"reference" is ${JSON.stringify(manifest.reference)}, which is not a shipped locale`,
);

/** Blocking locales — complete-or-the-build-fails. */
export const TIER_1 = LOCALES.filter((l) => l.tier === 1).map((l) => l.id);

/**
 * Best-effort locales — reported, never gated; fall back to English.
 *
 * Also the scope of `i18n-sync`'s strip: a Tier-2 value byte-identical to its
 * English one is a carbon copy, and since D73 the canonical form for "not
 * translated yet" is absence, not a copy. The tier *is* the policy here, so
 * there is no separate list to keep — `FILL_LOCALES` (every locale except the
 * reference) was one, and it took `nl` with it, which is Tier-1 and must stay
 * complete. If a Tier-2 locale ever needs to sit out, that is a manifest field
 * with a stated reason, not a silent list in a script.
 */
export const TIER_2 = LOCALES.filter((l) => l.tier === 2).map((l) => l.id);

/**
 * Every module file a locale directory holds, in manifest order, with the
 * loader that reads it:
 *
 * - `ui` — merged into the global dictionary by `client/lib/ui-i18n.js`
 *   (`I18N_COMPONENTS`) for whichever UI locale the user picked. Every locale
 *   can be selected, so every locale's copy is live.
 * - `deck` — read by a scoped loader keyed on the *deck* language rather than
 *   the UI locale. Today that is `follow.json` via
 *   `client/views/follow/i18n.js`, whose `deckLangToLocale()` resolves every
 *   deck language to `nl` or `en`.
 *
 * @type {Array<{id: string, loader: string}>}
 */
export const MODULE_DEFS = manifest.modules.map((m) => {
  require_(m && typeof m.id === 'string' && m.id, 'a module has no "id"');
  require_(
    LOADERS.has(m.loader),
    `module "${m.id}" has loader ${JSON.stringify(m.loader)} — must be one of ${[...LOADERS].join(', ')}`,
  );
  return { id: m.id, loader: m.loader };
});

/** Every module id — the prune and validation scope. */
export const MODULES = MODULE_DEFS.map((m) => m.id);

/**
 * The modules the global dictionary is built from — the `ui` ones only.
 *
 * `tests/i18n-locales.test.js` pins this against `I18N_COMPONENTS` in
 * `client/lib/ui-i18n.js`, which keeps its own literal on purpose so a failed
 * manifest fetch cannot take the dictionary down with the language picker.
 * That pin is the only consumer: neither half of `i18n-sync` narrows by
 * loader any more, since a dead key and a carbon copy are both dead weight
 * wherever they sit.
 */
export const UI_MODULES = MODULE_DEFS.filter((m) => m.loader === 'ui').map(
  (m) => m.id,
);

/**
 * The tier a locale sits in, or `null` when the id is not shipped.
 * @param {string} id
 * @returns {number|null}
 */
export function tierOf(id) {
  const found = LOCALES.find((l) => l.id === id);
  return found ? found.tier : null;
}
