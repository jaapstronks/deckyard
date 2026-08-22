/**
 * The app shell carries the policy as a **response header** (D53(ii) / B124).
 *
 * `tests/served-surface-csp-header.test.js` covers `/p/…` and `/embed/…`;
 * this file covers the third served surface — the shell (`/`, the auth pages,
 * the editor and presenter routes, the share-link viewer), which is where the
 * session cookie lives and which carried no policy at all before B124.
 *
 * The design decision this file pins: the shell policy is the **document
 * policy plus the analytics origins**, not a second policy source and not a
 * nonce policy. `'unsafe-inline'` is the recorded answer to the B124 design
 * question — a nonce cannot cover the operator's raw analytics HTML
 * (`ANALYTICS_HEAD_HTML`), and one nonce in `script-src` makes browsers
 * ignore `'unsafe-inline'` for everything else, so a partial nonce breaks
 * un-nonced fragments rather than merely not covering them. The full
 * rationale lives on `buildAppShellCspHeader` in
 * `server/utils/document-csp.js`.
 *
 * Run with: node --test tests/app-shell-csp-header.test.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildDocumentCsp,
  documentCspDirectives,
  appShellCspDirectives,
  buildAppShellCspHeader,
} from '../server/utils/document-csp.js';
import {
  analyticsHeadHtml,
  analyticsScriptOrigins,
} from '../server/analytics/head.js';
import { applySecurityHeaders } from '../server/utils/security-headers.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const read = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8');

describe('the app-shell policy derives from the document policy', () => {
  it('is the document policy plus frame-ancestors, when no analytics is configured', () => {
    assert.equal(
      buildAppShellCspHeader(),
      `${buildDocumentCsp()}; frame-ancestors 'none'`,
      'with nothing to add, the shell header must be byte-identical to the ' +
        'document policy plus frame-ancestors — a second, drifting policy ' +
        'is worse than none',
    );
  });

  it('adds analytics origins to script-src, and touches nothing else', () => {
    const origin = 'https://plausible.example';
    const shell = appShellCspDirectives({ analyticsScriptOrigins: [origin] });
    const doc = documentCspDirectives();

    assert.deepEqual(
      shell['script-src'],
      [...doc['script-src'], origin],
      'the analytics origin lands at the end of script-src',
    );
    for (const [directive, sources] of Object.entries(doc)) {
      if (directive === 'script-src') continue;
      assert.deepEqual(
        shell[directive],
        sources,
        `${directive} must not change for an analytics origin — a tag script ` +
          'needs script-src and nothing wider',
      );
    }
    assert.deepEqual(
      Object.keys(shell),
      Object.keys(doc),
      'the shell adds no directives of its own',
    );
  });

  it("records the design answer: 'unsafe-inline', no nonce", () => {
    const header = buildAppShellCspHeader();
    assert.match(header, /script-src[^;]*'unsafe-inline'/);
    assert.ok(
      !header.includes('nonce-'),
      'a nonce here would make browsers ignore unsafe-inline and break every ' +
        'un-nonced fragment (the analytics escape hatch cannot be nonced)',
    );
  });

  it("pins frame-ancestors 'none', agreeing with X-Frame-Options on the shell", () => {
    const set = {};
    applySecurityHeaders(
      { headers: {}, socket: {} },
      { setHeader: (k, v) => (set[k] = v) },
      '/',
    );
    assert.equal(set['X-Frame-Options'], 'DENY');
    assert.match(buildAppShellCspHeader(), /frame-ancestors 'none'$/);
  });
});

describe('the analytics origins are a projection of the emitted HTML', () => {
  // The env escape hatches also feed analyticsHeadHtml; pin them off so this
  // block only exercises the settings path.
  const ANALYTICS_ENV = [
    'DISABLE_ANALYTICS',
    'ANALYTICS_HEAD_HTML',
    'ANALYTICS_HEAD_HTML_B64',
    'GTM_CONTAINER_ID',
    'MATOMO_URL',
    'MATOMO_SITE_ID',
    'PLAUSIBLE_DOMAIN',
    'PLAUSIBLE_URL',
    'UMAMI_WEBSITE_ID',
    'UMAMI_URL',
    'GA4_MEASUREMENT_ID',
  ];
  /** @type {Record<string, string | undefined>} */
  let saved = {};
  beforeEach(() => {
    saved = {};
    for (const key of ANALYTICS_ENV) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });
  afterEach(() => {
    for (const key of ANALYTICS_ENV) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  const settingsWith = (externalProviders) => ({
    analytics: { externalProviders },
  });

  it('an enabled provider yields its script origin alongside its HTML', () => {
    const options = {
      context: 'app',
      settings: settingsWith({
        plausible: { enabled: true, domain: 'decks.example.com' },
        matomo: {
          enabled: true,
          url: 'https://stats.example.com/matomo',
          siteId: '7',
        },
      }),
    };
    assert.match(analyticsHeadHtml(options), /plausible\.io\/js\/script\.js/);
    assert.deepEqual(analyticsScriptOrigins(options).sort(), [
      'https://plausible.io',
      'https://stats.example.com',
    ]);
  });

  it('no providers → no origins, so the header collapses to the document policy', () => {
    const options = { context: 'app', settings: settingsWith({}) };
    assert.equal(analyticsHeadHtml(options), '');
    assert.deepEqual(analyticsScriptOrigins(options), []);
  });

  it('a provider that is refused emits neither HTML nor an origin', () => {
    // A hostile siteId fails provider-id validation, so buildMatomoHtml
    // refuses — the origin must be refused with it, or the policy would
    // allowlist a host no tag actually loads from.
    const options = {
      context: 'app',
      settings: settingsWith({
        matomo: {
          enabled: true,
          url: 'https://stats.example.com',
          siteId: "x',alert(1),'",
        },
      }),
    };
    assert.equal(analyticsHeadHtml(options), '');
    assert.deepEqual(analyticsScriptOrigins(options), []);
  });

  it('the custom-HTML escape hatch contributes its static script origins', () => {
    process.env.ANALYTICS_HEAD_HTML =
      '<script defer src="https://tag.example.net/t.js"></script>';
    const options = { context: 'app', settings: null };
    assert.match(analyticsHeadHtml(options), /tag\.example\.net/);
    assert.deepEqual(analyticsScriptOrigins(options), [
      'https://tag.example.net',
    ]);
  });
});

describe('both shell routes serve through the CSP-bearing writer', () => {
  it('serveShellHtml requires the policy and sets the header', () => {
    const src = read('server/routes/static/app-shell.js');
    assert.match(
      src,
      /serveShellHtml\(res, \{ html, csp \}\)/,
      'the shell writer takes the policy as a required part of the response — ' +
        'no shell 200 without it',
    );
    assert.ok(
      src.includes("'Content-Security-Policy': csp"),
      'and sets it as the header',
    );
  });

  it('the share-link viewer goes through the same writer', () => {
    const src = read('server/routes/static/share-viewer.js');
    assert.ok(
      src.includes('serveShellHtml(res, shell)'),
      'share-viewer.js must pass the {html, csp} pair from ' +
        'injectSeoDebugAnalytics straight through',
    );
  });
});
