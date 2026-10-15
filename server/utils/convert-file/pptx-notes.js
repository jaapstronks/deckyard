/**
 * PPTX speaker notes, per slide, in the order the deck shows them.
 *
 * The raster import (B700) puts each source slide on an image slide and needs
 * the notes beside the right image, and the interpreting import (B702) walks
 * the same list to read each slide's text and pictures. Both take the deck's
 * own order — the slide list in `ppt/presentation.xml` — not the order of the
 * part names (`slide10.xml` can come before `slide2.xml`, and a reordered deck
 * keeps its old names), and the notes part the slide's relationships point at,
 * not the one with the same number. Hidden slides are reported, so a caller
 * can line the notes up with a rendering that leaves them out.
 */

import JSZip from 'jszip';
import { extractTextFromSlideXml } from './pptx-text.js';

const NOTES_REL_TYPE = /\/notesSlide$/;
const SLIDE_REL_TYPE = /\/slide$/;

/**
 * Read the speaker notes of every slide, in deck order.
 *
 * Notes come back as plain text, one paragraph per line: the body placeholder
 * of the notes page only, so the slide-number and header fields on that page
 * stay out.
 *
 * @param {Buffer|Uint8Array} buffer - The PPTX file contents
 * @returns {Promise<Array<{ part: string, hidden: boolean, notes: string }>>}
 */
export async function readPptxSlideNotes(buffer) {
  return readSlideNotesFromZip(await JSZip.loadAsync(buffer));
}

/**
 * The same reading, on a package that is already open: for a caller that
 * goes on to read the slide parts themselves and should not load the zip
 * twice. Slides whose part is missing from the package are left out.
 *
 * @param {JSZip} zip - The opened PPTX package
 * @returns {Promise<Array<{ part: string, hidden: boolean, notes: string }>>}
 */
export async function readSlideNotesFromZip(zip) {
  const slideParts = await slidePartsInDeckOrder(zip);
  const slides = [];
  for (const part of slideParts) {
    const slideXml = await zip.file(part)?.async('string');
    if (slideXml == null) continue;
    const notesPart = (await readRels(zip, part)).find((r) =>
      NOTES_REL_TYPE.test(r.type),
    )?.target;
    const notesXml = notesPart
      ? await zip.file(notesPart)?.async('string')
      : null;
    slides.push({
      part,
      hidden: isHidden(slideXml),
      notes: notesXml ? notesBodyText(notesXml) : '',
    });
  }
  return slides;
}

/**
 * The slide parts as `ppt/presentation.xml` lists them; by part number when
 * a file has no usable slide list.
 * @param {JSZip} zip
 * @returns {Promise<string[]>}
 */
async function slidePartsInDeckOrder(zip) {
  const presXml = await zip.file('ppt/presentation.xml')?.async('string');
  if (presXml) {
    const rels = await readRels(zip, 'ppt/presentation.xml');
    const byId = new Map(
      rels.filter((r) => SLIDE_REL_TYPE.test(r.type)).map((r) => [r.id, r]),
    );
    const list = /<p:sldIdLst\b[^>]*>([\s\S]*?)<\/p:sldIdLst>/.exec(presXml);
    const ordered = [];
    for (const m of (list?.[1] || '').matchAll(/<p:sldId\b[^>]*>/g)) {
      const rid = attrs(m[0])['r:id'];
      const target = byId.get(rid)?.target;
      if (target) ordered.push(target);
    }
    if (ordered.length) return ordered;
  }
  return Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => partNumber(a) - partNumber(b));
}

/**
 * The relationships of one part, targets resolved to zip paths. External
 * targets (hyperlinks, linked media) are left out: they name no part.
 * @param {JSZip} zip
 * @param {string} part - e.g. `ppt/slides/slide1.xml`
 * @returns {Promise<Array<{ id: string, type: string, target: string }>>}
 */
async function readRels(zip, part) {
  const dir = part.slice(0, part.lastIndexOf('/') + 1);
  const name = part.slice(dir.length);
  const xml = await zip.file(`${dir}_rels/${name}.rels`)?.async('string');
  if (!xml) return [];
  const out = [];
  for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const a = attrs(m[0]);
    if (!a.Id || !a.Target || a.TargetMode === 'External') continue;
    out.push({
      id: a.Id,
      type: a.Type || '',
      target: resolvePart(dir, a.Target),
    });
  }
  return out;
}

/** Attributes of one start tag, by qualified name. */
function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:]+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

/** A relationship target as a zip path: relative to `dir`, or package-absolute. */
function resolvePart(dir, target) {
  const segments = target.startsWith('/') ? [] : dir.split('/').filter(Boolean);
  for (const seg of target.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') segments.pop();
    else segments.push(seg);
  }
  return segments.join('/');
}

function partNumber(name) {
  return parseInt(/(\d+)\.xml$/i.exec(name)?.[1] || '0', 10);
}

/** `<p:sld show="0">`: the slide is skipped in a slide show and in a PDF export. */
function isHidden(slideXml) {
  const root = /<p:sld\b[^>]*>/.exec(slideXml)?.[0] || '';
  return /\bshow="(0|false)"/.test(root);
}

/** The text of the notes page's body placeholder, paragraphs on their own line. */
function notesBodyText(notesXml) {
  const parts = [];
  for (const m of notesXml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)) {
    if (/<p:ph\b[^>]*\btype="body"/.test(m[0])) {
      const text = extractTextFromSlideXml(m[0]);
      if (text) parts.push(text);
    }
  }
  return parts.join('\n').replace(/\r\n?/g, '\n');
}
