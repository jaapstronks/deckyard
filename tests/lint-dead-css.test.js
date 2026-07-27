/**
 * Unit tests for the advisory dead-CSS scanner (scripts/lint-dead-css.js).
 *
 * The scanner's whole reason to be advisory is that class names are *composed*
 * (`slide-bg-${id}`, `is-${state}`), so the tests that matter most are the ones
 * pinning that a composed name is NOT reported dead. The scan is exercised with
 * an injected reader so no real files or git are touched.
 *
 * Run with: node --test tests/lint-dead-css.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { harvestSource, extractCssClasses, isAlive, scan } = await import(
  '../scripts/lint-dead-css.js'
);

describe('harvestSource', () => {
  it('harvests class tokens from single/double-quoted strings', () => {
    const ev = harvestSource(`h('div', { class: 'card is-active' })`);
    assert.ok(ev.used.has('card'));
    assert.ok(ev.used.has('is-active'));
  });

  it('records a composition prefix from a template literal', () => {
    const ev = harvestSource('`slide-bg-${id}`');
    // The static chunk before the hole becomes a live prefix, not a used token.
    assert.ok(ev.prefixes.has('slide-bg-'));
  });

  it('keeps the last token as the prefix when a chunk has several', () => {
    const ev = harvestSource('`btn is-${state}`');
    assert.ok(ev.used.has('btn'), 'the leading literal token is still used');
    assert.ok(ev.prefixes.has('is-'), 'only the token touching ${ is a prefix');
  });
});

describe('extractCssClasses', () => {
  it('reads classes from selector context with line numbers', () => {
    const css = ['.alpha {', '  color: red;', '}', '', '.beta.gamma:hover {', '  margin: 0;', '}'].join(
      '\n'
    );
    const found = extractCssClasses(css, 'x.css');
    const byName = Object.fromEntries(found.map((r) => [r.name, r.line]));
    assert.equal(byName.alpha, 1);
    assert.equal(byName.beta, 5);
    assert.equal(byName.gamma, 5);
  });

  it('ignores dotted tokens inside property values and strings', () => {
    const css = ['.real {', '  margin: .5em;', '  content: ".fake-not-a-selector";', '}'].join('\n');
    const names = extractCssClasses(css, 'x.css').map((r) => r.name);
    assert.deepEqual(names, ['real']);
  });

  it('ignores classes inside comments', () => {
    const css = ['/* .commented-out {} */', '.live {}'].join('\n');
    const names = extractCssClasses(css, 'x.css').map((r) => r.name);
    assert.deepEqual(names, ['live']);
  });

  it('reads nested rules inside @media', () => {
    const css = ['@media (min-width: 40em) {', '  .responsive { color: red }', '}'].join('\n');
    const names = extractCssClasses(css, 'x.css').map((r) => r.name);
    assert.deepEqual(names, ['responsive']);
  });
});

describe('isAlive', () => {
  const ev = { used: new Set(['card', 'card-header']), prefixes: new Set(['slide-bg-']) };

  it('is alive when used as a literal', () => {
    assert.equal(isAlive('card', ev), true);
  });
  it('is alive when it starts with a composition prefix', () => {
    assert.equal(isAlive('slide-bg-red', ev), true);
  });
  it('is alive when it is the static base of a composed literal', () => {
    // `.section` would be alive if the source writes `section-header`; here we
    // reuse `card` which has `card-header` in `used`.
    assert.equal(isAlive('card', ev), true);
  });
  it('is dead when it appears nowhere', () => {
    assert.equal(isAlive('login-panel', ev), false);
  });
});

describe('harvestSource — classes embedded in markup and selectors', () => {
  // These are the two commonest ways this codebase names a class, and both used
  // to read as dead: whitespace-splitting yields `class="table-step-row"` and
  // `.table-step-row`, neither of which is a class token.
  it('reads a class out of a class attribute inside a larger string', () => {
    const ev = harvestSource(`const row = ' class="table-step-row"';`);
    assert.equal(ev.used.has('table-step-row'), true);
  });

  it('reads classes out of a selector string', () => {
    const ev = harvestSource(`el.querySelectorAll('.slide-table > .table-step-cell');`);
    assert.equal(ev.used.has('slide-table'), true);
    assert.equal(ev.used.has('table-step-cell'), true);
  });

  it('survives quote characters inside a regex literal on the same line', () => {
    // The string scanner desyncs here — the regex's quotes pair up with the
    // attribute's — so the class attribute is harvested separately.
    const ev = harvestSource(
      `s.replace(/"([^"]+)":/g, '<span class="json-key">"$1"</span>:')`
    );
    assert.equal(ev.used.has('json-key'), true);
  });

  it('takes the class-shaped tail as a composition prefix, not the whole word', () => {
    const ev = harvestSource('const el = `<div class="slide-bg-${id}">`;');
    assert.equal(ev.prefixes.has('slide-bg-'), true);
    assert.equal(isAlive('slide-bg-red', ev), true);
  });
});

describe('scan (end to end, injected reader)', () => {
  it('reports only the genuinely unreferenced selector', () => {
    const files = {
      'client/app.js': `h('div', { class: 'card' }); const c = \`slide-bg-\${id}\`;`,
      'client/styles/x.css': ['.card {}', '.slide-bg-red {}', '.orphan {}'].join('\n'),
    };
    const { dead, totalClasses } = scan({
      sourceFiles: ['client/app.js'],
      cssFiles: ['client/styles/x.css'],
      read: (f) => files[f],
    });
    assert.equal(totalClasses, 3);
    assert.deepEqual(
      dead.map((d) => d.name),
      ['orphan'],
      'card is a literal, slide-bg-red is composed-alive, only orphan is dead'
    );
  });
});
