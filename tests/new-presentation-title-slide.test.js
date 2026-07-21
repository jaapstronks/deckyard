/**
 * The opening title slide of a brand-new deck carries the deck's own name.
 *
 * It used to read "Presentatie over <name>" / "Presentation about <name>",
 * which reads like filler nobody would type themselves. Locking the plain
 * title in here so the prefix doesn't creep back.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { prepareNewPresentation } from '../server/storage/presentations/crud/factory.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const titleSlideTitle = (pres) => {
  const s0 = pres.slides?.[0];
  assert.equal(s0?.type, 'title-slide', 'first slide should be the title slide');
  return s0.content.title;
};

test('nl: the title slide title is the deck title, unprefixed', async () => {
  const pres = await prepareNewPresentation(REPO_ROOT, {
    title: 'Kwartaalcijfers Q3',
    lang: 'nl',
  });
  assert.equal(titleSlideTitle(pres), 'Kwartaalcijfers Q3');
});

test('en-GB: the title slide title is the deck title, unprefixed', async () => {
  const pres = await prepareNewPresentation(REPO_ROOT, {
    title: 'Quarterly numbers Q3',
    lang: 'en-GB',
  });
  assert.equal(titleSlideTitle(pres), 'Quarterly numbers Q3');
});

test('an over-long deck title is trimmed to the schema max length', async () => {
  const long = 'A'.repeat(200);
  const pres = await prepareNewPresentation(REPO_ROOT, { title: long, lang: 'nl' });
  const t = titleSlideTitle(pres);
  assert.ok(t.length <= 120, `expected <= 120 chars, got ${t.length}`);
  assert.ok(t.endsWith('…'), 'a trimmed title should be marked with an ellipsis');
});

test('a title that exactly fits is left alone', async () => {
  const exact = 'B'.repeat(120);
  const pres = await prepareNewPresentation(REPO_ROOT, { title: exact, lang: 'nl' });
  assert.equal(titleSlideTitle(pres), exact);
});

test('slides supplied by the caller keep their own title', async () => {
  const pres = await prepareNewPresentation(REPO_ROOT, {
    title: 'Composed deck',
    lang: 'nl',
    slides: [{ type: 'title-slide', content: { title: 'From the slide library' } }],
  });
  assert.equal(titleSlideTitle(pres), 'From the slide library');
});
