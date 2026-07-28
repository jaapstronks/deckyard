/**
 * A marker-anchored list never inherits block alignment, and the alignment
 * control never lies about what is in force.
 *
 * Both halves were broken on `end-slide` and masked each other: the body's
 * bullets rendered centred (three markers, three indents) while the "This text"
 * panel reported "Left", and clicking "Left" did nothing.
 *
 * The CSS rule cannot be exercised here without a layout engine, so what is
 * pinned instead is the ASSUMPTION the rule rests on — that a markdown list is
 * emitted classless and a structural list container never is — plus the
 * declaration side, which is plain data.
 *
 * Run with: node --test tests/list-alignment.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { SLIDE_TYPES } from '../shared/slide-types.js';
import { markdownToSafeHtml } from '../shared/markdown.js';
import { initSanitizer } from '../shared/sanitize.js';
import {
  fieldDefaultAlign,
  fieldAlignAffordance,
  DEFAULT_ALIGN,
} from '../shared/slide-types/text-roles.js';
import {
  normalizeTextStyles,
  textStyleClasses,
  injectTextStyles,
} from '../shared/slide-types/text-styles.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// Without DOMPurify, markdownToSafeHtml falls back to escaping everything, and
// the list assertions below would pass on a string that is not markup at all.
await initSanitizer();

// --- The selector's assumption ---------------------------------------------

const BASE_CSS = readFileSync(
  join(repoRoot, 'client/styles/slides/01-layout-and-title/00-base.css'),
  'utf8'
);

test('the marker-anchored-list rule exists exactly once, in 00-base.css', () => {
  assert.match(BASE_CSS, /\.slide :is\(ul, ol\):not\(\[class\]\) \{\s*text-align: start;/);
});

test('a markdown list is emitted classless, so the rule reaches it', () => {
  // This is what `:not([class])` keys off. If markdown ever starts classing its
  // lists, the rule silently stops firing — hence the assertion.
  const html = markdownToSafeHtml('- one\n- two\n- three');
  assert.match(html, /<ul[^>]*>/);
  const openTags = html.match(/<(?:ul|ol)\b[^>]*>/g) || [];
  assert.ok(openTags.length > 0);
  for (const tag of openTags) {
    assert.ok(!/\bclass=/.test(tag), `markdown list must carry no class: ${tag}`);
  }
});

test('a nested markdown list is classless too', () => {
  const html = markdownToSafeHtml('- one\n  - nested\n- two');
  const openTags = html.match(/<(?:ul|ol)\b[^>]*>/g) || [];
  assert.equal(openTags.length, 2, 'expected an outer and a nested list');
  for (const tag of openTags) {
    assert.ok(!/\bclass=/.test(tag), `nested list must carry no class: ${tag}`);
  }
});

test('every structural list container carries a class, so the rule spares it', () => {
  // poll options, funnel stages, pyramid levels, timeline, cycle, process: all
  // use <ol> as a layout container with list-style:none, and several centre
  // their labels inside a shape on purpose. A classless one would be silently
  // flattened to `start` by the base rule.
  //
  // Read from the type SOURCE, not from rendered output: a rendered slide also
  // contains the markdown lists of its own default content, and those are
  // exactly the ones the rule is FOR. What distinguishes a structural container
  // is that a type writes the tag itself.
  const typesDir = join(repoRoot, 'shared/slide-types/types');
  const offenders = [];
  for (const file of readdirSync(typesDir)) {
    if (!file.endsWith('.js')) continue;
    const src = readFileSync(join(typesDir, file), 'utf8');
    for (const [i, raw] of src.split('\n').entries()) {
      // Several types explain their semantic projection in prose ("Projects to
      // <ol>"), which is not markup. Comments are not markup.
      const line = raw.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
      for (const tag of line.match(/<(?:ul|ol)\b[^>]*>/g) || []) {
        if (!/\bclass=/.test(tag)) offenders.push(`${file}:${i + 1} ${tag}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `structural lists must be classed:\n${offenders.join('\n')}`
  );
});

// --- The declaration side ---------------------------------------------------

test('an ordinary field defaults to left', () => {
  assert.equal(fieldDefaultAlign(SLIDE_TYPES['content-slide'], 'title'), 'left');
  assert.equal(fieldDefaultAlign(null, 'anything'), DEFAULT_ALIGN);
});

test('end-slide declares its centre at type level, so every field inherits it', () => {
  const def = SLIDE_TYPES['end-slide'];
  assert.equal(def.defaultAlign, 'center');
  for (const key of ['title', 'body', 'contactName']) {
    assert.equal(fieldDefaultAlign(def, key), 'center', key);
  }
});

test('a field-level default beats nothing else on the type', () => {
  // funnel centres only the stage description, not the stage label.
  const def = SLIDE_TYPES['funnel-slide'];
  assert.equal(fieldDefaultAlign(def, 'items.0.text'), 'center');
  assert.equal(fieldDefaultAlign(def, 'items.0.label'), 'left');
});

test('the affordance resolver reports the default the editor should show', () => {
  const out = fieldAlignAffordance(SLIDE_TYPES['end-slide'], 'body');
  assert.equal(out.owner, 'field');
  assert.equal(out.defaultAlign, 'center');
});

test('a declared default outside the role\'s allowed set is ignored', () => {
  // A list item cannot align at all, so no type may default it to centre.
  const def = {
    defaultAlign: 'center',
    fields: [{ key: 'step', type: 'string', role: 'list-item' }],
  };
  assert.equal(fieldDefaultAlign(def, 'step'), 'left');
});

// --- Storage and emission agree with the declaration ------------------------

test('on a centring type, "left" is a real override and survives normalisation', () => {
  const def = SLIDE_TYPES['end-slide'];
  const kept = normalizeTextStyles({ body: { align: 'left' } }, def);
  assert.deepEqual(kept, { body: { align: 'left' } });

  // …and "center" is the no-op that gets pruned.
  const pruned = normalizeTextStyles({ body: { align: 'center' } }, def);
  assert.deepEqual(pruned, {});
});

test('on an ordinary type the reverse holds, unchanged', () => {
  const def = SLIDE_TYPES['content-slide'];
  assert.deepEqual(normalizeTextStyles({ body: { align: 'left' } }, def), {});
  assert.deepEqual(normalizeTextStyles({ body: { align: 'center' } }, def), {
    body: { align: 'center' },
  });
});

test('"left" on a centring type emits a class that can beat the slide rule', () => {
  assert.equal(
    textStyleClasses({ align: 'left' }, { defaultAlign: 'center' }),
    'tf-align-left'
  );
  assert.equal(textStyleClasses({ align: 'center' }, { defaultAlign: 'center' }), '');
  // Unchanged for everything else.
  assert.equal(textStyleClasses({ align: 'left' }), '');
  assert.equal(textStyleClasses({ align: 'center' }), 'tf-align-center');
});

test('the renderer wires the type default through end to end', () => {
  const def = SLIDE_TYPES['end-slide'];
  const html = def.renderHtml(
    { title: 'Thanks', body: 'hello', textStyles: { body: { align: 'left' } } },
    { type: 'end-slide' },
    {}
  );
  const withStyles = injectTextStyles(
    html,
    { textStyles: { body: { align: 'left' } } },
    def
  );
  assert.match(withStyles, /tf-align-left/);
});

test('an untouched deck stays byte-identical', () => {
  // The whole point of pruning defaults: adding defaultAlign must not start
  // emitting classes on decks nobody has styled.
  for (const type of ['end-slide', 'funnel-slide', 'pyramid-slide', 'content-slide']) {
    const def = SLIDE_TYPES[type];
    const content = def.defaults || {};
    const html = def.renderHtml(content, { type }, {});
    assert.equal(
      injectTextStyles(html, content, def),
      html,
      `${type}: an unstyled slide must render unchanged`
    );
  }
});
