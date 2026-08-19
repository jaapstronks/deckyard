/**
 * The internal AI route layer's request contract (test-coverage gap map, B40 —
 * surface 5, "AI-routelaag/SSE-schil").
 *
 * `server/routes/api/ai/*.js` are the editor-facing AI endpoints (wizard,
 * wizard-v2/stream, append-slides, refine-section, convert-slide, compress-deck,
 * iterate, and vendor discovery). The generation logic beneath them is
 * tested elsewhere (the `tests/ai-*` pipeline suites) and the dispatcher wiring
 * has `tests/ai-route-dispatch.test.js`; what was untested is each handler's
 * **request contract** — the validation ladder every one of them runs before it
 * spends a single LLM token.
 *
 * A note on where authorization lives, because it shapes what this file can
 * assert. These handlers carry **no per-handler authorization**: authentication
 * is enforced once at the dispatch site (`server/routes/api/index.js` refuses an
 * unauthenticated non-guest before `handleAi` is reached) and the `AI_ENABLED=false`
 * kill-switch is likewise a single upstream mount gate (`flags.enableAi &&
 * handleAi(ctx)`), not a per-route check — so, unlike the public v1 AI surface
 * (#758) where the kill-switch is uneven, the internal surface has one gate for
 * all of its routes and none of the handlers re-check it. There is therefore no
 * handler-level authz-negative to pin here; the contract that *is* the
 * handlers' own is input validation, which is what this file covers, plus the
 * one endpoint that answers without an LLM at all (`/api/ai/vendors`).
 *
 * Feasibility note (opt-out already logged in briefs/test-coverage-gaps.md,
 * opt-out 3): every generative handler's happy path crosses into a configured
 * LLM vendor (`generateDeckJsonFromRawContent`, `generateSlidesToAppend…`,
 * `refineSectionWithAi`, …) — no seam to drive without a live vendor. Each is
 * pinned at every validation branch up to that point of no return; the vendor
 * call itself is the opt-out. The wizard-v2 **stream** endpoint additionally
 * opens an SSE connection (and its 429 connection-limiter) after validation —
 * that too is beyond this recipe; its pre-stream `raw` guard is pinned.
 *
 * House shape: the exported handler is called directly with a req/res double.
 * No fake database is installed — every branch asserted here returns before any
 * storage or vendor call, so none is reached.
 *
 * Run with: node --test tests/ai-routes-validation.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { handleAiVendors } = await import('../server/routes/api/ai/vendors.js');
const { handleAiWizard } = await import('../server/routes/api/ai/wizard.js');
const { handleAiWizardV2Stream } =
  await import('../server/routes/api/ai/wizard-v2-stream.js');
const { handleAiAppendSlides } =
  await import('../server/routes/api/ai/append-slides.js');
const { handleAiRefineSection } =
  await import('../server/routes/api/ai/refine-section.js');
const { handleAiConvertSlide } =
  await import('../server/routes/api/ai/convert-slide.js');
const { handleAiCompressDeck } =
  await import('../server/routes/api/ai/compress-deck.js');
const { handleAiIterate } = await import('../server/routes/api/ai/iterate.js');

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

/** A response double capturing the status/body the http helpers write. */
function makeRes() {
  return {
    statusCode: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
      return this;
    },
    end(payload) {
      try {
        this.body = payload ? JSON.parse(payload) : null;
      } catch {
        this.body = null;
      }
      return this;
    },
  };
}

/**
 * Call an AI handler with a JSON body (or a verbatim `rawBody` string, to drive
 * the malformed-JSON branch). The handlers read their body off the async
 * iterator, exactly as `requireJsonBody` does over a real request.
 *
 * @param {Function} handler
 * @param {Object} [options]
 * @param {Object} [options.body] - JSON body; stringified.
 * @param {string} [options.rawBody] - Body sent verbatim (e.g. malformed JSON).
 * @returns {Promise<{handled: *, res: Object}>}
 */
async function call(handler, { body, rawBody } = {}) {
  const payload =
    rawBody !== undefined
      ? rawBody
      : body === undefined
        ? ''
        : JSON.stringify(body);
  const req = {
    method: 'POST',
    headers: { host: 'decks.example.test', 'content-type': 'application/json' },
    socket: { remoteAddress: '203.0.113.9' },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload, 'utf8');
    },
  };
  const res = makeRes();
  const handled = await handler({
    repoRoot: process.cwd(),
    req,
    res,
    url: new URL('http://decks.example.test/api/ai/x'),
    authedUser: { email: 'author@example.com', name: 'Ada Author' },
  });
  return { handled, res };
}

// ===========================================================================
// vendors.js — the one endpoint with no LLM behind it
// ===========================================================================

test('vendor discovery answers 200 without touching an LLM', async () => {
  const res = makeRes();
  const handled = await handleAiVendors({ res });

  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(typeof res.body, 'object');
  assert.notEqual(res.body, null);
});

// ===========================================================================
// The generative handlers all reject a malformed body before the vendor call
// ===========================================================================

test('every POST handler rejects a body that is not JSON with a 400', async () => {
  const handlers = [
    handleAiWizard,
    handleAiWizardV2Stream,
    handleAiAppendSlides,
    handleAiRefineSection,
    handleAiConvertSlide,
    handleAiCompressDeck,
    handleAiIterate,
  ];

  for (const handler of handlers) {
    const { res } = await call(handler, { rawBody: '{ this is not json' });
    assert.equal(
      res.statusCode,
      400,
      `${handler.name} must 400 on malformed JSON`,
    );
  }
});

// ===========================================================================
// The raw-text generators require non-empty input
// ===========================================================================

test('wizard requires non-empty raw input', async () => {
  const { res } = await call(handleAiWizard, { body: { raw: '   ' } });
  assert.equal(res.statusCode, 400);
});

test('wizard-v2 stream refuses empty raw before opening the SSE stream', async () => {
  const { res } = await call(handleAiWizardV2Stream, { body: { raw: '' } });
  assert.equal(
    res.statusCode,
    400,
    'the guard runs before openSseStream, so this stays an HTTP 400',
  );
});

test('append-slides requires non-empty raw input', async () => {
  const { res } = await call(handleAiAppendSlides, { body: { raw: '' } });
  assert.equal(res.statusCode, 400);
});

// ===========================================================================
// The deck-operating handlers validate their structured inputs
// ===========================================================================

test('convert-slide requires both a slide and a target type', async () => {
  const noSlide = await call(handleAiConvertSlide, {
    body: { toType: 'content-slide' },
  });
  assert.equal(noSlide.res.statusCode, 400, 'a missing slide is a 400');

  const noType = await call(handleAiConvertSlide, {
    body: { slide: { id: 's1', type: 'content-slide' } },
  });
  assert.equal(noType.res.statusCode, 400, 'a missing toType is a 400');
});

test('compress-deck requires a presentation with a slides array', async () => {
  const missing = await call(handleAiCompressDeck, { body: {} });
  assert.equal(missing.res.statusCode, 400);

  const notArray = await call(handleAiCompressDeck, {
    body: { presentation: { slides: 'nope' } },
  });
  assert.equal(notArray.res.statusCode, 400);
});

test('iterate requires a presentation and a command', async () => {
  const noPres = await call(handleAiIterate, {
    body: { command: 'punch it up' },
  });
  assert.equal(noPres.res.statusCode, 400, 'a missing presentation is a 400');

  const noCommand = await call(handleAiIterate, {
    body: { presentation: { slides: [{ id: 's1', type: 'content-slide' }] } },
  });
  assert.equal(noCommand.res.statusCode, 400, 'a missing command is a 400');
});

test('refine-section validates presentation, slideIds, feedback and slide existence', async () => {
  const base = {
    slides: [
      { id: 's1', type: 'content-slide' },
      { id: 's2', type: 'content-slide' },
    ],
  };

  const noPres = await call(handleAiRefineSection, {
    body: { slideIds: ['s1'], feedback: 'x' },
  });
  assert.equal(noPres.res.statusCode, 400, 'a missing presentation is a 400');

  const noIds = await call(handleAiRefineSection, {
    body: { presentation: base, feedback: 'x' },
  });
  assert.equal(noIds.res.statusCode, 400, 'an empty slideIds array is a 400');

  const noFeedback = await call(handleAiRefineSection, {
    body: { presentation: base, slideIds: ['s1'] },
  });
  assert.equal(
    noFeedback.res.statusCode,
    400,
    'a missing feedback string is a 400',
  );

  const unknownIds = await call(handleAiRefineSection, {
    body: { presentation: base, slideIds: ['does-not-exist'], feedback: 'x' },
  });
  assert.equal(
    unknownIds.res.statusCode,
    400,
    'slideIds that match no slide is a 400',
  );
});
