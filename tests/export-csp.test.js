/**
 * The policy gate: every render path states the no-third-party-origins rule to
 * the browser, and states the same rule the other two gates check.
 *
 * `tests/no-third-party-origins.test.js` greps the source and
 * `tests/export-third-party-cdn.test.js` reads the built documents. Both are
 * ours, and both are advisory in the only place that matters: a reader's
 * browser will happily run a script from any host that reaches the document
 * through a route no gate models. The CSP is the statement the browser can act
 * on (D45(b)); this file checks that it is emitted, that it is emitted *first*,
 * and — the part that actually rots — that its host allowlist has not drifted
 * from the one the source gate keeps.
 *
 * **What this cannot check.** That the policy does not break a real export.
 * A string assertion passes just as happily against a policy that blocks the
 * slide runtime, so the shape checks below are necessary and not sufficient;
 * the documents were opened in a browser during the change (nine paths, zero
 * violations, plus the standalone export from `file://`, and PDF/PNG bytes
 * identical to the pre-CSP build). Re-run that by hand when the policy changes.
 *
 * Run with: node --test tests/export-csp.test.js
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RENDER_PATHS, buildAllRenderPaths } from '../server/render-paths.js';
import {
  THIRD_PARTY_ORIGINS,
  HEADER_ONLY_DIRECTIVES,
  documentCspDirectives,
  buildDocumentCsp,
} from '../server/utils/document-csp.js';
import { closePuppeteerBrowser } from '../server/utils/puppeteer-browser.js';
import { initSanitizer } from '../shared/sanitize.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

await initSanitizer();
after(closePuppeteerBrowser);

const documents = await buildAllRenderPaths(repoRoot, {
  id: 'd',
  title: 'T',
  theme: 'default',
  slides: [
    {
      id: 'a',
      type: 'content-slide',
      content: { title: 'T', body: 'Plain text is enough for a head check.' },
    },
  ],
});

const CSP_META =
  /<meta http-equiv="Content-Security-Policy" content="([^"]+)"\s*\/>/;

test('every render path emits the policy', () => {
  assert.equal(
    Object.keys(documents).length,
    RENDER_PATHS.length,
    'buildAllRenderPaths skipped a path',
  );
  const missing = Object.entries(documents)
    .filter(([, html]) => !CSP_META.test(html))
    .map(([name]) => name);
  assert.deepEqual(
    missing,
    [],
    'a render path built a document without the CSP meta. buildDocumentHead() ' +
      'emits it for every path by default — a path that opted out did so ' +
      'deliberately, and the reason belongs at that call site.',
  );
});

test('the policy precedes anything that can load', () => {
  // A CSP meta governs only what follows it. Charset has to be first (it must
  // land in the first 1024 bytes); the policy comes straight after, before any
  // <link>, <style>, <script> or <img>.
  for (const [name, html] of Object.entries(documents)) {
    const head = html.slice(0, html.indexOf('</head>'));
    const cspAt = head.search(CSP_META);
    const loaderAt = head.search(/<(?:link|style|script|img)\b/i);
    assert.ok(cspAt >= 0, `${name}: no CSP meta`);
    if (loaderAt >= 0) {
      assert.ok(
        cspAt < loaderAt,
        `${name}: something loadable precedes the CSP meta, so the policy ` +
          'does not govern it',
      );
    }
  }
});

test('the policy is identical across paths', () => {
  // One policy, decided in one module. A path that tuned its own would be a
  // second vocabulary for the same rule.
  const policies = new Set(
    Object.values(documents).map((html) => html.match(CSP_META)[1]),
  );
  assert.equal(policies.size, 1, 'render paths disagree about the policy');
  // The emitted policy is HTML-escaped in the attribute; ours contains no
  // characters that escape, so it must come back byte-for-byte.
  assert.equal([...policies][0], buildDocumentCsp());
});

test('default-src is none, so a new fetch kind fails closed', () => {
  assert.deepEqual(documentCspDirectives()['default-src'], ["'none'"]);
});

test('the code directives name exactly the declared origins', () => {
  const directives = documentCspDirectives();
  for (const directive of [
    'script-src',
    'style-src',
    'font-src',
    'frame-src',
  ]) {
    const declared = THIRD_PARTY_ORIGINS.filter((o) =>
      o.directives.includes(directive),
    ).map((o) => o.origin);
    const emitted = directives[directive].filter((s) =>
      s.startsWith('https://'),
    );
    assert.deepEqual(
      emitted,
      declared,
      `${directive} names hosts THIRD_PARTY_ORIGINS does not declare, or ` +
        'drops one it does. Every host is a decision recorded in ' +
        'docs/reference/no-third-party-origins.md § The carve-outs.',
    );
  }
});

test('every declared origin carries a reason and a directive', () => {
  for (const entry of THIRD_PARTY_ORIGINS) {
    assert.match(
      entry.origin,
      /^https:\/\/[a-z0-9.-]+$/,
      `${entry.origin} is not a bare https origin`,
    );
    assert.ok(
      entry.directives.length > 0,
      `${entry.origin} feeds no directive, so it is not doing anything`,
    );
    assert.ok(
      entry.reason && entry.reason.length > 40,
      `${entry.origin} has no reason. An origin in this list is a decision ` +
        'about the rule, and a decision has an author.',
    );
  }
});

test('no wildcard host survives in a code directive', () => {
  // `img-src`/`media-src`/`connect-src` are deliberately permissive — a deck
  // references content on hosts Deckyard never sees. The directives that decide
  // what *executes* may not be, and `https:` there would silently undo the
  // whole policy.
  const directives = documentCspDirectives();
  for (const directive of [
    'script-src',
    'style-src',
    'font-src',
    'frame-src',
  ]) {
    assert.ok(
      !directives[directive].some((s) => s === 'https:' || s === '*'),
      `${directive} allows any host, which makes the allowlist decorative`,
    );
  }
});

test('the header-only directives are absent, and say why', () => {
  const policy = buildDocumentCsp();
  for (const [directive, reason] of Object.entries(HEADER_ONLY_DIRECTIVES)) {
    assert.ok(
      !policy.includes(directive),
      `${directive} is ignored in meta form; emitting it reads as protection ` +
        'that is not there',
    );
    assert.ok(
      reason && reason.length > 40,
      `${directive} is omitted without a recorded reason`,
    );
  }
});

test('the emitted host list matches the source gate, host for host', async () => {
  // The drift this exists to stop: vendoring hls.js should delete one entry
  // from the source gate's allowlist *and* narrow the policy, in one commit.
  // Reading the other gate's file rather than duplicating its list is what
  // makes "they disagree" a failure instead of a thing nobody notices.
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(
    path.join(repoRoot, 'tests', 'no-third-party-origins.test.js'),
    'utf8',
  );
  const allowlist = src.slice(
    src.indexOf('const ALLOWED = ['),
    src.indexOf('/** @returns {Promise<string[]>}'),
  );
  const cdnHosts = new Set(
    [...allowlist.matchAll(/url:\s*'https:\/\/([a-z0-9.-]+)/gi)].map((m) =>
      m[1].toLowerCase(),
    ),
  );
  // The Swagger UI shell is on jsDelivr too, and it is not a render path — so
  // the claim is one-directional: every CDN host the policy allows must still
  // be an allowed exception in the source gate.
  const scriptSources = documentCspDirectives()['script-src'];
  const policyCdnHosts = scriptSources
    .filter((s) => s.startsWith('https://'))
    .map((s) => s.replace('https://', ''))
    .filter((host) => /^(cdn\.|cdnjs|unpkg|jsdelivr)/.test(host));

  for (const host of policyCdnHosts) {
    assert.ok(
      cdnHosts.has(host),
      `the policy allows scripts from ${host}, but ` +
        'tests/no-third-party-origins.test.js no longer allows it in the ' +
        'source. Vendor it and drop it from THIRD_PARTY_ORIGINS too.',
    );
  }
});
