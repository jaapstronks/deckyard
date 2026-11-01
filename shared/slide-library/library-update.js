/**
 * Taking in, or setting aside, a newer revision of a library item on the deck
 * slides that copy it (B904, D223, D370, D371).
 *
 * A linked slide (`slide.libraryRef`, ./library-ref.js) is still a copy. When
 * the item has a newer revision, the deck's editor chooses:
 *
 * - **Update** ({@link applyLibraryRevision}): the slide takes the item's type
 *   and content in every deck language the item has, and its ref moves to the
 *   new revision. What belongs to the deck stays: slide id, position, notes
 *   (D370), visibility, duration, parent, and the instance keys a poll or a
 *   follow-invite keeps its state under. A deck language the item lacks keeps
 *   its old text and is marked as outdated through the translation-source
 *   record of each field (D371), so the translate view reports it as changed;
 *   nothing is retranslated.
 * - **Ignore** ({@link ignoreLibraryRevision}): the ref remembers the revision,
 *   so the notice comes back only for a later one.
 *
 * Both work on the deck as the editor holds it: the active version in
 * `pres.slides`, the others in `pres.i18n.versions[lang].slides`. Pure apart
 * from mutating the deck they are handed.
 */

import {
  DEFAULT_DECK_LANG,
  normalizeLang,
  resolveDeckLang,
} from '../i18n-utils.js';
import { slideTextRows } from '../i18n-progress.js';
import {
  recordTranslationSource,
  translationSource,
} from '../translation-provenance.js';
import { slideInstanceKeys } from '../slide-types/instance-keys.js';
import { isNewerLibraryRevision, normalizeLibraryRef } from './library-ref.js';

const clone = (v) => (v === undefined ? v : structuredClone(v));

/**
 * Every version of the deck that holds slides, active first:
 * `[{ lang, slides, version }]`, where `version` is the `i18n.versions` entry
 * (null for a deck without versions).
 * @param {object} pres
 * @returns {Array<{lang: string, slides: object[], version: object|null}>}
 */
function deckVersions(pres) {
  const active = resolveDeckLang(pres) || DEFAULT_DECK_LANG;
  const versions = pres?.i18n?.versions;
  const out = [
    {
      lang: active,
      slides: Array.isArray(pres?.slides) ? pres.slides : [],
      version:
        versions && typeof versions === 'object'
          ? versions[active] || null
          : null,
    },
  ];
  if (!versions || typeof versions !== 'object') return out;
  for (const [key, version] of Object.entries(versions)) {
    const lang = normalizeLang(key);
    if (!lang || lang === active || version?.slides === pres.slides) continue;
    if (!Array.isArray(version?.slides)) continue;
    out.push({ lang, slides: version.slides, version });
  }
  return out;
}

/**
 * The item's content in `lang`, or null when the item has no version in it.
 * `item.content` is the version in the item's own language.
 * @param {object} item
 * @param {string} lang
 * @returns {object|null}
 */
export function libraryItemContentFor(item, lang) {
  const own = item?.i18n?.versions?.[lang]?.content;
  if (own && typeof own === 'object') return own;
  const base = normalizeLang(item?.i18n?.dominant) || DEFAULT_DECK_LANG;
  return lang === base && item?.content && typeof item.content === 'object'
    ? item.content
    : null;
}

/**
 * The deck slides linked to `itemId` for which `revision` is news, by id.
 * @param {object} pres
 * @param {string} itemId
 * @param {number} revision - the item's current revision
 * @returns {string[]}
 */
export function slidesBehindLibraryItem(pres, itemId, revision) {
  return (Array.isArray(pres?.slides) ? pres.slides : [])
    .filter((s) => {
      const ref = normalizeLibraryRef(s?.libraryRef);
      return ref?.itemId === itemId && isNewerLibraryRevision(ref, revision);
    })
    .map((s) => s.id);
}

/**
 * Keep the slide's own instance keys on its new content: a poll keeps the id
 * its votes are stored under, a follow-invite the deck it points at.
 * @param {object} next - the new content, mutated
 * @param {object} prev - the slide's content before the update
 * @param {object|null} def - the slide type
 */
function keepInstanceKeys(next, prev, def) {
  for (const key of Object.keys(slideInstanceKeys(def))) {
    if (prev && Object.hasOwn(prev, key)) next[key] = prev[key];
  }
}

/**
 * Mark the fields of `kept` (a language the item lacks) as translated from
 * the text `source` held before the update, so the translate view reports
 * them as changed once the source text moved.
 */
function markOutdated(kept, keptSlide, sourceLang, sourceSlide, slideTypes) {
  if (!kept.version) return;
  const rows = slideTextRows(
    { slides: [sourceSlide] },
    { slides: [keptSlide] },
    { slideTypes },
  );
  for (const row of rows) {
    if (row.kind !== 'slide' || !row.target.trim() || !row.source.trim())
      continue;
    recordTranslationSource(
      kept.version,
      row.slideId,
      row.path,
      translationSource(sourceLang, row.source),
    );
  }
}

/**
 * Take the item's revision into one deck slide, in every language version.
 *
 * @param {object} pres - the deck as the editor holds it, mutated
 * @param {string} slideId
 * @param {object} item - the library item at its current revision
 *   (`{ id, revision, slideType, content, i18n }`)
 * @param {{slideTypes?: Record<string, object>}} [opts]
 * @returns {{updated: string[], outdated: string[]}|null} the deck languages
 *   that took the item's text and those that kept theirs; null when the slide
 *   is not linked to this item
 */
export function applyLibraryRevision(pres, slideId, item, { slideTypes } = {}) {
  const versions = deckVersions(pres);
  const found = versions
    .map((v) => ({ ...v, slide: v.slides.find((s) => s?.id === slideId) }))
    .filter((v) => v.slide);
  const ref = normalizeLibraryRef(found[0]?.slide?.libraryRef);
  if (!ref || ref.itemId !== item?.id || !Number.isInteger(item?.revision))
    return null;

  const type = String(item.slideType || '').trim() || found[0].slide.type;
  const def = slideTypes?.[type] || null;
  const incoming = found.map((v) => libraryItemContentFor(item, v.lang));
  // A deck in a language the item does not have still takes the item's own
  // text in the language being edited, as the insert did.
  if (incoming.every((c) => !c) && item.content) incoming[0] = item.content;

  const before = found.map((v) => clone(v.slide));
  const updated = [];
  const outdated = [];
  found.forEach((v, i) => {
    v.slide.libraryRef = { itemId: ref.itemId, revision: item.revision };
    v.slide.type = type;
    if (!incoming[i]) {
      outdated.push(v.lang);
      return;
    }
    const content = clone(incoming[i]);
    keepInstanceKeys(content, before[i].content, def);
    v.slide.content = content;
    updated.push(v.lang);
  });

  const sourceIndex = found.findIndex((v, i) => incoming[i]);
  if (outdated.length && sourceIndex >= 0) {
    const source = found[sourceIndex];
    found.forEach((v, i) => {
      if (incoming[i]) return;
      markOutdated(v, before[i], source.lang, before[sourceIndex], slideTypes);
    });
  }
  return { updated, outdated };
}

/**
 * Set a revision aside on one deck slide, in every language version: its ref
 * remembers it, so only a later revision is news again.
 * @param {object} pres - the deck as the editor holds it, mutated
 * @param {string} slideId
 * @param {number} revision - the item revision to ignore
 * @returns {boolean} whether the slide was linked and is now set aside
 */
export function ignoreLibraryRevision(pres, slideId, revision) {
  let done = false;
  for (const v of deckVersions(pres)) {
    const slide = v.slides.find((s) => s?.id === slideId);
    const ref = normalizeLibraryRef(slide?.libraryRef);
    if (!ref || !isNewerLibraryRevision(ref, revision)) continue;
    slide.libraryRef = { ...ref, ignoredRevision: revision };
    done = true;
  }
  return done;
}
