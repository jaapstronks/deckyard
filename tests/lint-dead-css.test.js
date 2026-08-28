/**
 * Unit tests for the dead-CSS scanner (scripts/lint-dead-css.js).
 *
 * The scanner spent its first life report-only because class names here are
 * *composed* (`slide-bg-${id}`, `is-${state}`), so the tests that matter most
 * are still the ones pinning that a composed name is NOT reported dead — a false
 * positive is what would make the gate untrustworthy. The scan is exercised with
 * an injected reader so no real files or git are touched.
 *
 * The gate over the real tree lives in tests/dead-css-gate.test.js.
 *
 * Run with: node --test tests/lint-dead-css.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const {
  auditAllowlist,
  extractCssClasses,
  harvestSource,
  isAlive,
  isSourceFile,
  scan,
} = await import('../scripts/lint-dead-css.js');

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

  it('records a separator between two holes as a composition infix', () => {
    // shared/slide-types/partials.js builds tone modifiers this way; the chunk
    // before the first hole is whitespace, so there is no prefix to harvest.
    const ev = harvestSource('return ` ${base}--${t}`;');
    assert.ok(ev.infixes.has('--'));
    assert.equal(ev.prefixes.size, 0, 'a whitespace chunk yields no prefix');
  });

  it('does not record a single hyphen as an infix', () => {
    // `-` joins nearly every class name here; accepting it would let any
    // hyphenated selector pass whenever both halves appear as strings.
    const ev = harvestSource('`${a}-${b}`');
    assert.equal(ev.infixes.has('-'), false);
  });
});

describe('isSourceFile', () => {
  it('accepts client, shared and server modules', () => {
    assert.equal(isSourceFile('client/views/editor/index.js'), true);
    assert.equal(isSourceFile('shared/slide-types/partials.js'), true);
    // server/ writes class attributes (export, embed, published pages) and owns
    // the enum members that fill client-side holes.
    assert.equal(isSourceFile('server/utils/embed-html/template.js'), true);
  });

  it('rejects stylesheets and files outside the source tree', () => {
    assert.equal(
      isSourceFile('client/styles/base/01-core/05-avatar.css'),
      false,
    );
    assert.equal(isSourceFile('tests/lint-dead-css.test.js'), false);
  });

  it('rejects vendored bundles', () => {
    // Not our source, and the harvester desyncs inside minified single-line
    // files — the `katex-error` case. Classes we style on a vendor's behalf are
    // named in dead-css-allowlist.json instead.
    assert.equal(isSourceFile('client/vendor/katex/katex.min.js'), false);
    assert.equal(
      isSourceFile('client/vendor/prism/components/prism-core.min.js'),
      false,
    );
    assert.equal(isSourceFile('client/vendor/collab.js'), false);
  });
});

describe('extractCssClasses', () => {
  it('reads classes from selector context with line numbers', () => {
    const css = [
      '.alpha {',
      '  color: red;',
      '}',
      '',
      '.beta.gamma:hover {',
      '  margin: 0;',
      '}',
    ].join('\n');
    const found = extractCssClasses(css, 'x.css');
    const byName = Object.fromEntries(found.map((r) => [r.name, r.line]));
    assert.equal(byName.alpha, 1);
    assert.equal(byName.beta, 5);
    assert.equal(byName.gamma, 5);
  });

  it('ignores dotted tokens inside property values and strings', () => {
    const css = [
      '.real {',
      '  margin: .5em;',
      '  content: ".fake-not-a-selector";',
      '}',
    ].join('\n');
    const names = extractCssClasses(css, 'x.css').map((r) => r.name);
    assert.deepEqual(names, ['real']);
  });

  it('ignores classes inside comments', () => {
    const css = ['/* .commented-out {} */', '.live {}'].join('\n');
    const names = extractCssClasses(css, 'x.css').map((r) => r.name);
    assert.deepEqual(names, ['live']);
  });

  it('reads nested rules inside @media', () => {
    const css = [
      '@media (min-width: 40em) {',
      '  .responsive { color: red }',
      '}',
    ].join('\n');
    const names = extractCssClasses(css, 'x.css').map((r) => r.name);
    assert.deepEqual(names, ['responsive']);
  });
});

describe('isAlive', () => {
  const ev = {
    used: new Set(['card', 'card-header', 'red', 'slide-badge', 'danger']),
    prefixes: new Set(['slide-bg-', 'chart-slice-']),
    infixes: new Set(['--']),
  };

  it('is alive when used as a literal', () => {
    assert.equal(isAlive('card', ev), true);
  });
  it('is alive when a prefix plus a written value spells it out', () => {
    assert.equal(isAlive('slide-bg-red', ev), true);
  });
  it('is alive when the hole carries an index', () => {
    // `chart-slice-${i % 8}` — the value is a number, never a literal token.
    assert.equal(isAlive('chart-slice-0', ev), true);
  });
  it('is alive when both sides of a separator joint are values', () => {
    assert.equal(isAlive('slide-badge--danger', ev), true);
  });
  it('is alive when it is the static base of a composed literal', () => {
    // `.section` would be alive if the source writes `section-header`; here we
    // reuse `card` which has `card-header` in `used`.
    assert.equal(isAlive('card', ev), true);
  });
  it('is dead when it appears nowhere', () => {
    assert.equal(isAlive('login-panel', ev), false);
  });

  // The #1037 lesson: a prefix on its own is a wildcard, not evidence. When
  // `slideRootClass()` contributed `slide-` as a prefix, every `slide-*`
  // selector in the tree was absolved and the whole slide layer went unchecked.
  it('is dead when only the prefix matches and the remainder is unwritten', () => {
    assert.equal(isAlive('slide-bg-chartreuse', ev), false);
  });
  it('is dead when a separator joint has an unwritten side', () => {
    assert.equal(isAlive('slide-badge--chartreuse', ev), false);
  });
  it('does not let a bare prefix absolve a whole namespace', () => {
    const slideEv = {
      used: new Set(['image']),
      prefixes: new Set(['slide-']),
      infixes: new Set(),
    };
    assert.equal(
      isAlive('slide-image', slideEv),
      true,
      'the root class is real',
    );
    assert.equal(isAlive('slide-draft-overlay', slideEv), false);
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
    const ev = harvestSource(
      `el.querySelectorAll('.slide-table > .table-step-cell');`,
    );
    assert.equal(ev.used.has('slide-table'), true);
    assert.equal(ev.used.has('table-step-cell'), true);
  });

  it('survives quote characters inside a regex literal on the same line', () => {
    // The string scanner desyncs here — the regex's quotes pair up with the
    // attribute's — so the class attribute is harvested separately.
    const ev = harvestSource(
      `s.replace(/"([^"]+)":/g, '<span class="json-key">"$1"</span>:')`,
    );
    assert.equal(ev.used.has('json-key'), true);
  });

  it('takes the class-shaped tail as a composition prefix, not the whole word', () => {
    const ev = harvestSource('const el = `<div class="slide-bg-${id}">`;');
    assert.equal(ev.prefixes.has('slide-bg-'), true);
  });

  it('pairs the prefix with a value written elsewhere in the same file', () => {
    const ev = harvestSource(
      "const ids = ['red', 'mist'];\nconst el = `<div class=\"slide-bg-${id}\">`;",
    );
    assert.equal(isAlive('slide-bg-red', ev), true);
    assert.equal(isAlive('slide-bg-mist', ev), true);
    assert.equal(isAlive('slide-bg-chartreuse', ev), false, 'never written');
  });
});

describe('scan (end to end, injected reader)', () => {
  it('reports only the genuinely unreferenced selector', () => {
    const files = {
      'client/app.js':
        `const tones = ['red'];\n` +
        `h('div', { class: 'card' }); const c = \`slide-bg-\${id}\`;`,
      'client/styles/x.css': [
        '.card {}',
        '.slide-bg-red {}',
        '.orphan {}',
      ].join('\n'),
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
      'card is a literal, slide-bg-red is composed-alive, only orphan is dead',
    );
  });

  // The regression this scanner exists to catch, and the one it used to miss:
  // `slideRootClass()` writes `` `slide-${canonicalTypeName(name)}` ``, so
  // `slide-` was a live prefix and no `slide-*` selector could ever be reported.
  it('reports a dead slide-* class without touching the live slide layer', () => {
    const files = {
      // The real composition sites, verbatim in spirit: a root class built from
      // a type name, a tone modifier built from two holes, an indexed slice.
      'shared/slide-types/validate-definition.js':
        'export const slideRootClass = (name) => `slide-${canonicalTypeName(name)}`;',
      'shared/slide-types/registry.js':
        "export const TYPES = ['image', 'chart'];",
      'shared/slide-types/partials.js':
        "const TONES = ['danger'];\n" +
        'const toneClass = (base, t) => ` ${base}--${t}`;\n' +
        "const badge = () => toneClass('slide-badge', tone);",
      'shared/slide-types/types/chart-slide.js':
        'const slice = (i) => `<path class="chart-slice chart-slice-${i % 8}">`;',
      'client/styles/slides/x.css': [
        '.slide-image {}',
        '.slide-chart {}',
        '.slide-badge {}',
        '.slide-badge--danger {}',
        '.chart-slice {}',
        '.chart-slice-0 {}',
        '.chart-slice-7 {}',
        '.slide-draft-overlay {}',
      ].join('\n'),
    };
    const { dead } = scan({
      sourceFiles: Object.keys(files).filter((f) => f.endsWith('.js')),
      cssFiles: ['client/styles/slides/x.css'],
      read: (f) => files[f],
    });
    assert.deepEqual(
      dead.map((d) => d.name),
      ['slide-draft-overlay'],
      'the one slide-* class no composition can produce is the only report',
    );
  });
});

describe('auditAllowlist', () => {
  const entry = (over = {}) => ({
    kind: 'vendor-emitted',
    reason: 'Written by a vendored library at runtime.',
    see: 'client/vendor/x.js',
    ...over,
  });
  /** The shape `scan()` returns, condensed to what the audit reads. */
  const world = (deadNames, liveNames = []) => ({
    dead: deadNames.map((name) => ({ name, file: 'x.css', line: 1 })),
    byName: new Map(
      [...deadNames, ...liveNames].map((name) => [
        name,
        { name, file: 'x.css', line: 1 },
      ]),
    ),
  });

  it('reports a dead selector nobody wrote a reason for', () => {
    const { unexpected } = auditAllowlist({
      ...world(['orphan', 'katex-error']),
      allowlist: { 'katex-error': entry() },
    });
    assert.deepEqual(
      unexpected.map((u) => u.name),
      ['orphan'],
    );
  });

  it('accepts an allowlisted dead selector', () => {
    const audit = auditAllowlist({
      ...world(['katex-error']),
      allowlist: { 'katex-error': entry() },
    });
    assert.deepEqual(audit.unexpected, []);
    assert.deepEqual(audit.malformed, []);
    assert.deepEqual(audit.stale, []);
  });

  it('rejects an entry with no reason', () => {
    // A bare list of names is exactly the tolerance the allowlist exists to
    // prevent, so an unreasoned entry is not a lesser sin than a dead selector.
    const { malformed } = auditAllowlist({
      ...world(['katex-error']),
      allowlist: { 'katex-error': entry({ reason: '   ' }) },
    });
    assert.equal(malformed.length, 1);
    assert.match(malformed[0].problem, /reason is required/);
  });

  it('rejects an entry with an unknown kind', () => {
    const { malformed } = auditAllowlist({
      ...world(['katex-error']),
      allowlist: { 'katex-error': entry({ kind: 'scanner-is-confused' }) },
    });
    assert.equal(malformed.length, 1);
    assert.match(malformed[0].problem, /kind must be one of/);
  });

  it('rejects an entry missing `see`', () => {
    const { malformed } = auditAllowlist({
      ...world(['katex-error']),
      allowlist: { 'katex-error': entry({ see: undefined }) },
    });
    assert.deepEqual(
      malformed.map((m) => m.name),
      ['katex-error'],
    );
  });

  // The stale guard, both directions. Either way the fix is to delete the
  // entry, and the gate is green afterwards because nothing needs excusing.
  it('flags an entry whose selector no longer exists', () => {
    const { stale } = auditAllowlist({
      ...world([]),
      allowlist: { 'made-up-selector': entry() },
    });
    assert.deepEqual(stale, [
      { name: 'made-up-selector', why: 'selector-gone' },
    ]);
  });

  it('flags an entry the source now references', () => {
    const { stale } = auditAllowlist({
      ...world([], ['katex-error']),
      allowlist: { 'katex-error': entry() },
    });
    assert.deepEqual(stale, [{ name: 'katex-error', why: 'now-referenced' }]);
  });

  it('is green on an empty allowlist and an empty report', () => {
    const audit = auditAllowlist({ ...world([], ['card']), allowlist: {} });
    assert.deepEqual(audit, { unexpected: [], malformed: [], stale: [] });
  });
});
