import assert from 'node:assert/strict';
import test from 'node:test';
import { stubTranslateFields } from '../capture/lib/marketing.js';

test('capture translation answers JSON field paths, including nested items', async () => {
  let intercept;
  await stubTranslateFields(
    {
      setRequestInterception: async (enabled) => assert.equal(enabled, true),
      on: (event, listener) => {
        assert.equal(event, 'request');
        intercept = listener;
      },
    },
    { title: 'A proposal', items: [{ text: 'Nested proposal' }] },
  );
  let response;
  intercept({
    url: () => 'http://localhost/api/presentations/deck/translate/fields',
    postData: () =>
      JSON.stringify({
        fields: {
          '["title"]': 'Source',
          '["items",0,"text"]': 'Nested source',
          '["missing"]': 'Unknown source',
        },
      }),
    respond: async (value) => {
      response = value;
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), {
    translations: {
      '["title"]': 'A proposal',
      '["items",0,"text"]': 'Nested proposal',
    },
  });
  let continued = false;
  intercept({
    url: () => 'http://localhost/client/app.js',
    continue: async () => {
      continued = true;
    },
  });
  assert.equal(continued, true);
});
