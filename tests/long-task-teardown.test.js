/** Real task handlers with delayed transport: leaving a view must win every race. */
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
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
});
const { closeAllOverlays } = await import('../client/lib/dom/modal.js');
const { processSSEStream } = await import('../client/lib/net/sse.js');
const { importDeckFiles } =
  await import('../client/views/slide-import/stream.js');
const { streamExport } =
  await import('../client/views/editor/publish-export/export-download.js');
const { handleNotion, handleConvertFile, handlePasteText } =
  await import('../client/views/list/modals/new-presentation/handlers.js');
const event = (name, data) =>
  `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const complete = {
  presentation: { id: 'late-deck' },
  downloadUrl: '/late-download',
  suggestionCount: 1,
};

for (const [name, run] of [
  [
    'deck file import',
    () => importDeckFiles({ url: '/import', files: {}, title: 'Import' }),
  ],
  [
    'export',
    () =>
      streamExport({
        url: '/export',
        title: 'Export',
        fallbackName: 'test.pdf',
        timeoutMs: 10000,
      }),
  ],
  ...[
    ['Notion', handleNotion],
    ['file conversion', handleConvertFile],
    ['paste generation', handlePasteText],
  ].map(([name, handler]) => [
    name,
    (calls) =>
      handler({
        root: document.body,
        raw: 'Source',
        notionUrl: 'https://www.notion.so/test',
        selectedFile: new dom.window.File(['source'], 'source.pdf'),
        langMode: 'en',
        close: () => calls.push('close'),
        setBusy: () => {},
        setStatus: (s) => calls.push(s),
        hideBackdrop: () => {},
        showBackdrop: () => calls.push('restore'),
      }),
  ]),
]) {
  for (const ending of ['complete', 'error']) {
    for (const cancel of ['teardown', 'button']) {
      test(`${name}: ${cancel} ignores late ${ending} after pending fetch`, async (t) => {
        document.body.replaceChildren();
        dom.reconfigure({ url: 'http://localhost/app' });
        let deliver;
        let signal;
        const calls = [];
        const fetches = [];
        t.mock.method(globalThis, 'fetch', (url, options) => {
          fetches.push(url);
          signal = options.signal;
          return new Promise((resolve) => {
            deliver = resolve;
          });
        });
        const running = run(calls);
        while (!deliver) await tick();
        const before = calls.length;
        if (cancel === 'teardown') closeAllOverlays();
        else document.querySelector('.loading-modal-cancel').click();
        deliver(
          new Response(
            event(
              ending,
              ending === 'complete' ? complete : { message: 'late failure' },
            ),
          ),
        );
        const result = await running;
        assert.equal(signal.aborted, true);
        assert.ok(result == null);
        assert.equal(
          fetches.length,
          1,
          'no download or second creation request',
        );
        assert.equal(window.location.pathname, '/app', 'no late navigation');
        assert.ok(
          calls.slice(before).every((call) => call === 'close'),
          'no late error or restored form',
        );
        assert.ok(calls.filter((call) => call === 'close').length <= 1);
        assert.equal(
          document.querySelector('.loading-modal').getAttribute('aria-busy'),
          'false',
        );
      });
    }
  }
}

test('teardown interrupts a pending read, cancels the reader and releases its lock', async () => {
  const controller = new AbortController();
  let cancelled = 0;
  const body = new ReadableStream({
    cancel() {
      cancelled++;
    },
  });
  const reading = processSSEStream(body, {}, { signal: controller.signal });
  controller.abort();
  await assert.rejects(reading, { name: 'AbortError' });
  assert.equal(cancelled, 1);
  assert.equal(body.locked, false);
});

test('abort between events suppresses completion and error already buffered in the same chunk', async () => {
  const controller = new AbortController();
  const seen = [];
  const body = new Response(
    event('status', {}) + event('complete', complete) + event('error', {}),
  ).body;
  await assert.rejects(
    processSSEStream(
      body,
      {
        onStatus() {
          controller.abort();
        },
        onComplete() {
          seen.push('complete');
        },
        onError() {
          seen.push('error');
        },
      },
      { signal: controller.signal },
    ),
    { name: 'AbortError' },
  );
  assert.deepEqual(seen, []);
  assert.equal(body.locked, false);
});

test('export teardown during blob reading never downloads the returned bytes', async (t) => {
  let resolveBlob;
  let downloads = 0;
  t.mock.method(URL, 'createObjectURL', () => {
    downloads++;
    return 'blob:test';
  });
  t.mock.method(globalThis, 'fetch', async (url) =>
    url === '/export'
      ? new Response(event('complete', { downloadUrl: '/file' }))
      : {
          ok: true,
          blob: () =>
            new Promise((resolve) => {
              resolveBlob = resolve;
            }),
        },
  );
  const exporting = streamExport({
    url: '/export',
    title: 'Export',
    fallbackName: 'test.pdf',
  });
  while (!resolveBlob) await tick();
  closeAllOverlays();
  resolveBlob(new Blob(['data']));
  assert.equal(await exporting, null);
  assert.equal(downloads, 0);
});

test('successful import returns its result without aborting the completed request', async (t) => {
  let signal;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    signal = options.signal;
    return new Response(event('complete', complete));
  });
  assert.deepEqual(
    await importDeckFiles({ url: '/import', files: {}, title: 'Import' }),
    complete,
  );
  closeAllOverlays();
  assert.equal(signal.aborted, false);
});

test('successful export downloads once and does not cancel on later teardown', async (t) => {
  let signal;
  let downloaded = 0;
  t.mock.method(
    dom.window.HTMLAnchorElement.prototype,
    'click',
    () => downloaded++,
  );
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    signal = options.signal;
    return url === '/export'
      ? new Response(event('complete', { downloadUrl: '/file' }))
      : new Response('bytes');
  });
  assert.ok(
    await streamExport({
      url: '/export',
      title: 'Export',
      fallbackName: 'test.pdf',
    }),
  );
  closeAllOverlays();
  assert.equal(downloaded, 1);
  assert.equal(signal.aborted, false);
});

for (const [name, handler] of [
  ['Notion', handleNotion],
  ['file', handleConvertFile],
  ['paste', handlePasteText],
]) {
  test(`${name}: teardown during the success pause prevents navigation`, async (t) => {
    dom.reconfigure({ url: 'http://localhost/app' });
    document.body.replaceChildren();
    const calls = [];
    let signal;
    t.mock.method(globalThis, 'fetch', async (_url, options) => {
      signal = options.signal;
      return new Response(event('complete', complete));
    });
    const pending = handler({
      root: document.body,
      raw: 'Source',
      notionUrl: 'https://www.notion.so/test',
      selectedFile: new dom.window.File(['source'], 'source.pdf'),
      langMode: 'en',
      close: () => calls.push('close'),
      setBusy() {},
      setStatus() {},
      hideBackdrop() {},
      showBackdrop: () => calls.push('restore'),
    });
    while (
      document.querySelector('.loading-modal-progress-text')?.textContent !==
      '100%'
    )
      await tick();
    closeAllOverlays();
    await pending;
    assert.equal(signal.aborted, true);
    assert.equal(window.location.pathname, '/app');
    assert.deepEqual(calls, ['close']);
  });
}

test('teardown stops a rotating import and a pending stream read immediately', async (t) => {
  const nativeTimeout = globalThis.setTimeout;
  const nativeClear = globalThis.clearTimeout;
  const timers = new Set();
  t.mock.method(globalThis, 'setTimeout', (fn, ms, ...args) => {
    const timer = nativeTimeout(() => {
      timers.delete(timer);
      fn(...args);
    }, ms);
    if (ms === 6500) timers.add(timer);
    return timer;
  });
  t.mock.method(globalThis, 'clearTimeout', (timer) => {
    timers.delete(timer);
    nativeClear(timer);
  });
  let streamCancelled = false;
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                event('messages', {
                  statusMessages: ['Reading', 'Writing'],
                  loop: true,
                }),
              ),
            );
          },
          cancel() {
            streamCancelled = true;
          },
        }),
      ),
  );
  const pending = handleNotion({
    root: document.body,
    notionUrl: 'https://www.notion.so/test',
    close() {},
    setBusy() {},
    setStatus() {},
    hideBackdrop() {},
    showBackdrop() {
      assert.fail('must not restore abandoned form');
    },
  });
  while (timers.size === 0) await tick();
  closeAllOverlays();
  assert.equal(timers.size, 0);
  await pending;
  assert.equal(streamCancelled, true);
});
