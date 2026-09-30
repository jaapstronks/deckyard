/**
 * App-chrome token namespace gate (B529, D265).
 *
 * The prefix of an app custom property says who may change its value:
 *
 *   - `--ps-*`  the mode-independent scale (type, spacing, radius, transition,
 *               layout constants) - nobody changes it;
 *   - `--app-*` the mode-bound role (colour, shadow, filter) - the ui-mode
 *               redefines it under `[data-ui-mode='dark']`;
 *   - `--z-*`   the stacking scale.
 *
 * All three live in one file, `client/styles/shared/ui-tokens.css`. Any other
 * custom property is component-local and carries its component's name.
 *
 * Four assertions, no allowlist:
 *
 *   1. every `--ps-`/`--app-`/`--z-` definition under `client/styles/**` is in
 *      `shared/ui-tokens.css`;
 *   2. every `--app-*` in the light `:root` block has a dark counterpart, or
 *      carries `/* mode-invariant *\/` on its line (and then has none);
 *   3. every `var(--name)` in an app-chrome sheet (everything outside
 *      `slides/**`) resolves to a definition in CSS or a JS setter
 *      (`setProperty('--…')`, an inline `style: '--…:'`) - a name that exists
 *      nowhere fails, because it renders its fallback in both modes;
 *   4. no app-chrome read of a `--ps-`/`--app-`/`--z-` token carries a
 *      fallback (D279): the token always resolves, so a fallback is a second
 *      value that can only drift from it. A component-local hook
 *      (`var(--swatch, transparent)`) keeps its fallback.
 *
 * The rule, the families and the hook form: docs/reference/css-tokens.md
 * § The namespace rule.
 *
 * Run with: node --test tests/app-css-tokens.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const stylesDir = path.join(repoRoot, 'client', 'styles');
const clientDir = path.join(repoRoot, 'client');
const tokensFile = path.join(stylesDir, 'shared', 'ui-tokens.css');

const APP_FAMILY = /^--(ps|app|z)-/;
const DEFINITION = /(?<![\w-])(--[a-zA-Z][\w-]*)\s*:/g;
const READ = /var\(\s*(--[a-zA-Z][\w-]*)/g;
const APP_READ_WITH_FALLBACK = /var\(\s*(--(?:ps|app|z)-[\w-]*)\s*,/g;
/** A JS setter: `setProperty('--x', …)`, or `--x:` / `'--x':` inside a string or style object. */
const JS_SETTER =
  /setProperty(?:\?\.)?\(\s*['"`](--[a-zA-Z][\w-]*)|['"`;{\s](--[a-zA-Z][\w-]*)['"`]?\s*:/g;

/**
 * @param {string} dir
 * @param {(name: string) => boolean} keep
 * @returns {Promise<string[]>} absolute paths, recursively, sorted
 */
async function walk(dir, keep) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'vendor' || entry.name === 'node_modules') continue;
      out.push(...(await walk(full, keep)));
    } else if (keep(entry.name)) out.push(full);
  }
  return out.sort();
}

/** Blank out block comments, keeping newlines so line numbers stay right. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/** @param {string} text @param {number} index */
function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

const rel = (file) => path.relative(repoRoot, file);
/**
 * The slide layer, which has its own contract (`slide-css-tokens.test.js`)
 * and reads the theme's `--t-*` input family. `theme.css` is that layer's
 * `--t-*` → slide-var step and lives outside `slides/` only until B531 moves
 * it to `slides/00-theme.css` (D268).
 */
const isSlideSheet = (file) =>
  rel(file).startsWith(path.join('client', 'styles', 'slides') + path.sep) ||
  rel(file) === path.join('client', 'styles', 'theme.css');

async function loadCss() {
  const files = await walk(stylesDir, (n) => n.endsWith('.css'));
  return Promise.all(
    files.map(async (file) => {
      const raw = await fs.readFile(file, 'utf8');
      return { file, raw, code: stripComments(raw) };
    }),
  );
}

/**
 * The declarations of the first block opened by `selector` in `raw`, one per
 * line, comments kept (assertion 2 reads the marker from the line).
 * @param {string} raw
 * @param {string} selector
 */
function blockDeclarations(raw, selector) {
  const start = raw.indexOf(`${selector} {`);
  assert.ok(start >= 0, `ui-tokens.css has no \`${selector} {\` block`);
  const end = raw.indexOf('\n}', start);
  const body = raw.slice(start, end);
  const out = new Map();
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*(--app-[\w-]+)\s*:/);
    if (m) out.set(m[1], line);
  }
  return out;
}

describe('app CSS token namespace (D265)', () => {
  it('defines --ps-, --app- and --z- only in shared/ui-tokens.css', async () => {
    const sheets = await loadCss();
    const offenders = [];
    for (const { file, code } of sheets) {
      if (file === tokensFile) continue;
      for (const m of code.matchAll(DEFINITION)) {
        if (APP_FAMILY.test(m[1]))
          offenders.push(`${rel(file)}:${lineOf(code, m.index)} ${m[1]}`);
      }
    }
    assert.deepStrictEqual(
      offenders,
      [],
      `App tokens defined outside shared/ui-tokens.css - move them there, or give a component-local property its component's name:\n  ${offenders.join('\n  ')}`,
    );
  });

  it('gives every light --app-* a dark counterpart or a mode-invariant marker', async () => {
    const raw = await fs.readFile(tokensFile, 'utf8');
    const light = blockDeclarations(raw, ':root');
    const dark = blockDeclarations(raw, ":root[data-ui-mode='dark']");
    const offenders = [];
    for (const [name, line] of light) {
      const invariant = line.includes('/* mode-invariant */');
      if (invariant && dark.has(name))
        offenders.push(`${name}: marked mode-invariant but redefined in dark`);
      if (!invariant && !dark.has(name))
        offenders.push(
          `${name}: no dark counterpart and no mode-invariant marker`,
        );
    }
    for (const name of dark.keys()) {
      if (!light.has(name))
        offenders.push(`${name}: dark-only, no light value`);
    }
    assert.deepStrictEqual(offenders, [], offenders.join('\n'));
  });

  it('resolves every var() read in app-chrome CSS to a definition', async () => {
    const sheets = await loadCss();
    const defined = new Set();
    for (const { code } of sheets) {
      for (const m of code.matchAll(DEFINITION)) defined.add(m[1]);
    }
    const scripts = await walk(clientDir, (n) => n.endsWith('.js'));
    for (const file of scripts) {
      const code = await fs.readFile(file, 'utf8');
      for (const m of code.matchAll(JS_SETTER)) defined.add(m[1] || m[2]);
    }

    const offenders = [];
    for (const { file, code } of sheets) {
      if (isSlideSheet(file)) continue;
      for (const m of code.matchAll(READ)) {
        if (!defined.has(m[1]))
          offenders.push(`${rel(file)}:${lineOf(code, m.index)} ${m[1]}`);
      }
    }
    assert.deepStrictEqual(
      offenders,
      [],
      `var() reads of a name defined nowhere (they render their fallback in both modes) - use the --app-/--ps- role:\n  ${offenders.join('\n  ')}`,
    );
  });

  it('reads --ps-, --app- and --z- tokens without a fallback (D279)', async () => {
    const sheets = await loadCss();
    const offenders = [];
    for (const { file, code } of sheets) {
      if (isSlideSheet(file)) continue;
      for (const m of code.matchAll(APP_READ_WITH_FALLBACK))
        offenders.push(`${rel(file)}:${lineOf(code, m.index)} ${m[1]}`);
    }
    assert.deepStrictEqual(
      offenders,
      [],
      `App tokens read with a fallback - the token always resolves, drop the fallback:\n  ${offenders.join('\n  ')}`,
    );
  });
});
