import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isLiveSlideType,
  liveInteractionKind,
  liveScale,
} from '../shared/slide-types/runtime.js';
import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import {
  getOptionCountForSlide,
  scaleInteractionFromSlide,
} from '../server/utils/interaction-helpers.js';
import { computeAudienceCapabilitiesFromState } from '../server/routes/api/follow/helpers.js';

/**
 * The behaviour the `runtime` facet took over.
 *
 * Nine modules used to decide "does this slide collect answers, and of what
 * kind?" from a hand-written list of four type names; they now ask the type.
 * That is a rewrite of the guards on a public, unauthenticated submission path,
 * and the path had no test of its own — so this file pins the answers rather
 * than trusting that the reading was faithful.
 *
 * These are the *old* answers, written out literally. If a change here looks
 * like it needs updating, that is the point: the values are the contract the
 * follow API speaks, not an implementation detail.
 */

const LIVE = {
  'poll-slide': 'poll',
  'likert-slide': 'likert',
  'likert-slider-slide': 'likert',
  'feedback-slide': 'feedback',
};

const NOT_LIVE = [
  'countdown-slide', // timed: a clock, not an audience
  'follow-invite-slide', // renders the join code, collects nothing
  'content-slide',
  'chart-slide',
  '',
];

test('exactly the four interaction types are live, with their protocol kind', () => {
  for (const [type, kind] of Object.entries(LIVE)) {
    assert.equal(isLiveSlideType(type), true, `${type} should be live`);
    assert.equal(liveInteractionKind(type), kind, `${type} kind`);
  }
  for (const type of NOT_LIVE) {
    assert.equal(isLiveSlideType(type), false, `${type} should not be live`);
    assert.equal(liveInteractionKind(type), '', `${type} kind`);
  }
});

test('option counts per live type are the length of the authored array', () => {
  // Since schema v9 both authored types carry one `options[]` array and the
  // count is simply its length — no compaction, because an array has no holes
  // to close (the flat `option1..N` slots did, which is what made a blanked
  // answer re-point live votes).
  const poll = {
    content: { options: [{ text: 'a' }, { text: 'b' }, { text: 'd' }] },
  };
  assert.equal(getOptionCountForSlide('poll-slide', poll), 3);

  const likert = {
    content: {
      options: Array.from({ length: 7 }, (_v, i) => ({ text: `o${i + 1}` })),
    },
  };
  assert.equal(getOptionCountForSlide('likert-slide', likert), 7);

  // The slider's stops are not authored: they are the type's declared scale.
  assert.equal(
    getOptionCountForSlide('likert-slider-slide', { content: {} }),
    10,
  );

  // Free text has no options, and neither has anything that is not live.
  assert.equal(getOptionCountForSlide('feedback-slide', { content: {} }), 0);
  assert.equal(getOptionCountForSlide('content-slide', { content: {} }), 0);
  assert.equal(getOptionCountForSlide('poll-slide', null), 0);
});

test('the slider protocol reads its stops from the declared scale (B316)', () => {
  const declared = SLIDE_TYPES['likert-slider-slide'].scale;
  const scale = liveScale('likert-slider-slide');
  assert.deepEqual(
    scale,
    { min: declared.min, max: declared.max },
    'the one reader hands back the declaration, not a constant of its own',
  );
  assert.equal(
    getOptionCountForSlide('likert-slider-slide', { content: {} }),
    declared.max - declared.min + 1,
    'the vote range is min..max inclusive',
  );
  const { options } = scaleInteractionFromSlide({ content: {} }, scale);
  assert.equal(options[0], String(declared.min), 'index 0 is the scale min');
  assert.equal(
    options.at(-1),
    String(declared.max),
    'the last index is the scale max',
  );

  // A likert type with authored options declares no scale, and no other kind
  // has one to read.
  assert.equal(liveScale('likert-slide'), null);
  assert.equal(liveScale('poll-slide'), null);
  assert.equal(liveScale('content-slide'), null);
});

test('the audience is offered an interaction on exactly the live slides', () => {
  const caps = (slideType, status = 'live') =>
    computeAudienceCapabilitiesFromState(
      { status, slideType, slideId: 's1', sessionId: 'sess1' },
      {},
    );

  for (const [type, kind] of Object.entries(LIVE)) {
    const c = caps(type);
    assert.equal(c.interaction?.type, kind, `${type} interaction`);
    assert.equal(c.interaction?.slideId, 's1');
    // A live interaction takes the floor: Q&A steps aside while it is open.
    assert.equal(c.canUseQa, false, `${type} suppresses Q&A`);
  }

  for (const type of NOT_LIVE) {
    const c = caps(type);
    assert.equal(c.interaction, undefined, `${type} offers no interaction`);
    assert.equal(c.canUseQa, true, `${type} leaves Q&A available`);
  }

  // Not live: no session, so nothing is offered regardless of the type.
  const offline = caps('poll-slide', 'idle');
  assert.equal(offline.interaction, undefined);
  assert.equal(offline.canViewSlide, false);
});
