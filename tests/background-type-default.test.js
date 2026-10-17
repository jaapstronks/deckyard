/**
 * An empty `background` renders the type's own standard ground (B733, D346).
 *
 * Fourteen types declare a standard other than `lime` (`mist`, or `dark` on
 * the countdown), but `bgClass()` read an empty value as lime, so "Back to
 * default" had to write the value back and a later change to a standard never
 * reached older decks. The render pipeline now fills an empty `background`
 * with `typeDefaultBackground()` — the type's default, replaced by the theme's
 * `defaultBackground` where the type offers it — before the type renders, so
 * an empty value and the explicit standard render the same markup.
 *
 * Run with: node --test tests/background-type-default.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { renderSlideHtml } from '../shared/slide-types/presentation.js';
import {
  resolveTypeDefaults,
  typeDefaultBackground,
} from '../shared/slide-types/type-defaults.js';
import { SLIDE_TYPES } from '../shared/slide-types/registry.js';

/** Types whose schema offers a `background` with a declared standard. */
const WITH_STANDARD = Object.entries(SLIDE_TYPES).filter(
  ([, def]) =>
    (def.fields || []).some((f) => f?.key === 'background') &&
    typeof def.defaults?.background === 'string' &&
    def.defaults.background,
);

/** The type's defaults with `background` set to `bg`, or removed. */
function contentWith(def, bg) {
  const content = resolveTypeDefaults(def, 'en');
  if (bg == null) delete content.background;
  else content.background = bg;
  return content;
}

/** The class list of the rendered `.slide` root. */
function rootClasses(html) {
  const m = html.match(/<div\b[^>]*\bclass="(slide(?:\s[^"]*)?)"/);
  return m ? m[1].split(/\s+/) : [];
}

const render = (type, content, theme) =>
  renderSlideHtml({ id: 's', type, content }, { theme, lang: 'en' });

test('every bgClass consumer is covered by a declared standard', () => {
  // The renderers that map `background` to a class are exactly the types the
  // fill applies to; a new consumer without a standard would read lime again.
  const dir = new URL('../shared/slide-types/types/', import.meta.url);
  const consumers = Object.entries(SLIDE_TYPES).filter(([name]) => {
    for (const rel of [`${name}.js`, `${name}/render.js`]) {
      try {
        const src = readFileSync(fileURLToPath(new URL(rel, dir)), 'utf8');
        if (/\bbgClass(Extended)?\(/.test(src)) return true;
      } catch {
        // not this layout
      }
    }
    return false;
  });
  assert.ok(consumers.length >= 28, `found ${consumers.length} consumers`);
  const covered = new Set(WITH_STANDARD.map(([name]) => name));
  for (const [name] of consumers) assert.ok(covered.has(name), name);
});

test('an empty background renders exactly as the explicit standard', () => {
  let nonLime = 0;
  for (const [type, def] of WITH_STANDARD) {
    const standard = def.defaults.background;
    if (standard !== 'lime') nonLime += 1;
    const empty = render(type, contentWith(def, null));
    const explicit = render(type, contentWith(def, standard));
    assert.equal(empty, explicit, type);
    assert.ok(
      rootClasses(empty).includes(`slide-bg-${standard}`),
      `${type}: ${rootClasses(empty).join(' ')}`,
    );
  }
  assert.ok(nonLime >= 14, `only ${nonLime} non-lime standards`);
});

test('an explicit background is rendered as stored', () => {
  const pyramid = SLIDE_TYPES['pyramid-slide'];
  assert.equal(pyramid.defaults.background, 'mist');
  const html = render('pyramid-slide', contentWith(pyramid, 'lime'));
  assert.ok(rootClasses(html).includes('slide-bg-lime'));
  assert.ok(!rootClasses(html).includes('slide-bg-mist'));
});

test("the theme's ground is the standard where the type offers it", () => {
  const theme = { defaultBackground: 'mist' };
  const def = SLIDE_TYPES['content-slide'];
  assert.equal(def.defaults.background, 'lime');
  assert.equal(typeDefaultBackground(def, theme), 'mist');
  const html = render('content-slide', contentWith(def, null), theme);
  assert.ok(rootClasses(html).includes('slide-bg-mist'));
  // Stored content is never touched: the fill is a render view.
  const content = contentWith(def, null);
  render('content-slide', content, theme);
  assert.equal('background' in content, false);
});

test('a type without a background field has no standard ground', () => {
  const none = Object.values(SLIDE_TYPES).find(
    (def) => !(def.fields || []).some((f) => f?.key === 'background'),
  );
  assert.ok(none);
  assert.equal(typeDefaultBackground(none, { defaultBackground: 'mist' }), '');
});
