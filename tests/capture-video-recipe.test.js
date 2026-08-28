/**
 * The video half of the recipe format.
 *
 * A take and a screenshot share `state` / `navigate` / `waitFor` / `action` and
 * differ in exactly two places: what the recipe must carry, and what motion
 * preference the page is opened with. Both are decisions the runner makes from
 * the recipe alone, before a browser exists, so both are checkable here.
 *
 * The failure this guards is silent rather than loud. A video recipe that
 * slipped through carrying `registryPath` would suggest a published PNG that is
 * never written; one opened with `prefers-reduced-motion: reduce` would record
 * a clip of the app *not* animating — a clip that looks fine until you notice
 * the thing it was meant to show never happens.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isVideoRecipe,
  resolveReducedMotion,
  validateRecipe,
} from '../capture/lib/recipe.js';
import { RECIPES } from '../capture/recipes/index.js';
import formDrivesSlide from '../capture/recipes/form-drives-slide.js';
import { editorFormShot } from '../capture/recipes/_marketing-shots.js';

/** A minimal valid video recipe, to mutate per case. */
const base = () => ({
  id: 'x',
  kind: 'video',
  navigate: '/app',
  record: { sequence: async () => {} },
});

test('every registered recipe validates under its own kind', () => {
  for (const recipe of RECIPES) {
    assert.deepEqual(
      validateRecipe(recipe),
      [],
      `recipe "${recipe.id}" is invalid`,
    );
  }
});

test('recipe ids are unique across both kinds', () => {
  const ids = RECIPES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate id in ${ids}`);
});

test('a video recipe needs a record.sequence', () => {
  const recipe = base();
  delete recipe.record;
  assert.deepEqual(validateRecipe(recipe), [
    'missing "record.sequence" function',
  ]);
});

test('a video recipe rejects the screenshot-only fields', () => {
  // Not pedantry: these name one PNG in the website registry, and a take is
  // not a published artefact. Carrying them would promise a file nobody writes.
  for (const field of ['output', 'registryPath', 'clip', 'fullPage']) {
    const problems = validateRecipe({ ...base(), [field]: 'anything' });
    assert.deepEqual(problems, [`"${field}" does not apply to a video recipe`]);
  }
});

test('a video recipe does not need output/registryPath', () => {
  assert.deepEqual(validateRecipe(base()), []);
});

test('a screenshot recipe still needs output and registryPath', () => {
  const problems = validateRecipe({ id: 'x', navigate: '/app' });
  assert.deepEqual(problems, ['missing "output"', 'missing "registryPath"']);
});

test('reduced motion follows the kind, and nothing else', () => {
  assert.equal(resolveReducedMotion({ id: 'a' }), 'reduce');
  assert.equal(resolveReducedMotion(base()), 'no-preference');
  // Not a recipe knob: a stray field must not become a second place where this
  // decision lives.
  assert.equal(
    resolveReducedMotion({ ...base(), reducedMotion: 'reduce' }),
    'no-preference',
  );
});

test('form-drives-slide reaches the same state as the shot it layers on', () => {
  // The take takes these from `editorFormShot('nl')` instead of restating them,
  // so the clip and the marketing shot cannot end up photographing two
  // different screens. The factory returns a fresh object per call, so what is
  // checkable here is that they still agree — a copied-and-edited `waitFor` or
  // `navigate` would show up as a mismatch on the next change to either side.
  const shot = editorFormShot('nl');
  const ctx = { deckId: 'deck-1', slideId: 'slide-1' };
  assert.ok(isVideoRecipe(formDrivesSlide));
  assert.equal(formDrivesSlide.waitFor, shot.waitFor);
  assert.deepEqual(formDrivesSlide.localStorage, shot.localStorage);
  assert.equal(formDrivesSlide.navigate(ctx), shot.navigate(ctx));
  assert.equal(typeof formDrivesSlide.state, 'function');
  assert.equal(typeof formDrivesSlide.action, 'function');
});

test('the take is recorded at a 16:9 viewport, oversampled by scale', () => {
  // The oversampling has to be in `deviceScaleFactor`: a wider *viewport*
  // would cross a responsive breakpoint and film a UI users do not have.
  const { width, height, deviceScaleFactor } = formDrivesSlide.viewport;
  assert.equal(width / height, 16 / 9);
  assert.ok(deviceScaleFactor >= 3, 'a 4K-capable master needs at least 3×');
  assert.equal(width * deviceScaleFactor, 3840);
  assert.equal(height * deviceScaleFactor, 2160);
});

test('the sequence records a labelled step for the field and for the slide', async () => {
  /** @type {Array<{kind: string, label?: string, selector?: string}>} */
  const steps = [];
  const rec = {
    hold: async (ms) => void steps.push({ kind: 'hold', ms }),
    move: async (selector, o = {}) =>
      void steps.push({ kind: 'move', selector, ...o }),
    click: async (selector, o = {}) =>
      void steps.push({ kind: 'click', selector, ...o }),
    type: async (selector, text, o = {}) =>
      void steps.push({ kind: 'type', selector, text, ...o }),
  };
  await formDrivesSlide.record.sequence(rec);

  const labels = steps.filter((s) => s.label).map((s) => s.label);
  // Two labels, so the camera moves from the field to what the field changed —
  // one label would leave the payoff happening off-frame.
  assert.deepEqual(labels, ['titel', 'slide']);
  assert.equal(steps[0].kind, 'hold', 'the clip opens on a still frame');
});
