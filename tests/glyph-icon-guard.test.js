/**
 * Guard: UI icons come from the icon set, not from unicode glyphs (B466).
 *
 * The app has one icon system: `icon(name)` from `client/lib/dom/icons.js`, a
 * masked Lucide SVG that paints with `currentColor`. A glyph drawn as an icon
 * (ℹ ✓ ✕ × ← ▶ 🔒 👥 …) is a second one: it renders per OS font (the ℹ is an
 * emoji on macOS, a letter elsewhere), shares neither stroke nor size with the
 * set, and ignores the registry.
 *
 * What is scanned in `client/` (not `vendor/`):
 *  - every string and template literal in a `.js` file, escapes decoded
 *    (`'\u2713'`, `'&#8942;'`), comments skipped, the literals inside a
 *    template's `${…}` included;
 *  - every CSS `content:` value, `\2713` escapes decoded;
 *  - every value in `client/i18n/<locale>/*.json`.
 *
 * A glyph there is an icon unless a TYPOGRAPHY rule says it is text:
 *  - an arrow (U+2190-21FF) in a string that also carries a word: prose and
 *    labels ("View all →", "File → Share", "Up ↑", "Open ↗", "(⇧⌘Z)");
 *  - `×` between two operands: multiplication ("2×2", "1920×1080",
 *    "5 slides × 10s");
 *  - the key legends in KEY_LEGENDS, where a lone arrow is the name of a key;
 *  - the slide stylesheets in SLIDE_CONTENT, whose glyphs are bullets the
 *    author sees in the deck and every export, not app chrome.
 * An arrow alone in its string is a button (back, move up, sort), so it is an
 * icon. The rules are the allowlist; there is no per-line exemption.
 *
 * What is left is BURNDOWN: glyph icons that predate this guard, counted per
 * file like `eslint-suppressions.json`. The count may only go down: a new
 * glyph fails here, and a removed one fails until its entry is lowered, so
 * the list never carries slack another file could spend. B466 PR 2b empties
 * it, replacing each with `icon()`.
 *
 * Run with: node --test tests/glyph-icon-guard.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const CLIENT_DIR = path.join(repoRoot, 'client');

/**
 * Icon-range code points: ×, ℹ, arrows, ⋮ ⋯, geometric shapes, misc
 * symbols, dingbats, misc symbols and arrows, the emoji presentation
 * selector and the emoji planes.
 */
const GLYPH =
  /[\u00D7\u2139\u2190-\u21FF\u22EE\u22EF\u25A0-\u25FF\u2600-\u26FF\u2700-\u27BF\u2B00-\u2BFF]|\uFE0F|[\u{1F000}-\u{1FAFF}]/gu;
const ARROW = /^[\u2190-\u21FF]$/u;
const WORD = /\p{L}{2,}/u;

/** Files whose lone arrows name keys in a shortcut legend, not buttons. */
const KEY_LEGENDS = {
  'client/views/editor/shortcuts.js':
    'the editor shortcut legend: ↑ ↓ ⇧ are the keys the user presses',
  'client/views/presenter/shortcuts-overlay.js':
    'the presenter shortcut legend: ← → ↑ ↓ are the keys the user presses',
};

/**
 * Slide stylesheets whose glyphs are slide content. Whether a slide bullet
 * should be a glyph at all is a question for the slide type, not this guard.
 */
const SLIDE_CONTENT = {
  'client/styles/slides/01-layout-and-title/82-comparison-slide.css':
    'the ✓/✗ pro and con bullets of the comparison slide',
};

/** Glyph icons that predate the guard, per file. May only shrink (B466). */
const BURNDOWN = {
  'client/i18n/da/common.json': 1,
  'client/i18n/da/list.json': 1,
  'client/i18n/da/presenter.json': 2,
  'client/i18n/de/common.json': 1,
  'client/i18n/de/list.json': 1,
  'client/i18n/de/presenter.json': 2,
  'client/i18n/en/common.json': 1,
  'client/i18n/en/editor.json': 1,
  'client/i18n/en/list.json': 1,
  'client/i18n/en/presenter.json': 2,
  'client/i18n/es/common.json': 1,
  'client/i18n/es/list.json': 1,
  'client/i18n/es/presenter.json': 2,
  'client/i18n/fi/common.json': 1,
  'client/i18n/fi/presenter.json': 2,
  'client/i18n/fr/common.json': 1,
  'client/i18n/fr/list.json': 1,
  'client/i18n/fr/presenter.json': 2,
  'client/i18n/it/common.json': 1,
  'client/i18n/it/presenter.json': 2,
  'client/i18n/nl/common.json': 1,
  'client/i18n/nl/editor.json': 1,
  'client/i18n/nl/list.json': 1,
  'client/i18n/nl/presenter.json': 2,
  'client/i18n/no/common.json': 1,
  'client/i18n/no/list.json': 1,
  'client/i18n/no/presenter.json': 2,
  'client/i18n/pl/common.json': 1,
  'client/i18n/pl/presenter.json': 2,
  'client/i18n/pt/common.json': 1,
  'client/i18n/pt/list.json': 1,
  'client/i18n/pt/presenter.json': 2,
  'client/i18n/sv/common.json': 1,
  'client/i18n/sv/list.json': 1,
  'client/i18n/sv/presenter.json': 2,
  'client/lib/slide-authoring/slide-diff.js': 4,
  'client/styles/app/components.css': 1,
  'client/styles/base/02-lists-and-thumbs/33-slide-metadata.css': 2,
  'client/styles/base/03-controls-and-forms.css': 2,
  'client/styles/base/04-editor-and-misc/100-analytics.css': 1,
  'client/styles/base/04-editor-and-misc/13-modals-misc.css': 1,
  'client/styles/base/04-editor-and-misc/17-deck-grid.css': 1,
  'client/styles/slides/03-components/85-presenter-start.css': 1,
  'client/views/analytics/dashboard-cards.js': 2,
  'client/views/analytics/report-modal.js': 1,
  'client/views/editor/editor-form/ai-slide-notes.js': 1,
  'client/views/editor/modals/versions-compare.js': 4,
  'client/views/list/presentation-card.js': 1,
  'client/views/notes/layout.js': 2,
};

// ── extraction ──────────────────────────────────────────────────────────────

/** Decode JS and HTML escapes so `'\u2713'` and `'&#8942;'` count too. */
function decodeJs(raw) {
  return raw
    .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)));
}

/** Decode CSS escapes (`\2713`, `\2713 `). */
function decodeCss(raw) {
  return raw.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex) =>
    String.fromCodePoint(parseInt(hex, 16)),
  );
}

/**
 * The index of the `}` that closes a template `${…}` opened just before `i`.
 * Quoted and template literals are skipped whole, so a brace inside one
 * (`${'}'}`, `${`${a}`}`) does not end the expression.
 * @param {string} src
 * @param {number} i
 * @returns {number}
 */
function expressionEnd(src, i) {
  let depth = 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      i++;
      while (i < src.length && src[i] !== ch) {
        if (src[i] === '\\') i++;
        else if (ch === '`' && src[i] === '$' && src[i + 1] === '{') {
          i = expressionEnd(src, i + 2);
        }
        i++;
      }
    } else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i;
    i++;
  }
  return i;
}

const REGEX_PRECEDERS = new Set('(,=:[!&|?{};+-*%<>~^'.split(''));

/**
 * The string and template literals of a JS source, comments and regex
 * literals skipped. A template literal is one string in which a `${t(…)}`
 * stands in as the word `label` (a translation is words) and any other
 * `${…}` as `0` (a value), so "${t('redo')} (⇧⌘Z)" reads as prose and
 * "↓ ${pct}%" as a lone arrow.
 * @param {string} src
 * @returns {{text: string, line: number}[]}
 */
export function jsStrings(src) {
  const out = [];
  let i = 0;
  let line = 1;
  let prev = '';
  const n = src.length;
  const advance = (ch) => {
    if (ch === '\n') line++;
  };
  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '/' && next === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/'))
        advance(src[i++]);
      i += 2;
      continue;
    }
    if (ch === '/' && (prev === '' || REGEX_PRECEDERS.has(prev))) {
      i++;
      let inClass = false;
      while (i < n && src[i] !== '\n') {
        if (src[i] === '\\') i++;
        else if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        else if (src[i] === '/' && !inClass) break;
        i++;
      }
      i++;
      prev = '/regex';
      continue;
    }
    if (ch === "'" || ch === '"') {
      const start = line;
      let text = '';
      i++;
      while (i < n && src[i] !== ch && src[i] !== '\n') {
        if (src[i] === '\\') text += src[i++];
        text += src[i++];
      }
      i++;
      out.push({ text: decodeJs(text), line: start });
      prev = 'str';
      continue;
    }
    if (ch === '`') {
      const start = line;
      let text = '';
      i++;
      while (i < n && src[i] !== '`') {
        if (src[i] === '\\') {
          text += src[i++];
          text += src[i++];
        } else if (src[i] === '$' && src[i + 1] === '{') {
          const from = (i += 2);
          i = expressionEnd(src, i);
          const expr = src.slice(from, i);
          // The expression's own literals (`${ok ? '✓' : ''}`) are strings too.
          for (const s of jsStrings(expr)) {
            out.push({ text: s.text, line: line + s.line - 1 });
          }
          for (const c of expr) advance(c);
          i++;
          text += /^\s*t\(/.test(expr) ? 'label' : '0';
        } else {
          advance(src[i]);
          text += src[i++];
        }
      }
      i++;
      out.push({ text: decodeJs(text), line: start });
      prev = 'str';
      continue;
    }
    advance(ch);
    if (!/\s/.test(ch)) prev = /[\w$)\]]/.test(ch) ? 'id' : ch;
    i++;
  }
  return out;
}

/**
 * The `content:` values of a stylesheet, comments skipped.
 * @param {string} src
 * @returns {{text: string, line: number}[]}
 */
function cssContentValues(src) {
  const out = [];
  const bare = src.replace(/\/\*[\s\S]*?\*\//g, (c) =>
    c.replace(/[^\n]/g, ' '),
  );
  const re = /(?:^|[;{\s])content\s*:\s*([^;}]*)/g;
  let m;
  while ((m = re.exec(bare))) {
    const line = bare.slice(0, m.index).split('\n').length;
    out.push({ text: decodeCss(m[1]), line });
  }
  return out;
}

/**
 * The values of an i18n file, reported by key.
 * @param {string} src
 * @returns {{text: string, line: string}[]}
 */
function i18nValues(src) {
  return Object.entries(JSON.parse(src))
    .filter(([, v]) => typeof v === 'string')
    .map(([key, text]) => ({ text, line: key }));
}

// ── classification ──────────────────────────────────────────────────────────

/**
 * The glyph icons in one string: every icon-range glyph no typography rule
 * claims. A lone U+FE0F rides on the glyph before it and is not counted.
 * @param {string} text
 * @param {{keyLegend?: boolean}} [opts]
 * @returns {string[]}
 */
export function glyphIcons(text, { keyLegend = false } = {}) {
  const icons = [];
  const hasWord = WORD.test(text);
  for (const m of text.matchAll(GLYPH)) {
    const g = m[0];
    if (g === '\uFE0F') continue;
    if (ARROW.test(g) && (hasWord || keyLegend)) continue;
    if (g === '\u00D7') {
      const before = text.slice(0, m.index).trimEnd();
      const after = text.slice(m.index + 1).trimStart();
      if (/[\p{L}\p{N})]$/u.test(before) && /^[\p{L}\p{N}(]/u.test(after)) {
        continue;
      }
    }
    icons.push(g);
  }
  return icons;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'vendor') walk(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

/** @returns {Map<string, string[]>} file → `line: glyph` per glyph icon */
function scan() {
  const hits = new Map();
  for (const file of walk(CLIENT_DIR)) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    if (rel in SLIDE_CONTENT) continue;
    const src = fs.readFileSync(file, 'utf8');
    let items;
    if (rel.endsWith('.js')) items = jsStrings(src);
    else if (rel.endsWith('.css')) items = cssContentValues(src);
    else if (rel.startsWith('client/i18n/') && rel.endsWith('.json')) {
      items = i18nValues(src);
    } else continue;
    const keyLegend = rel in KEY_LEGENDS;
    const found = [];
    for (const { text, line } of items) {
      for (const g of glyphIcons(text, { keyLegend }))
        found.push(`${line}: ${g}`);
    }
    if (found.length) hits.set(rel, found);
  }
  return hits;
}

// ── tests ───────────────────────────────────────────────────────────────────

test('no glyph icon in client/ beyond the burndown', () => {
  const hits = scan();
  const grown = [];
  const shrunk = [];
  for (const [file, found] of hits) {
    const allowed = BURNDOWN[file] ?? 0;
    if (found.length > allowed) {
      grown.push(
        `  ${file} (${found.length} > ${allowed}):\n    ${found.join('\n    ')}`,
      );
    } else if (found.length < allowed) {
      shrunk.push(`  ${file}: lower the entry to ${found.length}`);
    }
  }
  for (const file of Object.keys(BURNDOWN)) {
    if (!hits.has(file)) shrunk.push(`  ${file}: drop the entry (0 left)`);
  }
  assert.deepEqual(
    grown,
    [],
    'A unicode glyph drawn as an icon. Use icon(name) from ' +
      'client/lib/dom/icons.js (add the name to UI_ICON_NAMES in ' +
      'shared/icon-names.js); in an i18n string, keep the words and put the ' +
      'icon beside them in code:\n' +
      grown.join('\n'),
  );
  assert.deepEqual(
    shrunk,
    [],
    'The burndown only shrinks - lower it to what is left:\n' +
      shrunk.join('\n'),
  );
});

test('the key legends and slide stylesheets still exist', () => {
  for (const file of [
    ...Object.keys(KEY_LEGENDS),
    ...Object.keys(SLIDE_CONTENT),
  ]) {
    assert.ok(
      fs.existsSync(path.join(repoRoot, file)),
      `${file} is gone - drop its entry`,
    );
  }
});

test('the rules: icon versus typography', () => {
  // Icons.
  assert.deepEqual(glyphIcons('ℹ'), ['ℹ']);
  assert.deepEqual(glyphIcons('×'), ['×']);
  assert.deepEqual(glyphIcons('←'), ['←']);
  assert.deepEqual(glyphIcons('✓ Report generated'), ['✓']);
  assert.deepEqual(glyphIcons('⚠️ {warning}'), ['⚠']);
  assert.deepEqual(glyphIcons('👥 Shared'), ['👥']);
  assert.deepEqual(glyphIcons('◀︎ Preview'), ['◀']);
  assert.deepEqual(glyphIcons('↓ 0%'), ['↓']);
  // Typography.
  assert.deepEqual(glyphIcons('View all →'), []);
  assert.deepEqual(glyphIcons('File → Share → Publish'), []);
  assert.deepEqual(glyphIcons('Up ↑'), []);
  assert.deepEqual(glyphIcons('A 2×2 quadrant matrix'), []);
  assert.deepEqual(glyphIcons(' (0 slides × 0s)'), []);
  assert.deepEqual(glyphIcons('label (⇧⌘Z)'), []);
  assert.deepEqual(glyphIcons('↑', { keyLegend: true }), []);
  // A key legend only frees arrows; a check there is still an icon.
  assert.deepEqual(glyphIcons('✓', { keyLegend: true }), ['✓']);
});

test('the extractor reads literals and skips comments', () => {
  const src = [
    '// a comment with ✓ in it',
    '/* and ✕ here */',
    "const a = '\\u2713';",
    'const b = `${n} × ${m}`;',
    "const e = `${t('redo')} (⇧⌘Z)`;",
    'const c = x / 2 / y;',
    'const d = /[✓]/.test(s);',
    "el.innerHTML = '&#8942;';",
    "const f = `${ok ? '✕' : `${n}}`} done`;",
  ].join('\n');
  const strings = jsStrings(src).map((s) => s.text);
  assert.deepEqual(strings, [
    '✓',
    '0 × 0',
    'redo',
    'label (⇧⌘Z)',
    '⋮',
    '✕',
    '0}',
    '0 done',
  ]);
});
