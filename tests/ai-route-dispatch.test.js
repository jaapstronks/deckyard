/**
 * AI route dispatcher: exact method+path matching. Guards the split of the
 * former 717-line handleAi if-chain into per-endpoint handlers under
 * server/routes/api/ai/ behind a table-driven dispatcher. Verifies wiring
 * (all handler modules import + export a function) and that dispatch matches
 * the original method/path semantics, without invoking the AI pipeline.
 *
 * Run with: node --test tests/ai-route-dispatch.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { handleAi } = await import('../server/routes/api/ai.js');

function makeCtx(method, pathname, resSink = {}) {
  const res = {
    code: null,
    payload: null,
    setHeader() {},
    ...resSink,
  };
  return {
    ctx: {
      repoRoot: '/tmp',
      req: { method },
      res,
      url: { pathname },
      authedUser: null,
    },
    res,
  };
}

test('GET /api/ai/vendors dispatches to the vendors handler', async () => {
  // vendors is the one handler with no request-body parsing or network, so it
  // exercises real end-to-end dispatch cheaply.
  let served = null;
  const { ctx } = makeCtx('GET', '/api/ai/vendors', {
    // serveJson uses res.writeHead + res.end
    writeHead(code) {
      this.code = code;
    },
    end(body) {
      served = { code: this.code, body };
    },
  });
  const handled = await handleAi(ctx);
  assert.equal(handled, true, 'vendors route handled');
  assert.equal(served.code, 200, 'responds 200');
  assert.ok(served.body, 'writes a body');
});

test('unknown path is not handled (falls through to next router)', async () => {
  const { ctx } = makeCtx('POST', '/api/ai/does-not-exist');
  assert.equal(await handleAi(ctx), false);
});

test('known path with the wrong method is not handled', async () => {
  // /api/ai/wizard is POST-only; a GET must fall through, not 404 here.
  const { ctx } = makeCtx('GET', '/api/ai/wizard');
  assert.equal(await handleAi(ctx), false);
});

test('all AI handler modules export a handler function', async () => {
  const mods = {
    'vendors.js': 'handleAiVendors',
    'wizard.js': 'handleAiWizard',
    'wizard-v2.js': 'handleAiWizardV2',
    'wizard-v2-outline.js': 'handleAiWizardV2Outline',
    'wizard-v2-stream.js': 'handleAiWizardV2Stream',
    'append-slides.js': 'handleAiAppendSlides',
    'refine-section.js': 'handleAiRefineSection',
    'convert-slide.js': 'handleAiConvertSlide',
    'compress-deck.js': 'handleAiCompressDeck',
    'iterate.js': 'handleAiIterate',
  };
  for (const [file, exportName] of Object.entries(mods)) {
    const mod = await import(`../server/routes/api/ai/${file}`);
    assert.equal(
      typeof mod[exportName],
      'function',
      `${file} exports ${exportName}`
    );
  }
});
