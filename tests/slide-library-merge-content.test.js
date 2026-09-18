/**
 * The server-side language merge of a library item (D170, B335).
 *
 * Before B335 a `content` patch left `i18n.versions[dominant]` on the old text,
 * and a deck composed from the item (`buildSlidesFromLibraryItems` forwards
 * every version as `contentByLang`) got the stale prose. `mergeLibraryI18n`
 * rebuilds the versions from the new base: the dominant version is the
 * content, every other version keeps its prose on the new structure.
 *
 * Run with: node --test tests/slide-library-merge-content.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeLibraryI18n } from '../shared/slide-library/merge-content.js';

const TEAM = 'team-cards-slide';

function bilingualTeam() {
  return {
    dominant: 'nl',
    active: 'nl',
    versions: {
      nl: {
        content: {
          title: 'Ons team',
          imageAspect: 'square',
          members: [{ name: 'Anna', byline: 'Directeur', image: 'a.jpg' }],
        },
      },
      'en-GB': {
        content: {
          title: 'Our team',
          imageAspect: 'square',
          members: [{ name: 'Anna', byline: 'Director', image: 'a.jpg' }],
        },
      },
    },
  };
}

test('versions[dominant] becomes the new content', () => {
  const content = {
    title: 'Het team',
    imageAspect: 'portrait',
    members: [{ name: 'Anna', byline: 'Directeur', image: 'a.jpg' }],
  };
  const out = mergeLibraryI18n({
    slideType: TEAM,
    content,
    i18n: bilingualTeam(),
  });
  assert.deepEqual(out.versions.nl.content, content);
  assert.notEqual(out.versions.nl.content, content, 'a copy, not the input');
});

test('the other language keeps its prose and follows the new structure', () => {
  const content = {
    title: 'Het team',
    imageAspect: 'portrait',
    members: [{ name: 'Anna', byline: 'Directeur', image: 'b.jpg' }],
  };
  const out = mergeLibraryI18n({
    slideType: TEAM,
    content,
    i18n: bilingualTeam(),
  });
  assert.deepEqual(out.versions['en-GB'].content, {
    title: 'Our team',
    imageAspect: 'portrait',
    members: [{ name: 'Anna', byline: 'Director', image: 'b.jpg' }],
  });
});

test('a card added to the base is empty in the other language, never base-language text', () => {
  const content = {
    title: 'Ons team',
    imageAspect: 'square',
    members: [
      { name: 'Anna', byline: 'Directeur', image: 'a.jpg' },
      { name: 'Bram', byline: 'Ontwerper', image: 'c.jpg' },
    ],
  };
  const out = mergeLibraryI18n({
    slideType: TEAM,
    content,
    i18n: bilingualTeam(),
  });
  const members = out.versions['en-GB'].content.members;
  assert.equal(members.length, 2);
  assert.deepEqual(members[0], {
    name: 'Anna',
    byline: 'Director',
    image: 'a.jpg',
  });
  assert.deepEqual(members[1], { name: '', byline: '', image: 'c.jpg' });
});

test('an unknown content key survives in every version', () => {
  const content = {
    title: 'Ons team',
    members: [],
    forkOnlyFlag: { keep: true },
  };
  const out = mergeLibraryI18n({
    slideType: TEAM,
    content,
    i18n: bilingualTeam(),
  });
  assert.deepEqual(out.versions.nl.content.forkOnlyFlag, { keep: true });
  assert.deepEqual(out.versions['en-GB'].content.forkOnlyFlag, { keep: true });
});

test('unknown keys on i18n and on a version are kept', () => {
  const i18n = bilingualTeam();
  i18n.translatedAt = '2026-09-18';
  i18n.versions['en-GB'].source = 'machine';
  const out = mergeLibraryI18n({
    slideType: TEAM,
    content: { title: 'X', members: [] },
    i18n,
  });
  assert.equal(out.translatedAt, '2026-09-18');
  assert.equal(out.active, 'nl');
  assert.equal(out.versions['en-GB'].source, 'machine');
});

test('an item without i18n.dominant gets no versions added', () => {
  const i18n = { versions: { nl: { content: { title: 'Oud' } } } };
  const out = mergeLibraryI18n({
    slideType: 'content-slide',
    content: { title: 'Nieuw' },
    i18n,
  });
  assert.deepEqual(out, i18n);
  assert.deepEqual(
    mergeLibraryI18n({
      slideType: 'content-slide',
      content: { title: 'Nieuw' },
      i18n: {},
    }),
    {},
  );
});

test('a dominant language with no stored version gets one', () => {
  const out = mergeLibraryI18n({
    slideType: 'content-slide',
    content: { title: 'Nieuw' },
    i18n: { dominant: 'nl', versions: {} },
  });
  assert.deepEqual(out.versions, { nl: { content: { title: 'Nieuw' } } });
});
