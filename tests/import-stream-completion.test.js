/** Real creation handlers and SSE parser; only browser globals and transport differ. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', {
  url: 'http://localhost/app',
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  location: dom.window.location,
  history: dom.window.history,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  FileReader: dom.window.FileReader,
  requestAnimationFrame: (fn) => fn(),
});
const { handleNotion, handleConvertFile } =
  await import('../client/views/list/modals/new-presentation/handlers.js');
const tick = (ms = 350) => new Promise((resolve) => setTimeout(resolve, ms));
const event = (name, data) =>
  `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
const progress =
  event('messages', {
    statusMessages: ['Parsing', 'Importing'],
    loop: true,
    intervalMs: 20,
  }) + event('status', { phase: 'save', message: 'Saving', progress: 95 });

const failures = {
  'HTTP refusal': () =>
    new Response(
      JSON.stringify({
        ok: false,
        error: 'forbidden',
        message: 'No permission',
      }),
      { status: 403 },
    ),
  'reader rejection after save status': () => {
    let reads = 0;
    return new Response(
      new ReadableStream({
        pull(controller) {
          if (reads++ === 0)
            controller.enqueue(new TextEncoder().encode(progress));
          else controller.error(new Error('Connection lost after save'));
        },
      }),
    );
  },
  'EOF without terminal event': () => new Response(progress),
  'missing body': () => new Response(null, { status: 204 }),
  'fetch rejection': () => {
    throw new TypeError('Failed to fetch');
  },
};

for (const [kind, handler, endpoint] of [
  ['Notion', handleNotion, '/api/notion/import/stream'],
  ['file', handleConvertFile, '/api/convert/stream'],
]) {
  async function run(response) {
    document.body.replaceChildren();
    dom.reconfigure({ url: 'http://localhost/app' });
    const calls = [];
    const busy = [];
    const statuses = [];
    let restored = 0;
    let closed = 0;
    const originalFetch = globalThis.fetch;
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const rotatorTimers = new Set();
    globalThis.setTimeout = (callback, ms, ...args) => {
      const timer = originalSetTimeout(() => {
        rotatorTimers.delete(timer);
        callback(...args);
      }, ms);
      if (ms === 20) rotatorTimers.add(timer);
      return timer;
    };
    globalThis.clearTimeout = (timer) => {
      rotatorTimers.delete(timer);
      return originalClearTimeout(timer);
    };
    globalThis.fetch = async (url, opts) => {
      calls.push({ url, opts });
      return response();
    };
    try {
      await handler({
        api: async (url, opts) => {
          calls.push({ url, opts });
          throw new Error('Unexpected second creation POST');
        },
        root: document.body,
        selectedFile: new dom.window.File(['sample'], 'sample.pdf', {
          type: 'application/pdf',
        }),
        notionUrl: 'https://www.notion.so/0123456789abcdef0123456789abcdef',
        langMode: 'nl',
        themeId: 'default',
        close: () => closed++,
        setBusy: (value) => busy.push(value),
        setStatus: (value) => statuses.push(value),
        hideBackdrop() {},
        showBackdrop: () => restored++,
      });
      await tick();
      return {
        calls,
        busy,
        statuses,
        restored,
        closed,
        rotatorTimers: rotatorTimers.size,
      };
    } finally {
      for (const timer of rotatorTimers) originalClearTimeout(timer);
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
      globalThis.fetch = originalFetch;
    }
  }

  for (const [failure, response] of Object.entries(failures)) {
    test(`${kind}: ${failure} never retries and restores the form`, async () => {
      const result = await run(response);
      assert.equal(
        result.calls.length,
        1,
        'one user action must make only one creation POST',
      );
      assert.equal(result.calls[0].url, endpoint);
      assert.equal(result.calls[0].opts.method, 'POST');
      assert.deepEqual(result.busy, [true, false]);
      assert.equal(result.restored, 1);
      assert.equal(result.closed, 0);
      assert.equal(
        document.querySelector('.loading-modal'),
        null,
        'loading modal must close',
      );
      if (failure === 'HTTP refusal')
        assert.equal(result.statuses.at(-1), 'No permission');
      else
        assert.match(
          result.statuses.at(-1),
          /not confirmed.*check.*presentation list/i,
        );
    });
  }

  test(`${kind}: non-JSON HTTP refusal shows the status`, async () => {
    const result = await run(
      () => new Response('<h1>Unavailable</h1>', { status: 503 }),
    );
    assert.equal(result.calls.length, 1);
    assert.deepEqual(result.busy, [true, false]);
    assert.equal(result.statuses.at(-1), 'Import request failed (HTTP 503).');
  });

  test(`${kind}: EOF while messages rotate stops the rotator`, async () => {
    const result = await run(
      () =>
        new Response(
          event('messages', {
            statusMessages: ['Parsing', 'Importing'],
            intervalMs: 20,
            loop: true,
          }),
        ),
    );
    assert.equal(result.calls.length, 1);
    assert.deepEqual(result.busy, [true, false]);
    assert.equal(result.rotatorTimers, 0);
    assert.equal(document.querySelector('.loading-modal'), null);
  });

  test(`${kind}: explicit SSE refusal is shown without retry`, async () => {
    const result = await run(
      () =>
        new Response(progress + event('error', { message: 'Import refused' })),
    );
    assert.equal(result.calls.length, 1);
    assert.deepEqual(result.busy, [true, false]);
    assert.equal(result.statuses.at(-1), 'Import refused');
    assert.equal(result.restored, 1);
    assert.equal(document.querySelector('.loading-modal'), null);
  });

  test(`${kind}: completion opens review with the detected language`, async () => {
    const result = await run(
      () =>
        new Response(
          progress +
            event('complete', {
              success: true,
              presentation: { id: 'imported-deck', lang: 'de' },
              detectedLang: 'fr',
            }),
        ),
    );
    assert.equal(result.calls.length, 1);
    assert.equal(result.closed, 1);
    assert.equal(result.restored, 0);
    assert.equal(document.querySelector('.loading-modal'), null);
    assert.equal(
      window.location.pathname + window.location.search,
      `/app/imported-deck?lang=${kind === 'Notion' ? 'fr' : 'nl'}&aiReview=1`,
    );
    const body = JSON.parse(result.calls[0].opts.body);
    assert.equal(body.theme, 'default');
    if (kind === 'file') {
      assert.equal(body.lang, 'nl');
      assert.equal(body.filename, 'sample.pdf');
      assert.match(body.dataUrl, /^data:application\/pdf;base64,/);
    }
  });
}
