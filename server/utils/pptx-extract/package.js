/**
 * The parts of a PowerPoint package one slide is read against (B828).
 *
 * A slide part alone does not say where its title sits, what size its text
 * is or which colour `accent1` is: that comes from its slideLayout, the
 * slideMaster behind the layout, and the master's theme. This module opens
 * the package once, follows those relationships per slide and keeps every
 * parsed part, so six slides on one layout parse that layout once. Slide
 * order, hidden slides and speaker notes come from `pptx-notes.js` (B702),
 * the reading the raster import and pad B already share.
 */

import JSZip from 'jszip';

import { readRels, readSlideNotesFromZip } from '../convert-file/index.js';
import { readClrMap, readColorScheme } from './colors.js';
import { child, numAttr, parseXml, path } from './xml.js';

/** English Metric Units per point: DrawingML lengths are in EMU. */
export const EMU_PER_PT = 12700;

/** The default slide size (16:9 at 10 × 5.625 in) when the package names none. */
const DEFAULT_SIZE = { cx: 9144000, cy: 5143500 };

const LAYOUT_REL = /\/slideLayout$/;
const MASTER_REL = /\/slideMaster$/;
const THEME_REL = /\/theme$/;

/**
 * @typedef {object} PptxPackage
 * @property {JSZip} zip
 * @property {{ width: number, height: number }} size - the slide size in pt
 * @property {Array<{ part: string, hidden: boolean, notes: string }>} slides -
 *   in deck order, hidden ones included
 * @property {{ title?: string, author?: string }} metadata
 * @property {import('./xml.js').XmlElement | null} defaultTextStyle - the
 *   presentation's text defaults (text boxes and tables fall back to it)
 * @property {(part: string) => Promise<import('./xml.js').XmlElement | null>} xml
 * @property {(part: string) => Promise<Array<{ id: string, type: string, target: string }>>} rels
 */

/**
 * Open a package.
 *
 * @param {Buffer | Uint8Array} buffer
 * @returns {Promise<PptxPackage>}
 */
export async function openPackage(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const parsed = new Map();
  const relsCache = new Map();
  const xml = (part) => {
    if (!parsed.has(part)) {
      const file = zip.file(part);
      parsed.set(
        part,
        file ? file.async('string').then(parseXml) : Promise.resolve(null),
      );
    }
    return parsed.get(part);
  };
  const rels = (part) => {
    if (!relsCache.has(part)) relsCache.set(part, readRels(zip, part));
    return relsCache.get(part);
  };

  const presentation = await xml('ppt/presentation.xml');
  const sldSz = child(presentation, 'p:sldSz');
  const size = {
    width: numAttr(sldSz, 'cx', DEFAULT_SIZE.cx) / EMU_PER_PT,
    height: numAttr(sldSz, 'cy', DEFAULT_SIZE.cy) / EMU_PER_PT,
  };
  return {
    zip,
    size,
    slides: await readSlideNotesFromZip(zip),
    metadata: readMetadata(await xml('docProps/core.xml')),
    defaultTextStyle: child(presentation, 'p:defaultTextStyle'),
    xml,
    rels,
  };
}

/**
 * @typedef {object} SlideParts
 * @property {string} part - the slide's part name
 * @property {import('./xml.js').XmlElement} slide - root `p:sld`
 * @property {import('./xml.js').XmlElement | null} layout - root `p:sldLayout`
 * @property {import('./xml.js').XmlElement | null} master - root `p:sldMaster`
 * @property {{ layout: string | null, master: string | null }} partNames -
 *   the layout's and master's part names (their relationships hold the
 *   pictures they paint)
 * @property {Array<{ id: string, type: string, target: string }>} rels - the
 *   slide's relationships
 * @property {import('./colors.js').ColorContext} colors - the theme's scheme
 *   and the clrMap in force on this slide
 */

/**
 * The slide with its layout, master and colours.
 *
 * @param {PptxPackage} pkg
 * @param {string} part - e.g. `ppt/slides/slide1.xml`
 * @returns {Promise<SlideParts | null>} null when the part does not parse
 */
export async function readSlideParts(pkg, part) {
  const slide = await pkg.xml(part);
  if (!slide || slide.name !== 'p:sld') return null;
  const rels = await pkg.rels(part);
  const layoutPart = rels.find((r) => LAYOUT_REL.test(r.type))?.target;
  const layout = layoutPart ? await pkg.xml(layoutPart) : null;
  const masterPart = layoutPart
    ? (await pkg.rels(layoutPart)).find((r) => MASTER_REL.test(r.type))?.target
    : null;
  const master = masterPart ? await pkg.xml(masterPart) : null;
  const themePart = masterPart
    ? (await pkg.rels(masterPart)).find((r) => THEME_REL.test(r.type))?.target
    : null;
  const theme = themePart ? await pkg.xml(themePart) : null;

  let clrMap = readClrMap(child(master, 'p:clrMap'));
  for (const el of [layout, slide]) {
    const override = path(el, 'p:clrMapOvr', 'a:overrideClrMapping');
    if (override) clrMap = readClrMap(override, clrMap);
  }
  return {
    part,
    slide,
    layout,
    master,
    partNames: { layout: layoutPart || null, master: masterPart || null },
    rels,
    colors: { scheme: readColorScheme(theme), clrMap },
  };
}

/** Title and author from `docProps/core.xml`, where the producer set them. */
function readMetadata(core) {
  const metadata = {};
  const title = child(core, 'dc:title')?.text.trim();
  const author = child(core, 'dc:creator')?.text.trim();
  if (title) metadata.title = title;
  if (author) metadata.author = author;
  return metadata;
}
