/**
 * Live-only slides leave every output that outlives the session (D129d).
 *
 * `follow-invite-slide` points an audience at a join code, so the reader, the
 * exports and the published view drop it. That used to be a name check in
 * `server/utils/public-output.js`; it is now `liveOnly: true` on the type, so
 * the rule is a declaration any type (a fork's too) can make.
 *
 * Run with: node --test tests/live-only-slides.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { stripLiveOnlySlidesFromPresentation, filterForExport } =
  await import('../server/utils/public-output.js');
const { CORE_SLIDE_TYPE_DEFS } =
  await import('../shared/slide-types/registry.js');

test('follow-invite-slide declares liveOnly, and no other core type does', () => {
  const liveOnly = Object.entries(CORE_SLIDE_TYPE_DEFS)
    .filter(([, def]) => def.liveOnly === true)
    .map(([name]) => name);
  assert.deepEqual(liveOnly, ['follow-invite-slide']);
});

test('a live-only slide is stripped; the presentation is untouched otherwise', () => {
  const pres = {
    slides: [
      { type: 'content-slide', content: { title: 'A' } },
      { type: 'follow-invite-slide', content: {} },
      { type: 'end-slide', content: {} },
    ],
  };
  const out = stripLiveOnlySlidesFromPresentation(pres);
  assert.deepEqual(
    out.slides.map((s) => s.type),
    ['content-slide', 'end-slide'],
  );
  assert.deepEqual(
    filterForExport(pres).slides.map((s) => s.type),
    ['content-slide', 'end-slide'],
  );
  const none = { slides: [{ type: 'content-slide', content: {} }] };
  assert.equal(stripLiveOnlySlidesFromPresentation(none), none);
});
