/**
 * The chrome around a published edition: canonical and alternate links, the
 * Open Graph and Twitter card, the language switch and the reader link.
 *
 * It lives in the bundle, not in the HTTP layer, because every word and every
 * link in it is derived from the edition: title and description from the
 * frozen input, the addresses from the edition's own canvas address
 * (`input.canonicalUrl`, which the read path takes from the edition record),
 * the labels from the frozen slide copy. The serving installation adds HTTP
 * headers and nothing to the document.
 *
 * Pure: no reads, no clock, no environment.
 */

import { escapeHtml } from '../../../../shared/slide-types/helpers.js';
import { getSlideCopy } from '../../../../shared/slide-types/slide-copy.js';
import { getLangDisplayName } from '../../../../shared/i18n-utils.js';
import { existingVersionLangs } from '../../../../shared/i18n-progress.js';

/** `base?lang=xx`, or `base` when there is no language to name. */
function withLang(base, lang) {
  return lang ? `${base}?lang=${encodeURIComponent(lang)}` : base;
}

/**
 * The addresses of one edition view.
 *
 * @param {string} canonicalUrl - The edition's canvas address, no query
 * @param {string|null} lang - The language version on screen
 */
export function editionAddresses(canonicalUrl, lang) {
  return {
    canvas: withLang(canonicalUrl, lang),
    reader: withLang(`${canonicalUrl}/reader`, lang),
    ogImage: `${canonicalUrl}/og`,
  };
}

/**
 * `<head>` markup and topbar markup for the canvas of one edition view.
 *
 * @param {object} stored - The edition's presentation, as stored (all
 *   language versions)
 * @param {object} shown - The projection on screen
 * @param {object} opts
 * @param {string} opts.canonicalUrl
 * @param {string|null} opts.lang
 * @param {string} [opts.metaDescription]
 * @returns {{headHtml: string, topbarRightHtml: string}}
 */
export function canvasChrome(
  stored,
  shown,
  { canonicalUrl, lang, metaDescription = '' },
) {
  if (!canonicalUrl) return { headHtml: '', topbarRightHtml: '' };
  const copy = getSlideCopy(lang);
  const urls = editionAddresses(canonicalUrl, lang);
  const title = escapeHtml(shown?.title || copy.readerDocument);
  const description = escapeHtml(String(metaDescription || '').trim());

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'PresentationDigitalDocument',
    name: shown?.title || copy.readerDocument,
    url: urls.canvas,
    thumbnailUrl: urls.ogImage,
    ...(lang ? { inLanguage: lang } : {}),
    ...(description ? { description: String(metaDescription).trim() } : {}),
  };
  const descMeta = description
    ? [
        `<meta property="og:description" content="${description}" />`,
        `<meta name="twitter:description" content="${description}" />`,
      ]
    : [];
  const headHtml = [
    `<link rel="canonical" href="${escapeHtml(urls.canvas)}" />`,
    `<link rel="alternate" href="${escapeHtml(urls.reader)}" title="${escapeHtml(copy.readerOpen)}" />`,
    '<meta property="og:type" content="website" />',
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:url" content="${escapeHtml(urls.canvas)}" />`,
    `<meta property="og:image" content="${escapeHtml(urls.ogImage)}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:image" content="${escapeHtml(urls.ogImage)}" />`,
    ...descMeta,
    // `<` escaped so no value can close the script block.
    `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`,
  ].join('\n    ');

  // One link per version the edition has; below two there is nothing to
  // switch between (the live page's rule, B182/D72 #6).
  const langs = existingVersionLangs(stored);
  const switchHtml =
    langs.length > 1
      ? `<div class="sb-segmented is-lang-switch" role="group" aria-label="${escapeHtml(copy.readerLanguages)}">${langs
          .map(
            (l) =>
              `<a class="sb-segmented-btn${l === lang ? ' is-active' : ''}" href="${escapeHtml(withLang(canonicalUrl, l))}" hreflang="${escapeHtml(l)}" rel="nofollow">${escapeHtml(getLangDisplayName(l))}</a>`,
          )
          .join('')}</div>`
      : '';
  const readerLinkHtml = `<a class="presenter-help ps-reader-link" href="${escapeHtml(urls.reader)}" rel="alternate" style="text-decoration: underline; white-space: nowrap;">${escapeHtml(copy.readerOpen)}</a>`;

  return { headHtml, topbarRightHtml: `${switchHtml}${readerLinkHtml}` };
}

/**
 * `<head>` markup for the reader of one edition view, and the address its
 * "view the slides" link points at.
 *
 * @param {object} opts
 * @param {string} opts.canonicalUrl
 * @param {string|null} opts.lang
 * @returns {{headHtml: string, canvasUrl: string}}
 */
export function readerChrome({ canonicalUrl, lang }) {
  if (!canonicalUrl) return { headHtml: '', canvasUrl: '' };
  const urls = editionAddresses(canonicalUrl, lang);
  return {
    headHtml: `<link rel="canonical" href="${escapeHtml(urls.reader)}" />`,
    canvasUrl: urls.canvas,
  };
}
