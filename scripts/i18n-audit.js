/**
 * i18n coverage audit — the two drift directions `tests/i18n-coverage.test.js`
 * does not cover.
 *
 * That test answers "does every key the code uses exist in nl/ and en/?". It
 * cannot see the two failure modes that leave the same user-visible hole:
 *
 *   1. **Hardcoded copy** — a label/button/toast written as a literal inside
 *      `h(...)`, so it never reaches `t()` at all and is English in every
 *      locale. Invisible to a key-based check precisely because there is no key.
 *   2. **Orphan keys** — an entry left in the locale JSONs after its call site
 *      moved or died. Harmless at runtime, but it inflates every one of the 12
 *      locales and makes "how translated are we?" unanswerable.
 *
 * Both are graded against `scripts/i18n-audit-allowlist.json`, a burndown file
 * in the same spirit as `eslint-suppressions.json`: known-accepted entries are
 * listed there with a reason, and the gate fails on anything *new*.
 *
 * Usage:
 *   node scripts/i18n-audit.js              # human report, non-zero exit on new findings
 *   node scripts/i18n-audit.js --json       # machine-readable
 *   node scripts/i18n-audit.js --orphans    # orphan detail (not gated)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  extractUsedKeys,
  loadLocale,
  collectKeyLiteralRefs,
  isRuntimeBuiltKey,
} from './i18n-keys.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientDir = path.join(repoRoot, 'client');
const i18nDir = path.join(clientDir, 'i18n');
const ALLOWLIST_PATH = path.join(repoRoot, 'scripts', 'i18n-audit-allowlist.json');

/** Directories under client/ that never contain app copy. */
const IGNORE_DIRS = new Set(['vendor', 'styles', 'i18n']);

/**
 * `h()` option props whose value is rendered to the user as copy.
 * `value`/`class`/`id` are deliberately absent — they carry machine tokens.
 */
const COPY_PROPS = [
  'text',
  'title',
  'placeholder',
  'label',
  'aria-label',
  'ariaLabel',
  'alt',
  'hint',
  'description',
  'subtitle',
];

// `{ text: 'copy' }` / `, placeholder: "copy"`. The leading `[{,]` anchors the
// match to a real object-literal position, so the word "description" *inside* a
// string (`console.error('Failed to save description:', err)`) is not mistaken
// for a prop. Values may not span lines, for the same reason.
//
// COPY_PROPS is a fixed list of identifiers ([a-z-] only), so it is interpolated
// verbatim: `-` is not a metacharacter outside a character class, and escaping it
// here reads as sanitizing an untrusted value (it isn't) — which is also what
// CodeQL's js/incomplete-sanitization flagged.
const PROP_RE = new RegExp(
  `[{,]\\s*['"]?(${COPY_PROPS.join('|')})['"]?\\s*:\\s*(['"])((?:[^'"\\\\\\n]|\\\\.)*)\\2`,
  'g'
);
const TOAST_RE = /\btoast(?:\.\w+)?\(\s*(['"])((?:[^'"\\\n]|\\.)*)\1/g;

/**
 * Heuristic: does this literal read as human copy rather than a machine token?
 *
 * The scanner errs toward *reporting*; a false positive costs one allowlist
 * line, whereas a false negative is untranslated copy nobody ever sees again.
 * @param {string} s
 * @returns {boolean}
 */
export function looksLikeCopy(s) {
  const v = String(s).trim();
  if (v.length < 2) return false;
  if (!/[A-Za-z]/.test(v)) return false;
  if (/^[a-z0-9]+([-_.][a-z0-9]+)+$/.test(v)) return false; // slug / kebab class / dotted key
  if (/^[\w-]+\.(js|css|json|png|jpg|svg|html|woff2?)$/i.test(v)) return false; // filename
  if (/^(https?:)?\/\//.test(v)) return false; // url
  if (/^[\d.]+(px|rem|em|%|s|ms|vh|vw|fr|ch)$/.test(v)) return false; // css length
  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return false; // hex colour
  // A single lowercase word is almost always an enum value, not a sentence.
  if (!/\s/.test(v) && !/^[A-Z]/.test(v)) return false;
  return true;
}

/**
 * True when the object literal enclosing `index` also declares an i18n key
 * (`labelKey`, `titleKey`, `i18nKey`, …).
 *
 * A dozen config tables deliberately pair the two — `{ labelKey: 'x.y', label:
 * 'Fallback' }` — because the dictionary is not loaded at import time, so the
 * literal is resolved later via `t(item.labelKey, item.label)`. Those labels are
 * translated; reporting them would train people to ignore this audit.
 *
 * Brace-matching is naive (a `{` inside a string counts), which can only make it
 * skip a hit — the same safe direction as the rest of the heuristics.
 * @param {string} src
 * @param {number} index
 * @returns {boolean}
 */
function hasSiblingI18nKey(src, index) {
  let depth = 0;
  let open = -1;
  for (let i = index; i >= 0; i--) {
    const c = src[i];
    if (c === '}') depth++;
    else if (c === '{') {
      if (depth === 0) {
        open = i;
        break;
      }
      depth--;
    }
  }
  if (open === -1) return false;
  depth = 0;
  let close = src.length;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      close = i;
      break;
    }
  }
  return /\b\w+Key\s*:/.test(src.slice(open, close));
}

async function* walkJs(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      yield* walkJs(full);
    } else if (entry.name.endsWith('.js')) {
      yield full;
    }
  }
}

/**
 * Find user-facing string literals that bypass `t()`.
 * @param {string} dir - absolute path to client/
 * @returns {Promise<Array<{file: string, line: number, prop: string, value: string}>>}
 */
export async function findHardcodedCopy(dir) {
  const hits = [];
  for await (const file of walkJs(dir)) {
    const src = await fs.readFile(file, 'utf8');
    const rel = path.relative(repoRoot, file);
    const lines = src.split('\n');
    const scan = (re, valueGroup, propOf) => {
      for (const m of src.matchAll(re)) {
        const value = m[valueGroup];
        if (!looksLikeCopy(value)) continue;
        const line = src.slice(0, m.index).split('\n').length;
        // A `t()` on the same line means the literal is a fallback, not copy.
        if (/\bt\(/.test(lines[line - 1] || '')) continue;
        if (hasSiblingI18nKey(src, m.index)) continue;
        hits.push({ file: rel, line, prop: propOf(m), value });
      }
    };
    scan(PROP_RE, 3, (m) => m[1]);
    scan(TOAST_RE, 2, () => 'toast');
  }
  return hits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/**
 * Find keys present in a locale's JSON but referenced nowhere in the source.
 * @param {string} locale
 * @returns {Promise<string[]>}
 */
export async function findOrphanKeys(locale) {
  const used = await extractUsedKeys(clientDir);
  // Slide-type definitions and server-rendered chrome carry keys too.
  const refs = await collectKeyLiteralRefs(
    ['client', 'shared', 'server', 'custom', 'themes'].map((d) => path.join(repoRoot, d))
  );
  const dict = await loadLocale(i18nDir, locale);
  return Object.keys(dict)
    .filter((k) => !used.has(k) && !refs.has(k) && !isRuntimeBuiltKey(k))
    .sort();
}

/** @returns {Promise<{hardcoded: Record<string, string>, note?: string}>} */
async function readAllowlist() {
  try {
    return JSON.parse(await fs.readFile(ALLOWLIST_PATH, 'utf8'));
  } catch {
    return { hardcoded: {} };
  }
}

/** Stable identity for an allowlist entry — file + literal, not line number. */
export function hardcodedId(hit) {
  return `${hit.file} :: ${hit.value}`;
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const showOrphans = args.includes('--orphans');

  const allow = await readAllowlist();
  const allowed = allow.hardcoded || {};
  const hits = await findHardcodedCopy(clientDir);
  const unexpected = hits.filter((h) => !(hardcodedId(h) in allowed));
  const orphans = await findOrphanKeys('en');

  if (asJson) {
    console.log(JSON.stringify({ hardcoded: hits, unexpected, orphans }, null, 2));
    return unexpected.length ? 1 : 0;
  }

  console.log(`i18n audit — ${hits.length} hardcoded literal(s), ${Object.keys(allowed).length} allowlisted`);
  if (unexpected.length) {
    console.log(`\n✗ ${unexpected.length} NEW hardcoded user-facing string(s):\n`);
    for (const h of unexpected) {
      console.log(`  ${h.file}:${h.line}  [${h.prop}] ${JSON.stringify(h.value)}`);
    }
    console.log(
      '\nRoute each through t(key, fallback) — or, if it is a brand name, a language\n' +
        `name or a technical placeholder, add it to ${path.relative(repoRoot, ALLOWLIST_PATH)} with a reason.`
    );
  } else {
    console.log('✓ no new hardcoded user-facing strings');
  }

  console.log(`\nOrphan keys in en/: ${orphans.length}`);
  if (showOrphans) for (const k of orphans) console.log(`  ${k}`);
  else if (orphans.length) console.log('  (run with --orphans to list them; not gated)');

  return unexpected.length ? 1 : 0;
}

// pathToFileURL, not a template literal: the repo path may contain spaces,
// which import.meta.url percent-encodes and a raw `file://${argv[1]}` does not.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
