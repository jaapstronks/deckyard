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
 * later, in one spelling: `<x>Key` / `<x>` — `labelKey` / `label` on slide-type,
 * preset and field descriptors, `titleKey` / `title` + `hintKey` / `hint` on
 * `WEBHOOK_CONFIGS`, `hintKey` / `hint` on the data-source providers. Those keys
 * are every bit as static, and they used to be invisible here — which is how six
 * webhook keys, three settings-tab keys and fourteen font-editor / field-type
 * keys went missing from Tier 1 without the coverage gate noticing.
 * DESCRIPTOR_PAIR picks them up; the pair must be adjacent, key first.
 *
 * `<x>Default` was a second spelling of the same pair until B94 normalized it
 * away (46 pairs in four files, against 72 bare ones across client/ and
 * shared/). One meaning, one shape: a new `<x>Default:` next to an `<x>Key:` is
 * a drift the coverage gate fails on — see tests/i18n-coverage.test.js.
 *
 * The same one-shape rule applies to the fallback *string*: B107 pinned every
 * fallback to the en/ value for its key, so `collectFallbackSites` reports the
 * sites unfolded (rather than one-per-key, as `extractUsedKeys` does) for the
 * gate that keeps them from drifting apart again.
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

// <x>Key: '<key>', <x>: '<English fallback>' — a descriptor-table entry whose
// two halves are handed to t() elsewhere. The prefix backreference is what
// makes this a *pair* rather than two unrelated properties, so an unrelated
// `settingsKey` next to a `title` cannot match.
const DESCRIPTOR_PAIR =
  /\b(\w+)Key:\s*(['"])([\w.-]+)\2\s*,\s*\1:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g;

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
    for (const m of src.matchAll(T_CALL))
      record(m[2], m[3] ?? m[4] ?? null, file);
    for (const m of src.matchAll(DESCRIPTOR_PAIR))
      record(m[3], m[4] ?? m[5] ?? null, file);
  }
  return used;
}

/**
 * Decode a JavaScript string literal's *source* text into the value it denotes.
 * The extraction regexes capture what stands between the quotes, so `\'` and
 * `\n` arrive here as two characters each and have to be resolved before the
 * result can be compared with a locale value.
 * @param {string} raw - literal body, without its delimiters
 * @returns {string}
 */
function decodeJsLiteral(raw) {
  return raw.replace(
    /\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/gs,
    (_, esc) => {
      switch (esc[0]) {
        case 'n':
          return '\n';
        case 't':
          return '\t';
        case 'r':
          return '\r';
        case 'b':
          return '\b';
        case 'f':
          return '\f';
        case 'v':
          return '\v';
        case '0':
          return esc.length === 1 ? '\0' : esc;
        case 'x':
          return String.fromCodePoint(parseInt(esc.slice(1), 16));
        case 'u':
          return String.fromCodePoint(
            parseInt(esc[1] === '{' ? esc.slice(2, -1) : esc.slice(1), 16),
          );
        default:
          return esc;
      }
    },
  );
}

/**
 * Every place the client spells an English fallback beside a key — the second
 * argument of `t()` and the second half of a descriptor pair — as one flat list
 * of *sites*, not folded per key.
 *
 * `extractUsedKeys` deliberately keeps only the first fallback it sees for a
 * key, which is what the coverage gate needs and exactly what hides a key
 * carrying two different English strings. This returns them all, so the
 * one-fallback-per-key gate in tests/i18n-coverage.test.js can see the collision.
 *
 * @param {string} dir - absolute path to a tree to scan (client/)
 * @returns {Promise<Array<{ key: string, fallback: string, file: string, line: number }>>}
 */
export async function collectFallbackSites(dir) {
  const sites = [];
  for await (const file of walkJs(dir)) {
    const src = await fs.readFile(file, 'utf8');
    const record = (key, raw, index) => {
      if (raw == null) return;
      sites.push({
        key,
        fallback: decodeJsLiteral(raw),
        file,
        line: src.slice(0, index).split('\n').length,
      });
    };
    for (const m of src.matchAll(T_CALL))
      record(m[2], m[3] ?? m[4] ?? null, m.index);
    for (const m of src.matchAll(DESCRIPTOR_PAIR))
      record(m[3], m[4] ?? m[5] ?? null, m.index);
  }
  return sites;
}

// The pre-B94 spelling of the same pair: <x>Key: '<key>', <x>Default: '…'.
// Kept only as a needle — a match means the second spelling is growing back.
const LEGACY_DESCRIPTOR_PAIR =
  /\b(\w+)Key:\s*(['"])([\w.-]+)\2\s*,\s*\1Default:/g;

/**
 * Find descriptor pairs still written in the retired `<x>Key` / `<x>Default`
 * spelling. B94 normalized every one of them to the bare `<x>Key` / `<x>` form
 * and narrowed DESCRIPTOR_PAIR to match only that, so a hit here is a key the
 * extractor no longer sees *and* a second shape for one meaning.
 * @param {string} dir - absolute path to a tree that holds descriptor tables:
 *   client/ (what extractUsedKeys scans) or shared/, where the slide-type
 *   registry spells the same pair
 * @returns {Promise<string[]>} `<file>:<line>  <prefix>Key/<prefix>Default` per hit
 */
export async function findLegacyDescriptorPairs(dir) {
  const offenders = [];
  for await (const file of walkJs(dir)) {
    const src = await fs.readFile(file, 'utf8');
    for (const m of src.matchAll(LEGACY_DESCRIPTOR_PAIR)) {
      const line = src.slice(0, m.index).split('\n').length;
      offenders.push(`${file}:${line}  ${m[1]}Key/${m[1]}Default`);
    }
  }
  return offenders;
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
