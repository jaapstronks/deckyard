import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isLiveSlideType,
  liveInteractionKind,
} from '../shared/slide-types/runtime.js';
import { getOptionCountForSlide } from '../server/utils/interaction-helpers.js';
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
  'lead-capture-slide', // collects, but into lead storage, never the session
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

test('option counts per live type are unchanged', () => {
  const poll = { content: { option1: 'a', option2: 'b', option3: '', option4: 'd' } };
  assert.equal(getOptionCountForSlide('poll-slide', poll), 3);

  const likert = {
    content: Object.fromEntries(
      Array.from({ length: 7 }, (_v, i) => [`option${i + 1}`, `o${i + 1}`])
    ),
  };
  assert.equal(getOptionCountForSlide('likert-slide', likert), 7);

  // The slider's stops are fixed by the widget, not authored.
  assert.equal(getOptionCountForSlide('likert-slider-slide', { content: {} }), 10);

  // Free text has no options, and neither has anything that is not live.
  assert.equal(getOptionCountForSlide('feedback-slide', { content: {} }), 0);
  assert.equal(getOptionCountForSlide('content-slide', { content: {} }), 0);
  assert.equal(getOptionCountForSlide('poll-slide', null), 0);
});

test('the audience is offered an interaction on exactly the live slides', () => {
  const caps = (slideType, status = 'live') =>
    computeAudienceCapabilitiesFromState(
      { status, slideType, slideId: 's1', sessionId: 'sess1' },
      {}
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
