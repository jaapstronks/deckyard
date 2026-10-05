/**
 * Layer 0 of the editable PPTX: any slide, from its semantic projection, onto
 * the theme's layouts (B290, station 3 PR 3 of
 * `docs/plans/briefs/pptx-fidelity-tiers.md`).
 *
 * ## Why the projection, and why its HTML
 *
 * The reader projection (`shared/slide-types/semantic-projection.js`) is the
 * one place that already knows, for every type, core or custom, what a slide
 * *says*: its heading, its paragraphs, its lists, its tables, its pictures and
 * their alt text. It knows that from the field declarations, not from the type
 * name. Layer 0 reads that answer instead of asking the type a second time, so
 * there is no per-type code here and no way for this module to disagree with
 * the reader about what is on a slide.
 *
 * The answer arrives as HTML, a small and documented vocabulary (`h2`, `p`,
 * `h3`, `ul`/`ol`/`li`, `table`, `figure`/`img`/`figcaption`, `blockquote`,
 * `a`, `strong`/`em`). It is parsed back into blocks here rather than having
 * the projection grow a second output shape: one projection, one shape, and
 * the parser is the only thing that has to follow it.
 *
 * ## What layer 0 is, and is not
 *
 * Correct and generic, not beautiful. A timeline becomes a numbered list, a
 * kpi grid a list of label and value. Whether that is good enough for a type
 * is Jaap's call at gate A2.8, made against this output; a type that needs
 * more gets its own mapper (PR 5+). Best effort, per D127.
 *
 * ## Three things done by hand
 *
 * Measured in the B232 spike, and the reason this module has arithmetic in it:
 *
 * - **A line budget.** pptxgenjs writes no usable autofit (`fit: 'shrink'` is a
 *   bare `<a:normAutofit/>` that PowerPoint only acts on after a manual
 *   resize), so the body size is chosen here: the largest size, from the
 *   theme's `lg` step down to a floor, at which the estimated lines fit
 *   the box. Past the floor the text overflows and the export says so.
 * - **Image frames.** `sizing` is a no-op in Node; each picture is read for its
 *   real pixel size and its frame fitted to it (`pptx-image.js`).
 * - **Bullets per level, and the table header.** pptxgenjs writes the same `•`
 *   on every level and never sets `firstRow`; both are set here, the second by
 *   a pass over the written package ({@link finishEditablePackage}).
 */

import { JSDOM } from 'jsdom';
import JSZip from 'jszip';

import { slideTypeSample } from '../../shared/slide-types/authoring-companions.js';
import { renderSlideSectionHtml } from '../../shared/slide-types/semantic-projection.js';
import { PPTX_LAYOUTS, layoutBox, themeTextPt } from './pptx-theme.js';
import { containInBox, rasterForPptx } from './pptx-image.js';

/** The smallest body size the line budget may choose before it gives up. */
export const MIN_BODY_PT = 10;
/** The smallest heading size, for a title too long for its box. */
export const MIN_HEADING_PT = 16;
/**
 * Average advance of a glyph, as a share of the font size. A Latin text face
 * sets around half an em per character; the budget errs a little wide, since
 * an estimate that overflows is worse than one that leaves room.
 */
const CHAR_EM = 0.52;
/** Line height, as a multiple of the font size (PowerPoint's single spacing). */
const LINE_HEIGHT = 1.2;
/** Space after each paragraph, as a share of the font size. */
const PARA_SPACE = 0.5;
/** OOXML's default text-box insets, in inches: 0.1 left/right, 0.05 top/bottom. */
const INSET_X = 0.2;
const INSET_Y = 0.1;
/** pptxgenjs' hanging indent per list level, in inches (`DEF_BULLET_MARGIN`). */
const LEVEL_INDENT = 27 / 72;
/** Vertical gap between two blocks stacked in one region, in inches. */
const BLOCK_GAP = 0.15;
/** The cell margins pptxgenjs writes, in inches (top + bottom, left + right). */
const CELL_PAD_Y = 0.1;
const CELL_PAD_X = 0.2;
/** Room under a picture for its caption, in inches. */
const CAPTION_H = 0.4;

/**
 * The bullet glyph per list level, so a nesting difference reads as more than
 * an indent (pptxgenjs writes `•` everywhere).
 */
const BULLET_GLYPHS = Object.freeze(['2022', '2013', '25E6']);

/**
 * The object name a table with a header row is written under, so the pass over
 * the package can find it. pptxgenjs prefixes nothing: the name is ours.
 */
const HEADER_TABLE_NAME = 'Table with header row';

// ---------------------------------------------------------------------------
// The projection, parsed into blocks
// ---------------------------------------------------------------------------

/**
 * @typedef {{ text: string, bold?: boolean, italic?: boolean,
 *   href?: string, slide?: number }} Run
 * @typedef {{ lines: Run[][], level: number,
 *   bullet: null|{ kind: 'bullet' }|{ kind: 'number', n: number } }} Paragraph
 * @typedef {{ kind: 'text', paragraphs: Paragraph[] }} TextBlock
 * @typedef {{ kind: 'table', header: boolean, rows: string[][],
 *   caption: string }} TableBlock
 * @typedef {{ kind: 'image', src: string, alt: string, caption: string }} ImageBlock
 * @typedef {{ heading: { text: string, visible: boolean },
 *   blocks: Array<TextBlock|TableBlock|ImageBlock> }} SlideBlocks
 */

/** Elements whose content is laid out as runs inside a paragraph. */
const INLINE = new Set([
  'a',
  'abbr',
  'b',
  'br',
  'cite',
  'code',
  'del',
  'em',
  'i',
  'ins',
  'kbd',
  'mark',
  's',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'time',
  'u',
]);

/** Block elements that are a paragraph of their own. */
const PARAGRAPH = new Set([
  'p',
  'h1',
  'h3',
  'h4',
  'h5',
  'h6',
  'dt',
  'dd',
  'pre',
]);

/** Paragraph elements whose text is set bold: a label above its value. */
const BOLD_PARAGRAPH = new Set(['h1', 'h3', 'h4', 'h5', 'h6', 'dt']);

function tagOf(node) {
  return node?.nodeType === 1 ? node.tagName.toLowerCase() : '';
}

function isHidden(node) {
  return node?.nodeType === 1 && node.classList.contains('sr-only');
}

/**
 * The runs of an inline subtree. Whitespace collapses the way a browser
 * collapses it; a `<br>` ends a line.
 *
 * @param {Node} node
 * @param {{ bold?: boolean, italic?: boolean, href?: string, slide?: number }} fmt
 * @param {Run[][]} lines - appended to: the last line is the current one
 */
function collectInline(node, fmt, lines) {
  if (node.nodeType === 3) {
    const text = node.textContent.replace(/\s+/g, ' ');
    if (text) lines[lines.length - 1].push({ text, ...fmt });
    return;
  }
  if (node.nodeType !== 1 || isHidden(node)) return;
  const tag = tagOf(node);
  if (tag === 'br') {
    lines.push([]);
    return;
  }
  const next = { ...fmt };
  if (tag === 'strong' || tag === 'b') next.bold = true;
  if (tag === 'em' || tag === 'i' || tag === 'cite') next.italic = true;
  if (tag === 'a') Object.assign(next, linkTarget(node.getAttribute('href')));
  for (const child of node.childNodes) collectInline(child, next, lines);
}

/**
 * Where a link in the projection goes, as pptxgenjs wants it: a slide jump
 * (`#slide-3`, the reader's own anchors) or a URL. Anything else drops the link
 * and keeps the words.
 *
 * @param {string|null} href
 * @returns {{ href?: string, slide?: number }}
 */
function linkTarget(href) {
  const s = String(href || '').trim();
  const jump = /^#slide-(\d+)$/.exec(s);
  if (jump) return { slide: Number(jump[1]) };
  if (/^(https?:|mailto:)/i.test(s)) return { href: s };
  return {};
}

/** Trim a paragraph's lines at their edges, and drop lines left empty. */
function tidyLines(lines) {
  const out = [];
  for (const line of lines) {
    const runs = line.filter((r) => r.text);
    if (!runs.length) continue;
    runs[0] = { ...runs[0], text: runs[0].text.replace(/^\s+/, '') };
    const last = runs.length - 1;
    runs[last] = { ...runs[last], text: runs[last].text.replace(/\s+$/, '') };
    const kept = runs.filter((r) => r.text);
    if (kept.length) out.push(kept);
  }
  return out;
}

/** The plain text of a subtree, collapsed, for table cells and captions. */
function plainText(node) {
  return String(node?.textContent || '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Walk the projection's section into blocks.
 *
 * `ctx.item` is the list item being filled, when there is one: everything an
 * item holds that is not a nested list joins its one paragraph as another
 * line, so the item keeps its hanging indent instead of a second paragraph
 * falling back to the margin.
 */
class BlockWalker {
  constructor() {
    /** @type {Array<TextBlock|TableBlock|ImageBlock>} */
    this.blocks = [];
  }

  /** @param {Paragraph} paragraph */
  pushParagraph(paragraph) {
    if (!paragraph.lines.length) return;
    const last = this.blocks[this.blocks.length - 1];
    if (last?.kind === 'text') last.paragraphs.push(paragraph);
    else this.blocks.push({ kind: 'text', paragraphs: [paragraph] });
  }

  /**
   * @param {Node} parent
   * @param {{ level: number, italic?: boolean, item?: Paragraph|null }} ctx
   */
  walkChildren(parent, ctx) {
    // Consecutive inline children of a block container are one paragraph:
    // `<div>Some <em>text</em></div>` says one thing, not three.
    let pending = [[]];
    const flush = () => {
      this.addLines(pending, ctx, false);
      pending = [[]];
    };
    for (const child of parent.childNodes) {
      const tag = tagOf(child);
      if (child.nodeType === 3 || INLINE.has(tag)) {
        collectInline(child, { italic: ctx.italic }, pending);
        continue;
      }
      flush();
      if (child.nodeType === 1) this.walkBlock(child, ctx);
    }
    flush();
  }

  /**
   * Lines into the current item, or as a paragraph of their own.
   *
   * @param {Run[][]} rawLines
   * @param {{ level: number, item?: Paragraph|null }} ctx
   * @param {boolean} bold
   */
  addLines(rawLines, ctx, bold) {
    const lines = tidyLines(rawLines).map((line) =>
      bold ? line.map((r) => ({ ...r, bold: true })) : line,
    );
    if (!lines.length) return;
    if (ctx.item) {
      ctx.item.lines.push(...lines);
      return;
    }
    this.pushParagraph({ lines, level: 0, bullet: null });
  }

  /**
   * @param {Element} el
   * @param {{ level: number, italic?: boolean, item?: Paragraph|null }} ctx
   */
  walkBlock(el, ctx) {
    if (isHidden(el)) return;
    const tag = tagOf(el);
    if (tag === 'h2') return; // the slide heading: read by headingOf()
    if (PARAGRAPH.has(tag)) {
      const lines = [[]];
      for (const child of el.childNodes)
        collectInline(child, { italic: ctx.italic }, lines);
      this.addLines(lines, ctx, BOLD_PARAGRAPH.has(tag));
      return;
    }
    if (tag === 'ul' || tag === 'ol') {
      this.walkList(el, tag === 'ol', ctx);
      return;
    }
    if (tag === 'table') {
      this.walkTable(el);
      return;
    }
    if (tag === 'figure') {
      this.walkFigure(el, ctx);
      return;
    }
    if (tag === 'img') {
      this.pushImage(el, '');
      return;
    }
    if (tag === 'blockquote') {
      this.walkChildren(el, { ...ctx, italic: true });
      return;
    }
    if (tag === 'hr' || tag === 'script' || tag === 'style') return;
    // div, section, footer, header, dl, aside, …: a container, not a meaning.
    this.walkChildren(el, ctx);
  }

  /**
   * One paragraph per item, at one level deeper than the list's parent; a
   * nested list follows its item as paragraphs one level deeper again.
   */
  walkList(listEl, ordered, ctx) {
    const level = ctx.item ? ctx.level + 1 : ctx.level;
    let n = 0;
    for (const li of listEl.children) {
      if (tagOf(li) !== 'li' || isHidden(li)) continue;
      n += 1;
      /** @type {Paragraph} */
      const item = {
        lines: [],
        level,
        bullet: ordered ? { kind: 'number', n } : { kind: 'bullet' },
      };
      // The item's own paragraph goes in before anything nested in it, so a
      // sub-list lands after its parent line.
      const at = this.reserveParagraph(item);
      const nestedCtx = { ...ctx, level, item };
      let pending = [[]];
      const flush = () => {
        this.addLines(pending, nestedCtx, false);
        pending = [[]];
      };
      for (const child of li.childNodes) {
        const tag = tagOf(child);
        if (child.nodeType === 3 || INLINE.has(tag)) {
          collectInline(child, { italic: ctx.italic }, pending);
          continue;
        }
        flush();
        if (tag === 'ul' || tag === 'ol') {
          this.walkList(child, tag === 'ol', nestedCtx);
        } else if (child.nodeType === 1) {
          this.walkBlock(child, nestedCtx);
        }
      }
      flush();
      if (!item.lines.length) at.remove();
    }
  }

  /**
   * Put an item's paragraph in place now and fill it later.
   *
   * @param {Paragraph} item
   * @returns {{ remove: () => void }}
   */
  reserveParagraph(item) {
    const last = this.blocks[this.blocks.length - 1];
    const block =
      last?.kind === 'text' ? last : { kind: 'text', paragraphs: [] };
    if (block !== last) this.blocks.push(block);
    block.paragraphs.push(item);
    return {
      remove: () => {
        const i = block.paragraphs.indexOf(item);
        if (i >= 0) block.paragraphs.splice(i, 1);
        if (!block.paragraphs.length) {
          const j = this.blocks.indexOf(block);
          if (j >= 0) this.blocks.splice(j, 1);
        }
      },
    };
  }

  walkTable(tableEl) {
    const rows = [];
    let header = false;
    for (const tr of tableEl.querySelectorAll('tr')) {
      if (tr.closest('table') !== tableEl) continue;
      const cells = [...tr.children].filter((c) =>
        ['th', 'td'].includes(tagOf(c)),
      );
      if (!cells.length) continue;
      if (!rows.length) {
        header =
          tagOf(tr.parentElement) === 'thead' ||
          cells.every((c) => tagOf(c) === 'th');
      }
      rows.push(cells.map(plainText));
    }
    if (!rows.length) return;
    const captionEl = [...tableEl.children].find((c) => tagOf(c) === 'caption');
    this.blocks.push({
      kind: 'table',
      header,
      rows,
      caption: plainText(captionEl),
    });
  }

  walkFigure(figureEl, ctx) {
    const captionEl = figureEl.querySelector('figcaption');
    const caption = plainText(captionEl);
    const imgs = [...figureEl.querySelectorAll('img')].filter(
      (img) => !img.closest('.sr-only'),
    );
    // A figure without a picture is a stand-in the projection wrote (a video,
    // an embed): its words are the content.
    if (!imgs.length) {
      this.walkChildren(figureEl, ctx);
      return;
    }
    imgs.forEach((img, i) =>
      this.pushImage(img, i === imgs.length - 1 ? caption : ''),
    );
    // Text a figure carries besides its pictures and caption (a gallery's
    // item headings, a media link) stays text.
    for (const child of figureEl.children) {
      const tag = tagOf(child);
      if (tag === 'img' || tag === 'figcaption') continue;
      if (child.querySelector('img')) continue;
      this.walkBlock(child, ctx);
    }
  }

  pushImage(img, caption) {
    const src = String(img.getAttribute('src') || '').trim();
    if (!src) return;
    this.blocks.push({
      kind: 'image',
      src,
      alt: String(img.getAttribute('alt') || ''),
      caption,
    });
  }
}

/**
 * The slide heading as the projection decided it: its text, and whether the
 * canvas shows it. A hidden heading is the slide's *name* (D129b), not text on
 * it, so it does not go into the title box.
 */
function headingOf(section) {
  const h2 = section?.querySelector('h2');
  return {
    text: plainText(h2),
    visible: !!h2 && !h2.classList.contains('sr-only'),
  };
}

/**
 * A slide's projection as blocks: the heading, then paragraphs, tables and
 * pictures in reading order.
 *
 * @param {object} slide
 * @param {object|null|undefined} def - the resolved definition; a type that
 *   does not resolve projects as an archived slide, like the reader's
 * @param {{ index?: number, lang?: string, slideIds?: string[] }} [opts]
 * @returns {SlideBlocks}
 */
export function slideBlocks(slide, def, { index = 0, lang, slideIds } = {}) {
  const html = renderSlideSectionHtml(slide, def, { index, lang, slideIds });
  const fragment = JSDOM.fragment(html);
  const section = fragment.querySelector('section') || fragment;
  const walker = new BlockWalker();
  walker.walkChildren(section, { level: 0, item: null });
  return { heading: headingOf(section), blocks: walker.blocks };
}

/**
 * Whether layer 0 can stand behind a type's claim to an editable slide (D306).
 *
 * A `native` or `mixed` claim without a mapper of its own is composed here, so
 * the claim is true when layer 0 finds something to write: the type's example
 * slide (its defaults under its sample, the content the picker inserts) has to
 * project to at least one text object, a visible heading, a paragraph or a
 * table. Pictures alone do not count, since an editable slide of only pictures
 * is the raster export with extra steps.
 *
 * @param {string} type - registry type name, for the core sample lookup
 * @param {object|null|undefined} def - the resolved definition
 * @returns {boolean}
 */
export function layerZeroCovers(type, def) {
  const content = {
    ...(def?.defaults || {}),
    ...(slideTypeSample(type, def) || {}),
  };
  const { heading, blocks } = slideBlocks(
    { id: 'layer-0', type, content },
    def,
  );
  return (
    (heading.visible && Boolean(heading.text)) ||
    blocks.some((block) => block.kind !== 'image')
  );
}

// ---------------------------------------------------------------------------
// The line budget
// ---------------------------------------------------------------------------

/** Characters in a line of runs. */
function lineChars(line) {
  return line.reduce((n, r) => n + r.text.length, 0);
}

/** Lines a text of `chars` characters wraps to at `pt` in `widthIn`. */
function wrappedLines(chars, pt, widthIn) {
  const perLine = Math.max(1, Math.floor((widthIn * 72) / (pt * CHAR_EM)));
  return Math.max(1, Math.ceil(chars / perLine));
}

/** Height, in inches, of a text block set at `pt` in a box `widthIn` wide. */
export function textBlockHeight(block, pt, widthIn) {
  let lines = 0;
  for (const p of block.paragraphs) {
    const w = widthIn - INSET_X - (p.bullet ? (p.level + 1) * LEVEL_INDENT : 0);
    for (const line of p.lines) lines += wrappedLines(lineChars(line), pt, w);
  }
  const spacing = (block.paragraphs.length - 1) * pt * PARA_SPACE;
  return (lines * pt * LINE_HEIGHT + spacing) / 72 + INSET_Y;
}

/** Height, in inches, of a table set at `pt` in a box `widthIn` wide. */
function tableBlockHeight(block, pt, widthIn) {
  const cols = Math.max(...block.rows.map((r) => r.length));
  const colW = widthIn / cols - CELL_PAD_X;
  let h = 0;
  for (const row of block.rows) {
    const lines = Math.max(
      1,
      ...row.map((cell) => wrappedLines(cell.length, pt, colW)),
    );
    h += (lines * pt * LINE_HEIGHT) / 72 + CELL_PAD_Y;
  }
  if (block.caption) {
    h +=
      BLOCK_GAP +
      (wrappedLines(block.caption.length, pt, widthIn) * pt * LINE_HEIGHT) /
        72 +
      INSET_Y;
  }
  return h;
}

/**
 * Width, in inches, a text block needs at `pt` to set its longest line
 * unwrapped: the box for text that sits on a chip as wide as its words (the
 * canvas' `width: fit-content`), before the caller caps it.
 */
export function textBlockWidth(block, pt) {
  let chars = 0;
  for (const p of block.paragraphs) {
    for (const line of p.lines) chars = Math.max(chars, lineChars(line));
  }
  return (chars * pt * CHAR_EM) / 72 + INSET_X;
}

function blockHeight(block, pt, widthIn) {
  return block.kind === 'table'
    ? tableBlockHeight(block, pt, widthIn)
    : textBlockHeight(block, pt, widthIn);
}

/**
 * The largest size from `start` down to `floor`, in whole points, at which the
 * blocks stacked in `box` fit it.
 *
 * @returns {{ pt: number, fits: boolean }}
 */
export function fitSize(blocks, box, start, floor) {
  const top = Math.max(floor, Math.floor(start));
  for (let pt = top; pt >= floor; pt -= 1) {
    const total =
      blocks.reduce((h, b) => h + blockHeight(b, pt, box.w), 0) +
      Math.max(0, blocks.length - 1) * BLOCK_GAP;
    if (total <= box.h) return { pt, fits: true };
  }
  return { pt: floor, fits: false };
}

// ---------------------------------------------------------------------------
// Onto the layouts
// ---------------------------------------------------------------------------

/**
 * Which of the three layouts a slide goes on, from the shape of its blocks
 * alone. Pictures beside text take the image layout; a slide that is a heading
 * and at most two short lines (a cover, a chapter, a closing slide) takes the
 * title layout; everything else is heading and body.
 *
 * @param {SlideBlocks} projected
 * @returns {keyof typeof PPTX_LAYOUTS}
 */
export function chooseLayout({ blocks }) {
  const images = blocks.filter((b) => b.kind === 'image');
  const flow = blocks.filter((b) => b.kind !== 'image');
  if (images.length && flow.length) return 'headingImageBody';
  if (images.length) return 'headingBody';
  if (flow.some((b) => b.kind === 'table')) return 'headingBody';
  const paragraphs = flow.flatMap((b) => b.paragraphs);
  const short =
    paragraphs.length <= 2 &&
    paragraphs.every((p) => !p.bullet) &&
    paragraphs.reduce(
      (n, p) => n + p.lines.reduce((m, l) => m + lineChars(l), 0),
      0,
    ) <= 160;
  return short ? 'title' : 'headingBody';
}

/**
 * A paragraph list as pptxgenjs text runs. Paragraph options ride on the
 * first run (pptxgenjs reads them there), a line break inside a paragraph is a
 * soft break, and every run names its colour, since there is no theme text
 * colour to inherit (B232).
 *
 * @param {Paragraph[]} paragraphs
 * @param {{ pt: number, color: string, face?: string }} style
 * @returns {Array<{ text: string, options: object }>}
 */
export function paragraphRuns(paragraphs, style) {
  const out = [];
  paragraphs.forEach((p, pi) => {
    p.lines.forEach((line, li) => {
      line.forEach((run, ri) => {
        const options = {
          fontSize: style.pt,
          color: style.color,
          ...(style.face ? { fontFace: style.face } : {}),
          ...(run.bold ? { bold: true } : {}),
          ...(run.italic ? { italic: true } : {}),
        };
        if (run.slide) options.hyperlink = { slide: run.slide };
        else if (run.href) options.hyperlink = { url: run.href };
        if (li > 0 && ri === 0) options.softBreakBefore = true;
        if (li === 0 && ri === 0) {
          Object.assign(options, paragraphOptions(p, style.pt));
        }
        const lastRun = li === p.lines.length - 1 && ri === line.length - 1;
        if (lastRun && pi < paragraphs.length - 1) options.breakLine = true;
        out.push({ text: run.text, options });
      });
    });
  });
  return out;
}

/** The paragraph half of a run's options: bullet, level, spacing. */
function paragraphOptions(p, pt) {
  const options = { paraSpaceAfter: Math.round(pt * PARA_SPACE) };
  if (p.level > 0) options.indentLevel = p.level;
  if (!p.bullet) {
    options.bullet = false;
  } else if (p.bullet.kind === 'number') {
    // Numbered explicitly: a run of items is numbered from its own list, not
    // from whatever paragraph PowerPoint thinks came before it.
    options.bullet = { type: 'number', numberStartAt: p.bullet.n };
  } else {
    options.bullet = {
      characterCode: BULLET_GLYPHS[Math.min(p.level, BULLET_GLYPHS.length - 1)],
    };
  }
  return options;
}

/**
 * A dashed frame with words in it, where a picture should be: the alt text of
 * one that could not travel, or the placeholder of a frame left empty.
 *
 * @param {object} pptxSlide
 * @param {string} text
 * @param {{x: number, y: number, w: number, h: number}} frame - inches
 * @param {{ spec: { textMuted: string }, pt: number }} style
 */
export function placeStandIn(pptxSlide, text, frame, { spec, pt }) {
  pptxSlide.addText(text, {
    ...frame,
    fontSize: pt,
    italic: true,
    color: spec.textMuted,
    align: 'center',
    valign: 'middle',
    line: { color: spec.textMuted, width: 0.75, dashType: 'dash' },
  });
}

/**
 * Pictures tiled into a box, each in its own cell and fitted to its own
 * ratio, with its caption under it.
 */
async function placeImages(pptxSlide, images, box, ctx) {
  const n = images.length;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const gap = BLOCK_GAP;
  const cellW = (box.w - gap * (cols - 1)) / cols;
  const cellH = (box.h - gap * (rows - 1)) / rows;
  for (let i = 0; i < n; i++) {
    const img = images[i];
    const cell = {
      x: box.x + (i % cols) * (cellW + gap),
      y: box.y + Math.floor(i / cols) * (cellH + gap),
      w: cellW,
      h: cellH,
    };
    const frame = img.caption ? { ...cell, h: cell.h - CAPTION_H } : cell;
    const raster = await rasterForPptx(ctx.repoRoot, img.src, {
      maxPx: { w: Math.round(frame.w * 192), h: Math.round(frame.h * 192) },
      embedRemote: true,
    });
    if (raster) {
      pptxSlide.addImage({
        data: raster.data,
        ...containInBox(raster, frame),
        altText: img.alt,
      });
    } else {
      // The picture could not travel; its alt text says what was there.
      placeStandIn(pptxSlide, img.alt || img.src, frame, {
        spec: ctx.spec,
        pt: ctx.captionPt,
      });
      ctx.warnings.push(
        `Slide ${ctx.slideNum}: image ${img.src} could not be embedded; its alt text stands in.`,
      );
    }
    if (img.caption) {
      pptxSlide.addText(img.caption, {
        x: cell.x,
        y: cell.y + cell.h - CAPTION_H,
        w: cell.w,
        h: CAPTION_H,
        fontSize: ctx.captionPt,
        color: ctx.spec.textMuted,
        ...(ctx.spec.bodyFont ? { fontFace: ctx.spec.bodyFont } : {}),
        valign: 'top',
      });
    }
  }
}

/** A table block as a pptxgenjs table at `box`, set at `pt`. */
function placeTable(pptxSlide, block, box, pt, spec) {
  const cols = Math.max(...block.rows.map((r) => r.length));
  const border = { type: 'solid', pt: 0.75, color: spec.textMuted };
  const rows = block.rows.map((row, ri) =>
    Array.from({ length: cols }, (_, ci) => ({
      text: row[ci] ?? '',
      options: {
        fontSize: pt,
        color: spec.text,
        ...(spec.bodyFont ? { fontFace: spec.bodyFont } : {}),
        ...(block.header && ri === 0 ? { bold: true } : {}),
        border,
      },
    })),
  );
  const tableH = tableBlockHeight({ ...block, caption: '' }, pt, box.w);
  pptxSlide.addTable(rows, {
    x: box.x,
    y: box.y,
    w: box.w,
    colW: Array.from({ length: cols }, () => box.w / cols),
    ...(block.header ? { objectName: HEADER_TABLE_NAME } : {}),
  });
  if (block.caption) {
    pptxSlide.addText(block.caption, {
      x: box.x,
      y: box.y + tableH + BLOCK_GAP,
      w: box.w,
      h: box.h - tableH - BLOCK_GAP,
      fontSize: pt,
      color: spec.textMuted,
      ...(spec.bodyFont ? { fontFace: spec.bodyFont } : {}),
      valign: 'top',
    });
  }
}

/**
 * Text, tables and their order, stacked in one region at one size.
 *
 * A region holding a single text block writes it into the layout's own
 * placeholder, which keeps the slide's outline in PowerPoint; anything mixed
 * is laid out as boxes, since a placeholder's geometry is copied from the
 * layout and cannot be moved (B232).
 */
function placeFlow(pptxSlide, flow, region, placeholder, pt, spec, color) {
  const style = { pt, color, face: spec.bodyFont || undefined };
  if (flow.length === 1 && flow[0].kind === 'text') {
    pptxSlide.addText(paragraphRuns(flow[0].paragraphs, style), {
      placeholder,
    });
    return;
  }
  let y = region.y;
  for (const block of flow) {
    const h = blockHeight(block, pt, region.w);
    const box = { x: region.x, y, w: region.w, h };
    if (block.kind === 'table') placeTable(pptxSlide, block, box, pt, spec);
    else
      pptxSlide.addText(paragraphRuns(block.paragraphs, style), {
        ...box,
        valign: 'top',
      });
    y += h + BLOCK_GAP;
  }
}

/**
 * Write one slide through layer 0.
 *
 * @param {object} pptx - the pptxgenjs instance, its layouts already defined
 *   (`applyThemeToPptx`)
 * @param {object} slide - the stored slide
 * @param {object|null|undefined} def - its resolved definition
 * @param {{ repoRoot: string, spec: ReturnType<typeof import('./pptx-theme.js').resolveThemeMaster>,
 *   slideNum: number, lang?: string, slideIds?: string[] }} ctx
 * @returns {Promise<{ pptxSlide: object, warnings: string[] }>}
 */
export async function composeGenericSlide(pptx, slide, def, ctx) {
  const { spec, slideNum } = ctx;
  const warnings = [];
  const projected = slideBlocks(slide, def, {
    index: slideNum - 1,
    lang: ctx.lang,
    slideIds: ctx.slideIds,
  });
  const layout = chooseLayout(projected);
  if (!projected.blocks.length && !projected.heading.visible) {
    // The projection says nothing a reader sees (a QR invite, a pure visual):
    // the slide stays an empty layout, and the export says which.
    warnings.push(
      `Slide ${slideNum}: its projection holds no visible content; the slide is empty.`,
    );
  }
  const pptxSlide = pptx.addSlide({ masterName: PPTX_LAYOUTS[layout] });

  const { heading } = projected;
  if (heading.visible && heading.text) {
    const titleBox = layoutBox(layout, 'title');
    const headingStep = layout === 'title' ? 'title' : 'heading';
    const block = {
      kind: 'text',
      paragraphs: [
        {
          lines: [[{ text: heading.text }]],
          level: 0,
          bullet: null,
        },
      ],
    };
    const fit = fitSize(
      [block],
      titleBox,
      themeTextPt(spec, headingStep),
      MIN_HEADING_PT,
    );
    if (!fit.fits)
      warnings.push(`Slide ${slideNum}: the heading overflows its box.`);
    pptxSlide.addText(
      [
        {
          text: heading.text,
          options: {
            fontSize: fit.pt,
            color: spec.text,
            ...(spec.headFont ? { fontFace: spec.headFont } : {}),
          },
        },
      ],
      { placeholder: 'title' },
    );
  }

  const images = projected.blocks.filter((b) => b.kind === 'image');
  const flow = projected.blocks.filter((b) => b.kind !== 'image');
  const bodyName = layout === 'title' ? 'subtitle' : 'body';
  // The budget starts at the theme's `lg` step, the size the canvas sets most
  // slide text at, and shrinks from there; the layouts' own `base` step is the
  // size of a template's empty box, and starting there left short slides with
  // small type in a large empty box.
  const bodyStep = 'subtitle';
  const region = layoutBox(layout, bodyName);
  const bodyPt = themeTextPt(spec, 'body');

  if (flow.length) {
    const fit = fitSize(flow, region, themeTextPt(spec, bodyStep), MIN_BODY_PT);
    if (!fit.fits)
      warnings.push(
        `Slide ${slideNum}: the text does not fit at ${MIN_BODY_PT}pt and overflows its box.`,
      );
    // Under a cover's title the text is the subtitle, in the layout's muted
    // colour; everywhere else it is body text.
    const color = layout === 'title' ? spec.textMuted : spec.text;
    placeFlow(pptxSlide, flow, region, bodyName, fit.pt, spec, color);
  }
  if (images.length) {
    const box = layoutBox(layout, flow.length ? 'image' : 'body');
    await placeImages(pptxSlide, images, box, {
      repoRoot: ctx.repoRoot,
      spec,
      slideNum,
      captionPt: Math.max(MIN_BODY_PT, Math.round(bodyPt * 0.85)),
      warnings,
    });
  }
  return { pptxSlide, warnings };
}

/**
 * The object name a decorative picture is written under, so the pass over the
 * package can mark it. pptxgenjs writes the image's file name as the
 * description of a picture without alt text, which a screen reader reads out.
 */
export const DECORATIVE_PICTURE_NAME = 'Decorative picture';

/**
 * The object name a heading is written under when its composition places it
 * somewhere other than the layout's title box, so the pass over the package
 * can make it the slide's title placeholder anyway. pptxgenjs copies a
 * placeholder's position from the layout and ignores the one given, so a
 * moved title is written as a text box and marked here; a placeholder with
 * its own `a:xfrm` on the slide keeps that position in PowerPoint, and the
 * slide keeps its title in the outline and for a screen reader.
 */
export const POSITIONED_TITLE_NAME = 'Slide title';

/** PowerPoint's "Mark as decorative" (Office 2019+), on a `p:cNvPr`. */
const DECORATIVE_EXT =
  '<a:extLst><a:ext uri="{C183D7F6-B498-43B3-948B-1728B52AA6E4}">' +
  '<adec:decorative xmlns:adec="http://schemas.microsoft.com/office/drawing/2017/decorative" val="1"/>' +
  '</a:ext></a:extLst>';

/**
 * What pptxgenjs cannot write, patched into the written package for the
 * objects the composition named for it.
 *
 * - **Header rows.** pptxgenjs writes `<a:tblPr/>` empty, so PowerPoint's
 *   "Header Row" box is off and applying a table style drops our bold header
 *   (B232 (c)). `firstRow` is set on every table {@link placeTable} named as
 *   having one.
 * - **Decorative pictures.** A picture named {@link DECORATIVE_PICTURE_NAME}
 *   loses the file name pptxgenjs wrote as its description and is marked
 *   decorative, so a screen reader skips it as the canvas' `aria-hidden` does.
 * - **Moved titles.** A text box named {@link POSITIONED_TITLE_NAME} becomes
 *   the slide's title placeholder, keeping its own position.
 *
 * @param {Buffer} buffer - a written .pptx
 * @returns {Promise<Buffer>}
 */
export async function finishEditablePackage(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const parts = zip.file(/^ppt\/slides\/slide\d+\.xml$/);
  let changed = false;
  for (const part of parts) {
    const xml = await part.async('string');
    let next = xml;
    if (next.includes(HEADER_TABLE_NAME)) {
      next = next.replace(
        /<p:graphicFrame>[\s\S]*?<\/p:graphicFrame>/g,
        (frame) =>
          frame.includes(`name="${HEADER_TABLE_NAME}"`)
            ? frame.replace('<a:tblPr/>', '<a:tblPr firstRow="1"/>')
            : frame,
      );
    }
    if (next.includes(DECORATIVE_PICTURE_NAME)) {
      next = next.replace(
        new RegExp(
          `<p:cNvPr ([^>]*)name="${DECORATIVE_PICTURE_NAME}" descr="[^"]*">`,
          'g',
        ),
        `<p:cNvPr $1name="${DECORATIVE_PICTURE_NAME}" descr="">${DECORATIVE_EXT}`,
      );
    }
    if (next.includes(POSITIONED_TITLE_NAME)) {
      next = next.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, (shape) =>
        shape.includes(`name="${POSITIONED_TITLE_NAME}"`)
          ? shape.replace(
              /<p:nvPr(?:\/>|><\/p:nvPr>)/,
              '<p:nvPr><p:ph type="title"/></p:nvPr>',
            )
          : shape,
      );
    }
    if (next !== xml) {
      zip.file(part.name, next);
      changed = true;
    }
  }
  if (!changed) return buffer;
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
