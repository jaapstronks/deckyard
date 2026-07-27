/**
 * AI-author identity recognition.
 *
 * The identity of AI-suggestion comments is configurable
 * (settings.aiAssistant.email), so recognising a comment as AI-authored cannot
 * compare against a single hardcoded constant — the bug this pins. The renderer
 * (client/views/editor/comments-panel-renderers.js) and the server both route
 * through `isAiAuthorEmail`, which must accept three cases:
 *
 *   1. the configured address (a self-hoster's custom aiAssistant.email),
 *   2. the built-in default, and
 *   3. a legacy address left in stored rows before the domain moved.
 *
 * Case (3) is why there is no backfill migration: recognition accepts the old
 * address on read, the same choice the deck format made with `slidecreator.deck`.
 *
 * Run with: node --test tests/ai-author-identity.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_AI_EMAIL,
  LEGACY_AI_EMAILS,
  isAiAuthorEmail,
} from '../shared/constants/ai.js';

describe('AI-author identity', () => {
  it('default address no longer uses the dead deckyard.app domain', () => {
    assert.ok(!DEFAULT_AI_EMAIL.includes('deckyard.app'));
    assert.equal(DEFAULT_AI_EMAIL, 'ai-assistant@deckyard.eu');
  });

  it('keeps the old address as a legacy value it still accepts', () => {
    assert.ok(LEGACY_AI_EMAILS.includes('ai-assistant@deckyard.app'));
  });

  it('recognises the configured address (custom aiAssistant.email)', () => {
    const configured = 'bot@self-hoster.example';
    assert.equal(isAiAuthorEmail(configured, configured), true);
  });

  it('recognises the built-in default regardless of the configured value', () => {
    // Configured to something custom, but a default-authored row is still AI.
    assert.equal(isAiAuthorEmail(DEFAULT_AI_EMAIL, 'bot@self-hoster.example'), true);
    // And with no configured identity supplied.
    assert.equal(isAiAuthorEmail(DEFAULT_AI_EMAIL), true);
  });

  it('recognises a legacy address left in existing rows', () => {
    assert.equal(isAiAuthorEmail('ai-assistant@deckyard.app', 'bot@self-hoster.example'), true);
    assert.equal(isAiAuthorEmail('ai-assistant@deckyard.app'), true);
  });

  it('does not recognise an unrelated author', () => {
    assert.equal(isAiAuthorEmail('alice@example.com', 'bot@self-hoster.example'), false);
    assert.equal(isAiAuthorEmail(''), false);
    assert.equal(isAiAuthorEmail(undefined), false);
    assert.equal(isAiAuthorEmail(null), false);
  });
});
