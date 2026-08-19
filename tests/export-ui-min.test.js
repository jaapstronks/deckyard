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
 * `?ui=min` makes one exported file serve both cases: full-page at /p/ and
 * chrome-less in an iframe. It is a runtime param, not a build option, so the
 * assertions here are about the markup + CSS that make it possible — the
 * behaviour itself is verified in a browser.
 */

const deck = {
  id: 'd',
  title: 'T',
  slides: [
    { id: 's1', type: 'payoff-slide', content: {} },
    { id: 's2', type: 'payoff-slide', content: {} },
  ],
};

test('the ui param is read before the shell renders', async () => {
  const html = await buildStandaloneHtml(repoRoot, deck, {});
  const bodyStart = html.indexOf('<body');
  const script = html.indexOf('window.__DECK_UI__');
  const shell = html.indexOf('class="presenter-shell"');
  assert.ok(script > bodyStart, 'the ui script sits inside <body>');
  assert.ok(script < shell, 'the ui script runs before the chrome is parsed');
  assert.match(html, /classList\.add\('ui-min'\)/);
});

test('ui=min collapses both chrome rows and keeps the progress fill', async () => {
  const html = await buildStandaloneHtml(repoRoot, deck, {});
  // Both grid rows go to zero, so the stage is the whole frame (16:9 exact).
  assert.match(
    html,
    /html\.ui-min \.presenter-shell \{\s*--presenter-topbar-height: 0px;\s*--presenter-progress-height: 0px;/,
  );
  // Topbar, button row and loop bar are hidden …
  assert.match(
    html,
    /html\.ui-min \.presenter-topbar,\s*html\.ui-min \.ps-standalone-progress-row,\s*html\.ui-min \.ps-standalone-loop-bar \{\s*display: none;/,
  );
  // … while the progress bar survives as a 3px overlay that costs no height.
  assert.match(
    html,
    /html\.ui-min \.presenter-progress \{[^}]*position: absolute;/,
  );
  assert.match(
    html,
    /html\.ui-min \.presenter-progress-bar \{[^}]*height: 3px;/,
  );
});

test('the chrome is still in the DOM, so nothing else has to change', async () => {
  const html = await buildStandaloneHtml(repoRoot, deck, {});
  // ui=min is CSS-only: the buttons, the counter and the sr-only live region
  // all stay, which is why keyboard nav and announcements keep working.
  assert.match(html, /<header class="presenter-topbar">/);
  assert.match(html, /id="btnNext"/);
  assert.match(html, /id="srStatus"/);
  assert.match(html, /id="progressFill"/);
});

test('without the param nothing about the export changes', async () => {
  const html = await buildStandaloneHtml(repoRoot, deck, {});
  // No ui-min class is baked into the document; only the runtime adds it.
  assert.doesNotMatch(html, /<html[^>]*class="[^"]*ui-min/);
  assert.doesNotMatch(html, /<body[^>]*class="[^"]*ui-min/);
});
