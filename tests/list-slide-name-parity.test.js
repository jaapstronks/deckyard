/**
 * The one List type answers to two names, so every type-keyed branch must
 * accept both.
 *
 * `lijstje-slide` is `{ ...listSlide, deprecated, ai: false }` — one definition,
 * two names. That makes any module which special-cases *one* of them a latent
 * divergence: the two behave differently even though they are the same type.
 *
 * The list consolidation moved every insertion path onto `list-slide`, which
 * turned a dormant asymmetry into a live one: the convert map, the editor form
 * router and two render-field special cases were keyed on the alias only, so
 * newly authored lists silently lost affordances that legacy ones kept. The
 * companion matrix (tests/slide-type-companion-coverage.test.js) could not see
 * it — it covers the picker- and agent-facing companions, not these.
 *
 * This file is that missing guardrail. It retires itself: when rung 3 removes
 * `lijstje-slide` from the registry there is only one name left and the source
 * scan below has nothing to compare.
 *
 * Run with: node --test tests/list-slide-name-parity.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getConvertibleSlideTypes,
  convertSlideToType,
} from '../shared/slide-types/convert.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const listContent = () => ({
  title: 'Our Process',
  subheading: 'How we work',
  variant: 'numbers',
  layout: 'one-column',
  items: [
    { title: 'Discovery', text: 'Understanding your needs' },
    { title: 'Strategy', text: 'Planning the approach' },
    { title: 'Execution', text: 'Delivering results' },
  ],
});

describe('list-slide / lijstje-slide: the two names behave identically', () => {
  it('offers the same convert targets under either name', () => {
    const targets = (type) =>
      getConvertibleSlideTypes({ type, content: listContent() });

    assert.deepEqual(targets('list-slide'), targets('lijstje-slide'));
    // Regression: this was [] for list-slide, so every newly authored list had
    // an empty Convert submenu while legacy lijstje slides kept theirs.
    assert.ok(
      targets('list-slide').includes('content-slide'),
      'a list must be convertible to a text slide under its live name'
    );
  });

  it('produces the same converted content under either name', () => {
    for (const target of ['content-slide', 'content-columns-slide']) {
      const fromList = convertSlideToType(
        { id: 'a', type: 'list-slide', content: listContent() },
        target
      );
      const fromAlias = convertSlideToType(
        { id: 'a', type: 'lijstje-slide', content: listContent() },
        target
      );
      assert.deepEqual(
        fromList.content,
        fromAlias.content,
        `${target}: the alias and the live name must convert identically`
      );
    }
  });
});

/**
 * Modules that may name one without the other, and why.
 *
 * `TYPE_CSS` is keyed by registry type name and the List stylesheet is still
 * filed under the alias. Deliberate: the PR that consolidated the type left the
 * CSS alone because `.slide-lijstje` is load-bearing for fork themes and
 * standalone exports. It is not silent — tests/slide-css-aggregators.test.js
 * asserts every TYPE_CSS key is a registered type, so rung 3 fails loudly there
 * until the entry is rekeyed to `list-slide`.
 */
const PARITY_EXEMPT = new Set(['scripts/generate-slide-css-aggregators.js']);

const SCAN_DIRS = ['client', 'server', 'shared', 'scripts'];

function* jsFiles(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* jsFiles(full);
    else if (entry.endsWith('.js')) yield full;
  }
}

describe('list-slide / lijstje-slide: no module special-cases one name only', () => {
  it('every module naming the alias names the live type too', () => {
    const gaps = [];
    for (const dir of SCAN_DIRS) {
      for (const file of jsFiles(path.join(ROOT, dir))) {
        const rel = path.relative(ROOT, file);
        if (PARITY_EXEMPT.has(rel)) continue;
        const src = readFileSync(file, 'utf8');
        const namesAlias = /['"]lijstje-slide['"]/.test(src);
        const namesLive = /['"]list-slide['"]/.test(src);
        if (namesAlias && !namesLive) gaps.push(rel);
      }
    }
    assert.deepEqual(
      gaps,
      [],
      'these modules branch on "lijstje-slide" without handling "list-slide" — ' +
        'the two are one type, so the branch must accept both (or drop the ' +
        'special case entirely if the generic path already covers it)'
    );
  });
});
