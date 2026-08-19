/**
 * Shared t() key extraction.
 *
 * Scans client/ for `t('key', 'English fallback')` call sites and returns the
 * static keys with their fallbacks. Used by both `scripts/i18n-validate.js`-style
 * tooling and `tests/i18n-coverage.test.js`, so the drift guard and the fill
 * tooling always agree on what "a key the code uses" means.
 *
 * Only *statically literal* keys are returned. Some call sites build keys at
 * runtime (e.g. `t(`slideType.${type}.label`, …)` in slide-library/controls.js);
 * those are unknowable here and are deliberately excluded rather than guessed —
 * see DYNAMIC_KEY_PREFIXES for the families they cover.
 *
 * A `t()` call is not the only *static* spelling, though. Descriptor tables pass
 * the key and its English fallback as a paired property and hand both to `t()`
 * later, in two spellings: `<x>Key` / `<x>Default` (`WEBHOOK_CONFIGS` in
 * client/views/settings/sections/admin-webhooks-section.js, the settings
 * sidebar tabs) and `<x>Key` / `<x>` (`labelKey` / `label` on slide-type,
 * preset and field descriptors, `hintKey` / `hint` on the data-source
 * providers). Those keys are every bit as static, and they used to be invisible
 * here — which is how six webhook keys, three settings-tab keys and fourteen
 * font-editor / field-type keys went missing from Tier 1 without the coverage
 * gate noticing. DESCRIPTOR_PAIR picks both spellings up; the pair must be
 * adjacent, key first.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

/** Directories under client/ that never contain app copy. */
const IGNORE_DIRS = new Set(['vendor', 'styles', 'i18n']);

/**
 * Key families that are constructed dynamically and therefore cannot be
 * verified statically. Keys under these prefixes are exempt from the
 * "unused key" side of the drift check.
 */
const DYNAMIC_KEY_PREFIXES = ['slideType.'];

/**
 * Every runtime-built key family, as anchored patterns. Used by the *orphan*
 * side of `scripts/i18n-audit.js`: a key only ever reached through a template
 * literal has no static call site, so without this list it reads as unused.
 *
 * Deliberately separate from DYNAMIC_KEY_PREFIXES, which gates the far stricter
 * "must exist in nl/ and en/" coverage check — loosening that list would let a
 * genuinely missing key through (e.g. a plain `editor.textBlocks.row` prefix
 * also swallows the static keys `…rows` and `…rowTitle`).
 *
 * Keep in sync with the template-literal `t()` call sites; find them with:
 *   rg -n 't\(\s*`' client/ --glob '!client/vendor/**'
 */
export const DYNAMIC_KEY_PATTERNS = [
  /^slideType\./, // deck-grid.js, ai-review-annotations.js, slide-library/controls.js
  /^editor\.slideTypeDesc\./, // slide-type-picker.js
  /^editor\.layoutVariant\./, // layout-switcher.js (+ labelKey in shared/slide-types/)
  /^editor\.textStyle\.(color|align|size)\./, // editor-form/text-element-card.js
  /^editor\.textBlocks\.row\d+$/, // editor-form/slide-forms/text-blocks.js
  /^editor\.inline\.field\./, // inline-edit/inline-editor.js
  /^fonts\.weightName\./, // settings/font-editor/upload-panel.js
  /^settings\.themes\.config\.(radius|shadow|transform)\./, // theme-editor/config-sections.js
  /^follow\./, // resolved by the scoped loader in client/views/follow/i18n.js
];

/**
 * @param {string} key
 * @returns {boolean} true when the key is only ever built at runtime
 */
export function isRuntimeBuiltKey(key) {
  return DYNAMIC_KEY_PATTERNS.some((re) => re.test(key));
}

// t( '<key>' [, '<fallback>'] ) — single or double quoted, allowing escapes.
// The fallback alternates on the delimiter rather than using one character
// class, so a fallback may contain the *other* quote: t('k', "Logo's") and
// t('k', 'A "quoted" phrase') both extract correctly.
const T_CALL =
  /\bt\(\s*(['"])([\w.-]+)\1\s*(?:,\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"))?/g;

/**
 * Walk a directory tree yielding .js file paths.
 * @param {string} dir
 * @returns {AsyncGenerator<string>}
 */
async function* walkJs(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      yield* walkJs(full);
    } else if (entry.name.endsWith('.js')) {
      yield full;
    }
  }
}

// <x>Key: '<key>', <x>Default: '<English fallback>' — or the bare
// <x>Key: '<key>', <x>: '<English fallback>' — a descriptor-table entry whose
// two halves are handed to t() elsewhere. The prefix backreference is what
// makes this a *pair* rather than two unrelated properties, so an unrelated
// `settingsKey` next to a `titleDefault` cannot match.
const DESCRIPTOR_PAIR =
  /\b(\w+)Key:\s*(['"])([\w.-]+)\2\s*,\s*\1(?:Default)?:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g;

/**
 * Extract every static t() key used in the client, whether it is spelled at the
 * call site or in a descriptor table (see the module header).
 * @param {string} clientDir - absolute path to client/
 * @returns {Promise<Map<string, { file: string, fallback: string|null }>>}
 */
export async function extractUsedKeys(clientDir) {
  /** @type {Map<string, { file: string, fallback: string|null }>} */
  const used = new Map();
  /** @param {string} key @param {string|null} fallback @param {string} file */
  const record = (key, fallback, file) => {
    const prev = used.get(key);
    // Prefer the first call site that actually supplies a fallback.
    if (!prev || (prev.fallback == null && fallback != null)) {
      used.set(key, { file, fallback });
    }
  };
  for await (const file of walkJs(clientDir)) {
    const src = await fs.readFile(file, 'utf8');
    for (const m of src.matchAll(T_CALL)) record(m[2], m[3] ?? m[4] ?? null, file);
    for (const m of src.matchAll(DESCRIPTOR_PAIR)) record(m[3], m[4] ?? m[5] ?? null, file);
  }
  return used;
}

// Any dotted string literal, e.g. the 'editor.foo.bar' in `{ labelKey: 'editor.foo.bar' }`.
const DOTTED_LITERAL = /(['"`])([A-Za-z][\w-]*(?:\.[\w-]+)+)\1/g;

/**
 * Collect every dotted string literal appearing anywhere in the given source
 * trees — a superset of the t() call sites.
 *
 * A dozen call sites pass the key *indirectly* (`text: t(tab.labelKey, …)`,
 * `labelKey: 'editor.layoutVariant.text'`), and slide-type definitions under
 * `shared/` carry i18n keys the client resolves later. Those keys are real but
 * invisible to `extractUsedKeys`, so the orphan check needs this wider net or
 * it reports live keys as dead.
 *
 * Deliberately over-matches (a filename like `foo.bar.js` also lands here);
 * that only ever *suppresses* an orphan report, which is the safe direction.
 *
 * @param {string[]} dirs - absolute paths to scan
 * @returns {Promise<Set<string>>}
 */
export async function collectKeyLiteralRefs(dirs) {
  const refs = new Set();
  for (const dir of dirs) {
    let ok = true;
    try {
      await fs.access(dir);
    } catch {
      ok = false;
    }
    if (!ok) continue;
    for await (const file of walkJs(dir)) {
      const src = await fs.readFile(file, 'utf8');
      for (const m of src.matchAll(DOTTED_LITERAL)) refs.add(m[2]);
    }
  }
  return refs;
}

/**
 * Load a locale's merged dictionary from client/i18n/<locale>/*.json.
 * @param {string} i18nDir - absolute path to client/i18n/
 * @param {string} locale
 * @returns {Promise<Record<string, string>>}
 */
export async function loadLocale(i18nDir, locale) {
  const dir = path.join(i18nDir, locale);
  const merged = Object.create(null);
  let files = [];
  try {
    files = await fs.readdir(dir);
  } catch {
    return merged;
  }
  for (const name of files) {
    if (!name.endsWith('.json')) continue;
    const raw = await fs.readFile(path.join(dir, name), 'utf8');
    Object.assign(merged, JSON.parse(raw));
  }
  return merged;
}

/**
 * @param {string} key
 * @returns {boolean} true when the key belongs to a runtime-built family
 */
export function isDynamicKey(key) {
  return DYNAMIC_KEY_PREFIXES.some((p) => key.startsWith(p));
}
