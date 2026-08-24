/**
 * Font preview assets — the three third-party font providers, in one table.
 *
 * A managed font family names a provider (`upload`, `google`, `adobe`,
 * `monotype`) and the identifier that provider needs; previewing it in the
 * browser means putting one asset in the head. That switch stood written twice
 * — `views/settings/tabs/fonts-tab.js` and
 * `views/settings/theme-editor/font-picker.js` — with `font-editor/google-panel.js`
 * carrying a third copy of the Google branch. Each of the three provider URLs
 * lived in two or three places (B150).
 *
 * The copies disagreed on the dedupe id, which is the part that has to match:
 * the same Google stylesheet was requested as `gf-preview-<slug>` by two
 * modules and `google-font-preview-<slug>` by the third, so opening the font
 * editor after the theme editor fetched it a second time. Ids are derived here
 * now, from the provider identity alone, so every surface asks for the same one.
 *
 * Injection itself is `client/lib/dom/head-assets.js`; this module owns only
 * *which* asset a font needs and under which id.
 */

import {
  ensureScript,
  ensureStyle,
  ensureStylesheet,
} from '../dom/head-assets.js';

/**
 * The three third-party font providers. `google` takes a list of family specs
 * (`"Inter"` or `"Inter:wght@400"`), the other two a project id.
 */
const PROVIDER_URL = {
  google: (specs) =>
    `https://fonts.googleapis.com/css2?${specs
      .map((s) => `family=${encodeURIComponent(s)}:wght@400;600;700`)
      .join('&')}&display=swap`,
  adobe: (projectId) => `https://use.typekit.net/${projectId}.css`,
  monotype: (projectId) => `https://fast.fonts.net/jsapi/${projectId}.js`,
};

/** Families already requested from Google, so a later single request is a no-op. */
const googleFamilies = new Set();
let batchCount = 0;

const slug = (family) => String(family).replace(/\s+/g, '-').toLowerCase();

/**
 * The family name out of a Google font spec (`"Inter:wght@400;700"` → `"Inter"`).
 * @param {string} spec
 * @returns {string}
 */
export function googleFontFamily(spec) {
  return String(spec || '')
    .split(':')[0]
    .trim();
}

/**
 * Load one Google font for preview. No-op if the family was already requested,
 * on its own or as part of a batch.
 * @param {string} family font family name
 */
export function ensureGoogleFontPreview(family) {
  if (!family || googleFamilies.has(family)) return;
  googleFamilies.add(family);
  ensureStylesheet({
    id: `gf-preview-${slug(family)}`,
    href: PROVIDER_URL.google([family]),
  });
}

/**
 * Load several Google fonts in one request — the API allows combining families,
 * which is what keeps opening the font dropdown from firing dozens of requests.
 * Families already requested are skipped.
 * @param {string[]} families
 */
export function ensureGoogleFontPreviews(families) {
  const fresh = (families || []).filter((f) => f && !googleFamilies.has(f));
  if (!fresh.length) return;
  for (const f of fresh) googleFamilies.add(f);
  ensureStylesheet({
    id: `gf-preview-batch-${(batchCount += 1)}`,
    href: PROVIDER_URL.google(fresh),
  });
}

/**
 * Inject `@font-face` rules for an uploaded family's variants.
 * @param {{id: string, name: string, variants?: Array<object>}} family
 */
function ensureUploadedFontFaces(family) {
  const rules = (family.variants || [])
    .filter((v) => v.url)
    .map(
      (v) => `@font-face {
  font-family: '${family.name}';
  src: url('${v.url}') format('${v.format || 'woff2'}');
  font-weight: ${v.weight || 400};
  font-style: ${v.style || 'normal'};
  font-display: swap;
}`,
    )
    .join('\n');
  ensureStyle({ id: `managed-font-${family.id}`, css: rules });
}

/**
 * Load whatever a managed font family needs to render in the browser: uploaded
 * `@font-face` rules, or the provider's stylesheet/script.
 *
 * @param {object} family managed font family (`source`, `sourceConfig`, `variants`)
 */
export function ensureManagedFontPreview(family) {
  if (!family) return;
  const config = family.sourceConfig || {};
  switch (family.source) {
    case 'upload':
      ensureUploadedFontFaces(family);
      break;
    case 'adobe':
      if (config.projectId)
        ensureStylesheet({
          id: `typekit-${config.projectId}`,
          href: PROVIDER_URL.adobe(config.projectId),
        });
      break;
    case 'monotype':
      if (config.projectId)
        ensureScript({
          id: `monotype-${config.projectId}`,
          src: PROVIDER_URL.monotype(config.projectId),
        });
      break;
    case 'google':
      ensureGoogleFontPreview(googleFontFamily(config.spec || family.name));
      break;
  }
}
