/**
 * One definition per class in the app chrome (B530, D266, D269).
 *
 * A cascade duplicate is an ownership question: the component that builds the
 * DOM owns the rule, and a second file carrying the same unscoped selector is
 * either a stale copy (identical, dead weight) or drift (the later file wins,
 * silently, and the owner's edit does nothing). Two assertions, no allowlist
 * and no ratchet:
 *
 *   1. no unscoped simple class selector (`.foo`, a whole selector in a
 *      top-level rule's list) is defined in two files of `client/styles/**`;
 *   2. a primitive every bundle renders (the `.btn` family, the `.form-input`
 *      ladder, `.row`, the segmented control) is defined only in
 *      `shared/primitives.css`, which `app.css`, `export.css` and `embed.css`
 *      all import. A leaf file, or a bundle entry, may scope an override
 *      (`.ps-embed-controls .btn`); it may not define the primitive, which is
 *      how `.btn-xs` came to exist twice with two sizes.
 *
 * `slides/**` is out: slide CSS has its own contract
 * (`slide-type-css-contract.test.js`, `slide-css-tokens.test.js`), and a slide
 * type's class is re-scoped per type there. The editor-only primitives
 * (`.modal`, `.field-label`, `.stack`, `.is-*`) are held by assertion 1; their
 * address moves with the feature map (B533). The viewer side of the rule:
 * `docs/reference/standalone-html-export.md` § Which CSS ships.
 *
 * Run with: node --test tests/css-one-definition.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const stylesDir = path.join(repoRoot, 'client', 'styles');
const PRIMITIVES_FILE = 'client/styles/shared/primitives.css';

/** The classes `shared/primitives.css` owns (D266). */
const PRIMITIVES = [
  'btn',
  'btn-primary',
  'btn-secondary',
  'btn-ai',
  'btn-danger',
  'btn-icon',
  'btn-sm',
  'btn-xs',
  'form-input',
  'form-input-sm',
  'form-input-xs',
  'row',
  'sb-segmented',
  'sb-segmented-btn',
];

/**
 * @param {string} dir
 * @returns {Promise<string[]>} absolute paths of every `.css` file, sorted
 */
async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out.sort();
}

/** Blank out block comments, keeping newlines so line numbers stay right. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/**
 * The selector lists of the top-level style rules: not the ones nested in an
 * at-rule (`@media`, `@supports`), which are a context's override of a rule
 * that lives at the top, and not the at-rules themselves.
 *
 * @param {string} text comment-free CSS
 * @returns {{ selectors: string[], line: number }[]}
 */
function topLevelRules(text) {
  const rules = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '{') {
      if (depth === 0) {
        const prelude = text.slice(start, i).trim();
        if (prelude && !prelude.startsWith('@')) {
          const line = text.slice(0, i).split('\n').length;
          rules.push({ selectors: splitSelectorList(prelude), line });
        }
      }
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) start = i + 1;
    } else if (c === ';' && depth === 0) {
      start = i + 1; // `@import …;`
    }
  }
  return rules;
}

/** Split `a, b:is(c, d)` on its top-level commas. */
function splitSelectorList(prelude) {
  const out = [];
  let depth = 0;
  let buf = '';
  for (const c of prelude) {
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (c === ',' && depth === 0) {
      out.push(buf);
      buf = '';
    } else buf += c;
  }
  out.push(buf);
  return out.map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

const SIMPLE_CLASS = /^\.([A-Za-z0-9_-]+)$/;
/** `.btn`, `.btn:hover`, `.btn-primary:hover:not(:disabled)`: the class bare. */
const BARE_CLASS = /^\.([A-Za-z0-9_-]+)((?::{1,2}[A-Za-z-]+(?:\([^)]*\))?)*)$/;

const files = (await walk(stylesDir)).filter(
  (file) => !path.relative(stylesDir, file).startsWith('slides' + path.sep),
);
const sheets = await Promise.all(
  files.map(async (file) => ({
    file: path.relative(repoRoot, file).split(path.sep).join('/'),
    rules: topLevelRules(stripComments(await fs.readFile(file, 'utf8'))),
  })),
);

describe('one definition per class (B530)', () => {
  it('scans the app chrome', () => {
    assert.ok(
      sheets.length > 80,
      `expected the app-chrome sheets, got ${sheets.length}`,
    );
    assert.ok(sheets.some((s) => s.file === PRIMITIVES_FILE));
  });

  it('defines no unscoped class selector in two files', () => {
    /** @type {Map<string, string[]>} */
    const owners = new Map();
    for (const { file, rules } of sheets) {
      for (const { selectors, line } of rules) {
        for (const sel of selectors) {
          if (!SIMPLE_CLASS.test(sel)) continue;
          const at = owners.get(sel) || [];
          if (!at.some((a) => a.startsWith(file + ':')))
            at.push(`${file}:${line}`);
          owners.set(sel, at);
        }
      }
    }
    const dups = [...owners].filter(([, at]) => at.length > 1);
    assert.deepEqual(
      dups.map(([sel, at]) => `${sel}  ${at.join('  ')}`),
      [],
      'these selectors are defined in more than one file. The component that ' +
        'builds the DOM owns the rule (D269): keep it there, fold the other ' +
        "copy's winning declarations into it, and delete the copy.",
    );
  });

  it('defines the shared primitives only in shared/primitives.css', () => {
    const strays = [];
    for (const { file, rules } of sheets) {
      if (file === PRIMITIVES_FILE) continue;
      for (const { selectors, line } of rules) {
        for (const sel of selectors) {
          const m = sel.match(BARE_CLASS);
          if (m && PRIMITIVES.includes(m[1]))
            strays.push(`${file}:${line} ${sel}`);
        }
      }
    }
    assert.deepEqual(
      strays,
      [],
      `a primitive is defined once, in ${PRIMITIVES_FILE}, and imported by ` +
        'every bundle (D266). Scope an override under the component instead.',
    );
  });

  it('pins the primitives in their home', () => {
    const home = sheets.find((s) => s.file === PRIMITIVES_FILE);
    const defined = new Set(
      home.rules.flatMap((r) =>
        r.selectors.map((s) => s.match(SIMPLE_CLASS)?.[1]).filter(Boolean),
      ),
    );
    assert.deepEqual(
      PRIMITIVES.filter((cls) => !defined.has(cls)),
      [],
      'every listed primitive has its base rule in shared/primitives.css',
    );
  });
});
