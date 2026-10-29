/**
 * The live-session facets (`liveOnly`, `liveInvite`) travel on
 * `/api/slide-types`, so the editor, which holds that response and not the
 * registry, gives the same answer as the shared registry (B885).
 *
 * Without them the export notice asked `isLiveOnlySlideType()` of a registry
 * that never said yes: a live-only type with an empty essential picture was
 * named among the slides "the export leaves out", although it is left out of
 * every export anyway. A fork type declaring the facet is only heard if the
 * flag travels.
 *
 * Run with: node --test tests/live-session-facets-wire.test.js
 */

import { createMockRes } from './helpers/http-mocks.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import {
  isLiveInviteSlideType,
  isLiveOnlySlideType,
  liveInviteSlideType,
} from '../shared/slide-types/live-session.js';
import { handleSlideTypes } from '../server/routes/api/slide-types.js';
import { incompleteSlideNumbers } from '../client/views/editor/incomplete-slides-notice.js';

async function apiRegistry() {
  const res = createMockRes();
  await handleSlideTypes({
    repoRoot: '/tmp',
    storageScope: {},
    authedUser: null,
    req: { method: 'GET', headers: {} },
    res,
    url: {
      pathname: '/api/slide-types',
      searchParams: new URLSearchParams(),
    },
  });
  assert.equal(res.statusCode, 200);
  return res.json();
}

test('/api/slide-types carries liveOnly and liveInvite', async () => {
  const meta = await apiRegistry();
  assert.equal(meta['follow-invite-slide'].liveOnly, true);
  assert.equal(meta['follow-invite-slide'].liveInvite, true);
  assert.equal(meta['content-slide'].liveOnly, undefined);
  assert.equal(meta['content-slide'].liveInvite, undefined);
});

test('the editor registry answers every live-session question as the shared registry does', async () => {
  const meta = await apiRegistry();
  for (const name of Object.keys(SLIDE_TYPES)) {
    assert.equal(
      isLiveOnlySlideType(name, meta),
      isLiveOnlySlideType(name),
      `liveOnly of ${name}`,
    );
    assert.equal(
      isLiveInviteSlideType(name, meta),
      isLiveInviteSlideType(name),
      `liveInvite of ${name}`,
    );
  }
  assert.equal(liveInviteSlideType(meta), liveInviteSlideType());
});

test('the export notice leaves out a live-only type with an empty essential picture', async () => {
  const meta = await apiRegistry();
  // A fork-style type: the core invite has no picture, so the case only
  // arises for a type the client registry does not hold itself.
  const pictured = {
    label: 'Pictured',
    fields: [{ key: 'image', type: 'image', essential: true }],
    defaults: {},
  };
  const slideTypes = {
    ...meta,
    'x-live-pictured': { ...pictured, liveOnly: true },
    'x-pictured': pictured,
  };
  const pres = {
    slides: [
      { id: 'a', type: 'x-live-pictured', content: { image: '' } },
      { id: 'b', type: 'x-pictured', content: { image: '' } },
    ],
  };
  assert.deepEqual(incompleteSlideNumbers(pres, slideTypes, 'export'), [2]);
  assert.deepEqual(
    incompleteSlideNumbers(pres, slideTypes, 'presentation'),
    [1, 2],
  );
});
