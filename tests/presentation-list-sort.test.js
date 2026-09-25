/**
 * The deck list sorts on the storage timestamp names (B448).
 *
 * `allByDate` read `updatedAt`/`createdAt`, which no deck in `/api/presentations`
 * carries (storage projects `modified`/`created`), so every own deck sorted as
 * time 0 and the "all" view was in arbitrary order. Shared decks now carry the
 * same `modified`/`created` names, with `sharedAt` still first for them.
 *
 * Run with: node --test tests/presentation-list-sort.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { loadPresentationList } = await import('../client/views/list/data.js');

test('allByDate orders own and shared decks by their real timestamps', async () => {
  const api = async (path) =>
    path === '/api/presentations'
      ? [
          {
            id: 'old',
            visibility: 'private',
            modified: '2026-01-01T00:00:00Z',
          },
          {
            id: 'new',
            visibility: 'private',
            modified: '2026-03-01T00:00:00Z',
          },
        ]
      : {
          presentations: [
            {
              id: 'shared',
              modified: '2025-01-01T00:00:00Z',
              sharedAt: '2026-02-01T00:00:00Z',
            },
          ],
        };

  const { allByDate } = await loadPresentationList(api);
  assert.deepEqual(
    allByDate.map((p) => p.id),
    ['new', 'shared', 'old'],
  );
});
