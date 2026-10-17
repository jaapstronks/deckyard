/**
 * One focus ring guard (D349, B727).
 *
 * Every keyboard stop in the app draws the same ring: `--app-focus-ring`
 * (`client/styles/shared/ui-tokens.css`), set as a zero-specificity baseline in
 * `client/styles/shared/primitives.css`. A component may restate the offset,
 * or the colour where the ring sits on a surface the app does not own (the
 * dark coach bubble, an error state), but never the ring itself.
 *
 * Checks:
 *  1. the tokens exist and the ring is built from `--app-border-focus`
 *  2. the baseline rule exists, so no stop falls back to `outline: auto`
 *  3. every focus rule in the app layers that sets `outline` uses the token,
 *     and `outline: none` only where the allowlist names who carries the ring
 *  4. no focus rule paints an accent halo (`box-shadow: 0 0 0 …`) in its place
 *  5. no rule outside a focus state switches the outline off: at zero
 *     specificity the baseline loses to any `.x { outline: none }`
 *
 * Run with: node --test tests/focus-ring.test.js
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
/** App layers: tokens and primitives, feature chrome, viewer chrome. */
const LAYERS = ['shared', 'app', 'viewer'];

/**
 * Focus rules that switch the outline off because something else draws the
 * ring. Selector (normalised whitespace) → who carries it.
 */
const OUTLINE_NONE_ALLOWED = {
  // The field is scaled with the slide; its overlay box draws the ring
  // (`.ie-ol-outline.is-focused`, B725).
  '.thumb.is-inline-edit [data-inline-field]:focus':
    'the overlay box of the field',
  // The input sits inside `.tag-editor`, whose :focus-within draws the ring.
  '.tag-editor-input:focus': '.tag-editor:focus-within',
};

/**
 * Rules outside a focus state that switch the outline off. Selector → why the
 * stop still shows a ring.
 */
const BASE_OUTLINE_NONE_ALLOWED = {
  '.thumb.is-inline-edit [data-inline-field].ie-editing':
    'a field in edit shows the overlay edit ring and a caret',
  '.thumb.is-inline-edit [data-inline-field].ie-editing:empty':
    'same field, empty: drops the dashed placeholder outline',
};

/** @param {string} dir @returns {Promise<string[]>} */
async function cssFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await cssFiles(full)));
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out.sort();
}

/** @param {string} source */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (block) =>
    block.replace(/[^\n]/g, ' '),
  );
}

/**
 * Innermost rule blocks (`selector { declarations }`) whose selector names a
 * focus state.
 *
 * @param {string} source
 * @returns {{ selector: string, body: string, line: number }[]}
 */
function focusRules(source, { focus = true } = {}) {
  const css = stripComments(source);
  const rules = [];
  for (const m of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const selector = m[1].replace(/\s+/g, ' ').trim();
    if (/:focus(-visible|-within)?\b/.test(selector) !== focus) continue;
    const line = css
      .slice(0, m.index + m[0].indexOf(m[1].trim()))
      .split('\n').length;
    rules.push({ selector, body: m[2], line });
  }
  return rules;
}

async function allFocusRules(options) {
  const out = [];
  for (const layer of LAYERS) {
    for (const file of await cssFiles(path.join(stylesDir, layer))) {
      const rel = path.relative(repoRoot, file);
      const source = await fs.readFile(file, 'utf8');
      for (const rule of focusRules(source, options)) {
        out.push({ ...rule, file: rel });
      }
    }
  }
  return out;
}

describe('one focus ring (D349)', () => {
  it('builds the ring from the app tokens', async () => {
    const tokens = await fs.readFile(
      path.join(stylesDir, 'shared', 'ui-tokens.css'),
      'utf8',
    );
    assert.match(tokens, /--ps-focus-ring-width:\s*2px;/);
    assert.match(
      tokens,
      /--app-focus-ring:\s*var\(--ps-focus-ring-width\)\s+solid\s+hsl\(var\(--app-border-focus\)\);/,
    );
  });

  it('sets the ring as the baseline for every :focus-visible', async () => {
    const primitives = stripComments(
      await fs.readFile(
        path.join(stylesDir, 'shared', 'primitives.css'),
        'utf8',
      ),
    );
    const m = primitives.match(/:where\(:focus-visible\)\s*\{([^}]*)\}/);
    assert.ok(m, 'primitives.css has no :where(:focus-visible) baseline');
    assert.match(m[1], /outline:\s*var\(--app-focus-ring\);/);
    assert.match(m[1], /outline-offset:\s*var\(--ps-focus-ring-offset\);/);
  });

  it('draws no focus outline other than the token', async () => {
    const offenders = [];
    const usedAllowances = new Set();
    for (const rule of await allFocusRules()) {
      for (const d of rule.body.matchAll(/(?:^|;)\s*outline:\s*([^;]+)/g)) {
        const value = d[1].replace(/\s+/g, ' ').trim();
        if (value === 'var(--app-focus-ring)') continue;
        if (value === 'none') {
          const key = rule.selector
            .split(',')
            .map((s) => s.trim())
            .find((s) => s in OUTLINE_NONE_ALLOWED);
          if (key) {
            usedAllowances.add(key);
            continue;
          }
        }
        offenders.push(
          `${rule.file}:${rule.line} ${rule.selector} { outline: ${value} }`,
        );
      }
    }
    assert.deepStrictEqual(
      offenders,
      [],
      'Use `outline: var(--app-focus-ring)` (restate only offset or colour):\n' +
        offenders.join('\n'),
    );
    assert.deepStrictEqual(
      Object.keys(OUTLINE_NONE_ALLOWED).filter((k) => !usedAllowances.has(k)),
      [],
      'stale OUTLINE_NONE_ALLOWED entries',
    );
  });

  it('paints no accent halo in place of the ring', async () => {
    const offenders = [];
    for (const rule of await allFocusRules()) {
      // A :focus-within highlight marks a container, not a stop.
      if (!/:focus(-visible)?\b(?!-)/.test(rule.selector)) continue;
      const shadow = rule.body.match(/box-shadow:\s*([^;]+)/);
      if (!shadow) continue;
      if (
        /(inset\s+)?0 0 0 \S+\s+hsl\(var\(--app-(accent-primary|danger)/.test(
          shadow[1],
        )
      ) {
        offenders.push(`${rule.file}:${rule.line} ${rule.selector}`);
      }
    }
    assert.deepStrictEqual(
      offenders,
      [],
      'A focus halo stands in for the ring:\n' + offenders.join('\n'),
    );
  });

  it('switches no outline off outside a focus state', async () => {
    const offenders = [];
    const used = new Set();
    for (const rule of await allFocusRules({ focus: false })) {
      if (!/(?:^|;)\s*outline:\s*(none|0)\s*(;|$)/.test(rule.body)) continue;
      if (rule.selector in BASE_OUTLINE_NONE_ALLOWED) {
        used.add(rule.selector);
        continue;
      }
      offenders.push(`${rule.file}:${rule.line} ${rule.selector}`);
    }
    assert.deepStrictEqual(
      offenders,
      [],
      'This beats the :where(:focus-visible) baseline:\n' +
        offenders.join('\n'),
    );
    assert.deepStrictEqual(
      Object.keys(BASE_OUTLINE_NONE_ALLOWED).filter((k) => !used.has(k)),
      [],
      'stale BASE_OUTLINE_NONE_ALLOWED entries',
    );
  });
});
