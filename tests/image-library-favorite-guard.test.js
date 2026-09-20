/**
 * One spelling for "the star of the caller" in the image library (B344, D176).
 *
 * D176 settled the form for the concept, not for one resource: an item a route
 * hands back carries `favorite: boolean`, derived per caller, and `isFavorite`
 * does not exist. The slide library was already there; the image library
 * spelled the same flag `isFavorite`, shipped a second copy of the same fact as
 * a top-level `favoriteIds` array, and kept a third in the picker as a
 * `favorites` Set that nothing ever filled.
 *
 * What the flag *means* on the wire is pinned against a real database, next to
 * the storage half it is derived from: `tests/pg/image-favorites.pgtest.js`.
 * This file pins the half a response assertion cannot reach — that no reader
 * accepts both spellings. A `x.favorite ?? x.isFavorite` would satisfy every
 * shape assertion there and still be the thing D176 removed, so the test is a
 * grep: the dead spellings do not occur in these modules at all.
 *
 * Run with: node --test tests/image-library-favorite-guard.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/**
 * The route that answers for the image library, and every client module that
 * renders or filters on the star.
 */
const MODULES = [
  'server/routes/api/image-library.js',
  'client/views/editor/image-library/picker.js',
  'client/views/editor/image-library/grid.js',
  'client/views/editor/image-library/detail.js',
  'client/views/editor/image-library/sidebar.js',
];

/**
 * The spellings D176 retired, with the reason each one is a second form of the
 * single concept "which items has this caller starred".
 */
const RETIRED = [
  [
    'isFavorite',
    'the old field name for the per-item flag; `favorite` is the one spelling',
  ],
  [
    'favoriteIds',
    'the starred-id list beside the per-item flag: the same fact, twice on the wire',
  ],
];

for (const rel of MODULES) {
  test(`${rel} knows only one spelling of the caller's star`, async () => {
    const src = await readFile(new URL(`../${rel}`, import.meta.url), 'utf8');
    for (const [spelling, why] of RETIRED) {
      assert.equal(
        src.includes(spelling),
        false,
        `${rel} still names \`${spelling}\` — ${why} (D176)`,
      );
    }
  });
}

test('the picker reads the star off the item, not from a set beside it', async () => {
  const src = await readFile(
    new URL('../client/views/editor/image-library/picker.js', import.meta.url),
    'utf8',
  );
  // The Set was never seeded from the server and the sidebar it was handed to
  // never destructured it, so the Favorites section already read the item's
  // own flag. Keeping the Set meant two places to update and one of them was
  // always wrong on load.
  assert.equal(
    /\bnew Set\(\)/.test(src),
    false,
    'the picker keeps no local favourites set: the item carries the flag',
  );
  assert.match(
    src,
    /items\.filter\(\(it\) => it\?\.favorite\)/,
    'the Favorites section filters on the item flag',
  );
});
