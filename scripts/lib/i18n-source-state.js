/**
 * Which English text each translation was reviewed against.
 *
 * Presence, placeholder parity and terminology are separate quality axes, and
 * none of them notices that the English under a translation changed: rename
 * "Library" to "Media Library" and every locale keeps its old word while the
 * whole i18n suite stays green. This module is the contract that closes that
 * gap. It binds every present translation, as a `(locale, key)` pair, to a
 * fingerprint of the English source and of the translation itself, in one
 * sidecar next to the tooling: `scripts/i18n-source-state.json`.
 *
 * A record is either
 *
 *   - `reviewed` — somebody explicitly reviewed *this* translation against
 *     *this* English (the reviewed import in `i18n-fill.js` is the route); or
 *   - `unreviewed` — the pair existed when the sidecar was introduced and
 *     nobody has reviewed it since. Its hashes are what was observed then, not
 *     an approval. Observed is not reviewed.
 *
 * A pair is current only when it is `reviewed` and both hashes still match. An
 * `unreviewed` pair whose hashes still match is tolerated, visible debt; the
 * CI burndown (`scripts/i18n-burndown.js`) lets that set shrink and never grow
 * or change. Any hash mismatch is drift and fails the audit, `unreviewed`
 * included: a changed English source under a never-reviewed translation is
 * still a translation nobody has checked against the new text.
 *
 * Module files are where a key lives, not who it is: identity is `(locale,
 * key)`, so moving a key between modules needs no new review. The runtime
 * dictionaries stay flat string maps; nothing here is read by the browser.
 *
 * Pure functions take their inputs explicitly so the tests can drive them
 * with hand-built dictionaries; the I/O helpers at the bottom are the only
 * part that reads the repository.
 *
 * @module scripts/lib/i18n-source-state
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { I18N_DIR, REPO_ROOT, loadLocale } from './i18n-fs.js';
import { LOCALE_IDS, REFERENCE_LOCALE } from './i18n-locales.js';

/** Repo-relative path of the sidecar, as messages and `git show` name it. */
export const SOURCE_STATE_REL = 'scripts/i18n-source-state.json';

/** Absolute path of the sidecar. */
export const SOURCE_STATE_PATH = path.join(REPO_ROOT, SOURCE_STATE_REL);

/** The sidecar schema this module reads and writes. */
export const SOURCE_STATE_SCHEMA = 1;

/** The two statuses a record may carry. Anything else is a parse error. */
export const STATUSES = Object.freeze(['unreviewed', 'reviewed']);

/** The kinds of finding that fail the audit. */
export const FAILING_KINDS = Object.freeze([
  'source-changed',
  'translation-changed',
  'untracked',
  'source-missing',
  'dangling',
]);

const HASH_RE = /^sha256:[0-9a-f]{64}$/;
const RECORD_FIELDS = ['status', 'sourceHash', 'translationHash'];

/**
 * The fingerprint of one string value: `sha256:` plus the lowercase hex
 * SHA-256 of its UTF-8 bytes.
 *
 * Over the *decoded* value, so JSON indentation and `\u` escapes do not
 * change it, while every visible change does — whitespace inside the value,
 * case, punctuation, a placeholder, a different Unicode character. No trim
 * and no normalisation: what the user sees is what is hashed. The same
 * function fingerprints the English source and the translation.
 *
 * @param {string} value
 * @returns {string}
 */
export function hashText(value) {
  if (typeof value !== 'string')
    throw new TypeError(`hashText expects a string, got ${typeof value}`);
  return `sha256:${crypto.createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

/**
 * The en/ key a key translates. Mostly itself; a `<key>.few` has no English
 * of its own, because English has no `few` form, and translates
 * `<key>.many` — the optional third plural suffix `t()` prefers where the
 * locale's rules say `few` (B878).
 *
 * @param {string} key
 * @returns {string}
 */
export function referenceKey(key) {
  return key.endsWith('.few') ? `${key.slice(0, -'.few'.length)}.many` : key;
}

/**
 * The English a key translates (see `referenceKey()`).
 *
 * @param {Record<string, unknown>} reference - the en/ dictionary
 * @param {string} key
 * @returns {string|undefined}
 */
export function referenceEnglish(reference, key) {
  const value = reference[referenceKey(key)];
  return typeof value === 'string' ? value : undefined;
}

/**
 * @typedef {object} SourceRecord
 * @property {'unreviewed'|'reviewed'} status
 * @property {string} sourceHash       fingerprint of the English it was seen with
 * @property {string} translationHash  fingerprint of the translation it was seen with
 */

/**
 * @typedef {object} SourceState
 * @property {number} schema
 * @property {string} reference
 * @property {Record<string, Record<string, SourceRecord>>} entries locale -> key -> record
 */

/**
 * An empty sidecar for the current reference locale.
 * @returns {SourceState}
 */
export function emptySourceState() {
  return {
    schema: SOURCE_STATE_SCHEMA,
    reference: REFERENCE_LOCALE,
    entries: {},
  };
}

/**
 * The one textual form of a sidecar: locales and keys sorted, one record per
 * line, fields in a fixed order, empty locales left out. Because the form is
 * unique, the parser can demand it, and a duplicate key — which `JSON.parse`
 * would silently collapse — shows up as a difference.
 *
 * @param {SourceState} state
 * @returns {string}
 */
export function serializeSourceState(state) {
  const lines = [
    '{',
    `  "schema": ${JSON.stringify(state.schema)},`,
    `  "reference": ${JSON.stringify(state.reference)},`,
  ];
  const locales = Object.keys(state.entries)
    .filter((locale) => Object.keys(state.entries[locale]).length)
    .sort();
  if (!locales.length) {
    lines.push('  "entries": {}', '}');
    return `${lines.join('\n')}\n`;
  }
  lines.push('  "entries": {');
  locales.forEach((locale, li) => {
    lines.push(`    ${JSON.stringify(locale)}: {`);
    const records = state.entries[locale];
    const keys = Object.keys(records).sort();
    keys.forEach((key, ki) => {
      const r = records[key];
      const body = JSON.stringify({
        status: r.status,
        sourceHash: r.sourceHash,
        translationHash: r.translationHash,
      });
      lines.push(
        `      ${JSON.stringify(key)}: ${body}${ki < keys.length - 1 ? ',' : ''}`,
      );
    });
    lines.push(`    }${li < locales.length - 1 ? ',' : ''}`);
  });
  lines.push('  }', '}');
  return `${lines.join('\n')}\n`;
}

/**
 * `(locale, key)` pairs that occur more than once in a sidecar's raw text.
 * Reads the canonical layout (locales at four spaces, records at six), which
 * is the only layout the parser accepts anyway.
 * @param {string} text
 * @returns {string[]} `"<locale> <key>"` per repeat
 */
function duplicateRecords(text) {
  const seen = new Set();
  const repeats = [];
  let locale = null;
  for (const line of text.split('\n')) {
    const loc = /^ {4}"((?:\\.|[^"\\])*)": \{$/.exec(line);
    if (loc) {
      locale = loc[1];
      if (seen.has(`locale:${locale}`)) repeats.push(`${locale} (locale)`);
      seen.add(`locale:${locale}`);
      continue;
    }
    const rec = /^ {6}"((?:\\.|[^"\\])*)": \{/.exec(line);
    if (rec && locale !== null) {
      const id = `${locale} ${rec[1]}`;
      if (seen.has(id)) repeats.push(id);
      seen.add(id);
    }
  }
  return repeats;
}

/**
 * Parse a sidecar strictly. Every structural problem is an error, never an
 * empty inventory: a sidecar that silently read as "nothing recorded" would
 * turn every reviewed pair into an untracked one at best, and pass a broken
 * file at worst.
 *
 * @param {string} text - the file's raw text
 * @param {object} [opts]
 * @param {string} [opts.source] - name used in error messages
 * @param {string[]} [opts.locales] - shipped locale ids
 * @param {string} [opts.reference] - the reference locale
 * @returns {SourceState}
 */
export function parseSourceState(
  text,
  {
    source = SOURCE_STATE_REL,
    locales = LOCALE_IDS,
    reference = REFERENCE_LOCALE,
  } = {},
) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`${source}: not valid JSON (${err.message})`, {
      cause: err,
    });
  }
  const errors = [];
  const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (!isObject(data))
    throw new Error(`${source}: top level must be an object`);
  const extra = Object.keys(data).filter(
    (k) => !['schema', 'reference', 'entries'].includes(k),
  );
  if (extra.length)
    errors.push(`unknown top-level field(s): ${extra.join(', ')}`);
  if (data.schema !== SOURCE_STATE_SCHEMA)
    errors.push(
      `"schema" is ${JSON.stringify(data.schema)}, expected ${SOURCE_STATE_SCHEMA}`,
    );
  if (data.reference !== reference)
    errors.push(
      `"reference" is ${JSON.stringify(data.reference)}, expected ${JSON.stringify(reference)}`,
    );
  if (!isObject(data.entries)) {
    errors.push('"entries" must be an object');
  } else {
    for (const [locale, records] of Object.entries(data.entries)) {
      if (!locales.includes(locale) || locale === reference) {
        errors.push(`"${locale}" is not a translated locale`);
        continue;
      }
      if (!isObject(records)) {
        errors.push(`entries.${locale} must be an object`);
        continue;
      }
      for (const [key, r] of Object.entries(records)) {
        const at = `${locale} ${key}`;
        if (!isObject(r)) {
          errors.push(`${at}: record must be an object`);
          continue;
        }
        const fields = Object.keys(r);
        if (
          fields.length !== RECORD_FIELDS.length ||
          !RECORD_FIELDS.every((f) => fields.includes(f))
        )
          errors.push(
            `${at}: record must have exactly ${RECORD_FIELDS.join(', ')}`,
          );
        if (!STATUSES.includes(r.status))
          errors.push(`${at}: unknown status ${JSON.stringify(r.status)}`);
        for (const f of ['sourceHash', 'translationHash'])
          if (typeof r[f] !== 'string' || !HASH_RE.test(r[f]))
            errors.push(`${at}: ${f} is not a sha256: fingerprint`);
      }
    }
  }
  if (!errors.length && serializeSourceState(data) !== text) {
    const repeats = duplicateRecords(text);
    errors.push(
      repeats.length
        ? `duplicate record(s): ${repeats.slice(0, 10).join('; ')}`
        : 'not in canonical form (sorted, one record per line) — ' +
            'write it through the i18n tooling, not by hand formatting',
    );
  }
  if (errors.length) {
    const shown = errors.slice(0, 20).map((e) => `  ${e}`);
    if (errors.length > 20) shown.push(`  … ${errors.length - 20} more`);
    throw new Error(`${source} is invalid:\n${shown.join('\n')}`);
  }
  return data;
}

/**
 * @typedef {object} FreshnessCounts
 * @property {number} reviewedCurrent     reviewed, both hashes match
 * @property {number} unreviewed          unreviewed, both hashes still as observed
 * @property {number} sourceChanged       the English changed since the record
 * @property {number} translationChanged  the translation changed since the record
 * @property {number} untracked           a translation with no record
 * @property {number} missing             an English key the locale lacks (reported only)
 * @property {number} sourceMissing       a translation whose key English lacks
 * @property {number} dangling            a record whose translation is gone
 */

/**
 * @typedef {object} FreshnessFinding
 * @property {string} locale
 * @property {string} key
 * @property {string} kind  one of FAILING_KINDS
 * @property {string|null} status               the record's status, if any
 * @property {string|null} expectedSourceHash   recorded
 * @property {string|null} actualSourceHash     current English
 * @property {string|null} expectedTranslationHash  recorded
 * @property {string|null} actualTranslationHash    current translation
 */

/** @returns {FreshnessCounts} */
function zeroCounts() {
  return {
    reviewedCurrent: 0,
    unreviewed: 0,
    sourceChanged: 0,
    translationChanged: 0,
    untracked: 0,
    missing: 0,
    sourceMissing: 0,
    dangling: 0,
  };
}

/**
 * Classify every translated pair against the sidecar.
 *
 * Source and translation drift are separate kinds and can both be reported
 * for one pair, so the failing counts may overlap; `reviewedCurrent` and
 * `unreviewed` never overlap with them or with each other. `missing` is
 * absence relative to English: reported, never failing here — Tier 1
 * completeness is `tests/i18n-coverage.test.js`'s gate, and a Tier-2 gap
 * falls back to English by design.
 *
 * @param {object} input
 * @param {Record<string, string>} input.reference - the English dictionary
 * @param {Record<string, Record<string, string>>} input.translations - locale -> dictionary
 * @param {SourceState} input.state
 * @returns {{
 *   locales: Record<string, FreshnessCounts>,
 *   totals: FreshnessCounts,
 *   findings: FreshnessFinding[],
 *   failed: boolean,
 * }}
 */
export function classifyFreshness({ reference, translations, state }) {
  /** @type {Record<string, FreshnessCounts>} */
  const locales = {};
  /** @type {FreshnessFinding[]} */
  const findings = [];
  const localeIds = [
    ...new Set([...Object.keys(translations), ...Object.keys(state.entries)]),
  ].sort();

  for (const locale of localeIds) {
    const counts = zeroCounts();
    locales[locale] = counts;
    const dict = translations[locale] || {};
    const records = state.entries[locale] || {};
    const find = (key, kind, record, extra = {}) =>
      findings.push({
        locale,
        key,
        kind,
        status: record ? record.status : null,
        expectedSourceHash: record ? record.sourceHash : null,
        actualSourceHash: null,
        expectedTranslationHash: record ? record.translationHash : null,
        actualTranslationHash: null,
        ...extra,
      });

    for (const [key, value] of Object.entries(dict)) {
      if (typeof value !== 'string') continue; // coverage owns the shape
      const record = records[key];
      const english = referenceEnglish(reference, key);
      const actualTranslationHash = hashText(value);
      if (typeof english !== 'string') {
        counts.sourceMissing++;
        find(key, 'source-missing', record, { actualTranslationHash });
        continue;
      }
      const actualSourceHash = hashText(english);
      if (!record) {
        counts.untracked++;
        find(key, 'untracked', null, {
          actualSourceHash,
          actualTranslationHash,
        });
        continue;
      }
      const sourceMoved = record.sourceHash !== actualSourceHash;
      const translationMoved = record.translationHash !== actualTranslationHash;
      const hashes = { actualSourceHash, actualTranslationHash };
      if (sourceMoved) {
        counts.sourceChanged++;
        find(key, 'source-changed', record, hashes);
      }
      if (translationMoved) {
        counts.translationChanged++;
        find(key, 'translation-changed', record, hashes);
      }
      if (sourceMoved || translationMoved) continue;
      if (record.status === 'reviewed') counts.reviewedCurrent++;
      else counts.unreviewed++;
    }

    for (const [key, record] of Object.entries(records)) {
      if (typeof dict[key] === 'string') continue;
      counts.dangling++;
      const english = referenceEnglish(reference, key);
      find(key, 'dangling', record, {
        actualSourceHash: english === undefined ? null : hashText(english),
      });
    }

    for (const key of Object.keys(reference))
      if (typeof dict[key] !== 'string') counts.missing++;
  }

  const totals = zeroCounts();
  for (const counts of Object.values(locales))
    for (const k of Object.keys(totals)) totals[k] += counts[k];

  findings.sort(
    (a, b) =>
      a.locale.localeCompare(b.locale) ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) ||
      a.kind.localeCompare(b.kind),
  );
  return { locales, totals, findings, failed: findings.length > 0 };
}

/**
 * @typedef {object} BurndownViolation
 * @property {string} locale
 * @property {string} key
 * @property {string} kind  `new-unreviewed` | `downgraded` | `rehashed` | `not-at-base`
 * @property {string} detail
 */

/**
 * Compare a head sidecar with the one at the PR base: the unreviewed debt may
 * only shrink, pair by pair.
 *
 * A count would not do: one reviewed pair would make room for one new
 * unreviewed one, and the total would hide the swap. So every `unreviewed`
 * record at head must exist at the base as `unreviewed` with exactly the same
 * hashes. That one rule refuses new debt (including a whole new locale),
 * a reviewed → unreviewed downgrade and any rehash under `unreviewed`.
 * Leaving `unreviewed` is allowed two ways, and they are reported apart:
 * `promoted` (now reviewed) and `removed` (the translation is gone; English
 * fallback, no linguistic improvement).
 *
 * With no sidecar at the base (`base: null`, which the caller may only pass
 * when the file is provably absent there) this is the bootstrap: every
 * `unreviewed` record must fingerprint the base's own English and
 * translation, so the initial inventory cannot launder a change made in the
 * same PR as "observed".
 *
 * @param {object} input
 * @param {SourceState|null} input.base
 * @param {SourceState} input.head
 * @param {{reference: Record<string,string>, translations: Record<string, Record<string,string>>}} [input.baseInput]
 *   the base's dictionaries — required when `base` is null
 * @returns {{
 *   mode: 'compare'|'bootstrap',
 *   violations: BurndownViolation[],
 *   baseUnreviewed: number,
 *   headUnreviewed: number,
 *   headReviewed: number,
 *   promoted: number,
 *   removed: number,
 * }}
 */
export function compareWithBase({ base, head, baseInput }) {
  /** @type {BurndownViolation[]} */
  const violations = [];
  const unreviewedAt = (state) => {
    const out = new Map();
    for (const [locale, records] of Object.entries(state.entries))
      for (const [key, r] of Object.entries(records))
        if (r.status === 'unreviewed') out.set(`${locale}\u0000${key}`, r);
    return out;
  };
  const headUnreviewed = unreviewedAt(head);
  let headReviewed = 0;
  for (const records of Object.values(head.entries))
    for (const r of Object.values(records))
      if (r.status === 'reviewed') headReviewed++;

  if (base === null) {
    if (!baseInput)
      throw new Error('a bootstrap comparison needs the base dictionaries');
    for (const [id, r] of headUnreviewed) {
      const [locale, key] = id.split('\u0000');
      const english = referenceEnglish(baseInput.reference, key);
      const value = baseInput.translations[locale]?.[key];
      if (typeof english !== 'string' || typeof value !== 'string') {
        violations.push({
          locale,
          key,
          kind: 'not-at-base',
          detail:
            'recorded as unreviewed, but the base has no such translated pair',
        });
        continue;
      }
      if (
        r.sourceHash !== hashText(english) ||
        r.translationHash !== hashText(value)
      )
        violations.push({
          locale,
          key,
          kind: 'rehashed',
          detail:
            'unreviewed hashes do not fingerprint the base text — a change ' +
            'made in this PR cannot be recorded as observed',
        });
    }
    return {
      mode: 'bootstrap',
      violations: sortViolations(violations),
      baseUnreviewed: 0,
      headUnreviewed: headUnreviewed.size,
      headReviewed,
      promoted: 0,
      removed: 0,
    };
  }

  const baseUnreviewed = unreviewedAt(base);
  for (const [id, r] of headUnreviewed) {
    const [locale, key] = id.split('\u0000');
    const before = baseUnreviewed.get(id);
    if (!before) {
      const was = base.entries[locale]?.[key];
      violations.push(
        was
          ? {
              locale,
              key,
              kind: 'downgraded',
              detail: 'reviewed at the base, unreviewed now',
            }
          : {
              locale,
              key,
              kind: 'new-unreviewed',
              detail:
                'new unreviewed record — new translations enter through the reviewed import',
            },
      );
      continue;
    }
    if (
      before.sourceHash !== r.sourceHash ||
      before.translationHash !== r.translationHash
    )
      violations.push({
        locale,
        key,
        kind: 'rehashed',
        detail:
          'unreviewed hashes changed — only a review may record new hashes',
      });
  }
  let promoted = 0;
  let removed = 0;
  for (const id of baseUnreviewed.keys()) {
    if (headUnreviewed.has(id)) continue;
    const [locale, key] = id.split('\u0000');
    if (head.entries[locale]?.[key]) promoted++;
    else removed++;
  }
  return {
    mode: 'compare',
    violations: sortViolations(violations),
    baseUnreviewed: baseUnreviewed.size,
    headUnreviewed: headUnreviewed.size,
    headReviewed,
    promoted,
    removed,
  };
}

/** @param {BurndownViolation[]} list */
function sortViolations(list) {
  return list.sort(
    (a, b) =>
      a.locale.localeCompare(b.locale) ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
}

/**
 * Drop the records of pairs whose translation was deleted, leaving every other
 * record byte-for-byte as it was. The only way the tooling ever shrinks the
 * sidecar on its own: it never refreshes a hash or changes a status.
 *
 * @param {SourceState} state
 * @param {Array<{locale: string, key: string}>} pairs - deleted translations
 * @returns {{state: SourceState, removed: Array<{locale: string, key: string, status: string}>}}
 */
export function dropSourceRecords(state, pairs) {
  const entries = {};
  for (const [locale, records] of Object.entries(state.entries))
    entries[locale] = { ...records };
  const removed = [];
  for (const { locale, key } of pairs) {
    const record = entries[locale]?.[key];
    if (!record) continue;
    delete entries[locale][key];
    removed.push({ locale, key, status: record.status });
  }
  return { state: { ...state, entries }, removed };
}

/**
 * Read and strictly parse the sidecar. A missing file is an error: the
 * sidecar is part of the repository, and "no file" must never read as
 * "nothing reviewed, nothing to check".
 * @param {string} [filePath]
 * @returns {Promise<SourceState>}
 */
export async function readSourceState(filePath = SOURCE_STATE_PATH) {
  let text;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT')
      throw new Error(
        `${path.relative(REPO_ROOT, filePath)} is missing — the i18n source ` +
          'state is tracked in the repository and must not be deleted',
        { cause: err },
      );
    throw err;
  }
  return parseSourceState(text, { source: path.relative(REPO_ROOT, filePath) });
}

/**
 * Write the sidecar in its canonical form.
 * @param {SourceState} state
 * @param {string} [filePath]
 * @returns {Promise<void>}
 */
export async function writeSourceState(state, filePath = SOURCE_STATE_PATH) {
  await fs.writeFile(filePath, serializeSourceState(state), 'utf8');
}

/**
 * Every locale's merged dictionary, the reference apart from the rest.
 * @param {string} [i18nDir]
 * @returns {Promise<{reference: Record<string,string>, translations: Record<string, Record<string,string>>}>}
 */
export async function loadTranslationInput(i18nDir = I18N_DIR) {
  const reference = await loadLocale(i18nDir, REFERENCE_LOCALE);
  const translations = {};
  for (const locale of LOCALE_IDS) {
    if (locale === REFERENCE_LOCALE) continue;
    translations[locale] = await loadLocale(i18nDir, locale);
  }
  return { reference, translations };
}

/**
 * The freshness classification of the repository as it stands — the one
 * collector `i18n-audit.js` and the test suite share, so a CLI change cannot
 * fall outside the gate.
 * @param {object} [opts]
 * @param {string} [opts.i18nDir]
 * @param {string} [opts.statePath]
 * @returns {Promise<ReturnType<typeof classifyFreshness>>}
 */
export async function collectFreshness({
  i18nDir = I18N_DIR,
  statePath = SOURCE_STATE_PATH,
} = {}) {
  const [input, state] = await Promise.all([
    loadTranslationInput(i18nDir),
    readSourceState(statePath),
  ]);
  return classifyFreshness({ ...input, state });
}
