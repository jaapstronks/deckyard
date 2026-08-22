import { envBool, envStr } from '../config/utils.js';
import { escapeHtml } from '../../shared/slide-types/helpers.js';
import { isEmbeddableUrl, isValidProviderId } from './provider-ids.js';

function safeB64ToUtf8(s) {
  const raw = String(s || '').trim();
  if (!raw) return '';
  try {
    const buf = Buffer.from(raw, 'base64');
    const out = buf.toString('utf8');
    return String(out || '').trim();
  } catch {
    return '';
  }
}

function joinUrl(base, path) {
  const b = String(base || '')
    .trim()
    .replace(/\/+$/, '');
  const p = String(path || '')
    .trim()
    .replace(/^\/+/, '');
  if (!b || !p) return '';
  return `${b}/${p}`;
}

/** The origin GA4 and GTM load their tag script from. */
const GOOGLE_TAG_ORIGIN = 'https://www.googletagmanager.com';

/**
 * The origin of a provider base URL, for the CSP `script-src` allowlist.
 * Returns '' for anything `new URL` refuses — the provider builder refused
 * such a value too (isEmbeddableUrl), so no HTML references it either.
 * @param {string} url
 * @returns {string}
 */
function originOf(url) {
  try {
    return new URL(String(url || '')).origin;
  } catch {
    return '';
  }
}

/**
 * Script origins named by static `<script src="…">` tags in the operator's
 * custom head HTML. A script the snippet inserts *dynamically* (the
 * Matomo/GTM createElement pattern) is invisible to this scan — an operator
 * whose raw-HTML snippet does that declares the origin in
 * `server/utils/document-csp.js` (the fork seam) or uses a preset provider,
 * which report their origins themselves.
 * @param {string} html
 * @returns {string[]}
 */
function customSnippetScriptOrigins(html) {
  return [
    ...String(html || '').matchAll(
      /<script\b[^>]*\bsrc\s*=\s*["']?(https?:\/\/[^"'\s>]+)/gi,
    ),
  ]
    .map((m) => originOf(m[1]))
    .filter(Boolean);
}

// ============================================================
// Provider HTML generators
// ============================================================

function buildMatomoHtml({
  url,
  siteId,
  disableCookies = true,
  requireConsent = false,
  trackLinks = true,
}) {
  // `url` and `siteId` land inside a <script> block, where HTML escaping is
  // both wrong (entities are not decoded there) and insufficient. Charset
  // validation is the containment; a value that fails it emits no provider.
  if (!isEmbeddableUrl(url) || !isValidProviderId('matomoSiteId', siteId)) {
    return '';
  }
  const safeBase = String(url);
  const safeSiteId = String(siteId);
  return [
    '<!-- Analytics: Matomo -->',
    '<script>',
    '  var _paq = window._paq = window._paq || [];',
    requireConsent ? "  _paq.push(['requireConsent']);" : '',
    disableCookies ? "  _paq.push(['disableCookies']);" : '',
    trackLinks
      ? "  _paq.push(['trackPageView']);\n  _paq.push(['enableLinkTracking']);"
      : "  _paq.push(['trackPageView']);",
    '  (function() {',
    `    var u="${safeBase}/";`,
    "    _paq.push(['setTrackerUrl', u+'matomo.php']);",
    `    _paq.push(['setSiteId', '${safeSiteId}']);`,
    '    var d=document, g=d.createElement("script"), s=d.getElementsByTagName("script")[0];',
    '    g.async=true; g.src=u+"matomo.js"; s.parentNode.insertBefore(g,s);',
    '  })();',
    '</script>',
    '<!-- End Analytics: Matomo -->',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildPlausibleHtml({ domain, url }) {
  const baseUrl = url || 'https://plausible.io';
  if (
    !isValidProviderId('plausibleDomain', domain) ||
    !isEmbeddableUrl(baseUrl)
  ) {
    return '';
  }
  const scriptSrc = joinUrl(baseUrl, '/js/script.js');
  return [
    '<!-- Analytics: Plausible -->',
    `<script defer data-domain="${escapeHtml(domain)}" src="${escapeHtml(scriptSrc)}"></script>`,
    '<!-- End Analytics: Plausible -->',
  ].join('\n');
}

function buildUmamiHtml({ websiteId, url }) {
  const baseUrl = url || 'https://cloud.umami.is';
  if (
    !isValidProviderId('umamiWebsiteId', websiteId) ||
    !isEmbeddableUrl(baseUrl)
  ) {
    return '';
  }
  const scriptSrc = joinUrl(baseUrl, '/script.js');
  return [
    '<!-- Analytics: Umami -->',
    `<script defer src="${escapeHtml(scriptSrc)}" data-website-id="${escapeHtml(websiteId)}"></script>`,
    '<!-- End Analytics: Umami -->',
  ].join('\n');
}

function buildGa4Html({ measurementId }) {
  // The pattern that every provider here now follows: refuse rather than escape.
  if (!isValidProviderId('ga4MeasurementId', measurementId)) {
    return '';
  }
  const safeId = String(measurementId);
  return [
    '<!-- Analytics: Google Analytics 4 -->',
    `<script async src="https://www.googletagmanager.com/gtag/js?id=${safeId}"></script>`,
    '<script>',
    '  window.dataLayer = window.dataLayer || [];',
    '  function gtag(){dataLayer.push(arguments);}',
    "  gtag('js', new Date());",
    `  gtag('config', '${safeId}');`,
    '</script>',
    '<!-- End Analytics: Google Analytics 4 -->',
  ].join('\n');
}

function buildGtmHtml({ containerId }) {
  if (!isValidProviderId('gtmContainerId', containerId)) {
    return '';
  }
  const safeId = String(containerId);
  return [
    '<!-- Analytics: Google Tag Manager -->',
    '<script>',
    "(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':",
    "new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],",
    "j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=",
    "'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);",
    `})(window,document,'script','dataLayer','${safeId}');`,
    '</script>',
    '<!-- End Analytics: Google Tag Manager -->',
  ].join('\n');
}

/**
 * The enabled providers, each as the head HTML it emits plus the external
 * origins that HTML loads *code* from. One walk of the enablement/priority
 * branches feeds both `analyticsHeadHtml` and `analyticsScriptOrigins`, so
 * the CSP allowlist and the emitted tags cannot drift apart (the B102
 * lesson: one computation, two projections).
 *
 * Priority order per provider: settings → env vars → disabled.
 *
 * @param {Object} options
 * @param {string} options.context - 'app' | 'published' | 'embed' | 'export'
 * @param {boolean} options.sandbox - Whether running in sandbox mode
 * @param {Object} options.settings - Optional app settings object (analytics.externalProviders)
 * @returns {Array<{html: string, scriptOrigins: string[]}>}
 */
function collectAnalyticsHead({
  context = 'app', // 'app' | 'published' | 'embed' | 'export'
  sandbox = false,
  settings = null,
} = {}) {
  if (envBool('DISABLE_ANALYTICS', false)) return [];
  if (sandbox && !envBool('ANALYTICS_ALLOW_IN_SANDBOX', false)) return [];
  if (context === 'embed' && !envBool('ANALYTICS_INCLUDE_EMBEDS', false))
    return [];
  if (context === 'export' && !envBool('ANALYTICS_INCLUDE_EXPORTS', false))
    return [];

  const entries = [];
  // A provider whose values failed validation builds '' — skip it entirely,
  // so a refused provider contributes neither a blank line nor an origin.
  const push = (html, scriptOrigins) => {
    if (html)
      entries.push({ html, scriptOrigins: scriptOrigins.filter(Boolean) });
  };
  const providers = settings?.analytics?.externalProviders || null;

  // Escape hatch: custom snippet (env vars only, not UI-configurable)
  const customB64 = safeB64ToUtf8(envStr('ANALYTICS_HEAD_HTML_B64'));
  const customRaw = envStr('ANALYTICS_HEAD_HTML');
  const custom = customB64 || customRaw;
  if (custom) {
    push(
      `<!-- Analytics: custom head HTML -->\n${custom}`,
      customSnippetScriptOrigins(custom),
    );
  }

  // Google Tag Manager (GTM) - env vars only
  const gtmId = envStr('GTM_CONTAINER_ID');
  if (gtmId) {
    push(buildGtmHtml({ containerId: gtmId }), [GOOGLE_TAG_ORIGIN]);
  }

  // Matomo: settings → env vars
  const matomoSettings = providers?.matomo;
  if (
    matomoSettings?.enabled &&
    matomoSettings?.url &&
    matomoSettings?.siteId
  ) {
    // Use settings-based config
    const url = matomoSettings.url.replace(/\/+$/, '');
    push(
      buildMatomoHtml({
        url,
        siteId: matomoSettings.siteId,
        disableCookies: matomoSettings.disableCookies !== false,
        requireConsent: matomoSettings.requireConsent === true,
        trackLinks: true,
      }),
      [originOf(url)],
    );
  } else {
    // Fall back to env vars
    const matomoUrl = envStr('MATOMO_URL').replace(/\/+$/, '');
    const matomoSiteId = envStr('MATOMO_SITE_ID');
    if (matomoUrl && matomoSiteId) {
      push(
        buildMatomoHtml({
          url: matomoUrl,
          siteId: matomoSiteId,
          disableCookies: envBool('MATOMO_DISABLE_COOKIES', true),
          requireConsent: envBool('MATOMO_REQUIRE_CONSENT', false),
          trackLinks: envBool('MATOMO_TRACK_LINKS', true),
        }),
        [originOf(matomoUrl)],
      );
    }
  }

  // Plausible: settings → env vars
  const plausibleSettings = providers?.plausible;
  if (plausibleSettings?.enabled && plausibleSettings?.domain) {
    // Use settings-based config
    const url = plausibleSettings.url || '';
    push(buildPlausibleHtml({ domain: plausibleSettings.domain, url }), [
      originOf(url || 'https://plausible.io'),
    ]);
  } else {
    // Fall back to env vars
    const plausibleDomain = envStr('PLAUSIBLE_DOMAIN');
    if (plausibleDomain) {
      const url = envStr('PLAUSIBLE_URL');
      push(buildPlausibleHtml({ domain: plausibleDomain, url }), [
        originOf(url || 'https://plausible.io'),
      ]);
    }
  }

  // Umami: settings → env vars
  const umamiSettings = providers?.umami;
  if (umamiSettings?.enabled && umamiSettings?.websiteId) {
    // Use settings-based config
    const url = umamiSettings.url || '';
    push(buildUmamiHtml({ websiteId: umamiSettings.websiteId, url }), [
      originOf(url || 'https://cloud.umami.is'),
    ]);
  } else {
    // Fall back to env vars
    const umamiWebsiteId = envStr('UMAMI_WEBSITE_ID');
    if (umamiWebsiteId) {
      const url = envStr('UMAMI_URL');
      push(buildUmamiHtml({ websiteId: umamiWebsiteId, url }), [
        originOf(url || 'https://cloud.umami.is'),
      ]);
    }
  }

  // Google Analytics 4: settings → env vars
  const ga4Settings = providers?.googleAnalytics;
  if (ga4Settings?.enabled && ga4Settings?.measurementId) {
    // Use settings-based config
    push(buildGa4Html({ measurementId: ga4Settings.measurementId }), [
      GOOGLE_TAG_ORIGIN,
    ]);
  } else {
    // Fall back to env vars
    const ga4MeasurementId = envStr('GA4_MEASUREMENT_ID');
    if (ga4MeasurementId) {
      push(buildGa4Html({ measurementId: ga4MeasurementId }), [
        GOOGLE_TAG_ORIGIN,
      ]);
    }
  }

  return entries;
}

/**
 * Build a string of HTML tags to inject into <head>.
 *
 * This intentionally stays dependency-free and "preset-based":
 * - Prefer simple env-based config (GTM / Matomo / Plausible / Umami / GA4)
 * - Provide an escape hatch for custom HTML snippets (raw or base64)
 * - Optionally accept settings object from admin UI (overrides env vars)
 *
 * NOTE: A raw HTML snippet is inherently powerful. Treat env vars as
 * operator-controlled input (not user-provided) and document accordingly.
 *
 * @param {Object} [options] - See {@link collectAnalyticsHead}.
 * @returns {string}
 */
export function analyticsHeadHtml(options = {}) {
  const emitted = collectAnalyticsHead(options).map((entry) => entry.html);
  return emitted.length ? emitted.join('\n') + '\n' : '';
}

/**
 * The external origins the emitted analytics HTML loads script from, for the
 * app-shell CSP's `script-src` (server/utils/document-csp.js,
 * buildAppShellCspHeader). Empty whenever {@link analyticsHeadHtml} emits
 * nothing, by construction: both are projections of the same provider walk.
 *
 * @param {Object} [options] - See {@link collectAnalyticsHead}.
 * @returns {string[]} Deduplicated origins, e.g. ['https://plausible.io'].
 */
export function analyticsScriptOrigins(options = {}) {
  const origins = collectAnalyticsHead(options).flatMap(
    (entry) => entry.scriptOrigins,
  );
  return [...new Set(origins)];
}
