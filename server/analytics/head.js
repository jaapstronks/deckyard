function boolEnv(key, defaultValue = false) {
  const v = process.env[key];
  if (v == null) return !!defaultValue;
  const s = String(v).trim().toLowerCase();
  if (!s) return !!defaultValue;
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function strEnv(key) {
  const v = process.env[key];
  const s = String(v == null ? '' : v).trim();
  return s || '';
}

function escAttr(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

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
  const b = String(base || '').trim().replace(/\/+$/, '');
  const p = String(path || '').trim().replace(/^\/+/, '');
  if (!b || !p) return '';
  return `${b}/${p}`;
}

// ============================================================
// Provider HTML generators
// ============================================================

function buildMatomoHtml({ url, siteId, disableCookies = true, requireConsent = false, trackLinks = true }) {
  const safeBase = escAttr(url);
  const safeSiteId = escAttr(siteId);
  return [
    '<!-- Analytics: Matomo -->',
    '<script>',
    '  var _paq = window._paq = window._paq || [];',
    requireConsent ? "  _paq.push(['requireConsent']);" : '',
    disableCookies ? "  _paq.push(['disableCookies']);" : '',
    trackLinks ? "  _paq.push(['trackPageView']);\n  _paq.push(['enableLinkTracking']);" : "  _paq.push(['trackPageView']);",
    "  (function() {",
    `    var u="${safeBase}/";`,
    "    _paq.push(['setTrackerUrl', u+'matomo.php']);",
    `    _paq.push(['setSiteId', '${safeSiteId}']);`,
    '    var d=document, g=d.createElement("script"), s=d.getElementsByTagName("script")[0];',
    '    g.async=true; g.src=u+"matomo.js"; s.parentNode.insertBefore(g,s);',
    '  })();',
    '</script>',
    '<!-- End Analytics: Matomo -->',
  ].filter(Boolean).join('\n');
}

function buildPlausibleHtml({ domain, url }) {
  const baseUrl = url || 'https://plausible.io';
  const scriptSrc = joinUrl(baseUrl, '/js/script.js');
  return [
    '<!-- Analytics: Plausible -->',
    `<script defer data-domain="${escAttr(domain)}" src="${escAttr(scriptSrc)}"></script>`,
    '<!-- End Analytics: Plausible -->',
  ].join('\n');
}

function buildUmamiHtml({ websiteId, url }) {
  const baseUrl = url || 'https://cloud.umami.is';
  const scriptSrc = joinUrl(baseUrl, '/script.js');
  return [
    '<!-- Analytics: Umami -->',
    `<script defer src="${escAttr(scriptSrc)}" data-website-id="${escAttr(websiteId)}"></script>`,
    '<!-- End Analytics: Umami -->',
  ].join('\n');
}

/**
 * Validate GA4 measurement ID format.
 * Must match G-XXXXXXXXXX pattern (G- followed by alphanumeric).
 */
function isValidGa4Id(id) {
  return /^G-[A-Z0-9]+$/i.test(String(id || ''));
}

function buildGa4Html({ measurementId }) {
  // Strict validation to prevent any injection
  if (!isValidGa4Id(measurementId)) {
    return '';
  }
  const safeId = escAttr(measurementId);
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
  const safeId = escAttr(containerId);
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
 * Build a string of HTML tags to inject into <head>.
 *
 * This intentionally stays dependency-free and "preset-based":
 * - Prefer simple env-based config (GTM / Matomo / Plausible / Umami / GA4)
 * - Provide an escape hatch for custom HTML snippets (raw or base64)
 * - Optionally accept settings object from admin UI (overrides env vars)
 *
 * Priority order: settings → env vars → disabled
 *
 * NOTE: A raw HTML snippet is inherently powerful. Treat env vars as
 * operator-controlled input (not user-provided) and document accordingly.
 *
 * @param {Object} options
 * @param {string} options.context - 'app' | 'published' | 'embed' | 'export'
 * @param {boolean} options.sandbox - Whether running in sandbox mode
 * @param {Object} options.settings - Optional app settings object (analytics.externalProviders)
 */
export function analyticsHeadHtml({
  context = 'app', // 'app' | 'published' | 'embed' | 'export'
  sandbox = false,
  settings = null,
} = {}) {
  if (boolEnv('DISABLE_ANALYTICS', false)) return '';
  if (sandbox && !boolEnv('ANALYTICS_ALLOW_IN_SANDBOX', false)) return '';
  if (context === 'embed' && !boolEnv('ANALYTICS_INCLUDE_EMBEDS', false))
    return '';
  if (context === 'export' && !boolEnv('ANALYTICS_INCLUDE_EXPORTS', false))
    return '';

  const out = [];
  const providers = settings?.analytics?.externalProviders || null;

  // Escape hatch: custom snippet (env vars only, not UI-configurable)
  const customB64 = safeB64ToUtf8(strEnv('ANALYTICS_HEAD_HTML_B64'));
  const customRaw = strEnv('ANALYTICS_HEAD_HTML');
  const custom = customB64 || customRaw;
  if (custom) {
    out.push(`<!-- Analytics: custom head HTML -->\n${custom}`);
  }

  // Google Tag Manager (GTM) - env vars only
  const gtmId = strEnv('GTM_CONTAINER_ID');
  if (gtmId) {
    out.push(buildGtmHtml({ containerId: gtmId }));
  }

  // Matomo: settings → env vars
  const matomoSettings = providers?.matomo;
  if (matomoSettings?.enabled && matomoSettings?.url && matomoSettings?.siteId) {
    // Use settings-based config
    out.push(buildMatomoHtml({
      url: matomoSettings.url.replace(/\/+$/, ''),
      siteId: matomoSettings.siteId,
      disableCookies: matomoSettings.disableCookies !== false,
      requireConsent: matomoSettings.requireConsent === true,
      trackLinks: true,
    }));
  } else {
    // Fall back to env vars
    const matomoUrl = strEnv('MATOMO_URL').replace(/\/+$/, '');
    const matomoSiteId = strEnv('MATOMO_SITE_ID');
    if (matomoUrl && matomoSiteId) {
      out.push(buildMatomoHtml({
        url: matomoUrl,
        siteId: matomoSiteId,
        disableCookies: boolEnv('MATOMO_DISABLE_COOKIES', true),
        requireConsent: boolEnv('MATOMO_REQUIRE_CONSENT', false),
        trackLinks: boolEnv('MATOMO_TRACK_LINKS', true),
      }));
    }
  }

  // Plausible: settings → env vars
  const plausibleSettings = providers?.plausible;
  if (plausibleSettings?.enabled && plausibleSettings?.domain) {
    // Use settings-based config
    out.push(buildPlausibleHtml({
      domain: plausibleSettings.domain,
      url: plausibleSettings.url || '',
    }));
  } else {
    // Fall back to env vars
    const plausibleDomain = strEnv('PLAUSIBLE_DOMAIN');
    if (plausibleDomain) {
      out.push(buildPlausibleHtml({
        domain: plausibleDomain,
        url: strEnv('PLAUSIBLE_URL'),
      }));
    }
  }

  // Umami: settings → env vars
  const umamiSettings = providers?.umami;
  if (umamiSettings?.enabled && umamiSettings?.websiteId) {
    // Use settings-based config
    out.push(buildUmamiHtml({
      websiteId: umamiSettings.websiteId,
      url: umamiSettings.url || '',
    }));
  } else {
    // Fall back to env vars
    const umamiWebsiteId = strEnv('UMAMI_WEBSITE_ID');
    if (umamiWebsiteId) {
      out.push(buildUmamiHtml({
        websiteId: umamiWebsiteId,
        url: strEnv('UMAMI_URL'),
      }));
    }
  }

  // Google Analytics 4: settings → env vars
  const ga4Settings = providers?.googleAnalytics;
  if (ga4Settings?.enabled && ga4Settings?.measurementId) {
    // Use settings-based config
    out.push(buildGa4Html({
      measurementId: ga4Settings.measurementId,
    }));
  } else {
    // Fall back to env vars
    const ga4MeasurementId = strEnv('GA4_MEASUREMENT_ID');
    if (ga4MeasurementId) {
      out.push(buildGa4Html({
        measurementId: ga4MeasurementId,
      }));
    }
  }

  return out.length ? out.join('\n') + '\n' : '';
}
