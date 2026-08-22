/**
 * Size-modifier guard for the `.form-input` family.
 *
 * `form-input-sm` and `form-input-xs` were written in markup 12 times while
 * the only rules carrying them were ancestor-scoped
 * (`.data-source-actions .form-input-xs`, `.editor-slide-duration
 * .form-input-sm`). Everywhere else `form-input form-input-sm` rendered at
 * full size — the class said "small" and did nothing. Three of those scoped
 * rules existed; two of them set layout (flex, max-width), not size, so there
 * was no base step in the ladder at all.
 *
 * What this asserts is narrow: **a `form-input-*` size modifier that appears
 * in markup must have an unscoped definition next to `.form-input`.** It does
 * not police what the definition contains, and it does not object to
 * ancestor-scoped rules — those stay legitimate for layout. It only stops the
 * class from meaning nothing again.
 *
 * Brief: docs/plans/briefs/app-css-architecture.md (A7.18 carve-out from #858).
 *
 * Run with: node --test tests/form-input-size-ladder.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMPONENTS = 'client/styles/app/components.css';

/** Every `.js` file under a directory, recursively. */
async function walkJs(dir, out = []) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'vendor' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walkJs(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

describe('form-input size ladder', () => {
  it('every size modifier used in markup has an unscoped definition', async () => {
    const used = new Set();
    for (const file of await walkJs(path.join(ROOT, 'client'))) {
      const src = await fs.readFile(file, 'utf8');
      for (const m of src.matchAll(/form-input-[a-z0-9-]+/g)) used.add(m[0]);
    }
    assert.ok(used.size > 0, 'the modifiers should still be in use');

    const css = await fs.readFile(path.join(ROOT, COMPONENTS), 'utf8');
    const missing = [...used].filter(
      (cls) => !new RegExp(`^\\.${cls}\\s*\\{`, 'm').test(css),
    );
    assert.deepStrictEqual(
      missing,
      [],
      `no base definition in ${COMPONENTS} for: ${missing.join(', ')} — ` +
        'an ancestor-scoped rule is not a definition; the class renders at ' +
        'full size everywhere else.',
    );
  });

  it('the ladder is a ladder: xs is smaller than sm is smaller than base', async () => {
    const css = await fs.readFile(path.join(ROOT, COMPONENTS), 'utf8');
    const fontOf = (selector) => {
      const block = css.match(
        new RegExp(`^\\.${selector}\\s*\\{([^}]*)\\}`, 'm'),
      );
      assert.ok(block, `${selector} has no unscoped block`);
      const font = block[1].match(/font-size:\s*var\(--ps-text-([a-z]+)\)/);
      assert.ok(font, `${selector} sets no tokenised font-size`);
      return font[1];
    };
    assert.equal(fontOf('form-input'), 'base');
    assert.equal(fontOf('form-input-sm'), 'sm');
    assert.equal(fontOf('form-input-xs'), 'xs');
  });
});
