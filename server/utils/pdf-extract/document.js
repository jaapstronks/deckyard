/**
 * A PDF read as a document, not as slides (B773).
 *
 * The page model (`index.js`) is built for slides: one heading per page,
 * picked by size. A report has its structure across pages instead: a
 * chapter heading on page 4 governs the sections on pages 4 to 7, a
 * paragraph runs on from one page into the next, and the running footer
 * ("Quarterly Report 2024 - Q4 7") stands on every page. This layer reads
 * the page models of a whole PDF as one document:
 *
 * - **Headings** over the whole document: a short paragraph clearly larger
 *   than the body text, or bold where the body is not, is a heading. Its
 *   level comes from its size among the heading sizes that recur; a size
 *   used once (a cover, a colophon) takes the level of the nearest
 *   recurring size below it. What the first page opens with above every
 *   recurring heading size is the document title.
 * - **Page furniture**: text in the top or bottom margin at body size or
 *   smaller that comes back on more than one page (digits aside, so page
 *   numbers count as the same) is dropped.
 * - **Page breaks**: a paragraph that ends without closing punctuation runs
 *   on into the first paragraph of the next page; a list into a list.
 * - **A letter's heading block**: artifact text of the first page that no
 *   other page repeats ("Betreft …", the date), as far as it stands in the
 *   body column at body size, right above the running text. The address
 *   column beside it is furniture.
 * - **Tables** become pipe tables when their rows have one shape and they
 *   read as data; an uncertain one stays a row per line.
 *
 * The output is marked-up text (`#`, `- `, pipe tables): the structure
 * travels in the one string the generation pipeline already reads, so no
 * prompt needs a second input form. Pure computation over the page models.
 */

/** Text this many times the body size or larger can be a heading. */
export const HEADING_SIZE_RATIO = 1.15;

/** A heading is at most this long; longer is a paragraph set large. */
export const HEADING_MAX_CHARS = 200;

/** The top and bottom fraction of a page where running furniture stands. */
export const MARGIN_ZONE = 0.1;

/** Headings go no deeper than this level (`####`). */
const MAX_LEVEL = 4;

/** Ends a sentence; a paragraph ending otherwise runs on over a page break. */
const CLOSED = /[.!?:;…"”’)\]]$/u;

/** Ends a phrase that introduces something, never a heading. */
const NOT_A_HEADING_END = /[.,;:]$/;

/** A bare reference number left beside a table note. */
const BARE_NUMBER = /^\d{1,3}$/;

/** A page number or date differs per page; the furniture around it does not. */
export const furnitureKey = (text) => text.replace(/\d+/g, '#');

const roundSize = (size) => Math.round(size * 2) / 2;

/**
 * @typedef {object} DocumentBlock
 * One block of the document, in reading order:
 *
 * - `{ kind: 'heading', level, text }` (`level` 1 is the title)
 * - `{ kind: 'para', text }`
 * - `{ kind: 'list', variant: 'bullets'|'numbers', items: string[] }`
 * - `{ kind: 'table', rows: string[][] }` (the first row is the header)
 * - `{ kind: 'lines', lines: string[] }` (an uncertain table, a letter's
 *   heading block, the labels of a drawing)
 * - `{ kind: 'quote', text }`
 */

/**
 * Read the page models of a PDF as one document.
 *
 * @param {{ pages: import('./index.js').PageModel[] }} extracted - what
 *   `extractPdfPages()` returns
 * @returns {{ title: string | null, blocks: DocumentBlock[], text: string }}
 */
export function readDocument({ pages }) {
  const perPage = pages.map(pageEntries);
  const all = perPage.flat();
  const body = bodyStyle(all);

  dropFurniture(perPage, body);
  for (const entries of perPage) markHeadings(entries, body);
  for (const entries of perPage) mergeHeadingLines(entries);
  const flow = joinPageBreaks(perPage);

  const sizes = levelSizes(flow);
  const { levels } = sizes;
  const { title, rest } = splitTitle(flow, sizes);
  const head = letterHead(pages, body);

  const blocks = [
    ...(title ? [{ kind: 'heading', level: 1, text: title }] : []),
    ...(head.length ? [{ kind: 'lines', lines: head }] : []),
    ...rest.flatMap((entry) => toBlocks(entry, levels)),
  ];
  return { title, blocks, text: renderDocument(blocks) };
}

/**
 * Render document blocks as marked-up text.
 * @param {DocumentBlock[]} blocks
 * @returns {string}
 */
export function renderDocument(blocks) {
  return blocks
    .map((block) => {
      switch (block.kind) {
        case 'heading':
          return `${'#'.repeat(block.level)} ${block.text}`;
        case 'list':
          return block.items
            .map((item, i) =>
              block.variant === 'numbers' ? `${i + 1}. ${item}` : `- ${item}`,
            )
            .join('\n');
        case 'table':
          return pipeTable(block.rows);
        case 'lines':
          return block.lines.join('\n');
        case 'quote':
          return `> ${block.text}`;
        default:
          return block.text;
      }
    })
    .filter((text) => text.trim())
    .join('\n\n');
}

function pipeTable(rows) {
  const width = rows[0].length;
  // A backslash first, so the one before an escaped pipe stays literal.
  const cell = (text) =>
    String(text).replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
  const row = (cells) => `| ${cells.map(cell).join(' | ')} |`;
  return [
    row(rows[0]),
    row(Array.from({ length: width }, () => '---')),
    ...rows.slice(1).map(row),
  ].join('\n');
}

/**
 * The entries of one page in reading order: its heading, its blocks, then
 * the labels of a drawing. A paragraph carries its size and boldness.
 */
function pageEntries(page) {
  const base = { page: page.page, height: page.height };
  const entries = page.blocks.map((block) => ({ ...base, block }));
  if (page.heading) {
    const lines = page.lines.filter((l) => l.role === 'heading');
    const y = Math.min(...lines.map((l) => l.y));
    const heading = {
      ...base,
      block: {
        kind: 'para',
        y,
        text: page.heading,
        bold: lines.every((l) => l.bold),
        size: Math.max(...lines.map((l) => l.size)),
      },
    };
    const at = entries.findIndex((e) => e.block.y > y);
    entries.splice(at === -1 ? entries.length : at, 0, heading);
  }
  const labels = (page.drawing?.labels || []).map((l) => l.text);
  if (labels.length) {
    entries.push({ ...base, block: { kind: 'labels', lines: labels } });
  }
  return entries;
}

/** The size that carries most of the text, and whether that text is bold. */
function bodyStyle(entries) {
  const chars = new Map();
  let boldChars = 0;
  for (const { block } of entries) {
    if (block.kind !== 'para') continue;
    const size = roundSize(block.size);
    chars.set(size, (chars.get(size) || 0) + block.text.length);
  }
  let size = 0;
  for (const [s, count] of chars) if (count > (chars.get(size) || 0)) size = s;
  let total = 0;
  for (const { block } of entries) {
    if (block.kind !== 'para' || roundSize(block.size) !== size) continue;
    total += block.text.length;
    if (block.bold) boldChars += block.text.length;
  }
  return { size, bold: total > 0 && boldChars > total / 2 };
}

const inMargin = (entry) =>
  entry.block.y < MARGIN_ZONE * entry.height ||
  entry.block.y > (1 - MARGIN_ZONE) * entry.height;

/**
 * Drop running furniture: margin text at body size or smaller that recurs
 * on another page, and the bare reference numbers beside table notes.
 */
function dropFurniture(perPage, body) {
  const isSmall = (block) =>
    block.kind === 'para' && block.size < HEADING_SIZE_RATIO * body.size;
  const pagesOf = new Map();
  for (const entries of perPage) {
    for (const entry of entries) {
      if (!isSmall(entry.block) || !inMargin(entry)) continue;
      const key = furnitureKey(entry.block.text);
      if (!pagesOf.has(key)) pagesOf.set(key, new Set());
      pagesOf.get(key).add(entry.page);
    }
  }
  perPage.forEach((entries, i) => {
    perPage[i] = entries.filter(({ block, ...entry }) => {
      if (block.kind !== 'para') return true;
      if (BARE_NUMBER.test(block.text) && block.size < body.size) return false;
      if (!isSmall(block) || !inMargin({ block, ...entry })) return true;
      return (pagesOf.get(furnitureKey(block.text))?.size || 0) < 2;
    });
  });
}

function isHeadingCandidate(block, body) {
  if (block.kind !== 'para') return false;
  const text = block.text.trim();
  if (text.length > HEADING_MAX_CHARS || NOT_A_HEADING_END.test(text))
    return false;
  // A year set large on a cover is a heading; a bold number in the text is not.
  if (block.size >= HEADING_SIZE_RATIO * body.size)
    return /[\p{L}\p{N}]/u.test(text);
  return (
    block.bold &&
    !body.bold &&
    block.size >= body.size - 0.25 &&
    /\p{L}/u.test(text)
  );
}

function markHeadings(entries, body) {
  for (const entry of entries)
    entry.heading = isHeadingCandidate(entry.block, body);
}

/**
 * A heading set over several paragraphs ("World Energy" / "Outlook" /
 * "2024") is one heading: consecutive headings of the same size merge.
 */
function mergeHeadingLines(entries) {
  for (let i = entries.length - 1; i > 0; i--) {
    const prev = entries[i - 1];
    const cur = entries[i];
    if (
      prev.heading &&
      cur.heading &&
      roundSize(prev.block.size) === roundSize(cur.block.size)
    ) {
      prev.block = {
        ...prev.block,
        text: `${prev.block.text} ${cur.block.text}`,
      };
      entries.splice(i, 1);
    }
  }
}

/**
 * Join the pages into one flow, running a paragraph that breaks off at the
 * end of a page on into the first paragraph of the next (and a list into a
 * list). The labels of a drawing at the page end stay out of the way.
 */
function joinPageBreaks(perPage) {
  const flow = [];
  for (const entries of perPage) {
    const lastText = flow.findLast((e) => e.block.kind !== 'labels');
    const [first, ...rest] = entries;
    if (lastText && first && runsOn(lastText, first)) {
      lastText.block = joinBlocks(lastText.block, first.block);
      flow.push(...rest);
    } else {
      flow.push(...entries);
    }
  }
  return flow;
}

function runsOn(prev, next) {
  if (prev.heading || next.heading) return false;
  const a = prev.block;
  const b = next.block;
  if (a.kind === 'list' && b.kind === 'list') return a.variant === b.variant;
  if (a.kind !== 'para' || b.kind !== 'para' || a.subheading || b.subheading)
    return false;
  return (
    Math.abs(a.size - b.size) <= 0.5 &&
    a.bold === b.bold &&
    !CLOSED.test(a.text.trim())
  );
}

function joinBlocks(a, b) {
  if (a.kind === 'list') return { ...a, items: [...a.items, ...b.items] };
  return { ...a, text: `${a.text} ${b.text}` };
}

/**
 * Heading sizes that recur, largest first: each is a level. Without any
 * recurring size every heading size is a level.
 */
function levelSizes(flow) {
  const count = new Map();
  for (const entry of flow) {
    if (!entry.heading) continue;
    const size = roundSize(entry.block.size);
    count.set(size, (count.get(size) || 0) + 1);
  }
  const recurring = [...count].filter(([, n]) => n >= 2).map(([s]) => s);
  const levels = recurring.length ? recurring : [...count.keys()];
  return {
    levels: levels.sort((a, b) => b - a),
    recurring: recurring.length > 0,
  };
}

/** `##` for the largest level size, a level deeper per larger size. */
function levelOf(size, levels) {
  const larger = levels.filter((s) => s > roundSize(size)).length;
  return Math.min(2 + larger, MAX_LEVEL);
}

/**
 * The title: the headings the first page opens with, up to the last one set
 * larger than every recurring heading size (or, when no size recurs, than
 * every heading after them).
 */
function splitTitle(flow, { levels, recurring }) {
  let k = 0;
  while (k < flow.length && flow[k].page === 1 && flow[k].heading) k += 1;
  const after = flow
    .slice(k)
    .filter((e) => e.heading)
    .map((e) => roundSize(e.block.size));
  const top = recurring ? levels[0] : Math.max(-Infinity, ...after);
  let end = 0;
  for (let i = 0; i < k; i++)
    if (roundSize(flow[i].block.size) > top) end = i + 1;
  if (!end) return { title: null, rest: flow };
  return {
    title: flow
      .slice(0, end)
      .map((e) => e.block.text)
      .join(' - '),
    rest: flow.slice(end),
  };
}

function toBlocks({ block, heading }, levels) {
  if (heading) {
    return [
      { kind: 'heading', level: levelOf(block.size, levels), text: block.text },
    ];
  }
  switch (block.kind) {
    case 'para':
    case 'caption':
      return [{ kind: 'para', text: block.text }];
    case 'quote':
      return [{ kind: 'quote', text: block.text }];
    case 'list':
      return [
        {
          kind: 'list',
          variant: block.variant,
          items: block.items.map((it) => it.text),
        },
      ];
    case 'table':
      return [tableBlock(block)];
    case 'cards':
      return [
        {
          kind: 'list',
          variant: 'bullets',
          items: block.cards.map((c) =>
            [c.title, c.body].filter(Boolean).join(': '),
          ),
        },
      ];
    case 'labels':
      return [{ kind: 'lines', lines: [block.lines.join(' · ')] }];
    default:
      return [];
  }
}

/**
 * A table is a pipe table when every row has the same number of cells
 * (two or more) and it reads as data: a header row, or digits in at least a
 * quarter of the cells beside the first column. Otherwise a row per line:
 * columns of running text that line up are no table.
 */
function tableBlock(block) {
  const { rows } = block;
  const width = rows[0]?.length || 0;
  const even = width >= 2 && rows.every((r) => r.length === width);
  const cells = rows.flatMap((r) => r.slice(1));
  const numeric = cells.filter((c) => /\d/.test(c)).length;
  if (
    even &&
    rows.length >= 2 &&
    (block.headerRow || numeric * 4 >= cells.length)
  )
    return { kind: 'table', rows };
  return { kind: 'lines', lines: rows.map((r) => r.join(' ')) };
}

/**
 * The heading block of a letter: the first page's artifact text that no
 * other page repeats, standing in the body column at body size, as the last
 * group of lines above the running text.
 */
function letterHead(pages, body) {
  const [first, ...rest] = pages;
  if (!first) return [];
  const artifacts = (page) =>
    page.dropped.filter((d) => d.reason === 'artifact');
  const recurring = new Set(
    rest.flatMap(artifacts).map((d) => furnitureKey(d.text)),
  );
  const bodyLines = first.lines.filter(
    (l) => l.role === 'para' && Math.abs(l.size - body.size) <= 0.5,
  );
  if (!bodyLines.length) return [];
  const left = Math.min(...bodyLines.map((l) => l.x));
  const top = Math.min(...bodyLines.map((l) => l.y));
  const unique = artifacts(first).filter(
    (d) => !recurring.has(furnitureKey(d.text)) && d.y < top,
  );
  // The address column is small print right of the body text; where its
  // lines start, a segment on a line at body size belongs to it too
  // ("Datum …   DGED-DE / …").
  const column = unique
    .filter((d) => d.size < body.size - 0.5 && d.x > left + body.size)
    .map((d) => d.x);
  const inColumn = (seg) => column.some((x) => Math.abs(seg.x - x) <= 2);
  const lines = unique
    .filter((d) => d.size >= body.size - 0.5)
    .map((d) => ({
      y: d.y,
      text: d.segments
        .filter((seg) => !inColumn(seg))
        .map((seg) => seg.text)
        .join(' '),
    }))
    .filter((l) => l.text)
    .sort((a, b) => a.y - b.y);
  // Only the group right above the text: the addressee higher up is not
  // the subject of the letter.
  let start = lines.length - 1;
  while (start > 0 && lines[start].y - lines[start - 1].y <= 2 * body.size)
    start -= 1;
  return lines.slice(Math.max(start, 0)).map((l) => l.text);
}
