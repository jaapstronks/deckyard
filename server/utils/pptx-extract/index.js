/**
 * Read the structure of a PowerPoint deck: one page model per slide (B828).
 *
 * The second source of the page model `pdf-extract` defines (track 1b of
 * B755, beslissing 1): the same shape, so the slide import's mapper knows
 * only the model and not where it came from. Where the PDF route has to
 * rebuild structure out of positioned text runs, PresentationML states it:
 *
 * - the **heading** is the title placeholder (`title`, `ctrTitle`); a slide
 *   without one (a pptxgenjs deck has no placeholders) gets it by size and
 *   position through `findHeadingLines`, the rule `detectGeometry` applies
 *   to an untagged PDF;
 * - a paragraph with a bullet in force (`buChar`, `buAutoNum`, inherited
 *   from the layout or master as often as set on the slide) is a **list
 *   item**; a deeper paragraph under it is a next part of that item;
 * - an `a:tbl` is a **table** block; a `p:pic` an **image** with its box;
 * - a chart or diagram frame is a **drawing**, counted as
 *   {@link FRAME_DRAWING_PATHS} paths because it always is one; other
 *   painted shapes and connectors count one path each;
 * - the **background** is the slide's, else its layout's, else its
 *   master's `p:bg`, unless a solid shape covers the slide;
 * - footer, slide number and date placeholders, furniture fields and the
 *   text the layout and master paint are **dropped** as `artifact`, as a
 *   tagged PDF marks them (their pictures and shapes are template too and
 *   stay out); a picture in a format that does not become a PNG (SVG, EMF,
 *   WMF) is dropped as `unsupported-image`.
 *
 * Every page is `tagged`: its roles come from the package's structure, the
 * PowerPoint counterpart of a PDF's structure tree.
 *
 * Hidden slides are left out, as they are left out of a PDF export: page
 * `n` here is page `n` of the PDF of the same deck. The text is literal, a
 * paragraph whole (1a-beslissing 3). Pure computation: no uploads, no
 * storage, no HTTP, no browser.
 */

import {
  BACKGROUND_MIN_COVERAGE,
  DRAWING_PATH_MAX_COVERAGE,
  MIN_IMAGE_PIXELS,
  PAGE_WHITE,
  boxArea,
  findHeadingLines,
  unionBoxes,
} from '../pdf-extract/index.js';
import { openPackage, readSlideParts } from './package.js';
import {
  bodyPropsChain,
  listStyleChain,
  readShapes,
  shapeName,
  templateShapes,
} from './shapes.js';
import { placeParagraphs, readParagraphs } from './paragraphs.js';
import { readTable } from './tables.js';
import { readPicture } from './media.js';
import { colorOf, fillColor } from './colors.js';
import { child, numAttr, path } from './xml.js';

/**
 * A chart or diagram frame counts as this many paths: it is a drawing
 * whatever it holds, so it must count above any threshold a mapper puts on
 * vector paths (`deck-slides-import.js` takes 60, measured on Philips Q4
 * 2024). A test pins that the slide import reads such a page as a drawing.
 */
export const FRAME_DRAWING_PATHS = 1000;

/** Two shape tops this close (as a fraction of the slide height) share a row. */
export const READING_ROW_TOLERANCE = 0.03;

const TITLE_TYPES = new Set(['title', 'ctrTitle']);
const FURNITURE_TYPES = new Set(['dt', 'ftr', 'sldNum']);
const CHART_URI = /\/(chart|diagram)$/;
const TABLE_URI = /\/table$/;
const FILE_NAME = /\.(png|jpe?g|gif|webp|tiff?|bmp|svg|emf|wmf)$/i;

/**
 * Extract one page model per visible slide.
 *
 * @param {Buffer | Uint8Array} buffer - the PPTX bytes
 * @param {object} [opts]
 * @param {AbortSignal} [opts.signal] - checked before the package opens and
 *   between slides; an abort rejects with the signal's reason
 * @returns {Promise<{ pages: import('../pdf-extract/index.js').PageModel[], notes: string[], tagged: boolean, pageCount: number, size: { width: number, height: number } | null, metadata: { title?: string, author?: string } }>}
 *   `notes[i]` are the speaker notes of `pages[i]`; `pageCount` counts the
 *   visible slides, the pages a PDF export of the deck has
 */
export async function extractPptxPages(buffer, { signal } = {}) {
  signal?.throwIfAborted();
  const pkg = await openPackage(buffer);
  const pages = [];
  const notes = [];
  for (const entry of pkg.slides) {
    signal?.throwIfAborted();
    if (entry.hidden) continue;
    const parts = await readSlideParts(pkg, entry.part);
    if (!parts) continue;
    pages.push(await readSlide(pkg, parts, pages.length + 1));
    notes.push(entry.notes);
  }
  signal?.throwIfAborted();
  return {
    pages,
    notes,
    metadata: pkg.metadata,
    tagged: pages.length > 0,
    pageCount: pages.length,
    size: pages.length ? { ...pkg.size } : null,
  };
}

async function readSlide(pkg, parts, n) {
  const page = pkg.size;
  const pageArea = page.width * page.height;
  const ctx = parts.colors;
  const dropped = [];
  const images = [];
  const drawingBoxes = [];
  let paths = 0;
  let background = await backgroundOf(pkg, parts, images);

  const textOf = (shape) => {
    const style = {
      lists: listStyleChain(shape, {
        master: parts.master,
        defaultTextStyle: pkg.defaultTextStyle,
      }),
      colors: ctx,
      fontColor: colorOf(path(shape.el, 'p:style', 'a:fontRef'), ctx),
      fontScale:
        numAttr(
          path(shape.el, 'p:txBody', 'a:bodyPr', 'a:normAutofit'),
          'fontScale',
          100000,
        ) / 100000,
    };
    const paragraphs = readParagraphs(child(shape.el, 'p:txBody'), style);
    return shape.box
      ? placeParagraphs(paragraphs, shape.box, bodyPropsChain(shape))
      : [];
  };
  const drop = (para, reason, text = para.text) =>
    dropped.push({
      text,
      reason,
      x: para.x,
      y: para.y,
      size: para.size,
      segments: [{ text, x: para.x }],
    });
  const coversSlide = (shape) =>
    shape.box && boxArea(shape.box) >= BACKGROUND_MIN_COVERAGE * pageArea;
  // A painted shape this large is a background, not part of a drawing (the
  // bound `pdf-extract` puts on a path); a chart frame is a drawing at any size.
  const drawShape = (box) => {
    if (boxArea(box) < DRAWING_PATH_MAX_COVERAGE * pageArea)
      drawingBoxes.push(box);
  };

  // What the layout and master paint is template, as a tagged PDF marks it.
  for (const shape of templateShapes(parts)) {
    if (shape.kind !== 'sp') continue;
    const paint = paintOf(shape, ctx);
    if (paint.solid && coversSlide(shape)) background = { color: paint.solid };
    for (const para of textOf(shape)) {
      if (para.text) drop(para, 'artifact');
      for (const field of para.fields) drop(para, 'artifact', field);
    }
  }

  const units = [];
  for (const shape of readShapes(parts.slide, parts)) {
    if (!shape.box) continue;
    const offPage = !onPage(shape.box, page);
    if (shape.kind === 'sp') {
      const paint = paintOf(shape, ctx);
      if (paint.visible) paths += 1;
      if (paint.solid && coversSlide(shape))
        background = { color: paint.solid };
      const placed = textOf(shape);
      const furniture = FURNITURE_TYPES.has(shape.ph?.type);
      for (const para of placed) {
        for (const field of para.fields) drop(para, 'artifact', field);
        if (para.text && (furniture || offPage)) {
          drop(para, offPage ? 'off-page' : 'artifact');
        }
      }
      const text = placed.filter((p) => p.text);
      if (furniture || offPage) continue;
      if (text.length) units.push({ shape, paragraphs: placed });
      else if (paint.visible) drawShape(shape.box);
    } else if (shape.kind === 'pic') {
      if (offPage) continue;
      const picture = await pictureOf(pkg, parts.rels, shape);
      if (picture?.png) {
        const { width, height } = picture.pixels;
        if (width >= MIN_IMAGE_PIXELS && height >= MIN_IMAGE_PIXELS) {
          const image = {
            png: picture.png,
            box: shape.box,
            pixels: picture.pixels,
          };
          const alt = altOf(shape.el);
          if (alt) image.alt = alt;
          images.push(image);
        }
      } else if (picture?.unsupported) {
        const { name = '', descr = '' } = shapeName(shape.el);
        const text = descr || name || picture.unsupported;
        dropped.push({
          text,
          reason: 'unsupported-image',
          x: shape.box.x,
          y: shape.box.y,
          size: 0,
          segments: [{ text, x: shape.box.x }],
        });
      }
    } else if (shape.kind === 'graphicFrame') {
      const data = path(shape.el, 'a:graphic', 'a:graphicData');
      const uri = data?.attrs.uri || '';
      if (TABLE_URI.test(uri) && child(data, 'a:tbl')) {
        units.push({ shape, table: child(data, 'a:tbl') });
      } else {
        paths += CHART_URI.test(uri) ? FRAME_DRAWING_PATHS : 1;
        if (CHART_URI.test(uri)) drawingBoxes.push(shape.box);
        else drawShape(shape.box);
      }
    } else if (shape.kind === 'cxnSp') {
      paths += 1;
      drawShape(shape.box);
    }
  }

  const { heading, headingSource, blocks, lines } = readText(
    readingOrder(units, page),
    { page, parts, pkg },
  );
  return {
    page: n,
    width: page.width,
    height: page.height,
    tagged: true,
    heading,
    headingSource,
    lines,
    blocks,
    images,
    background,
    drawing: {
      paths,
      labels: [],
      tablePaths: 0,
      box: unionBoxes(drawingBoxes),
    },
    dropped,
  };
}

/**
 * Heading, blocks and lines out of the text units in reading order. The
 * title placeholder is the heading; without one, `findHeadingLines` picks it
 * out of every paragraph by size and position.
 */
function readText(units, { page, parts, pkg }) {
  const titleUnits = units.filter(
    (u) =>
      TITLE_TYPES.has(u.shape.ph?.type) && u.paragraphs.some((p) => p.text),
  );
  const headingParas = new Set();
  let headingSource = null;
  if (titleUnits.length) {
    for (const u of titleUnits) {
      for (const p of u.paragraphs) if (p.text) headingParas.add(p);
    }
    headingSource = 'struct';
  } else {
    const candidates = units.flatMap((u) =>
      (u.paragraphs || []).filter((p) => p.text),
    );
    for (const i of findHeadingLines(candidates, page)) {
      headingParas.add(candidates[i]);
    }
    if (headingParas.size) headingSource = 'geometry';
  }

  const ordered = [...headingParas];
  const lines = ordered.map((p) => lineOf(p, 'heading'));
  const blocks = [];
  for (const unit of units) {
    if (unit.table) {
      const { block, lines: cells } = readTable(unit.table, unit.shape.box, {
        lists: listStyleChain(
          { el: unit.shape.el, inherited: [], ph: null },
          { master: parts.master, defaultTextStyle: pkg.defaultTextStyle },
        ),
        colors: parts.colors,
      });
      blocks.push({ ...block, box: unit.shape.box });
      lines.push(...cells);
      continue;
    }
    const subtitle = unit.shape.ph?.type === 'subTitle';
    for (const block of paragraphBlocks(
      unit.paragraphs,
      headingParas,
      subtitle,
    )) {
      blocks.push(block.model);
      lines.push(...block.lines);
    }
  }
  return {
    heading: ordered.length ? ordered.map((p) => p.text).join(' ') : null,
    headingSource,
    blocks,
    lines,
  };
}

/**
 * The blocks of one text shape: consecutive bulleted paragraphs form a list
 * (a deeper paragraph joins the item above as a next part), every other
 * paragraph is a paragraph block. An empty paragraph ends a list.
 */
function paragraphBlocks(paragraphs, headingParas, subtitle) {
  const out = [];
  let list = null;
  for (const para of paragraphs) {
    if (!para.text) {
      list = null;
      continue;
    }
    if (headingParas.has(para)) continue;
    const item = list?.model.items.at(-1);
    if (item && para.level > list.level) {
      item.parts.push(para.text);
      item.text = item.parts.join(' ');
      list.lines.push(lineOf(para, 'list-item'));
      list.boxes.push(para.box);
      continue;
    }
    if (para.bullet && !subtitle) {
      if (!list || list.model.variant !== para.bullet) {
        list = {
          level: para.level,
          model: { kind: 'list', y: para.y, variant: para.bullet, items: [] },
          lines: [],
          boxes: [],
        };
        out.push(list);
      }
      list.model.items.push({ text: para.text, parts: [para.text] });
      list.lines.push(lineOf(para, 'list-item'));
      list.boxes.push(para.box);
      continue;
    }
    list = null;
    out.push({
      model: {
        kind: 'para',
        y: para.y,
        text: para.text,
        bold: para.bold,
        size: para.size,
      },
      lines: [lineOf(para, 'para')],
      boxes: [para.box],
    });
  }
  return out.map(({ model, lines, boxes }) => ({
    model: { ...model, box: unionBoxes(boxes) },
    lines,
  }));
}

function lineOf(para, role) {
  const { text, x, y, width, size, bold, color } = para;
  return { text, x, y, width, size, bold, color, role };
}

/**
 * Units top to bottom, and left to right among those whose tops are within
 * {@link READING_ROW_TOLERANCE} of each other: two columns side by side read
 * left column first.
 */
function readingOrder(units, page) {
  const tolerance = READING_ROW_TOLERANCE * page.height;
  const byTop = [...units].sort((a, b) => a.shape.box.y - b.shape.box.y);
  const rows = [];
  for (const unit of byTop) {
    const row = rows.at(-1);
    if (row && unit.shape.box.y - row[0].shape.box.y <= tolerance)
      row.push(unit);
    else rows.push([unit]);
  }
  return rows.flatMap((row) =>
    row.sort((a, b) => a.shape.box.x - b.shape.box.x),
  );
}

function onPage(box, page) {
  return (
    box.x < page.width &&
    box.y < page.height &&
    box.x + box.width > 0 &&
    box.y + box.height > 0
  );
}

/**
 * How a shape paints: `solid` is its fill colour when it has one, `visible`
 * whether it paints anything (a fill, a line, or the theme's through its
 * `p:style`), which makes it a path of the drawing.
 */
function paintOf(shape, ctx) {
  const spPr = child(shape.el, 'p:spPr');
  const style = child(shape.el, 'p:style');
  const fill = fillColor(spPr, ctx);
  const themed = (ref) => numAttr(child(style, ref), 'idx', 0) > 0;
  const filled =
    fill === 'none'
      ? false
      : Boolean(fill) ||
        Boolean(child(spPr, 'a:blipFill')) ||
        themed('a:fillRef');
  const lineFill = fillColor(child(spPr, 'a:ln'), ctx);
  const lined =
    lineFill === 'none' ? false : Boolean(lineFill) || themed('a:lnRef');
  const solid =
    fill && fill !== 'none'
      ? fill
      : !fill && themed('a:fillRef')
        ? colorOf(child(style, 'a:fillRef'), ctx)
        : null;
  return { solid: filled ? solid : null, visible: filled || lined };
}

/**
 * The slide's background: its own `p:bg`, else its layout's, else its
 * master's. A picture fill adds the picture as an image over the whole
 * slide and leaves the colour white, as `pdf-extract` reports a page whose
 * only cover is a picture.
 */
async function backgroundOf(pkg, parts, images) {
  const levels = [
    { el: parts.slide, rels: parts.rels },
    { el: parts.layout, part: parts.partNames.layout },
    { el: parts.master, part: parts.partNames.master },
  ];
  for (const level of levels) {
    const bg = path(level.el, 'p:cSld', 'p:bg');
    if (!bg) continue;
    const bgPr = child(bg, 'p:bgPr');
    const embed = path(bgPr, 'a:blipFill', 'a:blip')?.attrs['r:embed'];
    if (embed) {
      const rels = level.rels || (level.part ? await pkg.rels(level.part) : []);
      const target = rels.find((r) => r.id === embed)?.target;
      const picture = target ? await readPicture(pkg.zip, target) : null;
      if (picture?.png) {
        images.push({
          png: picture.png,
          box: { x: 0, y: 0, width: pkg.size.width, height: pkg.size.height },
          pixels: picture.pixels,
        });
      }
      return { color: PAGE_WHITE };
    }
    const color = bgPr
      ? fillColor(bgPr, parts.colors)
      : colorOf(child(bg, 'p:bgRef'), parts.colors);
    if (color && color !== 'none') return { color };
    return { color: PAGE_WHITE };
  }
  return { color: PAGE_WHITE };
}

async function pictureOf(pkg, rels, shape) {
  const embed = path(shape.el, 'p:blipFill', 'a:blip')?.attrs['r:embed'];
  const target = embed && rels.find((r) => r.id === embed)?.target;
  return target ? readPicture(pkg.zip, target) : null;
}

/** The picture's description, unless it is only its file name. */
function altOf(el) {
  const { descr = '' } = shapeName(el);
  const alt = descr.trim();
  return alt && !FILE_NAME.test(alt) ? alt : null;
}
