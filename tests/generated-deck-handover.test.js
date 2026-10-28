/**
 * "Discard deck" belongs to the moment right after a generation, not to the
 * review URL (B590 PR C).
 *
 * `?aiReview=1` is also the link an agent gets (`reviewUrl`), so it only
 * opens the review. The generation flows hand the fresh deck over in memory
 * (`openGeneratedDeck`), the editor takes it once (`takeGeneratedDeck`), and
 * only then does the review offer to throw the deck away.
 *
 * Run with: node --test tests/generated-deck-handover.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  openGeneratedDeck,
  takeGeneratedDeck,
} from '../client/lib/state/generated-deck.js';

test('the hand-over is taken once, for the deck it named', () => {
  assert.equal(takeGeneratedDeck('d1'), false, 'nothing handed over');
  openGeneratedDeck('d1', 'en');
  assert.equal(takeGeneratedDeck('d2'), false, 'another deck');
  assert.equal(takeGeneratedDeck('d1'), false, 'a miss clears it');
  openGeneratedDeck('d1', 'en');
  assert.equal(takeGeneratedDeck('d1'), true);
  assert.equal(takeGeneratedDeck('d1'), false, 'taken once');
});

test('the URL flag alone never offers the discard action', () => {
  const editor = readFileSync(
    new URL('../client/views/editor/editor-controller.js', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(editor, /postGeneration:\s*true/);
  assert.match(editor, /postGeneration:\s*justGenerated/);
  const flows = readFileSync(
    new URL(
      '../client/views/list/modals/new-presentation/handlers.js',
      import.meta.url,
    ),
    'utf8',
  );
  assert.doesNotMatch(flows, /aiReview=1/, 'flows hand over, not build URLs');
  assert.equal(flows.match(/openGeneratedDeck\(/g)?.length, 3);
});

test("an agent's note claims no source, so the review does not miss one", async () => {
  const { aiReviewPreviewText } =
    await import('../client/views/editor/ai-review-annotations.js');
  const { bindAiReview } = await import('../shared/ai-review.js');
  const slide = (review) =>
    bindAiReview(
      {
        type: 'content-slide',
        content: { title: 'Partners' },
        _aiReasoning: 'Text fits.',
      },
      review,
    );
  const agent = aiReviewPreviewText(
    slide({ kind: 'content', sourceExcerpt: null, origin: 'agent' }),
  );
  assert.equal(agent, 'Text fits.');
  const generated = aiReviewPreviewText(
    slide({ kind: 'content', sourceExcerpt: null }),
  );
  assert.match(generated, /No source passage could be verified/);
});
