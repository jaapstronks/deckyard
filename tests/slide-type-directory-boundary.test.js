/**
 * The slide-type directory boundary.
 *
 * A slide type in the directory form (docs/reference/slide-type-directory.md)
 * keeps everything about itself in one directory, but *not* in one module: the
 * definition is isomorphic and the companions are not. `ai.js` in particular is
 * the editorial prose the AI catalog reads — ~168 KB across all types, which the
 * browser never executes. Deckyard has no bundler, so an `import` in a module
 * the browser loads is a file the browser fetches: colocating the companions and
 * then importing them from `index.js` would push the client payload up by ~46%
 * for code that only ever runs on the server.
 *
 * The rule is therefore: **`index.js` and `render.js` reach nothing sideways.**
 * Every companion is imported by its own consumer, and the consumer that runs
 * server-side keeps its companion server-side. That is an agreement, and
 * agreements drift — this file is what makes it a gate instead.
 *
 * Three checks, in order of what they would catch:
 *  1. no type module reaches a companion (the rule, stated directly);
 *  2. no companion is reachable from the browser's render entry (the rule's
 *     actual consequence, walked through the real module graph, so an indirect
 *     route through a helper is caught too);
 *  3. a declaration that a consumer has not yet been converted to read still
 *     matches that consumer's copy (the transitional anti-drift gate the rollout
 *     inherits — see the picker/curation membership below).
 *
 * Run with: node --test tests/slide-type-directory-boundary.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PICKER_GROUPS } from '../client/views/editor/slide-type-picker/data.js';
import { CATEGORIES } from '../client/views/settings/tabs/slide-types-tab/categories.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES_DIR = path.join(repoRoot, 'shared', 'slide-types', 'types');

/**
 * The named companion slots. A type directory may hold internal modules beyond
 * these (icon-card-grid's `cards.js`, say); the slots are the part other layers
 * are allowed to know about.
 */
const COMPANION_FILES = ['authoring.js', 'inline-edit.js', 'ai.js'];

/** The two modules that make up the isomorphic core. */
const CORE_FILES = ['index.js', 'render.js'];

/** The browser's entry into the slide-type registry. */
const CLIENT_RENDER_ENTRY = path.join(
  repoRoot, 'client', 'lib', 'slide-runtime', 'slide-render.js'
);

/**
 * Every slide type that owns a directory. A directory arrives with the first
 * companion a rollout PR moves into it, so most of them hold companions while
 * their definition is still a flat `types/<name>.js` — see the "interim shape"
 * note in docs/reference/slide-type-directory.md.
 */
function directoryTypes() {
  return fs
    .readdirSync(TYPES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** The subset whose definition module has moved in as well. */
function definitionTypes() {
  return directoryTypes().filter((name) =>
    fs.existsSync(path.join(TYPES_DIR, name, 'index.js'))
  );
}

/**
 * Static import specifiers in a module, plus `await import('...')` with a
 * literal argument. Deliberately a regex rather than a parser: the check has to
 * be cheap enough to walk the whole client graph, and a specifier that a regex
 * cannot see is a dynamic one, which is not a payload the browser fetches up
 * front anyway.
 * @param {string} src
 * @returns {string[]}
 */
function importSpecifiers(src) {
  const out = [];
  const patterns = [
    /\bimport\s+[^'"();]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bexport\s+[^'"();]*?\bfrom\s*['"]([^'"]+)['"]/g,
  ];
  for (const re of patterns) {
    for (const m of src.matchAll(re)) out.push(m[1]);
  }
  return out;
}

/**
 * Resolve a relative specifier to an absolute path, or null for a bare/URL one
 * (a package or a browser-global: not a repo file, so not our concern).
 * @param {string} fromFile
 * @param {string} spec
 * @returns {string|null}
 */
function resolveSpecifier(fromFile, spec) {
  if (!spec.startsWith('.') && !spec.startsWith('/')) return null;
  const abs = spec.startsWith('/')
    ? path.join(repoRoot, spec.slice(1))
    : path.resolve(path.dirname(fromFile), spec);
  return fs.existsSync(abs) && fs.statSync(abs).isFile() ? abs : null;
}

/**
 * Every repo file reachable from `entry` through static imports.
 * @param {string} entry
 * @returns {Set<string>}
 */
function reachableFrom(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const src = fs.readFileSync(file, 'utf8');
    for (const spec of importSpecifiers(src)) {
      const abs = resolveSpecifier(file, spec);
      if (abs && !seen.has(abs)) queue.push(abs);
    }
  }
  return seen;
}

const TYPE_NAMES = directoryTypes();
const DEFINITION_NAMES = definitionTypes();

describe('slide-type directory form', () => {
  it('at least one type is in the directory form', () => {
    // Guards every assertion below against passing vacuously once the rollout
    // starts moving directories around.
    assert.ok(
      TYPE_NAMES.length > 0,
      `no slide-type directories found under ${path.relative(repoRoot, TYPES_DIR)}`
    );
  });

  it('a directory name is the registry key', async () => {
    // The mapping is mechanical on purpose: a loader that discovers types by
    // scanning directories (custom/slide-types/, phase 3 of the brief) can take
    // the name straight off the directory.
    const { SLIDE_TYPES } = await import('../shared/slide-types/registry.js');
    for (const name of TYPE_NAMES) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(SLIDE_TYPES, name),
        `directory types/${name}/ does not match a registered slide type`
      );
    }
  });
});

describe('the isomorphic core reaches nothing sideways', () => {
  for (const name of TYPE_NAMES) {
    for (const core of CORE_FILES) {
      const file = path.join(TYPES_DIR, name, core);
      if (!fs.existsSync(file)) continue;

      it(`${name}/${core} imports no companion`, () => {
        const specs = importSpecifiers(fs.readFileSync(file, 'utf8'));
        const offenders = specs.filter((s) =>
          COMPANION_FILES.some((c) => s.endsWith(`/${c}`) || s === `./${c}`)
        );
        assert.deepStrictEqual(
          offenders,
          [],
          `${name}/${core} imports ${offenders.join(', ')}. The core is what the ` +
            'browser loads to render a slide; companions are imported by their own ' +
            'consumer. See docs/reference/slide-type-directory.md.'
        );
      });
    }
  }
});

describe('the client render path stays clear of the server-only layer', () => {
  const reachable = reachableFrom(CLIENT_RENDER_ENTRY);
  const rel = (f) => path.relative(repoRoot, f);

  it('the walk actually reaches the type definitions', () => {
    // Without this the next assertion would pass on a broken walk. Scoped to the
    // types whose definition has moved into the directory: a companion-only
    // directory has no index.js for the walk to reach.
    const found = DEFINITION_NAMES.filter((n) =>
      reachable.has(path.join(TYPES_DIR, n, 'index.js'))
    );
    assert.deepStrictEqual(
      found,
      DEFINITION_NAMES,
      'the module-graph walk did not reach every directory type from ' +
        `${rel(CLIENT_RENDER_ENTRY)} — the check below would be vacuous`
    );
  });

  it('no authoring.js is reachable from the browser render entry', () => {
    // Same argument as ai.js below, one tier weaker: authoring copy is picker
    // payload. The presenter and the export render slides without ever offering
    // one, so a route from the render entry into a type's authoring.js means the
    // presenter now downloads glyphs, descriptions and sample decks it never
    // uses. The aggregator (shared/slide-types/authoring.js) is what makes this
    // easy to get wrong: it sits next to registry.js, and registry.js *is* on
    // the render path.
    const leaked = [...reachable]
      .filter((f) => f.startsWith(TYPES_DIR + path.sep) && path.basename(f) === 'authoring.js')
      .map(rel)
      .sort();
    assert.deepStrictEqual(
      leaked,
      [],
      'a type\'s authoring.js is reachable from the client render entry — the ' +
        'registry must never import shared/slide-types/authoring.js.'
    );
  });

  it('no inline-edit.js is reachable from the browser render entry', () => {
    // Same argument as authoring.js: the inline-edit descriptor is editor
    // payload — what the editor lets someone change on the canvas. The presenter
    // and the export render slides without ever offering that surface, so a route
    // from the render entry into a type's inline-edit.js means the presenter now
    // downloads editing descriptors it never uses. The aggregator
    // (shared/slide-types/inline-edit.js) is the same footgun as authoring's: it
    // sits in shared/, one careless import from registry.js away from the payload.
    const leaked = [...reachable]
      .filter((f) => f.startsWith(TYPES_DIR + path.sep) && path.basename(f) === 'inline-edit.js')
      .map(rel)
      .sort();
    assert.deepStrictEqual(
      leaked,
      [],
      'a type\'s inline-edit.js is reachable from the client render entry — the ' +
        'registry must never import shared/slide-types/inline-edit.js.'
    );
  });

  it('no ai.js is reachable from the browser render entry', () => {
    const leaked = [...reachable]
      .filter((f) => f.startsWith(TYPES_DIR + path.sep) && path.basename(f) === 'ai.js')
      .map(rel)
      .sort();
    assert.deepStrictEqual(
      leaked,
      [],
      'a server-only ai.js is reachable from the client render entry, so the ' +
        'browser now downloads editorial prose it never executes.'
    );
  });

  it('ai.js is imported from server code only', () => {
    const importers = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(abs); continue; }
        if (!entry.name.endsWith('.js')) continue;
        const specs = importSpecifiers(fs.readFileSync(abs, 'utf8'));
        if (!specs.some((s) => s.endsWith('/ai.js'))) continue;
        const resolved = specs
          .map((s) => resolveSpecifier(abs, s))
          .filter((f) => f && f.startsWith(TYPES_DIR + path.sep) && path.basename(f) === 'ai.js');
        if (resolved.length) importers.push(rel(abs));
      }
    };
    for (const dir of ['client', 'server', 'shared', 'scripts']) {
      walk(path.join(repoRoot, dir));
    }
    const outsideServer = importers.filter((f) => !f.startsWith('server/')).sort();
    assert.deepStrictEqual(
      outsideServer,
      [],
      'ai.js may only be imported from server/ — it is the one companion whose ' +
        'weight the client must never pay.'
    );
    assert.ok(importers.length > 0, 'nothing imports ai.js; the check is vacuous');
  });
});

describe('declarations a consumer has not been converted to read yet', () => {
  // The transitional gate the rollout inherits. Picker group and curation
  // category are *positional* facts: the arrays in the consumer encode order as
  // well as membership, and order is a cross-type decision that belongs to that
  // consumer's own rollout PR. Until then the type directory holds the
  // authoritative membership and this test holds the consumer's copy to it, so
  // there is one authority rather than two sources.
  const authoringOf = async (name) => {
    const file = path.join(TYPES_DIR, name, 'authoring.js');
    if (!fs.existsSync(file)) return null;
    return (await import(file)).default;
  };

  it('the picker group matches the declared pickerGroup', async () => {
    for (const name of TYPE_NAMES) {
      const authoring = await authoringOf(name);
      if (!authoring?.pickerGroup) continue;
      const actual = Object.entries(PICKER_GROUPS)
        .filter(([, types]) => types.includes(name))
        .map(([group]) => group);
      assert.deepStrictEqual(
        actual,
        [authoring.pickerGroup],
        `${name} declares pickerGroup "${authoring.pickerGroup}" but the picker ` +
          `puts it in [${actual.join(', ')}]`
      );
    }
  });

  it('the curation category matches the declared curationCategory', async () => {
    for (const name of TYPE_NAMES) {
      const authoring = await authoringOf(name);
      if (!authoring?.curationCategory) continue;
      const actual = CATEGORIES.filter((c) => c.types.includes(name)).map((c) => c.key);
      assert.deepStrictEqual(
        actual,
        [authoring.curationCategory],
        `${name} declares curationCategory "${authoring.curationCategory}" but the ` +
          `settings tab puts it in [${actual.join(', ')}]`
      );
    }
  });
});
