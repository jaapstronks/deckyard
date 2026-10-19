/**
 * Roles from the PDF structure tree, for tagged pages (B751).
 *
 * PowerPoint and Chrome tag their PDFs: the structure tree names headings,
 * lists, tables and figures, and its leaves point at marked-content ids that
 * the text runs carry too. So a `LI` is a list item and a `TD` a cell without
 * guessing. This detector walks the tree and produces the same heading and
 * blocks the geometry detector does:
 *
 * - `H`, `H1`…`H6` → heading (the first one of the highest rank is the page
 *   heading; any other becomes a paragraph marked `subheading`)
 * - `P` → paragraph; `Caption` → caption; `BlockQuote` → quote
 * - `L` / `LI` / `Lbl` / `LBody` → list; the `Lbl` text (bullet or number) is
 *   stripped from the item and recorded as `variant`
 * - `Table` / `TR` / `TH` / `TD` → table, `headerRow` when the first row is
 *   all `TH`
 * - `Figure` → its `alt` goes to the image painted inside it; text inside a
 *   figure (chart labels) is a drawing label, not body text
 * - two or more sibling `Div`s that each hold a heading and paragraphs →
 *   cards
 *
 * Every other role (`NonStruct`, `Span`, `Div`, `Part`, `Sect`, `Document`,
 * `THead`, inline roles such as `Strong` or `Link`) is transparent. `Artifact`
 * content never reaches this module: it is dropped before detection. Runs the
 * tree does not reach (Chrome's list numbers, loose content) are read by the
 * geometry detector and slotted in by position.
 */

import {
  assembleLines,
  joinLineText,
  normalizeText,
  BASELINE_TOLERANCE_EM,
} from './lines.js';
import {
  detectGeometry,
  findHeadingLines,
  markerVariant,
  splitListMarker,
} from './geometry-detector.js';

const HEADING_ROLE = /^H([1-6])?$/;

const maxSize = (lines) => Math.max(...lines.map((l) => l.size));

/**
 * All marked-content ids the tree points at.
 *
 * @param {object | null} tree - `page.getStructTree()`
 * @returns {Set<string>}
 */
export function structContentIds(tree) {
  const ids = new Set();
  const visit = (node) => {
    if (!node) return;
    if (node.type === 'content') ids.add(node.id);
    for (const child of node.children || []) visit(child);
  };
  visit(tree);
  return ids;
}

/**
 * The content ids under a node, each once, in tree order. A tree may point at
 * one marked content more than once (Chrome references a chart's label group
 * once per label under its `Figure`, B778), but the runs behind an id are one
 * stretch of text: reading them per reference repeats every label.
 */
const collectIds = (node) => [...structContentIds(node)];

/** Depth-first search for nodes with a role, not descending into matches. */
function findRoles(node, roles, out = [], { stopAt = null } = {}) {
  for (const child of node.children || []) {
    if (!child.role) continue;
    if (roles.has(child.role)) out.push(child);
    else if (!stopAt?.has(child.role)) findRoles(child, roles, out, { stopAt });
  }
  return out;
}

const LIST_STOP = new Set(['L']);
const CELL_ROLES = new Set(['TH', 'TD']);

function listItems(list) {
  const items = [];
  for (const li of findRoles(list, new Set(['LI']), [], {
    stopAt: LIST_STOP,
  })) {
    const labelIds = [];
    const parts = [];
    const nested = [];
    const body = [];
    for (const child of li.children || []) {
      if (child.role === 'Lbl') labelIds.push(...collectIds(child));
      else body.push(child);
    }
    const raw = [];
    walkChildren({ children: body }, raw);
    for (const item of raw) {
      if (item.type === 'list') nested.push(...item.items);
      else parts.push(rawItemIds(item));
    }
    // Content straight under a wrapper (Chrome: `LI` > `NonStruct`) is the
    // item's own text.
    const covered = new Set(raw.flatMap(rawItemIds));
    const loose = body
      .flatMap((c) => collectIds(c))
      .filter((id) => !covered.has(id));
    if (loose.length) parts.unshift(loose);
    items.push({ labelIds, parts }, ...nested);
  }
  return items;
}

/** Every content id a raw item covers. */
function rawItemIds(item) {
  if (item.ids) return item.ids;
  if (item.items)
    return item.items.flatMap((i) => [...i.labelIds, ...i.parts.flat()]);
  if (item.rows) return item.rows.flatMap((r) => r.cells.flat());
  if (item.cards) return item.cards.flat().flatMap(rawItemIds);
  return [];
}

function tableRows(table) {
  return findRoles(table, new Set(['TR']), [], {
    stopAt: new Set(['Table']),
  }).map((tr) => {
    const cells = findRoles(tr, CELL_ROLES, [], {
      stopAt: new Set(['TR', 'Table']),
    });
    return {
      header: cells.length > 0 && cells.every((c) => c.role === 'TH'),
      cells: cells.map((c) => collectIds(c)),
    };
  });
}

const isCard = (items) =>
  items.length >= 2 &&
  items[0].type === 'heading' &&
  items.slice(1).every((i) => i.type === 'para');

/** Turn a node's children into raw items (ids, not text yet), in tree order. */
function walkChildren(node, out) {
  const children = (node.children || []).filter((c) => c.role);
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.role === 'Div') {
      const run = [];
      let k = i;
      while (k < children.length && children[k].role === 'Div') {
        const inner = [];
        walkChildren(children[k], inner);
        run.push(inner);
        k += 1;
      }
      let j = 0;
      while (j < run.length) {
        let end = j;
        while (end < run.length && isCard(run[end])) end += 1;
        if (end - j >= 2) {
          out.push({ type: 'cards', cards: run.slice(j, end) });
          j = end;
        } else {
          out.push(...run[j]);
          j += 1;
        }
      }
      i = k - 1;
      continue;
    }
    walkNode(child, out);
  }
}

function walkNode(node, out) {
  const role = node.role;
  const heading = HEADING_ROLE.exec(role);
  if (heading)
    out.push({
      type: 'heading',
      level: Number(heading[1] || 1),
      ids: collectIds(node),
    });
  else if (role === 'P') out.push({ type: 'para', ids: collectIds(node) });
  else if (role === 'Caption')
    out.push({ type: 'caption', ids: collectIds(node) });
  else if (role === 'BlockQuote')
    out.push({ type: 'quote', ids: collectIds(node) });
  else if (role === 'Figure') walkFigure(node, out);
  else if (role === 'L') out.push({ type: 'list', items: listItems(node) });
  else if (role === 'Table') out.push({ type: 'table', rows: tableRows(node) });
  else walkChildren(node, out);
}

/** First `alt` on a figure or a figure nested in it (Chrome nests them). */
function figureAlt(node) {
  if (node.alt) return node.alt;
  for (const child of node.children || []) {
    if (!child.role || child.role === 'Caption') continue;
    const alt = figureAlt(child);
    if (alt) return alt;
  }
  return null;
}

/** A figure, and its `Caption` (inside it, as Chrome writes it) after it. */
function walkFigure(node, out) {
  const captions = findRoles(node, new Set(['Caption']));
  const captionIds = new Set(captions.flatMap((c) => collectIds(c)));
  out.push({
    type: 'figure',
    alt: figureAlt(node),
    ids: collectIds(node).filter((id) => !captionIds.has(id)),
  });
  for (const caption of captions)
    out.push({ type: 'caption', ids: collectIds(caption) });
}

const withRole = (lines, role) => lines.map((line) => ({ ...line, role }));

/**
 * @typedef {object} DetectedPage
 * @property {string | null} heading
 * @property {'struct' | 'geometry' | null} headingSource
 * @property {Array<import('./lines.js').Line & { role: string }>} lines
 * @property {object[]} blocks
 * @property {Array<import('./lines.js').Line>} labels - text inside figures
 * @property {Array<{ alt: string | null, ids: string[] }>} figures
 */

/**
 * Detect heading and blocks from the structure tree. Returns null when the
 * tree points at none of the page's runs (its tags do not describe the text),
 * so the caller falls back to geometry.
 *
 * @param {object} tree - `page.getStructTree()`
 * @param {Array<import('./text-runs.js').TextRun>} runs - kept body runs
 * @param {{ width: number, height: number }} page
 * @returns {DetectedPage | null}
 */
export function detectStruct(tree, runs, page) {
  const treeIds = structContentIds(tree);
  if (!treeIds.size) return null;
  if (runs.length && !runs.some((r) => treeIds.has(r.mcid))) return null;

  const runsById = new Map();
  for (const run of runs) {
    if (!run.mcid || !treeIds.has(run.mcid)) continue;
    if (!runsById.has(run.mcid)) runsById.set(run.mcid, []);
    runsById.get(run.mcid).push(run);
  }
  const take = (ids) =>
    assembleLines(ids.flatMap((id) => runsById.get(id) || []));

  const raw = [];
  walkChildren(tree, raw);

  const entries = [];
  const figures = [];
  const labels = [];
  for (const item of raw) {
    const entry = resolveItem(item, take, figures, labels);
    if (entry) entries.push(entry);
  }

  const orphanRuns = runs.filter((r) => !r.mcid || !treeIds.has(r.mcid));
  placeOrphans(entries, assembleLines(orphanRuns), page);

  const headingSource = chooseHeading(entries, page);
  const heading = entries.find((e) => e.kind === 'heading');
  return {
    heading: heading ? heading.text : null,
    headingSource,
    lines: entries.flatMap((e) => e.lines),
    blocks: entries.filter((e) => e.block).map((e) => e.block),
    labels,
    figures,
  };
}

function resolveItem(item, take, figures, labels) {
  if (item.type === 'figure') {
    figures.push({ alt: item.alt, ids: item.ids });
    const lines = take(item.ids);
    labels.push(...lines);
    return lines.length
      ? { kind: 'figure', y: lines[0].y, lines: withRole(lines, 'label') }
      : null;
  }
  if (
    item.type === 'heading' ||
    item.type === 'para' ||
    item.type === 'caption' ||
    item.type === 'quote'
  ) {
    const lines = take(item.ids);
    if (!lines.length) return null;
    const text = joinLineText(lines);
    const y = lines[0].y;
    if (item.type === 'heading') {
      return {
        kind: 'heading',
        level: item.level,
        text,
        y,
        lines: withRole(lines, 'heading'),
      };
    }
    const block =
      item.type === 'para'
        ? {
            kind: 'para',
            y,
            text,
            bold: lines.every((l) => l.bold),
            size: maxSize(lines),
          }
        : { kind: item.type, y, text };
    return {
      kind: item.type,
      y,
      text,
      block,
      lines: withRole(lines, item.type),
    };
  }
  if (item.type === 'list') return resolveList(item, take);
  if (item.type === 'table') return resolveTable(item, take);
  if (item.type === 'cards') return resolveCards(item, take);
  return null;
}

function resolveList(item, take) {
  const lines = [];
  const items = [];
  let variant = null;
  for (const { labelIds, parts } of item.items) {
    const labelLines = take(labelIds);
    const partLines = parts.map(take).filter((l) => l.length);
    const label = joinLineText(labelLines);
    const labelVariant = markerVariant(label);
    let texts = partLines.map(joinLineText);
    if (label && !labelVariant) {
      // A label that is not a marker ("Q1:") is real text: keep it.
      texts = [normalizeText(`${label} ${texts[0] || ''}`), ...texts.slice(1)];
    } else if (!labelLines.length && texts.length) {
      const inline = splitListMarker(texts[0]);
      if (inline) {
        texts[0] = inline.text;
        variant ||= inline.variant;
      }
    }
    if (!texts.length) continue;
    if (labelLines.length && labelVariant) variant ||= labelVariant;
    lines.push(
      ...withRole(labelLines, labelVariant ? 'list-label' : 'list-item'),
    );
    lines.push(...withRole(partLines.flat(), 'list-item'));
    items.push({
      text: normalizeText(texts.join(' ')),
      parts: texts,
      first: partLines[0]?.[0] ?? labelLines[0],
    });
  }
  if (!items.length) return null;
  const y = Math.min(...lines.map((l) => l.y));
  return {
    kind: 'list',
    y,
    lines,
    items,
    block: {
      kind: 'list',
      y,
      variant: variant || 'bullets',
      items: items.map(({ text, parts }) => ({ text, parts })),
    },
  };
}

function resolveTable(item, take) {
  const lines = [];
  const rows = [];
  let headerRow = false;
  for (const row of item.rows) {
    const cellLines = row.cells.map(take);
    if (cellLines.every((l) => !l.length)) continue;
    if (!rows.length) headerRow = row.header;
    rows.push(cellLines.map(joinLineText));
    lines.push(...withRole(cellLines.flat(), 'table-cell'));
  }
  if (!rows.length) return null;
  const y = Math.min(...lines.map((l) => l.y));
  return {
    kind: 'table',
    y,
    lines,
    block: { kind: 'table', y, headerRow, rows },
  };
}

function resolveCards(item, take) {
  const lines = [];
  const cards = [];
  for (const card of item.cards) {
    const titleLines = take(card[0].ids);
    const bodyLines = card
      .slice(1)
      .map((p) => take(p.ids))
      .filter((l) => l.length);
    if (!titleLines.length && !bodyLines.length) continue;
    lines.push(
      ...withRole(titleLines, 'card-title'),
      ...withRole(bodyLines.flat(), 'card-body'),
    );
    cards.push({
      title: joinLineText(titleLines),
      body: bodyLines.map(joinLineText).join('\n\n'),
    });
  }
  if (!cards.length) return null;
  const y = Math.min(...lines.map((l) => l.y));
  return { kind: 'cards', y, lines, block: { kind: 'cards', y, cards } };
}

/**
 * Runs the tree does not reach. A bare marker next to a list item is that
 * item's label (Chrome leaves list numbers outside every marked content);
 * the rest goes through the geometry detector and is slotted in before the
 * first entry below it.
 */
function placeOrphans(entries, orphanLines, page) {
  if (!orphanLines.length) return;
  const rest = [];
  for (const line of orphanLines) {
    const variant = line.text && markerVariant(line.text);
    const owner =
      variant &&
      entries.find(
        (e) =>
          e.kind === 'list' &&
          e.items.some(
            (it) =>
              it.first.x > line.x &&
              Math.abs(it.first.y - line.y) <=
                BASELINE_TOLERANCE_EM * Math.max(it.first.size, line.size),
          ),
      );
    if (owner) {
      if (!owner.labelled) {
        owner.block.variant = variant;
        owner.labelled = true;
      }
      owner.lines.push({ ...line, role: 'list-label' });
      continue;
    }
    rest.push(line);
  }
  if (!rest.length) return;
  const geometry = detectGeometry(rest, page, { heading: false });
  const byBlock = geometry.blocks.map((block) => ({
    kind: block.kind,
    y: block.y,
    block,
    lines: [],
  }));
  // Lines belong to the block whose y range they fall in, in order.
  let b = -1;
  rest.forEach((line, i) => {
    while (b + 1 < byBlock.length && byBlock[b + 1].y <= line.y) b += 1;
    if (b >= 0) byBlock[b].lines.push({ ...line, role: geometry.roles[i] });
  });
  for (const entry of byBlock) {
    const at = entries.findIndex((e) => e.y > entry.y);
    if (at === -1) entries.push(entry);
    else entries.splice(at, 0, entry);
  }
}

/**
 * Keep one page heading: the first heading of the highest rank. Without any
 * `H` tag, a paragraph that the geometry rule reads as the heading (largest
 * text at the top, as PowerPoint tags a title page) becomes it.
 *
 * @returns {'struct' | 'geometry' | null}
 */
function chooseHeading(entries, page) {
  const headings = entries.filter((e) => e.kind === 'heading');
  if (headings.length) {
    const top = Math.min(...headings.map((h) => h.level));
    const main = headings.find((h) => h.level === top);
    for (const h of headings) {
      if (h === main) continue;
      h.kind = 'para';
      h.lines = h.lines.map((l) => ({ ...l, role: 'subheading' }));
      h.block = {
        kind: 'para',
        y: h.y,
        text: h.text,
        bold: h.lines.every((l) => l.bold),
        size: maxSize(h.lines),
        subheading: true,
      };
    }
    return 'struct';
  }
  const all = entries
    .flatMap((e) => e.lines)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const picked = findHeadingLines(all, page).map((i) => all[i]);
  if (!picked.length) return null;
  const owner = entries.find(
    (e) =>
      e.kind === 'para' &&
      e.lines.length === picked.length &&
      picked.every((p) => e.lines.some((l) => l.y === p.y && l.x === p.x)),
  );
  if (!owner) return null;
  owner.kind = 'heading';
  owner.block = null;
  owner.lines = owner.lines.map((l) => ({ ...l, role: 'heading' }));
  return 'geometry';
}
