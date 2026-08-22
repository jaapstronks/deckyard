/**
 * Third-party analytics identifiers cannot break out of the head markup (B101).
 *
 * `analyticsHeadHtml()` lands on the app shell — since D56 its only caller, a
 * published deck and an embed being first-party-only — so an admin-writable
 * provider id that escapes its quoting context is stored XSS against everyone
 * who opens the operator's own surface. The Matomo `siteId` did
 * exactly that: it was HTML-escaped by a helper that did not escape `'`, and
 * then interpolated into `_paq.push(['setSiteId', '…'])` — inside a `<script>`,
 * where HTML entities are not decoded anyway.
 *
 * The fix is charset validation at both ends (`server/analytics/provider-ids.js`):
 * the write path stores `''` for an id that is not spelled the way its provider
 * spells it, and the render path emits nothing for a provider whose values fail
 * the same check — which also covers the env-var path, that bypasses the
 * settings normalizer entirely.
 *
 * The write path's own round-trip lives in tests/pg/settings.pgtest.js.
 *
 * Run with: node --test tests/analytics-head-provider-ids.test.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { analyticsHeadHtml } from '../server/analytics/head.js';
import {
  isEmbeddableUrl,
  isValidProviderId,
  normalizeProviderId,
} from '../server/analytics/provider-ids.js';

/** Values that break out of an attribute, a JS string literal, or a tag. */
const HOSTILE = [
  "x',alert(1),'",
  'x"onload="alert(1)',
  'x</script><script>alert(1)</script>',
  'x\nalert(1)',
  "'+alert(1)+'",
];

/** Every env var analyticsHeadHtml reads, so the test starts from a clean slate. */
const ANALYTICS_ENV = [
  'DISABLE_ANALYTICS',
  'ANALYTICS_ALLOW_IN_SANDBOX',
  'ANALYTICS_HEAD_HTML',
  'ANALYTICS_HEAD_HTML_B64',
  'GTM_CONTAINER_ID',
  'MATOMO_URL',
  'MATOMO_SITE_ID',
  'MATOMO_DISABLE_COOKIES',
  'MATOMO_REQUIRE_CONSENT',
  'MATOMO_TRACK_LINKS',
  'PLAUSIBLE_DOMAIN',
  'PLAUSIBLE_URL',
  'UMAMI_WEBSITE_ID',
  'UMAMI_URL',
  'GA4_MEASUREMENT_ID',
];

let savedEnv = {};

beforeEach(() => {
  savedEnv = {};
  for (const k of ANALYTICS_ENV) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ANALYTICS_ENV) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

/** Head HTML for a settings-configured provider block. */
function headFor(externalProviders) {
  return analyticsHeadHtml({
    settings: { analytics: { externalProviders } },
  });
}

/** The providers, each with a legitimate value set and the field under attack. */
const PROVIDERS = [
  {
    name: 'matomo',
    good: { enabled: true, url: 'https://matomo.example.com', siteId: '7' },
    fields: ['siteId', 'url'],
    marker: 'setSiteId',
  },
  {
    name: 'plausible',
    good: { enabled: true, domain: 'decks.example.com', url: '' },
    fields: ['domain', 'url'],
    marker: 'data-domain',
  },
  {
    name: 'umami',
    good: {
      enabled: true,
      websiteId: '3f2a0c1e-6b4d-4f10-9a2e-5c7d8e9f0a1b',
      url: '',
    },
    fields: ['websiteId', 'url'],
    marker: 'data-website-id',
  },
  {
    name: 'googleAnalytics',
    good: { enabled: true, measurementId: 'G-ABC1234567' },
    fields: ['measurementId'],
    marker: 'gtag',
  },
];

describe('analytics head: provider ids are validated, not escaped', () => {
  it('emits each provider for legitimate values', () => {
    for (const p of PROVIDERS) {
      const html = headFor({ [p.name]: p.good });
      assert.match(
        html,
        new RegExp(p.marker),
        `${p.name} must still render for a legitimate configuration`,
      );
    }
  });

  it('emits nothing for a hostile value in any provider field', () => {
    for (const p of PROVIDERS) {
      for (const field of p.fields) {
        for (const evil of HOSTILE) {
          const html = headFor({ [p.name]: { ...p.good, [field]: evil } });
          assert.equal(
            html.includes(p.marker),
            false,
            `${p.name}.${field} = ${JSON.stringify(evil)} still rendered`,
          );
          assert.equal(
            html.includes('alert(1)'),
            false,
            `${p.name}.${field} = ${JSON.stringify(evil)} leaked into the head`,
          );
        }
      }
    }
  });

  it('never emits a raw quote, angle bracket or newline from a provider value', () => {
    // The bug's exact shape: a `'` reaching the Matomo script literal.
    for (const evil of HOSTILE) {
      const html = headFor({
        matomo: { enabled: true, url: 'https://m.example.com', siteId: evil },
      });
      assert.equal(html.trim(), '');
    }
    // And its escaped-but-still-wrong sibling: entities inside <script> would
    // corrupt a legitimate id rather than contain a hostile one.
    const ok = headFor({
      matomo: { enabled: true, url: 'https://m.example.com', siteId: '42' },
    });
    assert.match(ok, /_paq\.push\(\['setSiteId', '42'\]\)/);
    assert.equal(ok.includes('&amp;'), false);
  });

  it('validates the env-var path too, which bypasses the settings normalizer', () => {
    process.env.MATOMO_URL = 'https://m.example.com';
    process.env.MATOMO_SITE_ID = "1',alert(1),'";
    assert.equal(analyticsHeadHtml().includes('setSiteId'), false);

    process.env.MATOMO_SITE_ID = '1';
    assert.match(analyticsHeadHtml(), /setSiteId/);

    process.env.GTM_CONTAINER_ID = "GTM-1',alert(1),'";
    assert.equal(analyticsHeadHtml().includes('alert(1)'), false);

    process.env.PLAUSIBLE_DOMAIN = 'a.example.com';
    process.env.PLAUSIBLE_URL = "https://p.example.com/'+alert(1)+'";
    assert.equal(analyticsHeadHtml().includes('data-domain'), false);
  });

  it('leaves no blank line where a refused provider would have been', () => {
    const html = headFor({
      matomo: { enabled: true, url: 'https://m.example.com', siteId: "x'" },
      googleAnalytics: { enabled: true, measurementId: 'G-ABC1234567' },
    });
    assert.match(html, /gtag/);
    assert.equal(html.includes('\n\n'), false);
  });
});

describe('provider-id patterns', () => {
  it('accepts the documented spellings', () => {
    assert.ok(isValidProviderId('matomoSiteId', '12'));
    assert.ok(isValidProviderId('umamiWebsiteId', 'abc-123'));
    assert.ok(isValidProviderId('plausibleDomain', 'a.example.com'));
    // Plausible documents a comma-separated list of domains.
    assert.ok(isValidProviderId('plausibleDomain', 'a.example.com,b.test'));
    // …but the list is bounded: the value stays length-capped as a whole.
    assert.ok(
      isValidProviderId('plausibleDomain', Array(32).fill('a.test').join(',')),
    );
    assert.equal(
      isValidProviderId('plausibleDomain', Array(33).fill('a.test').join(',')),
      false,
    );
    assert.ok(isValidProviderId('ga4MeasurementId', 'G-ABC1234567'));
    assert.ok(isValidProviderId('gtmContainerId', 'GTM-ABC1234'));
  });

  it('rejects anything that could carry a quote or a tag', () => {
    for (const kind of [
      'matomoSiteId',
      'umamiWebsiteId',
      'plausibleDomain',
      'ga4MeasurementId',
      'gtmContainerId',
    ]) {
      for (const evil of HOSTILE) {
        assert.equal(isValidProviderId(kind, evil), false, `${kind}: ${evil}`);
        assert.equal(normalizeProviderId(kind, evil), '');
      }
    }
  });

  it('throws on an unknown identifier kind rather than passing it through', () => {
    assert.throws(() => isValidProviderId('nope', 'x'), /unknown provider id/);
  });

  it('rejects URLs that parse but still carry an apostrophe', () => {
    // new URL() leaves `'` unencoded in a path — the reason parsing alone is
    // not the check.
    assert.equal(isEmbeddableUrl("https://x.example.com/'+alert(1)+'"), false);
    assert.equal(isEmbeddableUrl('javascript:alert(1)'), false);
    assert.equal(isEmbeddableUrl('https://x.example.com/matomo'), true);
  });
});
