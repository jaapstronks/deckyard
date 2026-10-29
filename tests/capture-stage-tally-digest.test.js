/**
 * A stage-tally timeout explains itself.
 *
 * The capture run of 2026-10-04 failed four live-poll shots on `Total: 0`
 * after the seed was confirmed server-side, and left nothing that could tell a
 * server that lost the votes from a stage polling another slide or a poll that
 * never answered (B654). `waitForStageTally()` now reports all three when it
 * gives up; this test holds that digest to a fake page and a stub server, so a
 * later tidy-up cannot quietly drop a line of it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { waitForStageTally } from '../capture/lib/marketing.js';

/** A stub of the follow state route that reports `total` votes. */
async function startStateServer(total) {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        interactionState: { slideId: 'poll-1', total, status: 'open' },
      }),
    );
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return server;
}

/**
 * Just enough of a puppeteer page: the stage keeps showing zero while the
 * live stream drops once and the console reports an error.
 */
function fakePage(origin) {
  const handlers = {};
  return {
    handlers,
    url: () => `${origin}/present/deck-1?slideId=poll-1`,
    on(event, fn) {
      handlers[event] = fn;
      if (event === 'requestfailed') {
        fn({
          url: () => `${origin}/api/live-sessions/s-1/events`,
          failure: () => ({ errorText: 'net::ERR_ABORTED' }),
        });
      }
      if (event === 'console') {
        fn({ type: () => 'error', text: () => 'poll fetch failed' });
      }
    },
    off(event, fn) {
      if (handlers[event] === fn) delete handlers[event];
    },
    async evaluate(fn) {
      if (String(fn).includes('is-active')) {
        return { active: 'end-1', totals: ['poll-1="Total: 0"'] };
      }
      return 'Total: 0';
    },
  };
}

test('a timeout reports the server tally, the stage and the traffic', async () => {
  const server = await startStateServer(47);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const page = fakePage(origin);
  try {
    await assert.rejects(
      waitForStageTally(page, 47, {
        deckId: 'deck-1',
        slideId: 'poll-1',
        timeoutMs: 300,
      }),
      (err) => {
        assert.match(err.message, /never reached 47 within 300ms/);
        assert.match(err.message, /last read "Total: 0"/);
        assert.match(err.message, /server: 200 total=47 slide=poll-1/);
        assert.match(
          err.message,
          /stage: seeded slide=poll-1 active=end-1 totals=\[poll-1="Total: 0"\]/,
        );
        assert.match(
          err.message,
          /during wait \(2\):\n {4}net::ERR_ABORTED \/api\/live-sessions\/s-1\/events\n {4}console\.error: poll fetch failed/,
        );
        return true;
      },
    );
    assert.deepEqual(
      Object.keys(page.handlers),
      [],
      'listeners are removed after the wait',
    );
  } finally {
    server.close();
  }
});
