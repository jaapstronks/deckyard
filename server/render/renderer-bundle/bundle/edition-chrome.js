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
 * The share card of one edition view: Open Graph, Twitter card and JSON-LD. A
 * shared link unfolds the same whichever view it names; what differs is the
 * address and what schema.org calls the document.
 *
 * @param {object} opts
 * @param {string} opts.title - Plain text
 * @param {string} opts.url - The address of this view
 * @param {string} opts.ogImage
 * @param {string} opts.description - Plain text; may be empty
 * @param {string} opts.schemaType - The JSON-LD `@type`
 * @param {string|null} opts.lang
 * @returns {string[]} `<head>` lines
 */
function shareCardHead({ title, url, ogImage, description, schemaType, lang }) {
  const text = description.trim();
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': schemaType,
    name: title,
    url,
    thumbnailUrl: ogImage,
    ...(lang ? { inLanguage: lang } : {}),
    ...(text ? { description: text } : {}),
  };
  const descMeta = text
    ? [
        `<meta property="og:description" content="${escapeHtml(text)}" />`,
        `<meta name="twitter:description" content="${escapeHtml(text)}" />`,
      ]
    : [];
  return [
    '<meta property="og:type" content="website" />',
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta property="og:image" content="${escapeHtml(ogImage)}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(ogImage)}" />`,
    ...descMeta,
    // `<` escaped so no value can close the script block.
    `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`,
  ];
}

/**
 * `<head>` markup, topbar markup and the no-script way out for the canvas of
 * one edition view.
 *
 * @param {object} stored - The edition's presentation, as stored (all
 *   language versions)
 * @param {object} shown - The projection on screen
 * @param {object} opts
 * @param {string} opts.canonicalUrl
 * @param {string|null} opts.lang
 * @param {string|null} [opts.deckLang] - The deck's language: the words of a
 *   view that names no language
 * @param {string} [opts.metaDescription]
 * @returns {{headHtml: string, topbarRightHtml: string, noscriptHtml: string}}
 */
export function canvasChrome(
  stored,
  shown,
  { canonicalUrl, lang, deckLang = null, metaDescription = '' },
) {
  if (!canonicalUrl) {
    return { headHtml: '', topbarRightHtml: '', noscriptHtml: '' };
  }
  const copy = getSlideCopy(lang || deckLang);
  const urls = editionAddresses(canonicalUrl, lang);
  const headHtml = [
    `<link rel="canonical" href="${escapeHtml(urls.canvas)}" />`,
    `<link rel="alternate" href="${escapeHtml(urls.reader)}" title="${escapeHtml(copy.readerOpen)}" />`,
    ...shareCardHead({
      title: shown?.title || copy.readerDocument,
      url: urls.canvas,
      ogImage: urls.ogImage,
      description: String(metaDescription || ''),
      schemaType: 'PresentationDigitalDocument',
      lang,
    }),
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

  // Without JavaScript the canvas never shows a slide. `_top`, because the same
  // canvas is the frameable embed and the reader refuses to be framed.
  const noscriptHtml = `<noscript><p class="ps-noscript">${escapeHtml(copy.readerNoScript)} <a href="${escapeHtml(urls.reader)}" target="_top">${escapeHtml(copy.readerOpen)}</a></p></noscript>`;

  return {
    headHtml,
    topbarRightHtml: `${switchHtml}${readerLinkHtml}`,
    noscriptHtml,
  };
}

/**
 * `<head>` markup for the reader of one edition view, and the address its
 * "view the slides" link points at.
 *
 * @param {object} shown - The projection on screen
 * @param {object} opts
 * @param {string} opts.canonicalUrl
 * @param {string|null} opts.lang
 * @param {string|null} [opts.deckLang] - The deck's language: the words of a
 *   view that names no language
 * @param {string} [opts.metaDescription]
 * @returns {{headHtml: string, canvasUrl: string}}
 */
export function readerChrome(
  shown,
  { canonicalUrl, lang, deckLang = null, metaDescription = '' },
) {
  if (!canonicalUrl) return { headHtml: '', canvasUrl: '' };
  const copy = getSlideCopy(lang || deckLang);
  const urls = editionAddresses(canonicalUrl, lang);
  return {
    headHtml: [
      `<link rel="canonical" href="${escapeHtml(urls.reader)}" />`,
      `<link rel="alternate" href="${escapeHtml(urls.canvas)}" title="${escapeHtml(copy.readerViewSlides)}" />`,
      ...shareCardHead({
        title: shown?.title || copy.readerDocument,
        url: urls.reader,
        ogImage: urls.ogImage,
        description: String(metaDescription || ''),
        schemaType: 'TextDigitalDocument',
        lang,
      }),
    ].join('\n    '),
    canvasUrl: urls.canvas,
  };
}
