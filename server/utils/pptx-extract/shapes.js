/**
 * The shapes on a slide, with their boxes and what they inherit (B828).
 *
 * A slide's shape tree holds text shapes (`p:sp`), pictures (`p:pic`),
 * frames for tables, charts and diagrams (`p:graphicFrame`), connectors
 * (`p:cxnSp`) and groups of them (`p:grpSp`). This module flattens the tree
 * in paint order, maps each box from EMU to points through any group's
 * child coordinate space, and for a placeholder finds the placeholder it
 * inherits from: on the layout by `idx` (or by type when it has none), on
 * the master by type. A placeholder that leaves out its frame, its insets
 * or its list styles takes them from there.
 */

import { EMU_PER_PT } from './package.js';
import { child, numAttr, path } from './xml.js';

/** @typedef {import('../pdf-extract/index.js').Box} Box */

/**
 * @typedef {object} SlideShape
 * @property {'sp' | 'pic' | 'graphicFrame' | 'cxnSp'} kind
 * @property {import('./xml.js').XmlElement} el
 * @property {{ type: string, idx: string | null } | null} ph
 * @property {import('./xml.js').XmlElement[]} inherited - the layout and
 *   master placeholders this one inherits from, nearest first
 * @property {Box | null} box - in pt, null when no level gives a frame
 */

const SHAPE_KINDS = {
  'p:sp': 'sp',
  'p:pic': 'pic',
  'p:graphicFrame': 'graphicFrame',
  'p:cxnSp': 'cxnSp',
};
const NV_PROPS = ['p:nvSpPr', 'p:nvPicPr', 'p:nvGraphicFramePr', 'p:nvCxnSpPr'];
const IDENTITY = { scale: [1, 1], shift: [0, 0] };

/**
 * The placeholder a shape is, or null. An omitted `type` is `obj`, as the
 * specification has it.
 *
 * @param {import('./xml.js').XmlElement} el
 * @returns {{ type: string, idx: string | null } | null}
 */
export function placeholderOf(el) {
  for (const nv of NV_PROPS) {
    const ph = path(el, nv, 'p:nvPr', 'p:ph');
    if (ph) return { type: ph.attrs.type || 'obj', idx: ph.attrs.idx ?? null };
  }
  return null;
}

/** The non-visual name and description (`p:cNvPr`) of a shape. */
export function shapeName(el) {
  for (const nv of NV_PROPS) {
    const props = path(el, nv, 'p:cNvPr');
    if (props) return props.attrs;
  }
  return {};
}

/** Title and centred title share the master's title placeholder. */
const masterType = (type) =>
  type === 'title' || type === 'ctrTitle'
    ? 'title'
    : ['dt', 'ftr', 'sldNum'].includes(type)
      ? type
      : 'body';

/**
 * Find the placeholder on a layout or master that `ph` inherits from.
 *
 * @param {import('./xml.js').XmlElement | null} root - `p:sldLayout` or
 *   `p:sldMaster`
 * @param {{ type: string, idx: string | null }} ph
 * @param {boolean} onMaster - match by type only, as a master does
 * @returns {import('./xml.js').XmlElement | null}
 */
function findPlaceholder(root, ph, onMaster) {
  const shapes = flatten(path(root, 'p:cSld', 'p:spTree'), IDENTITY).map(
    (s) => s.el,
  );
  const withPh = shapes
    .map((el) => ({ el, ph: placeholderOf(el) }))
    .filter((s) => s.ph);
  if (!onMaster && ph.idx !== null) {
    const byIdx = withPh.find((s) => s.ph.idx === ph.idx);
    if (byIdx) return byIdx.el;
  }
  const want = onMaster ? masterType(ph.type) : ph.type;
  const sameType = (s) =>
    (onMaster ? masterType(s.ph.type) : s.ph.type) === want;
  return withPh.find(sameType)?.el || null;
}

/**
 * Every shape on one tree (a slide, layout or master), in paint order, with
 * its box and its inherited placeholders.
 *
 * @param {import('./xml.js').XmlElement | null} root - `p:sld`,
 *   `p:sldLayout` or `p:sldMaster`
 * @param {{ layout?: import('./xml.js').XmlElement | null, master?: import('./xml.js').XmlElement | null }} [parents]
 *   - where a placeholder on `root` inherits from
 * @returns {SlideShape[]}
 */
export function readShapes(root, { layout = null, master = null } = {}) {
  return flatten(path(root, 'p:cSld', 'p:spTree'), IDENTITY).map(
    ({ el, kind, transform }) => {
      const ph = placeholderOf(el);
      const inherited = ph
        ? [
            layout && findPlaceholder(layout, ph, false),
            master && findPlaceholder(master, ph, true),
          ].filter(Boolean)
        : [];
      const own = frameOf(el);
      const box = own
        ? applyTransform(own, transform)
        : inherited.map(frameOf).find(Boolean) || null;
      return { kind, el, ph, inherited, box: box && toPt(box) };
    },
  );
}

/** Walk a shape tree depth first, composing group transforms. */
function flatten(tree, transform) {
  const out = [];
  for (const el of tree?.children || []) {
    if (el.name === 'p:grpSp') {
      out.push(...flatten(el, compose(transform, groupTransform(el))));
    } else if (SHAPE_KINDS[el.name]) {
      out.push({ el, kind: SHAPE_KINDS[el.name], transform });
    } else if (el.name === 'mc:AlternateContent') {
      // Newer shape kinds come with a fallback the older readers understand.
      const choice = child(el, 'mc:Fallback') || child(el, 'mc:Choice');
      out.push(...flatten(choice, transform));
    }
  }
  return out;
}

/** The frame of a shape in EMU, from its own `a:xfrm` or `p:xfrm`. */
function frameOf(el) {
  const xfrm =
    path(el, 'p:spPr', 'a:xfrm') ||
    path(el, 'p:grpSpPr', 'a:xfrm') ||
    child(el, 'p:xfrm');
  const off = child(xfrm, 'a:off');
  const ext = child(xfrm, 'a:ext');
  if (!off || !ext) return null;
  return {
    x: numAttr(off, 'x', 0),
    y: numAttr(off, 'y', 0),
    width: numAttr(ext, 'cx', 0),
    height: numAttr(ext, 'cy', 0),
  };
}

/**
 * A group maps its children from the child space (`chOff`/`chExt`) onto its
 * own frame (`off`/`ext`).
 */
function groupTransform(group) {
  const xfrm = path(group, 'p:grpSpPr', 'a:xfrm');
  const off = child(xfrm, 'a:off');
  const ext = child(xfrm, 'a:ext');
  const chOff = child(xfrm, 'a:chOff');
  const chExt = child(xfrm, 'a:chExt');
  if (!off || !ext || !chOff || !chExt) return IDENTITY;
  const ratio = (a, b) => (b > 0 ? a / b : 1);
  const scale = [
    ratio(numAttr(ext, 'cx', 0), numAttr(chExt, 'cx', 0)),
    ratio(numAttr(ext, 'cy', 0), numAttr(chExt, 'cy', 0)),
  ];
  return {
    scale,
    shift: [
      numAttr(off, 'x', 0) - numAttr(chOff, 'x', 0) * scale[0],
      numAttr(off, 'y', 0) - numAttr(chOff, 'y', 0) * scale[1],
    ],
  };
}

/** `outer ∘ inner`: apply `inner` first, then `outer`. */
function compose(outer, inner) {
  return {
    scale: [outer.scale[0] * inner.scale[0], outer.scale[1] * inner.scale[1]],
    shift: [
      outer.scale[0] * inner.shift[0] + outer.shift[0],
      outer.scale[1] * inner.shift[1] + outer.shift[1],
    ],
  };
}

function applyTransform(box, { scale, shift }) {
  return {
    x: box.x * scale[0] + shift[0],
    y: box.y * scale[1] + shift[1],
    width: box.width * scale[0],
    height: box.height * scale[1],
  };
}

function toPt({ x, y, width, height }) {
  return {
    x: x / EMU_PER_PT,
    y: y / EMU_PER_PT,
    width: width / EMU_PER_PT,
    height: height / EMU_PER_PT,
  };
}

/**
 * The value `pick` finds on the shape itself or, failing that, on the first
 * placeholder it inherits from that has one.
 *
 * @template T
 * @param {SlideShape} shape
 * @param {(el: import('./xml.js').XmlElement) => T | null | undefined} pick
 * @returns {T | null}
 */
export function inheritedValue(shape, pick) {
  for (const el of [shape.el, ...shape.inherited]) {
    const value = pick(el);
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

/**
 * The `a:bodyPr` elements that apply to a shape's text, nearest first.
 *
 * @param {SlideShape} shape
 * @returns {import('./xml.js').XmlElement[]}
 */
export function bodyPropsChain(shape) {
  return [shape.el, ...shape.inherited]
    .map((el) => path(el, 'p:txBody', 'a:bodyPr'))
    .filter(Boolean);
}

/**
 * The list styles that apply to a shape's text, nearest first: its own
 * `a:lstStyle`, those of the placeholders it inherits from, then the
 * master's text style for its kind (`titleStyle` for a title, `bodyStyle`
 * for other placeholders) or, for a text box, the presentation's defaults.
 *
 * @param {SlideShape} shape
 * @param {{ master: import('./xml.js').XmlElement | null, defaultTextStyle: import('./xml.js').XmlElement | null }} parts
 * @returns {import('./xml.js').XmlElement[]}
 */
export function listStyleChain(shape, { master, defaultTextStyle }) {
  const own = [shape.el, ...shape.inherited]
    .map((el) => path(el, 'p:txBody', 'a:lstStyle'))
    .filter(Boolean);
  const txStyles = child(master, 'p:txStyles');
  const kind = shape.ph ? masterType(shape.ph.type) : null;
  const masterStyle =
    kind === 'title'
      ? child(txStyles, 'p:titleStyle')
      : kind
        ? child(txStyles, 'p:bodyStyle')
        : null;
  return [
    ...own,
    ...(masterStyle ? [masterStyle] : []),
    ...(shape.ph ? [] : [defaultTextStyle, child(txStyles, 'p:otherStyle')]),
  ].filter(Boolean);
}

/**
 * The shapes of the layout and master that paint on the slide: those that
 * are no placeholder (a placeholder there is only a prompt), when the slide
 * and layout show the master's shapes (`showMasterSp`).
 *
 * @param {{ slide: import('./xml.js').XmlElement, layout: import('./xml.js').XmlElement | null, master: import('./xml.js').XmlElement | null }} parts
 * @returns {SlideShape[]}
 */
export function templateShapes({ slide, layout, master }) {
  const shows = (el) => el?.attrs.showMasterSp !== '0';
  const out = [];
  if (master && shows(slide) && shows(layout)) out.push(...readShapes(master));
  if (layout && shows(slide)) out.push(...readShapes(layout));
  return out.filter((s) => !s.ph);
}
