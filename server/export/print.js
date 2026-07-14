import { SLIDE_TYPES } from '../../shared/slide-types.js';
import { stripFontFacesFromCss } from '../utils/embed-fonts.js';
import { markdownToSafeHtml } from '../utils/markdown.js';
import { iconUrl } from '../../shared/icon-names.js';
import { stripLiveOnlySlidesFromPresentation } from '../utils/public-output.js';
import { resolveDocLangFromPresentation } from '../utils/doc-lang.js';
import { sandboxWatermarkText } from '../config/sandbox.js';
import { sandboxWatermarkEnabled } from '../utils/sandbox-watermark.js';
import { escapeHtml, isProbablyUrl } from '../utils/html-utils.js';
import { buildPrismKatexCdnTags, buildPrismKatexInitScriptTag } from '../utils/prism-katex.js';
import { loadExportCssBundle } from './css-bundle.js';

// Simple translations for server-side export
const PRINT_I18N = {
  nl: {
    noCardContent: 'Geen kaarten-inhoud.',
    noContent: 'Geen inhoud.',
  },
  en: {
    noCardContent: 'No card content.',
    noContent: 'No content.',
  },
};

function getPrintTranslations(lang) {
  const langKey = String(lang || '').toLowerCase().startsWith('nl') ? 'nl' : 'en';
  return PRINT_I18N[langKey] || PRINT_I18N.en;
}

function linkify(s) {
  const t = String(s || '').trim();
  if (!t) return '';
  if (isProbablyUrl(t)) {
    const escUrl = escapeHtml(t);
    return `<a href="${escUrl}" target="_blank" rel="noopener noreferrer">${escUrl}</a>`;
  }
  return escapeHtml(t);
}

function renderQuoteSlide(slide) {
  const c =
    slide && typeof slide === 'object' ? slide.content : {};
  const quote = String(c?.quote || '').trim();
  const name = String(c?.authorName || '').trim();
  const role = String(c?.authorTitle || '').trim();
  const authorLine = [name, role]
    .filter(Boolean)
    .join(', ');
  const footer = authorLine
    ? `<footer class="print-quote-footer">- ${escapeHtml(
        authorLine
      )}</footer>`
    : '';

  return `<blockquote class="print-quote">
    <p class="print-quote-text">&ldquo;${escapeHtml(
      quote
    )}&rdquo;</p>
    ${footer}
  </blockquote>`;
}

function renderCardStackSlide(slide, lang) {
  const t = getPrintTranslations(lang);
  const c =
    slide && typeof slide === 'object' ? slide.content : {};
  const count = Math.max(
    1,
    Math.min(4, Number(c?.cardCount || 4) || 4)
  );
  const cards = [];
  for (let i = 1; i <= count; i += 1) {
    const label = String(c?.[`card${i}Label`] || '').trim();
    const body = String(c?.[`card${i}Body`] || '').trim();
    if (!label && !body) continue;
    cards.push(`<section class="print-card">
      ${label ? `<h3>${escapeHtml(label)}</h3>` : ''}
      ${
        body
          ? `<div class="md">${markdownToSafeHtml(
              body
            )}</div>`
          : ''
      }
    </section>`);
  }
  return cards.length
    ? `<div class="print-cards">${cards.join('')}</div>`
    : `<p class="print-muted">${escapeHtml(t.noCardContent)}</p>`;
}

function renderIconCardGridSlide(slide, lang) {
  const t = getPrintTranslations(lang);
  const c =
    slide && typeof slide === 'object' ? slide.content : {};
  const count = Math.max(
    1,
    Math.min(6, Number(c?.cardCount || 6) || 6)
  );
  const cards = [];
  for (let i = 1; i <= count; i += 1) {
    const iconName = String(
      c?.[`card${i}Icon`] || ''
    ).trim();
    const iconSrc = iconUrl(iconName);
    const title = String(c?.[`card${i}Title`] || '').trim();
    const body = String(c?.[`card${i}Body`] || '').trim();
    if (!iconName && !title && !body) continue;
    cards.push(`<section class="print-icon-card">
      <div class="print-icon-card-head">
        ${
          iconSrc
            ? `<img class="print-icon" src="${escapeHtml(
                iconSrc
              )}" alt="" />`
            : ''
        }
        ${title ? `<h3>${escapeHtml(title)}</h3>` : ''}
      </div>
      ${
        body
          ? `<div class="md">${markdownToSafeHtml(
              body
            )}</div>`
          : ''
      }
    </section>`);
  }
  return cards.length
    ? `<div class="print-icon-cards">${cards.join(
        ''
      )}</div>`
    : `<p class="print-muted">${escapeHtml(t.noCardContent)}</p>`;
}

function slideH2(slide, idx, slideTypes) {
  const type = String(slide?.type || '');
  const types = slideTypes && typeof slideTypes === 'object' ? slideTypes : SLIDE_TYPES;
  const def = types[type];
  const c =
    slide && typeof slide === 'object' ? slide.content : {};
  const title = String(c?.title || '').trim();
  if (title) return title;
  if (type === 'quote-slide') return 'Quote';
  return def?.label || `Slide ${idx + 1}`;
}

function renderSlideReadableHtml(slide, lang) {
  const type = String(slide?.type || '');
  const c =
    slide && typeof slide === 'object' ? slide.content : {};

  if (type === 'quote-slide')
    return renderQuoteSlide(slide);
  if (type === 'card-stack-slide')
    return renderCardStackSlide(slide, lang);
  if (type === 'icon-card-grid-slide')
    return renderIconCardGridSlide(slide, lang);

  if (
    type === 'title-slide' ||
    type === 'chapter-title-slide'
  ) {
    const subheading = String(c?.subheading || '').trim();
    return subheading
      ? `<p class="print-lead">${escapeHtml(subheading)}</p>`
      : '';
  }

  if (
    type === 'content-slide' ||
    type === 'image-text-slide'
  ) {
    const body = String(c?.body || '').trim();
    return body
      ? `<div class="md">${markdownToSafeHtml(body)}</div>`
      : '';
  }

  if (type === 'image-slide') {
    const subheading = String(c?.subheading || '').trim();
    const caption = String(c?.caption || '').trim();
    const parts = [];
    if (subheading)
      parts.push(
        `<p class="print-lead">${escapeHtml(subheading)}</p>`
      );
    if (caption)
      parts.push(`<p>${escapeHtml(caption)}</p>`);
    return parts.join('\n');
  }

  if (type === 'video-slide') {
    const source = String(c?.source || '').trim();
    return source ? `<p>${linkify(source)}</p>` : '';
  }

  // Fallback: readable JSON
  const json = escapeHtml(JSON.stringify(c || {}, null, 2));
  return `<pre class="print-pre">${json}</pre>`;
}

function renderSlideTextHtml(slide, idx, lang, slideTypes) {
  const t = getPrintTranslations(lang);
  const type = String(slide?.type || '');
  const h2 = slideH2(slide, idx, slideTypes);
  const content = renderSlideReadableHtml(slide, lang);
  return `<section class="print-slide" data-slide-type="${escapeHtml(
    type
  )}">
    <h2 class="print-h2"><span class="print-slide-num">${
      idx + 1
    }.</span> ${escapeHtml(h2)}</h2>
    ${content || `<p class="print-muted">${escapeHtml(t.noContent)}</p>`}
  </section>`;
}

export async function buildPrintHtml(repoRoot, pres, { theme = null, watermark = null, slideTypes = null } = {}) {
  pres = stripLiveOnlySlidesFromPresentation(pres);
  const docLang = resolveDocLangFromPresentation(pres);
  const css = await loadExportCssBundle(repoRoot, theme, watermark);

  const title = escapeHtml(pres.title || 'Presentation');
  const wmOn = css.wmOn;
  const wmText = wmOn ? escapeHtml(sandboxWatermarkText()) : '';
  const slides = Array.isArray(pres?.slides)
    ? pres.slides
    : [];
  const slidesHtml = slides
    .map((s, idx) => {
      const section = renderSlideTextHtml(s, idx, docLang, slideTypes);
      const hr =
        idx < slides.length - 1
          ? `<hr class="print-break" />`
          : '';
      return `${section}\n${hr}`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="${escapeHtml(docLang)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} (Print)</title>
    ${buildPrismKatexCdnTags()}
    <style>
${css.fontCss}
${stripFontFacesFromCss(css.appCss)}
${css.themeVarsCss}
${css.themeCss}
${stripFontFacesFromCss(css.slidesCss)}

      html, body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      body { padding: 0; margin: 0; }
      .print-wrap { background: #fff; color: #111; }
      .print-toolbar {
        position: sticky;
        top: 0;
        padding: 12px 16px;
        background: rgba(0,0,0,0.75);
        color: #fff;
        display: flex;
        gap: 12px;
        align-items: center;
        z-index: 10;
      }
      .print-toolbar .btn { border-radius: 6px; }
      .print-watermark {
        font-family: var(--font-mono);
        font-size: 12px;
        opacity: 0.8;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 55vw;
      }

      /* Text-only layout */
      .print-doc {
        max-width: 920px;
        margin: 0 auto;
        padding: 22px 18px 40px;
      }
      .print-slide {
        padding: 8px 0 18px;
      }

      h1, h2, h3 { color: #0b0b0b; }
      .print-h1 {
        font-family: var(--font-heading);
        font-size: 30px;
        line-height: 1.15;
        margin: 10px 0 18px;
        font-weight: 600;
      }
      .print-h2 {
        font-family: var(--font-heading);
        font-size: 20px;
        line-height: 1.2;
        margin: 18px 0 10px;
        font-weight: 600;
      }
      .print-slide-num {
        font-family: var(--font-mono);
        font-size: 13px;
        opacity: 0.65;
        margin-right: 6px;
      }
      h3 {
        font-family: var(--font-heading);
        font-size: 15px;
        margin: 14px 0 6px;
        font-weight: 600;
      }

      .md {
        font-size: 14px;
        line-height: 1.6;
        color: #111;
      }
      .md a { color: #0b57d0; text-decoration: underline; }
      .md img { display: none !important; }
      .md p { margin: 10px 0; }
      .md ul, .md ol { margin: 10px 0; padding-left: 22px; }
      .md li { margin: 6px 0; }

      .print-pre {
        font-family: var(--font-mono);
        font-size: 12px;
        line-height: 1.45;
        white-space: pre-wrap;
        word-break: break-word;
        background: rgba(0,0,0,0.04);
        border: 1px solid rgba(0,0,0,0.08);
        border-radius: 10px;
        padding: 12px;
      }

      .help { opacity: 0.75; font-size: 13px; }
      .print-muted { opacity: 0.7; }
      .print-lead { font-size: 15px; line-height: 1.55; opacity: 0.85; margin: 10px 0; }

      .print-break {
        border: 0;
        border-top: 1px solid rgba(0,0,0,0.12);
        margin: 18px 0;
      }

      .print-quote {
        margin: 12px 0;
        padding: 10px 0 2px;
      }
      .print-quote-text {
        font-family: var(--font-heading);
        font-size: 18px;
        line-height: 1.35;
        margin: 0 0 10px;
      }
      .print-quote-footer {
        font-size: 13px;
        opacity: 0.85;
        margin: 0;
      }

      .print-cards, .print-icon-cards {
        display: grid;
        gap: 10px;
      }
      .print-card, .print-icon-card {
        border: 1px solid rgba(0,0,0,0.10);
        border-radius: 12px;
        padding: 10px 12px;
        background: rgba(0,0,0,0.02);
      }
      .print-icon-card-head {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .print-icon {
        width: 18px;
        height: 18px;
        display: inline-block;
      }

      @media print {
        .print-toolbar { display: none !important; }
        .print-doc { max-width: none; padding: 0; }
        @page { margin: 14mm; }
      }
    </style>
  </head>
  <body class="print-wrap ps-theme">
    <div class="print-toolbar">
      <div style="flex:1">${title}</div>
      ${wmText ? `<div class="print-watermark">${wmText}</div>` : ''}
      <button class="btn btn-primary" onclick="window.print()">Print / Save as PDF (text)</button>
    </div>
    <main class="print-doc">
      <h1 class="print-h1">${title}</h1>
      ${wmText ? `<div class="print-watermark" style="margin: 0 0 14px;">${wmText}</div>` : ''}
      ${slidesHtml}
    </main>
    ${buildPrismKatexInitScriptTag()}
  </body>
</html>`;
}