/**
 * Import an existing deck as editable slides (track 1a; B737, B752).
 *
 * One slide per page of a PDF the presentation app exported, of the type the
 * page's structure asks for, with the text of the page letter for letter.
 * `server/utils/pdf-extract/` reads each page into one page model (heading,
 * blocks in reading order, embedded images, the amount of vector drawing);
 * this module maps that model onto a slide type and uploads the images.
 *
 * Two promises shape the mapping:
 *
 * - **The text is literal.** Lines are joined with a space and markdown
 *   markers are escaped (`escapeMarkdownText`), nothing else: no casing, no
 *   summary, no truncation. Text the slide does not show (footer, page
 *   number, footnotes, labels of a drawing) goes to the slide's notes under
 *   "Not on the slide:".
 * - **A page that does not fit falls back on its own**, never the deck: it
 *   becomes an image-slide of the rendered page with the page text in the
 *   notes, and the report names the page and a reason from
 *   {@link FALLBACK_REASONS}.
 *
 * The speaker notes of a PowerPoint file beside the PDF come first in every
 * slide's notes, paired by slide order like the import as images
 * (`deck-images-import.js`, whose file reading and pairing this module
 * shares). No AI: the route is the endpoint (D235), and this one never
 * interprets.
 */

import { uploadImageBuffer } from '../media/upload-buffer.js';
import { pdfToImages } from '../render/pdf-to-images.js';
import { extractPdfPages } from '../utils/pdf-extract/index.js';
import { createLogger } from '../utils/logger.js';
import {
  DeckImagesRefusal,
  countMismatch,
  deckImageBaseName,
  notesForPages,
  readSourceSlides,
} from './deck-images-import.js';
import {
  newSlide,
  validateSlideFields,
} from '../../shared/slide-types/presentation.js';
import { escapeMarkdownText } from '../../shared/markdown.js';
import { normalizeLang } from '../../shared/i18n-utils.js';
import {
  MAX_COLS,
  MAX_ROWS,
} from '../../shared/slide-types/types/table-slide.js';
const log = createLogger('deck-slides-import');

/**
 * Why a page became an image of itself instead of an editable slide. A
 * closed set: the creation view names each one (B753).
 *
 * - `no-text`: the page has no text to edit (a picture, a drawing).
 * - `drawing`: a heading and text beside a vector drawing (a chart, a
 *   diagram) that no slide type can hold.
 * - `table-untagged`: a table found by geometry only; its cells are a guess.
 * - `multi-image`: more than one picture beside the text.
 * - `no-heading`: text without a heading that is no section title either.
 * - `too-long`: the literal text is longer than the slide's fields hold;
 *   cutting it would break the promise that the text is literal.
 */
export const FALLBACK_REASONS = Object.freeze([
  'no-text',
  'drawing',
  'table-untagged',
  'multi-image',
  'no-heading',
  'too-long',
]);

/** More vector paths than this beside the text is a drawing (brief § Mappingtabel). */
export const DRAWING_MIN_PATHS = 60;

/** A picture that covers this much of the title page is its background. */
export const TITLE_BACKGROUND_MIN_COVER = 0.6;

/** A lone picture that covers this much of the page goes edge to edge. */
export const BLEED_MIN_COVER = 0.9;

/** A text-only page without a heading that is a section title: at most this many lines… */
const LOOSE_TITLE_MAX_LINES = 3;

/** …set this large, as a fraction of the page height (18 pt on a 405 pt page). */
const LOOSE_TITLE_MIN_SIZE = 0.045;

/** The title page holds at most this many lines (brief § Mappingtabel). */
const TITLE_PAGE_MAX_LINES = 4;

/** At least this many cards make a text-blocks slide. */
const CARDS_MIN = 3;

/** A date on a title page goes to its detail line. */
const DATE_LIKE =
  /\b(19|20)\d{2}\b|\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|mrt|mei|okt)[a-z]*\.?\b/i;

/** The heading of the notes section for text that is not on the slide. */
const NOT_ON_SLIDE = {
  nl: 'Niet op de slide:',
  en: 'Not on the slide:',
};

/**
 * @typedef {import('../utils/pdf-extract/index.js').PageModel} PageModel
 */

/**
 * The plan for one page: the slide as `newSlide` composed it, with the page
 * images to upload into which content key, or the reason it falls back.
 * @typedef {{ slide: object, uploads: Array<{ key: string, index: number }> } | { reason: string }} PagePlan
 */

/**
 * Decide what one page becomes. Pure: no uploads, no rendering; a mapped
 * slide's image keys are empty until the caller uploads `uploads`.
 *
 * Every candidate is checked against its type's declared fields: a list
 * whose items are longer than the list slide holds becomes a text slide,
 * and text longer than a text slide holds falls back as `too-long`.
 *
 * @param {PageModel} page
 * @param {object} ctx
 * @param {Record<string, object>} ctx.slideTypes - The organization's map.
 * @param {object} [ctx.theme]
 * @param {string} [ctx.lang]
 * @param {string} [ctx.presentationId]
 * @returns {PagePlan}
 */
export function planPage(page, ctx) {
  const choice = chooseSlide(page);
  if (choice.reason) return choice;
  const slide = composeValid(choice, ctx);
  if (slide) return { slide, uploads: choice.uploads || [] };
  // Too long for the chosen type: the text slide is the widest home.
  if (choice.type !== 'content-slide' && page.heading) {
    const text = contentSlide(page);
    const fallback = composeValid(text, ctx);
    if (fallback) return { slide: fallback, uploads: [] };
  }
  return { reason: 'too-long' };
}

function composeValid({ type, content }, ctx) {
  if (!ctx.slideTypes[type]) return null;
  const slide = newSlide({
    type,
    theme: ctx.theme ?? null,
    lang: ctx.lang ?? null,
    presentationId: ctx.presentationId || '',
    slideTypes: ctx.slideTypes,
    content,
  });
  const problems = validateSlideFields(slide, { slideTypes: ctx.slideTypes });
  return problems.length ? null : slide;
}

/**
 * The mapping table of the brief (`pdf-import-two-modes.md` § Mappingtabel),
 * one rule after the other; the first that fits wins.
 * @param {PageModel} page
 * @returns {{ type: string, content: object, uploads?: Array<{ key: string, index: number }> } | { reason: string }}
 */
export function chooseSlide(page) {
  const { heading, blocks, images } = page;
  const paths = page.drawing?.paths || 0;

  if (!heading && blocks.length === 0) {
    // A page without text: a picture is an image slide, anything else (a
    // drawing, nothing at all) keeps its pixels.
    if (images.length === 0 || paths > DRAWING_MIN_PATHS) {
      return { reason: 'no-text' };
    }
    if (images.length > 1) return { reason: 'multi-image' };
    return imageSlide(page, {});
  }

  if (!heading) {
    // A picture with a caption under it.
    const caption = captionOf(blocks);
    if (images.length === 1 && caption !== null && paths <= DRAWING_MIN_PATHS) {
      return imageSlide(page, { caption });
    }
    // A big line or two, or a quote: a section title (`quote-slide` asks for
    // an author, which a PDF does not reliably name).
    if (images.length === 0 && isLooseTitle(page)) {
      const [first, ...rest] = blocks.map(blockText);
      return {
        type: 'chapter-title-slide',
        content: { title: first, subheading: rest.join(' ') },
      };
    }
    return { reason: 'no-heading' };
  }

  const tables = blocks.filter((b) => b.kind === 'table');
  const tableOnly = tables.length === 1 && blocks.every(isTableOrCaption);
  // A table's rules are paths too; a page that holds only the table is no
  // drawing.
  if (paths > DRAWING_MIN_PATHS && !tableOnly) return { reason: 'drawing' };
  if (images.length > 1) return { reason: 'multi-image' };
  if (tables.length && !page.tagged) return { reason: 'table-untagged' };

  if (page.page === 1) {
    const title = titleSlide(page);
    if (title) return title;
  }

  if (images.length === 1) {
    if (blocks.length === 0) return imageSlide(page, { title: heading });
    return imageTextSlide(page);
  }

  if (blocks.length === 0 || isSingleLine(page)) {
    return {
      type: 'chapter-title-slide',
      content: { title: heading, subheading: blocks.map(blockText).join(' ') },
    };
  }

  if (tableOnly) {
    // Wider or longer than the table slide holds: a markdown table of that
    // size is no slide either.
    return fitsTableSlide(tables[0])
      ? tableSlide(page)
      : { reason: 'too-long' };
  }
  return textBlocksSlide(page) || listSlide(page) || contentSlide(page);
}

// ---------------------------------------------------------------------------
// The slides
// ---------------------------------------------------------------------------

function imageSlide(page, { title = '', caption = '' }) {
  const img = page.images[0];
  return {
    type: 'image-slide',
    content: {
      title,
      caption,
      alt: img.alt || '',
      ...(!title && !caption && cover(page, img) >= BLEED_MIN_COVER
        ? { bleed: true }
        : {}),
    },
    uploads: [{ key: 'image', index: 0 }],
  };
}

function imageTextSlide(page) {
  const img = page.images[0];
  const centre = img.box.x + img.box.width / 2;
  return {
    type: 'image-text-slide',
    content: {
      title: page.heading,
      body: blocksToMarkdown(page.blocks),
      alt: img.alt || '',
      imageRole: 'content',
      layout: 'split',
      imageSide: centre < page.width / 2 ? 'left' : 'right',
    },
    uploads: [{ key: 'image', index: 0 }],
  };
}

/**
 * Page 1 with a few lines and nothing but paragraphs: the heading is the
 * title, a date-like line the detail line, one other line the subtitle. A
 * picture that covers most of the page is its background.
 */
function titleSlide(page) {
  const { blocks, images } = page;
  if (textLineCount(page) > TITLE_PAGE_MAX_LINES) return null;
  if (!blocks.every((b) => b.kind === 'para')) return null;
  const background =
    images.length === 1 && cover(page, images[0]) >= TITLE_BACKGROUND_MIN_COVER;
  if (images.length && !background) return null;
  const texts = blocks.map((b) => b.text);
  const metaIndex = texts.findIndex((t) => DATE_LIKE.test(t));
  const meta = metaIndex >= 0 ? texts[metaIndex] : '';
  const rest = texts.filter((_t, i) => i !== metaIndex);
  if (rest.length > 1) return null;
  return {
    type: 'title-slide',
    content: { title: page.heading, subheading: rest[0] || '', meta },
    uploads: background ? [{ key: 'slideBgImage', index: 0 }] : [],
  };
}

function tableSlide(page) {
  const table = page.blocks.find((b) => b.kind === 'table');
  const caption = page.blocks.find((b) => b.kind === 'caption');
  const cols = Math.max(...table.rows.map((r) => r.length));
  return {
    type: 'table-slide',
    content: {
      title: page.heading,
      caption: caption ? caption.text : '',
      headerRow: table.headerRow ? 'on' : 'off',
      colCount: String(cols),
      rows: table.rows.map((row) =>
        Object.fromEntries(
          Array.from({ length: cols }, (_v, i) => [`c${i + 1}`, row[i] ?? '']),
        ),
      ),
    },
  };
}

function fitsTableSlide(table) {
  const cols = Math.max(0, ...table.rows.map((r) => r.length));
  return cols >= 1 && cols <= MAX_COLS && table.rows.length <= MAX_ROWS;
}

/** One card group, with at most one paragraph above it as the subtitle. */
function textBlocksSlide(page) {
  const { lead, body } = splitLead(page.blocks);
  if (body.length !== 1 || body[0].kind !== 'cards') return null;
  const { cards } = body[0];
  if (cards.length < CARDS_MIN) return null;
  return {
    type: 'text-blocks-slide',
    content: {
      title: page.heading,
      subheading: lead,
      rows: [
        {
          title: '',
          color: 'yellow',
          arrow: 'none',
          blocks: cards.map((c) => ({
            title: c.title,
            body: escapeMarkdownText(c.body),
          })),
        },
      ],
    },
  };
}

/**
 * Lists of one kind, with at most one paragraph above them as the subtitle,
 * and more items than paragraphs. An item's first paragraph is its title, the
 * rest its line of text.
 */
function listSlide(page) {
  const { lead, body } = splitLead(page.blocks);
  if (!body.length || !body.every((b) => b.kind === 'list')) return null;
  const variants = new Set(body.map((b) => b.variant));
  if (variants.size > 1) return null;
  const items = body.flatMap((b) => b.items);
  const paras = lead ? 1 : 0;
  if (items.length < 2 || items.length <= paras) return null;
  return {
    type: 'list-slide',
    content: {
      title: page.heading,
      subheading: lead,
      variant: body[0].variant === 'numbers' ? 'numbers' : 'bullets',
      items: items.map((item) => {
        const parts = item.parts?.length ? item.parts : [item.text];
        return { title: parts[0], text: parts.slice(1).join(' ') };
      }),
    },
  };
}

/** The widest home: the heading and every block as markdown, in order. */
export function contentSlide(page) {
  return {
    type: 'content-slide',
    content: {
      title: page.heading,
      layout: 'one-column',
      body: blocksToMarkdown(page.blocks),
    },
  };
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/**
 * The blocks as markdown, each one literal: a paragraph a paragraph (bold
 * only when the whole paragraph is), a list a list, a table a pipe table,
 * a card its title as a subheading with its body under it.
 * @param {object[]} blocks
 * @returns {string}
 */
export function blocksToMarkdown(blocks) {
  return blocks
    .map((block) => {
      switch (block.kind) {
        case 'list':
          return block.items
            .map(
              (item, i) =>
                `${block.variant === 'numbers' ? `${i + 1}.` : '-'} ${escapeMarkdownText(item.text)}`,
            )
            .join('\n');
        case 'table':
          return pipeTable(block.rows);
        case 'cards':
          return block.cards
            .map(
              (c) =>
                `## ${escapeMarkdownText(c.title)}\n\n${escapeMarkdownText(c.body)}`,
            )
            .join('\n\n');
        case 'quote':
          return `> ${escapeMarkdownText(block.text)}`;
        case 'para': {
          const text = escapeMarkdownText(block.text);
          if (block.subheading) return `## ${text}`;
          return block.bold ? `**${text}**` : text;
        }
        default:
          return escapeMarkdownText(block.text);
      }
    })
    .filter(Boolean)
    .join('\n\n');
}

function pipeTable(rows) {
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const line = (row) =>
    `| ${Array.from({ length: cols }, (_v, i) =>
      escapeMarkdownText(row[i] ?? '', { tableCell: true }),
    ).join(' | ')} |`;
  const [head = [], ...rest] = rows;
  return [line(head), `| ${Array(cols).fill('---').join(' | ')} |`]
    .concat(rest.map(line))
    .join('\n');
}

/** The plain text of one block, one line per item, row or card part. */
function blockLines(block) {
  switch (block.kind) {
    case 'list':
      return block.items.map((i) => i.text);
    case 'table':
      return block.rows.map((r) => r.join('\t'));
    case 'cards':
      return block.cards.flatMap((c) => [c.title, c.body]);
    default:
      return [block.text];
  }
}

function blockText(block) {
  return blockLines(block).join(' ');
}

/**
 * The text of the page as plain lines: the heading, every block, then the
 * labels of a drawing. What a slide that falls back carries in its notes.
 * @param {PageModel} page
 * @returns {string}
 */
export function pageText(page) {
  return [
    ...(page.heading ? [page.heading] : []),
    ...page.blocks.flatMap(blockLines),
    ...(page.drawing?.labels || []).map((l) => l.text),
  ]
    .filter((t) => String(t).trim())
    .join('\n');
}

/**
 * A slide's notes: the speaker notes of the PowerPoint file first, then (on a
 * page that fell back) the page text, then what the slide does not show,
 * under a heading in the deck's language. Parts are separated by an empty
 * line; an empty part is left out.
 *
 * @param {object} parts
 * @param {string} [parts.speakerNotes]
 * @param {string} [parts.pageText]
 * @param {string[]} [parts.notOnSlide]
 * @param {string} [parts.lang]
 * @returns {string}
 */
export function composeNotes({
  speakerNotes = '',
  pageText: text = '',
  notOnSlide = [],
  lang = '',
}) {
  const heading =
    NOT_ON_SLIDE[normalizeLang(lang) === 'nl' ? 'nl' : 'en'] || NOT_ON_SLIDE.en;
  const kept = notOnSlide.filter((t) => String(t).trim());
  return [
    String(speakerNotes || '').trim(),
    String(text || '').trim(),
    kept.length ? [heading, ...kept].join('\n') : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// Page measures
// ---------------------------------------------------------------------------

function cover(page, img) {
  const area = page.width * page.height;
  return area > 0 ? (img.box.width * img.box.height) / area : 0;
}

/** Lines of text on the page, heading included, drawing labels not. */
function textLineCount(page) {
  return page.lines.filter((l) => l.role !== 'label' && l.role !== 'list-label')
    .length;
}

function isSingleLine(page) {
  if (page.blocks.length !== 1 || page.blocks[0].kind !== 'para') return false;
  const headingLines = page.lines.filter((l) => l.role === 'heading').length;
  return textLineCount(page) - headingLines <= 1;
}

function isLooseTitle(page) {
  if (page.blocks.some((b) => b.kind === 'quote') && page.blocks.length <= 2) {
    return page.blocks.every((b) => b.kind === 'quote' || b.kind === 'para');
  }
  if (!page.blocks.every((b) => b.kind === 'para')) return false;
  const lines = page.lines.filter((l) => l.role !== 'label');
  if (!lines.length || lines.length > LOOSE_TITLE_MAX_LINES) return false;
  const largest = Math.max(...lines.map((l) => l.size));
  return largest >= LOOSE_TITLE_MIN_SIZE * page.height;
}

function captionOf(blocks) {
  if (blocks.length !== 1) return null;
  const [block] = blocks;
  return block.kind === 'caption' || block.kind === 'para' ? block.text : null;
}

function isTableOrCaption(block) {
  return block.kind === 'table' || block.kind === 'caption';
}

/** A first paragraph above the rest, as a subtitle, and the rest. */
function splitLead(blocks) {
  if (blocks[0]?.kind === 'para' && !blocks[0].bold) {
    return { lead: blocks[0].text, body: blocks.slice(1) };
  }
  return { lead: '', body: blocks };
}

// ---------------------------------------------------------------------------
// The import
// ---------------------------------------------------------------------------

/**
 * Build one slide per page of the PDF: mapped where the page fits a type,
 * the rendered page where it does not, with the notes and a report.
 *
 * @param {object} opts
 * @param {import('./deck-images-import.js').DeckImageFiles} opts.files - From
 *   `readDeckImageFiles`; the PDF is required, the PowerPoint file optional.
 * @param {object} opts.theme - The target deck's resolved theme.
 * @param {string} opts.lang - The target deck's language.
 * @param {string} [opts.presentationId]
 * @param {Record<string, object>} opts.slideTypes - The organization's map.
 * @param {AbortSignal} opts.signal - Stops the reading and the page renders,
 *   checked before every upload.
 * @param {(message: string, data: object) => void} opts.onProgress
 * @param {typeof pdfToImages} [opts.renderPages] - The page rasteriser, for
 *   tests; the browser-backed `pdfToImages` by default.
 * @returns {Promise<{ slides: object[], report: DeckSlidesReport }>}
 * @throws {DeckImagesRefusal} the PDF is missing, unreadable or empty, or its
 *   page count does not pair with the PowerPoint file.
 */
export async function buildDeckSlides({
  files,
  theme,
  lang,
  presentationId = '',
  slideTypes,
  signal,
  onProgress,
  renderPages = pdfToImages,
}) {
  const { pdfBytes, pptxBytes } = files;
  if (!pdfBytes) {
    throw new DeckImagesRefusal('A PDF of the deck is required');
  }
  const sourceSlides = pptxBytes ? await readSourceSlides(pptxBytes) : null;

  onProgress('Reading the PDF...', { stage: 'reading', current: 0, total: 0 });
  let extracted;
  try {
    extracted = await extractPdfPages(new Uint8Array(pdfBytes), { signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    log.warn('[import-slides] unreadable PDF:', err?.message);
    throw new DeckImagesRefusal('The PDF could not be read');
  }
  const { pages } = extracted;
  if (pages.length === 0) throw new DeckImagesRefusal('No pages found in PDF');

  const speakerNotes = sourceSlides
    ? notesForPages(sourceSlides, pages.length)
    : null;
  if (sourceSlides && !speakerNotes) {
    throw countMismatch(pages.length, sourceSlides);
  }

  const ctx = { slideTypes, theme, lang, presentationId };
  const plans = pages.map((page) => planPage(page, ctx));
  const fallbackPages = pages
    .filter((_p, i) => plans[i].reason)
    .map((p) => p.page);

  // Only the pages that fell back are rendered.
  const rendered = new Map();
  if (fallbackPages.length) {
    const images = await renderPages({
      buffer: pdfBytes,
      width: 1920,
      height: 1080,
      pages: fallbackPages,
      signal,
      onProgress: (nth, count) =>
        onProgress(`Rendering page ${nth} of ${count}...`, {
          stage: 'converting',
          current: nth,
          total: count,
        }),
    });
    for (const img of images || []) rendered.set(img.page, img.buffer);
  }

  const baseFilename = deckImageBaseName(files);
  const upload = async (buffer, name, page, errors) => {
    // Each upload is a write to the media library for whoever asked: checked
    // before, not after.
    signal.throwIfAborted();
    try {
      return await uploadImageBuffer({
        buffer,
        fileName: `${baseFilename}-${name}.png`,
        mimeType: 'image/png',
        tags: ['pdf-import', `source:${baseFilename}`],
      });
    } catch (err) {
      log.error(`[import-slides] Failed to upload page ${page}:`, err?.message);
      errors.push({ page, message: 'An image could not be uploaded' });
      return '';
    }
  };

  const slides = [];
  const reportPages = [];
  const errors = [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const plan = plans[i];
    const num = String(page.page).padStart(3, '0');
    onProgress(`Building slide ${i + 1} of ${pages.length}...`, {
      stage: 'uploading',
      current: i + 1,
      total: pages.length,
    });
    const notOnSlide = page.dropped.map((d) => d.text);
    let slide;
    if (plan.reason) {
      const buffer = rendered.get(page.page);
      const image = buffer
        ? await upload(buffer, `page-${num}`, page.page, errors)
        : '';
      if (!buffer) {
        errors.push({ page: page.page, message: 'The page was not rendered' });
      }
      slide = newSlide({
        type: 'image-slide',
        theme,
        lang,
        presentationId,
        slideTypes,
        content: {
          image,
          alt: image ? `${baseFilename} - Page ${page.page}` : '',
          bleed: true,
        },
      });
      slide.notes = composeNotes({
        speakerNotes: speakerNotes?.[i],
        pageText: pageText(page),
        notOnSlide,
        lang,
      });
    } else {
      slide = plan.slide;
      for (const { key, index } of plan.uploads) {
        slide.content[key] = await upload(
          page.images[index].png,
          `page-${num}-image-${index + 1}`,
          page.page,
          errors,
        );
      }
      slide.notes = composeNotes({
        speakerNotes: speakerNotes?.[i],
        notOnSlide: [
          ...notOnSlide,
          ...(page.drawing?.labels || []).map((l) => l.text),
        ],
        lang,
      });
    }
    slides.push(slide);
    reportPages.push({
      page: page.page,
      type: slide.type,
      ...(plan.reason ? { reason: plan.reason } : {}),
      dropped: page.dropped.length,
    });
  }

  return {
    slides,
    report: {
      slidesExtracted: pages.length,
      slidesConverted: reportPages.filter((p) => !p.reason).length,
      errors,
      pages: reportPages,
    },
  };
}

/**
 * The report of an import, in the names the generation route's report uses
 * (`convert-file/index.js`), so one renderer shows both.
 * @typedef {object} DeckSlidesReport
 * @property {number} slidesExtracted - pages read from the PDF
 * @property {number} slidesConverted - pages that became an editable slide
 * @property {Array<{ page: number, message: string }>} errors
 * @property {Array<{ page: number, type: string, reason?: string, dropped: number }>} pages
 *   - one per page; `reason` (from {@link FALLBACK_REASONS}) on a page that
 *   fell back, `dropped` the lines of text not on the slide
 */
