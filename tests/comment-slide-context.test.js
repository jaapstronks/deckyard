/**
 * Slide-context enrichment for comment payloads (public API v1 + MCP).
 *
 * - slideContextFor: null without anchor, {deleted:true} for gone slides,
 *   index/number/type/title for live ones.
 * - buildSlideSnapshot: deep copy of just the affected slide.
 * - enrichCommentsWithSlideContext: decorates comments + nested replies
 *   without mutating input.
 * - checkActorCommentAccess: comment-permission rules for machine actors.
 *
 * Run with: node --test tests/comment-slide-context.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  buildSlideSnapshot,
  slideContextFor,
  enrichCommentsWithSlideContext,
} from '../server/services/comment-slide-context.js';
import { checkActorCommentAccess } from '../server/utils/presentation-authz/actor-access.js';

const pres = {
  id: 'p1',
  slides: [
    { id: 's1', type: 'title-slide', content: { title: 'Welcome' } },
    { id: 's2', type: 'quote-slide', content: { quote: 'To be or not to be' } },
  ],
};

describe('slideContextFor', () => {
  it('returns null for comments without a slide anchor', () => {
    assert.equal(slideContextFor(pres, null), null);
  });

  it('marks deleted slides', () => {
    assert.deepEqual(slideContextFor(pres, 'gone'), { deleted: true });
  });

  it('returns index, number, type and derived title', () => {
    assert.deepEqual(slideContextFor(pres, 's2'), {
      deleted: false,
      index: 1,
      number: 2,
      type: 'quote-slide',
      title: 'To be or not to be',
    });
  });
});

describe('buildSlideSnapshot', () => {
  it('copies id, type and content only', () => {
    const snap = buildSlideSnapshot({ id: 's1', type: 'x', content: { a: 1 }, notes: 'secret' });
    assert.deepEqual(snap, { id: 's1', type: 'x', content: { a: 1 } });
  });

  it('is a deep copy (later slide edits do not change it)', () => {
    const slide = { id: 's1', type: 'x', content: { title: 'before' } };
    const snap = buildSlideSnapshot(slide);
    slide.content.title = 'after';
    assert.equal(snap.content.title, 'before');
  });

  it('returns null for missing slides', () => {
    assert.equal(buildSlideSnapshot(null), null);
  });
});

describe('enrichCommentsWithSlideContext', () => {
  it('decorates comments and nested replies without mutating input', () => {
    const comments = [
      {
        id: 'c1',
        slideId: 's1',
        replies: [{ id: 'r1', slideId: null, replies: [] }],
      },
    ];
    const enriched = enrichCommentsWithSlideContext(comments, pres);
    assert.equal(enriched[0].slide.index, 0);
    assert.equal(enriched[0].replies[0].slide, null);
    assert.equal(comments[0].slide, undefined, 'input not mutated');
  });
});

describe('checkActorCommentAccess', () => {
  const OWNER = 'owner@example.com';
  const OTHER = 'other@example.com';
  const privateDeck = { id: 'p1', ownerEmail: OWNER, scope: 'private' };
  const workspaceDeck = { id: 'w1', ownerEmail: OWNER, scope: 'workspace' };

  it('owner and workspace users can comment', () => {
    assert.equal(checkActorCommentAccess({ pres: privateDeck, actorEmail: OWNER }), true);
    assert.equal(checkActorCommentAccess({ pres: workspaceDeck, actorEmail: OTHER }), true);
  });

  it('outsiders cannot comment on private decks', () => {
    assert.equal(checkActorCommentAccess({ pres: privateDeck, actorEmail: OTHER }), false);
  });

  it('comment/edit collaborators can, view collaborators cannot', () => {
    const base = { pres: privateDeck, actorEmail: OTHER };
    assert.equal(checkActorCommentAccess({ ...base, collaboratorPermission: 'comment' }), true);
    assert.equal(checkActorCommentAccess({ ...base, collaboratorPermission: 'edit' }), true);
    assert.equal(checkActorCommentAccess({ ...base, collaboratorPermission: 'view' }), false);
  });
});
