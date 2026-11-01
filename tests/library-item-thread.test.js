/**
 * The pure halves of the library-item thread (B906, D369): who may delete a
 * message, and what the maker's notification says and links to. The read
 * boundary and the fan-out run against real PostgreSQL in
 * tests/pg/library-item-thread.pgtest.js.
 *
 * Run with: node --test tests/library-item-thread.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLibraryCommentNotificationInput,
  canDeleteLibraryThreadMessage,
  LIBRARY_COMMENT_TYPE,
} from '../server/services/library-item-comments.js';

const AUTHOR_ID = '00000000-0000-4000-8000-0000000000a1';

test('a message is deleted by its author or an admin, by users.id', () => {
  const message = { authorUserId: AUTHOR_ID };
  assert.equal(canDeleteLibraryThreadMessage({ id: AUTHOR_ID }, message), true);
  assert.equal(
    canDeleteLibraryThreadMessage(
      { id: '00000000-0000-4000-8000-0000000000b2' },
      message,
    ),
    false,
  );
  assert.equal(
    canDeleteLibraryThreadMessage({ id: 'x', isAdmin: true }, message),
    true,
  );
  // A message whose author was deleted belongs to nobody but an admin.
  assert.equal(
    canDeleteLibraryThreadMessage({ id: AUTHOR_ID }, { authorUserId: null }),
    false,
  );
  // The listed shape names the author as a display pair.
  assert.equal(
    canDeleteLibraryThreadMessage(
      { id: AUTHOR_ID },
      { author: { id: AUTHOR_ID, displayName: 'A' } },
    ),
    true,
  );
});

test('the notification names the writer and the slide, and opens the item', () => {
  const input = buildLibraryCommentNotificationInput({
    item: { id: 'item-1', name: 'Team' },
    message: { id: 'm-1', body: 'Jan is missing.' },
    actor: { email: 'Member@Example.com', name: 'Member' },
  });
  assert.equal(input.notificationType, LIBRARY_COMMENT_TYPE);
  assert.equal(input.title, 'Member commented on "Team" in the slide library');
  assert.equal(input.body, 'Jan is missing.');
  assert.equal(input.presentationId, null);
  assert.equal(input.actorEmail, 'member@example.com');
  assert.equal(input.actionUrl, '/app/slide-library/organization/item-1');
  assert.deepEqual(input.data, {
    itemId: 'item-1',
    itemName: 'Team',
    messageId: 'm-1',
  });
});

test('a long message is quoted, not copied whole', () => {
  const input = buildLibraryCommentNotificationInput({
    item: { id: 'i', name: '' },
    message: { id: 'm', body: 'x'.repeat(500) },
    actor: {},
  });
  assert.equal(input.body.length, 140);
  assert.ok(input.body.endsWith('…'));
  assert.match(input.title, /^Someone commented on "a library slide"/);
});
