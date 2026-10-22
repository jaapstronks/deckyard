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
 * Where a type offers a choice the page already made, the slide follows the
 * page (B830): the width and corner of a picture beside text, two columns
 * of blocks, the height and centring of a heading, a tinted or dark page.
 * Only options the types declare, never a free colour or a font: the theme
 * stays the user's choice.
 *
 * Mixed pages (B831): a tagged table's own paths do not make a drawing, a
 * drawing that stands apart from the text is cut out of the rendered page
 * beside it, and a small picture in the same place on three pages or more
 * is decoration, left out and named once in the report.
 *
 * Two sources of the same page model (B829): a PowerPoint file states the
 * structure a PDF has to rebuild, so when it comes, its slides are read
 * (`server/utils/pptx-extract/`) with their speaker notes, and the PDF beside
 * it is only the pixel source for the pages that fall back or have a drawing
 * cut out. Page `n` of both is the same slide. A PowerPoint file alone has no
 * pixels: a page that falls back keeps its heading and text as a text slide,
 * and the report says the PDF export would add the image. No AI: the route is
 * the endpoint (D235), and this one never interprets.
 */

import { createHash } from 'node:crypto';
import sharp from 'sharp';

import { uploadImageBuffer } from '../media/upload-buffer.js';
import { pdfToImages } from '../render/pdf-to-images.js';
import {
  countPdfPages,
  extractPdfPages,
  blockText,
  FOOTNOTE_ZONE,
  bodyLineTest,
  boxArea,
  lineBox,
  liesWithin,
  overlapArea,
  pageText,
} from '../utils/pdf-extract/index.js';
import { extractPptxPages } from '../utils/pptx-extract/index.js';
import { createLogger } from '../utils/logger.js';
import {
  DeckImagesRefusal,
  countMismatch,
  deckImageBaseName,
} from './deck-images-import.js';
import {
  newSlide,
  validateSlideFields,
} from '../../shared/slide-types/presentation.js';
import { escapeMarkdownText } from '../../shared/markdown.js';
import { resolveSlideBgTone } from '../../shared/slide-surface-tone.js';
import { hexToRgb, pickTextColorForBg } from '../../shared/color-utils.js';
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

/**
 * What went wrong with a page's picture, in `report.errors[].code`. A closed
 * set the creation view puts into words (B826); the slide keeps an empty
 * image either way.
 *
 * - `upload-failed`: the media library refused the picture.
 * - `not-rendered`: the page fell back but the rasteriser gave no image.
 * - `unsupported-image`: a picture of the PowerPoint file in a format that
 *   does not become a PNG (SVG, EMF, WMF) was left out (B829).
 */
export const REPORT_ERROR_CODES = Object.freeze([
  'upload-failed',
  'not-rendered',
  'unsupported-image',
]);

/** Where an import read its pages from: `report.source` (B829). */
export const IMPORT_SOURCES = Object.freeze(['pdf', 'pptx', 'both']);

/**
 * More vector paths than this beside the text is a drawing (brief
 * § Mappingtabel). The paths a tagged table owns (`drawing.tablePaths`) do
 * not count: its borders and cell fills are the table (B831).
 */
export const DRAWING_MIN_PATHS = 60;

/**
 * A drawing cut out of the rendered page, beside the text, covers this share
 * of the page at least and at most (B831). Measured on the 17 `drawing`
 * pages of Philips Q4 2024: the two whose drawing holds no body line, p13
 * and p24, cover 63% and 33%; a box under 8% is a stray rule or a logo, one
 * over 75% leaves no room for the text.
 */
export const CROP_MIN_COVER = 0.08;
export const CROP_MAX_COVER = 0.75;

/**
 * A block lies in the drawing when at least this share of its box does: its
 * text is a label of the drawing, shown in the cut-out and kept in the
 * notes. A block that only touches the drawing keeps the page whole.
 */
const CROP_BLOCK_INSIDE = 0.5;

/** The blocks that can be a drawing's labels; a list or a table never is. */
const LABEL_KINDS = new Set(['para', 'caption']);

/**
 * The same picture in the same place on this many pages, or more, is
 * decoration (a logo, a corner mark) when it is also this small: left out,
 * named once in the report (B831). Measured: the repeated pictures of both
 * decks are content (Philips one photo at 50% on three pages, CIIIC five
 * photos at 14% on four), so without the size bound the rule would take
 * them; at 3% it fires on neither.
 */
export const DECORATION_MIN_PAGES = 3;
export const DECORATION_MAX_COVER = 0.03;

/** Two boxes of a repeated picture are one place within this many pt. */
const DECORATION_BOX_TOLERANCE = 2;

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

/**
 * The image-text slide's three split widths (37, 50 and 63% of the slide,
 * `imageWidth`), each the nearest to the picture's share of the page width;
 * these are the midpoints. Measured: Philips Q4 2024 puts its photos at 50%
 * (p4, p9-11, p21) and one at 31% (p15), the fixture one at 25%.
 */
export const IMAGE_WIDTH_NARROW_MAX = 0.435;
export const IMAGE_WIDTH_WIDE_MIN = 0.565;

/**
 * A picture this small (of the page width and height), with its top and its
 * outer side this close to a page corner, sits in that corner: the
 * image-text slide's `corner` layout. Fires on neither measured deck; the
 * Philips photos fill a half, the 31% one sits 40% down the page.
 */
const CORNER_MAX_WIDTH = 0.3;
const CORNER_MAX_HEIGHT = 0.45;
const CORNER_MAX_INSET = 0.12;

/**
 * Two columns of blocks: a gutter at least this wide (of the page width)
 * that no block crosses, with blocks on both sides that overlap in height.
 */
const COLUMN_MIN_GUTTER = 0.02;

/**
 * A heading whose middle sits above this share of the page height is at the
 * top, below `1 - this` at the bottom (chapter-title `layout`). Philips puts
 * both chapter headings at 52%: centred.
 */
const HEADING_TOP_MAX = 1 / 3;

/**
 * A heading line is centred when its middle is this close to the page's
 * middle (of the page width) and it starts this far in: a left-set heading
 * as wide as the page has its middle there too. Every heading of both
 * measured decks is set left at 6% or less.
 */
const CENTRED_MAX_OFFSET = 0.05;
const CENTRED_MIN_INSET = 0.15;

/**
 * A light page is tinted, and asks for `mist`, when a channel of its colour
 * is under this: off-white paper is still white. CIIIC's lime (`#e2fe52`) is
 * tinted; white pages measure `#ffffff`.
 */
const WHITE_MIN_CHANNEL = 0xf0;

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
 * A picture a slide takes into content key `key`: the page's embedded image
 * at `index`, or `crop`, the box of the page (in page units) cut out of its
 * rendering (B831).
 * @typedef {{ key: string, index: number } | { key: string, crop: import('../utils/pdf-extract/boxes.js').Box }} PageUpload
 */

/**
 * The plan for one page: the slide as `newSlide` composed it, with the
 * pictures to upload into which content key and the text of the page it
 * leaves for the notes, or the reason it falls back.
 * @typedef {{ slide: object, uploads: PageUpload[], notOnSlide: string[] } | { reason: string }} PagePlan
 */

/**
 * Decide what one page becomes. Pure: no uploads, no rendering; a mapped
 * slide's image keys are empty until the caller uploads `uploads`.
 *
 * Every candidate is checked against its type's declared fields: a list
 * whose items are longer than the list slide holds becomes a text slide,
 * and text longer than a text slide holds falls back as `too-long`. A
 * choice that carries a picture has no second home: the text slide would
 * drop the picture in silence, so it falls back as `too-long` too (B826).
 *
 * @param {PageModel} page
 * @param {object} ctx
 * @param {Record<string, object>} ctx.slideTypes - The organization's map.
 * @param {object} [ctx.theme]
 * @param {string} [ctx.lang]
 * @param {string} [ctx.presentationId]
 * @param {boolean} [ctx.pagePixels=true] - see {@link chooseSlide}
 * @returns {PagePlan}
 */
export function planPage(page, ctx) {
  const choice = chooseSlide(page, { pagePixels: ctx.pagePixels ?? true });
  if (choice.reason) return choice;
  const background = backgroundOf(page, ctx.theme);
  const slide = composeValid(choice, ctx, background);
  if (slide) {
    return {
      slide,
      uploads: choice.uploads || [],
      notOnSlide: choice.notOnSlide || [],
    };
  }
  // Too long for the chosen type: the text slide is the widest home, but
  // only for a page without a picture to lose.
  if (
    choice.type !== 'content-slide' &&
    page.heading &&
    !(choice.uploads || []).length
  ) {
    const text = contentSlide(page);
    const fallback = composeValid(text, ctx, background);
    if (fallback) return { slide: fallback, uploads: [], notOnSlide: [] };
  }
  return { reason: 'too-long' };
}

/**
 * The slide `newSlide` composes, or null when one of its fields refuses the
 * content. The page's background goes only to a type that declares the
 * field; the field's own check is the boundary for a theme variant's id.
 */
function composeValid({ type, content }, ctx, background = null) {
  if (!ctx.slideTypes[type]) return null;
  const declares = ctx.slideTypes[type].fields?.some(
    (f) => f.key === 'background',
  );
  if (background && declares) content = { ...content, background };
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
 * @param {object} [opts]
 * @param {boolean} [opts.pagePixels=true] - the source has a rendering of
 *   each page, so a drawing can be cut out of it; a source without one (a
 *   PowerPoint file alone, B829) keeps a drawing page whole
 * @returns {{ type: string, content: object, uploads?: PageUpload[], notOnSlide?: string[] } | { reason: string }}
 */
export function chooseSlide(page, { pagePixels = true } = {}) {
  const { heading, blocks, images } = page;
  const paths = drawingPaths(page);

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
      return chapterTitleSlide(page, first, rest.join(' '), blocks[0].box);
    }
    return { reason: 'no-heading' };
  }

  const tables = blocks.filter((b) => b.kind === 'table');
  const tableOnly = tables.length === 1 && blocks.every(isTableOrCaption);
  // A table's rules are paths too; a page that holds only the table is no
  // drawing. A drawing beside text becomes a picture of itself where it can
  // be cut out without a line of the text in it.
  if (paths > DRAWING_MIN_PATHS && !tableOnly) {
    return (pagePixels && drawingCutOut(page)) || { reason: 'drawing' };
  }
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
    return chapterTitleSlide(page, heading, blocks.map(blockText).join(' '));
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

/**
 * A picture beside text: on the side it sits (of the page's middle, or of
 * `beside`), as wide as the split width nearest to its share of the page, or
 * in its corner when it is small and set there. The page's one picture and
 * all its blocks unless a cut-out names its own.
 */
function imageTextSlide(
  page,
  {
    img = page.images[0],
    blocks = page.blocks,
    upload = { key: 'image', index: 0 },
    beside = page.width / 2,
  } = {},
) {
  const centre = img.box.x + img.box.width / 2;
  const corner = isCornerImage(page, img);
  return {
    type: 'image-text-slide',
    content: {
      title: page.heading,
      body: blocksToMarkdown(blocks),
      alt: img.alt || '',
      imageRole: 'content',
      layout: corner ? 'corner' : 'split',
      imageSide: centre < beside ? 'left' : 'right',
      ...(corner ? {} : { imageWidth: imageWidthOf(page, img) }),
    },
    uploads: [upload],
  };
}

/**
 * A drawing beside text, cut out of the rendered page: an image-text slide
 * with the drawing as its picture and the text outside it as its body (B831,
 * brief § Beslissingen 5). Only where the cut cannot lose or repeat text: a
 * page with a heading and no picture of its own, a drawing box of
 * `CROP_MIN_COVER`–`CROP_MAX_COVER` of the page with neither the heading, a
 * body line nor a table cell in it, at least one block outside it, and no
 * block across its edge. The blocks inside are the drawing's labels: in the picture, and in
 * the notes. The box stops above the page's footer band, which a vector
 * logo there would otherwise pull in. Null when the page is no such page.
 * @param {PageModel} page
 * @returns {{ type: string, content: object, uploads: PageUpload[], notOnSlide: string[] } | null}
 */
export function drawingCutOut(page) {
  const drawing = page.drawing?.box;
  if (!drawing || !page.heading || page.images.length) return null;
  // What the drawing holds is judged on its whole box, the cut on the box
  // above the footer.
  const box = aboveFooter(page, drawing);
  const area = page.width * page.height;
  const share = box && area > 0 ? boxArea(box) / area : 0;
  if (share < CROP_MIN_COVER || share > CROP_MAX_COVER) return null;
  const isBody = bodyLineTest(page.lines);
  const kept = (l) =>
    l.role === 'heading' || l.role === 'table-cell' || isBody(l);
  if (page.lines.some((l) => kept(l) && overlapArea(lineBox(l), drawing) > 0)) {
    return null;
  }
  const inside = [];
  const outside = [];
  for (const block of page.blocks) {
    if (!block.box) return null;
    if (overlapArea(block.box, drawing) === 0) outside.push(block);
    else if (
      LABEL_KINDS.has(block.kind) &&
      liesWithin(block.box, drawing, CROP_BLOCK_INSIDE)
    ) {
      inside.push(block);
    } else return null;
  }
  if (!outside.length) return null;
  return {
    ...imageTextSlide(page, {
      img: { box, alt: page.heading },
      blocks: outside,
      upload: { key: 'image', crop: box },
      // A wide drawing is often centred: its side is the one away from the
      // text.
      beside:
        outside.reduce((sum, b) => sum + b.box.x + b.box.width / 2, 0) /
        outside.length,
    }),
    notOnSlide: inside.map(blockText),
  };
}

/**
 * The box with its bottom edge above the footer band, the bottom
 * `FOOTNOTE_ZONE` of the page, when a dropped line there (a footer, a
 * footnote, the page number) reaches into it; a logo beside the footer
 * goes with it. Higher up a dropped line can be a chart label
 * (PowerPoint marks those as artifacts too), which the picture keeps. A
 * dropped line carries no width: it counts from its start to the page edge.
 * Null when nothing is left.
 * @param {PageModel} page
 * @param {import('../utils/pdf-extract/boxes.js').Box} box
 */
function aboveFooter(page, box) {
  const band = (1 - FOOTNOTE_ZONE) * page.height;
  let bottom = box.y + box.height;
  for (const line of page.dropped || []) {
    if (line.y <= band || line.x >= box.x + box.width) continue;
    const { y: lineTop, height } = lineBox({ ...line, width: 0 });
    if (lineTop < bottom && lineTop + height > box.y) {
      bottom = Math.min(lineTop, band);
    }
  }
  return bottom > box.y ? { ...box, height: bottom - box.y } : null;
}

/**
 * A section title: the title where the page set it (top, middle, bottom of
 * the page) and centred when the page centred it. `box` stands in for the
 * heading lines on a page whose title is a loose block.
 */
function chapterTitleSlide(page, title, subheading, box = null) {
  const place = headingPlacement(page, box);
  return {
    type: 'chapter-title-slide',
    content: {
      title,
      subheading,
      ...(place ? { layout: place.position } : {}),
      ...(place?.centred ? { titleBlockAlign: 'center' } : {}),
    },
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

/**
 * The table slide renders each cell as inline markdown (`rowToCellsHtml`),
 * unlike the other string fields: a cell is escaped like a body, so an
 * asterisk in a source cell stays an asterisk.
 */
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
          Array.from({ length: cols }, (_v, i) => [
            `c${i + 1}`,
            escapeMarkdownText(row[i] ?? ''),
          ]),
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
      ...(headingPlacement(page)?.centred ? { headerAlign: 'center' } : {}),
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
      ...(headingPlacement(page)?.centred ? { headerAlign: 'center' } : {}),
      ...(inTwoColumns(page, body) ? { layout: 'two-column' } : {}),
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
      layout: inTwoColumns(page, page.blocks) ? 'two-column' : 'one-column',
      body: blocksToMarkdown(page.blocks),
    },
  };
}

/**
 * A page that falls back without pixels to show (a PowerPoint file alone,
 * B829). Its text stays on a slide where a text type holds it: the heading
 * and the literal text as a text slide, a heading alone as a section title.
 * Where none does (no heading, or text longer than the fields hold), the
 * slide is an empty image slide, as for a page the rasteriser skipped, and
 * the text goes to the notes; it is never cut.
 *
 * @param {PageModel} page
 * @param {object} ctx - as {@link planPage}
 * @returns {{ slide: object, textOnSlide: boolean }}
 */
export function fallbackWithoutPixels(page, ctx) {
  const background = backgroundOf(page, ctx.theme);
  if (page.heading) {
    const text =
      page.blocks.length > 0
        ? contentSlide(page)
        : chapterTitleSlide(page, page.heading, '');
    const slide = composeValid(text, ctx, background);
    if (slide) return { slide, textOnSlide: true };
  }
  const slide = newSlide({
    type: 'image-slide',
    theme: ctx.theme ?? null,
    lang: ctx.lang ?? null,
    presentationId: ctx.presentationId || '',
    slideTypes: ctx.slideTypes,
    content: { image: '', alt: '', bleed: true },
  });
  return { slide, textOnSlide: false };
}

// ---------------------------------------------------------------------------
// Layout and background (B830)
// ---------------------------------------------------------------------------

/** The split width nearest to the picture's share of the page width. */
function imageWidthOf(page, img) {
  const share = page.width > 0 ? img.box.width / page.width : 0.5;
  if (share < IMAGE_WIDTH_NARROW_MAX) return 'narrow';
  if (share > IMAGE_WIDTH_WIDE_MIN) return 'wide';
  return 'half';
}

function isCornerImage(page, { box }) {
  const { width: w, height: h } = page;
  if (!(w > 0 && h > 0)) return false;
  if (box.width > CORNER_MAX_WIDTH * w || box.height > CORNER_MAX_HEIGHT * h) {
    return false;
  }
  const inset = Math.min(box.x, w - (box.x + box.width));
  return box.y <= CORNER_MAX_INSET * h && inset <= CORNER_MAX_INSET * w;
}

/**
 * Whether the blocks stand in two columns: some gutter that no block
 * crosses, blocks on both sides of it, the two sides overlapping in height
 * (two blocks one above the other are one column), and the reading order
 * going down the left column before the right one, as the slide's columns
 * fill. Labels on the left read after the lists on their right (Philips
 * p19) stay one column, and so do three or five blocks in a row (CIIIC
 * p7, p10): each side is one column itself. Blocks without a box (a model from before B827) are
 * one column.
 * @param {PageModel} page
 * @param {object[]} blocks
 */
export function inTwoColumns(page, blocks) {
  const boxes = blocks.map((b) => b.box);
  if (boxes.length < 2 || boxes.some((b) => !b)) return false;
  const gutter = COLUMN_MIN_GUTTER * page.width;
  return columnSplits(boxes, gutter).some(
    (isLeft) =>
      // Down the left column first, and each side one column: three cards
      // in a row are no two columns.
      isLeft.indexOf(false) > isLeft.lastIndexOf(true) &&
      !columnSplits(
        boxes.filter((_b, i) => isLeft[i]),
        gutter,
      ).length &&
      !columnSplits(
        boxes.filter((_b, i) => !isLeft[i]),
        gutter,
      ).length,
  );
}

/**
 * Every way a gutter splits the boxes into a left and a right side that
 * overlap in height, as one flag per box (true: left of the gutter).
 */
function columnSplits(boxes, gutter) {
  const splits = [];
  for (const edge of new Set(boxes.map((b) => b.x + b.width))) {
    const isLeft = boxes.map((b) => b.x + b.width <= edge);
    const left = boxes.filter((_b, i) => isLeft[i]);
    const right = boxes.filter((b, i) => !isLeft[i] && b.x >= edge + gutter);
    if (!left.length || !right.length) continue;
    if (left.length + right.length !== boxes.length) continue;
    const [lTop, lBottom] = span(left);
    const [rTop, rBottom] = span(right);
    if (lTop < rBottom && rTop < lBottom) splits.push(isLeft);
  }
  return splits;
}

function span(boxes) {
  return [
    Math.min(...boxes.map((b) => b.y)),
    Math.max(...boxes.map((b) => b.y + b.height)),
  ];
}

/**
 * Where the heading sits: `top`, `center` or `bottom` by the middle of its
 * lines (from one em above the first baseline to the last), and whether
 * every line of it is centred. Null without heading lines or a `box`.
 * @param {PageModel} page
 * @param {{ x: number, y: number, width: number, height: number } | null} [box]
 * @returns {{ position: 'top'|'center'|'bottom', centred: boolean } | null}
 */
export function headingPlacement(page, box = null) {
  const lines = page.lines.filter((l) => l.role === 'heading');
  const rects = lines.length
    ? lines.map((l) => ({
        x: l.x,
        y: l.y - l.size,
        width: l.width,
        height: l.size,
      }))
    : box
      ? [box]
      : [];
  if (!rects.length || !(page.height > 0)) return null;
  const top = Math.min(...rects.map((r) => r.y));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  const middle = (top + bottom) / 2 / page.height;
  const position =
    middle < HEADING_TOP_MAX
      ? 'top'
      : middle > 1 - HEADING_TOP_MAX
        ? 'bottom'
        : 'center';
  const centred = rects.every(
    (r) =>
      Math.abs(r.x + r.width / 2 - page.width / 2) <=
        CENTRED_MAX_OFFSET * page.width &&
      r.x >= CENTRED_MIN_INSET * page.width,
  );
  return { position, centred };
}

/**
 * The `background` the page asks for under the deck's theme, or null for
 * the type's default. A dark page takes the theme's first own background
 * whose ground is dark (a variant with light text); a light tinted page
 * `mist`; white, a theme without a dark variant, or a page whose colour a
 * picture covers (a full-bleed photo over the white the extractor reports:
 * reviewnote B827) keep the default.
 * @param {PageModel} page
 * @param {object} [theme] - the target deck's resolved theme
 * @returns {string | null}
 */
export function backgroundOf(page, theme) {
  const color = page.background?.color;
  if (!color || !hexToRgb(color)) return null;
  if (page.images.some((img) => cover(page, img) >= BLEED_MIN_COVER)) {
    return null;
  }
  if (pickTextColorForBg(color) === '#ffffff') {
    const variants = Array.isArray(theme?.slideBackgrounds)
      ? theme.slideBackgrounds
      : [];
    const dark = variants.find(
      (v) =>
        v?.id && resolveSlideBgTone({ background: v.id }, theme) === 'dark',
    );
    return dark ? dark.id : null;
  }
  const { r, g, b } = hexToRgb(color);
  return Math.min(r, g, b) < WHITE_MIN_CHANNEL ? 'mist' : null;
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

/** The paths of the page's drawing: every path but those of a tagged table. */
function drawingPaths(page) {
  return Math.max(
    0,
    (page.drawing?.paths || 0) - (page.drawing?.tablePaths || 0),
  );
}

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
// Decoration and cut-outs (B831)
// ---------------------------------------------------------------------------

/**
 * Take the deck's decoration out of its pages, before any page is mapped: a
 * picture that stands with the same pixels (PNG hash) in the same place
 * (within `DECORATION_BOX_TOLERANCE` pt) on `DECORATION_MIN_PAGES` pages or
 * more and covers at most `DECORATION_MAX_COVER` of each. A logo in a
 * corner would otherwise turn every page into a picture beside text. Pure:
 * the pages that lose a picture are copies.
 * @param {PageModel[]} pages
 * @returns {{ pages: PageModel[], decorations: Array<{ pages: number[] }> }}
 *   the pages without their decoration, and one entry per decorative
 *   picture with the pages it was left out of
 */
export function findDecorations(pages) {
  const groups = [];
  for (const page of pages) {
    for (const img of page.images) {
      if (cover(page, img) > DECORATION_MAX_COVER) continue;
      const hash = createHash('sha1').update(img.png).digest('hex');
      let group = groups.find(
        (g) => g.hash === hash && sameBox(g.box, img.box),
      );
      if (!group) {
        group = { hash, box: img.box, pages: new Set(), images: new Set() };
        groups.push(group);
      }
      group.pages.add(page.page);
      group.images.add(img);
    }
  }
  const decorative = groups.filter((g) => g.pages.size >= DECORATION_MIN_PAGES);
  const left = new Set(decorative.flatMap((g) => [...g.images]));
  return {
    pages: pages.map((page) =>
      page.images.some((img) => left.has(img))
        ? { ...page, images: page.images.filter((img) => !left.has(img)) }
        : page,
    ),
    decorations: decorative.map((g) => ({
      pages: [...g.pages].sort((a, b) => a - b),
    })),
  };
}

function sameBox(a, b) {
  return ['x', 'y', 'width', 'height'].every(
    (k) => Math.abs(a[k] - b[k]) <= DECORATION_BOX_TOLERANCE,
  );
}

/**
 * Cut `box` (in page units) out of the page's rendering. The rasteriser fits
 * the page into its canvas and centres it (`pdfToImages`), so the scale and
 * the margins follow from the rendering's own size.
 * @param {Buffer} rendering - the PNG of the whole page
 * @param {PageModel} page
 * @param {import('../utils/pdf-extract/boxes.js').Box} box
 * @returns {Promise<Buffer>} a PNG
 */
export async function cutOutOfRendering(rendering, page, box) {
  const { width: w, height: h } = await sharp(rendering).metadata();
  const scale = Math.min(w / page.width, h / page.height);
  const offsetX = (w - page.width * scale) / 2;
  const offsetY = (h - page.height * scale) / 2;
  const left = Math.max(0, Math.floor(offsetX + box.x * scale));
  const top = Math.max(0, Math.floor(offsetY + box.y * scale));
  const right = Math.min(w, Math.ceil(offsetX + (box.x + box.width) * scale));
  const bottom = Math.min(h, Math.ceil(offsetY + (box.y + box.height) * scale));
  return sharp(rendering)
    .extract({
      left,
      top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
    })
    .png()
    .toBuffer();
}

// ---------------------------------------------------------------------------
// The import
// ---------------------------------------------------------------------------

/**
 * Build one slide per page: mapped where the page fits a type, and where it
 * does not, the rendered page of the PDF, or without a PDF the page's text
 * on a text slide; with the notes and a report.
 *
 * The PowerPoint file, when it comes, is the structure source and gives the
 * speaker notes; the PDF is then only rendered, and its page count must
 * pair with the visible slides. Without a PowerPoint file the PDF is read
 * as in track 1a.
 *
 * @param {object} opts
 * @param {import('./deck-images-import.js').DeckImageFiles} opts.files - From
 *   `readDeckImageFiles`: a PDF, a PowerPoint file, or both.
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
 * @throws {DeckImagesRefusal} neither file came, a file is unreadable or
 *   empty, or the PDF's page count does not pair with the PowerPoint file.
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
  if (!pdfBytes && !pptxBytes) {
    throw new DeckImagesRefusal('A PDF or a PowerPoint file is required');
  }
  const source = pdfBytes ? (pptxBytes ? 'both' : 'pdf') : 'pptx';

  const extracted = pptxBytes
    ? await readPptxSource(pptxBytes, { signal, onProgress })
    : await readPdfSource(pdfBytes, { signal, onProgress });
  if (source === 'both') {
    const pageCount = await countPdfPagesOrRefuse(pdfBytes, signal);
    if (pageCount !== extracted.pages.length) {
      throw countMismatch(pageCount, extracted.pages.length);
    }
  }
  const { pages, decorations } = findDecorations(extracted.pages);
  const speakerNotes = extracted.notes || null;

  // The PDF is the pixel source: a drawing can be cut out of its rendering.
  const pagePixels = Boolean(pdfBytes);
  const ctx = { slideTypes, theme, lang, presentationId, pagePixels };
  const plans = pages.map((page) => planPage(page, ctx));
  const cutsOut = (plan) => Boolean(plan.uploads?.some((u) => u.crop));
  const renderedPages = pagePixels
    ? pages
        .filter((_p, i) => plans[i].reason || cutsOut(plans[i]))
        .map((p) => p.page)
    : [];

  // Only the pages that fell back, or that a drawing is cut out of, are
  // rendered.
  const rendered = new Map();
  if (renderedPages.length) {
    const images = await renderPages({
      buffer: pdfBytes,
      width: 1920,
      height: 1080,
      pages: renderedPages,
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
  // A drawing without a rendering to cut it from keeps its page whole.
  pages.forEach((page, i) => {
    if (cutsOut(plans[i]) && !rendered.has(page.page)) {
      plans[i] = { reason: 'drawing' };
    }
  });

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
      errors.push({ page, code: 'upload-failed' });
      return '';
    }
  };

  const uploadCutOut = async (page, box, num, errors) => {
    let buffer;
    try {
      buffer = await cutOutOfRendering(rendered.get(page.page), page, box);
    } catch (err) {
      log.warn(
        `[import-slides] Could not cut page ${page.page}:`,
        err?.message,
      );
      errors.push({ page: page.page, code: 'not-rendered' });
      return '';
    }
    return upload(buffer, `page-${num}-drawing`, page.page, errors);
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
    // A reference mark says nothing once its footnote stands beside it.
    const notOnSlide = page.dropped
      .filter((d) => d.reason !== 'reference')
      .map((d) => d.text);
    // A picture the PowerPoint file holds in a format that does not become a
    // PNG is missing from the slide: the report names it (B829).
    for (const d of page.dropped) {
      if (d.reason === 'unsupported-image') {
        errors.push({ page: page.page, code: 'unsupported-image' });
      }
    }
    let slide;
    if (plan.reason && !pagePixels) {
      // No pixels to show: the heading and the text stay, as text where a
      // text slide holds them.
      const fallback = fallbackWithoutPixels(page, ctx);
      slide = fallback.slide;
      slide.notes = composeNotes({
        speakerNotes: speakerNotes?.[i],
        pageText: fallback.textOnSlide ? '' : pageText(page),
        notOnSlide: [
          ...notOnSlide,
          ...(page.drawing?.labels || []).map((l) => l.text),
        ],
        lang,
      });
    } else if (plan.reason) {
      const buffer = rendered.get(page.page);
      const image = buffer
        ? await upload(buffer, `page-${num}`, page.page, errors)
        : '';
      if (!buffer) {
        errors.push({ page: page.page, code: 'not-rendered' });
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
      for (const { key, index, crop } of plan.uploads) {
        slide.content[key] = crop
          ? await uploadCutOut(page, crop, num, errors)
          : await upload(
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
          ...plan.notOnSlide,
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
      source,
      slidesExtracted: pages.length,
      slidesConverted: reportPages.filter((p) => !p.reason).length,
      errors,
      pages: reportPages,
      decorations,
    },
  };
}

/**
 * The page model of the PDF, the structure source when no PowerPoint file
 * comes. No speaker notes.
 */
async function readPdfSource(pdfBytes, { signal, onProgress }) {
  onProgress('Reading the PDF...', { stage: 'reading', current: 0, total: 0 });
  let extracted;
  try {
    extracted = await extractPdfPages(new Uint8Array(pdfBytes), { signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    log.warn('[import-slides] unreadable PDF:', err?.message);
    throw new DeckImagesRefusal('The PDF could not be read');
  }
  if (extracted.pages.length === 0) {
    throw new DeckImagesRefusal('No pages found in PDF');
  }
  return { pages: extracted.pages, notes: null };
}

/**
 * The page model of the PowerPoint file, one page per visible slide, with
 * the speaker notes beside the pages.
 */
async function readPptxSource(pptxBytes, { signal, onProgress }) {
  onProgress('Reading the PowerPoint file...', {
    stage: 'reading',
    current: 0,
    total: 0,
  });
  let extracted;
  try {
    extracted = await extractPptxPages(pptxBytes, { signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    log.warn('[import-slides] unreadable PowerPoint file:', err?.message);
    throw new DeckImagesRefusal('The PowerPoint file could not be read');
  }
  if (extracted.pages.length === 0) {
    throw new DeckImagesRefusal('No slides found in the PowerPoint file');
  }
  return { pages: extracted.pages, notes: extracted.notes };
}

/** The pages of the PDF beside a PowerPoint file, to pair them. */
async function countPdfPagesOrRefuse(pdfBytes, signal) {
  try {
    return await countPdfPages(new Uint8Array(pdfBytes), { signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    log.warn('[import-slides] unreadable PDF:', err?.message);
    throw new DeckImagesRefusal('The PDF could not be read');
  }
}

/**
 * The report of an import, in the names the generation route's report uses
 * (`convert-file/index.js`), so one renderer shows both.
 * @typedef {object} DeckSlidesReport
 * @property {'pdf' | 'pptx' | 'both'} source - what the pages were read from
 *   ({@link IMPORT_SOURCES}): `pptx` has no pixels, so a page with a
 *   `reason` became a text slide instead of an image of itself
 * @property {number} slidesExtracted - pages read from the source
 * @property {number} slidesConverted - pages that became an editable slide
 * @property {Array<{ page: number, code: string }>} errors - one per picture
 *   that is missing, `code` from {@link REPORT_ERROR_CODES}
 * @property {Array<{ page: number, type: string, reason?: string, dropped: number }>} pages
 *   - one per page; `reason` (from {@link FALLBACK_REASONS}) on a page that
 *   fell back, `dropped` the lines of text not on the slide
 * @property {Array<{ pages: number[] }>} decorations - one per picture left
 *   out as decoration ({@link findDecorations}), with the pages it stood on
 */
