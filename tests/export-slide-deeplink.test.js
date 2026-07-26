import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStandaloneHtml } from '../server/export/html.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/**
 * The exported runtime reads a `#slide=<n>` deep-link out of the URL hash to
 * open on a specific slide. That regex lives inside the emitted-JS template
 * literal, where a lone `\d` collapses to a literal `d` — so `/slide=(\d+)/`
 * silently shipped as `/slide=(d+)/` and matched nothing. The fix double-escapes
 * (`\\d`) so the browser receives a real digit class. These tests lock the
 * emitted behaviour, which no export test previously exercised.
 */

function deck() {
  return {
    id: 'd',
    title: 'T',
    slides: [
      { id: 's0', type: 'payoff-slide', content: {} },
      { id: 's1', type: 'payoff-slide', content: {} },
      { id: 's2', type: 'payoff-slide', content: {} },
    ],
  };
}

test('export emits a digit-matching slide deep-link regex, not a literal "d"', async () => {
  const html = await buildStandaloneHtml(repoRoot, deck(), {});
  assert.ok(
    html.includes('/slide=(\\d+)/'),
    'emitted runtime must contain the escaped digit class /slide=(\\d+)/',
  );
  assert.ok(
    !html.includes('/slide=(d+)/'),
    'emitted runtime must not contain the collapsed literal /slide=(d+)/',
  );
});

test('the emitted deep-link regex actually captures a numeric slide index', async () => {
  const html = await buildStandaloneHtml(repoRoot, deck(), {});
  // Pull the regex literal straight out of the emitted client JS and run it,
  // so the test proves runtime behaviour rather than a source substring.
  const m = html.match(/location\.hash\.match\(\/(slide=[^/]*)\//);
  assert.ok(m, 'could not locate the slide deep-link regex in the export');
  const emitted = new RegExp(m[1]);
  const hit = '#slide=42'.match(emitted);
  assert.ok(hit, 'emitted regex should match a #slide=<n> hash');
  assert.equal(hit[1], '42');
  assert.equal('#slide=abc'.match(emitted), null);
});
