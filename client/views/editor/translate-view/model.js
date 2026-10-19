/**
 * What the translation view shows: two language versions of the deck as rows
 * of source | target per text field (B763). Pure, no DOM, so a test can pin it.
 *
 * The rows are `slideTextRows` (shared/i18n-progress.js), the same walk the
 * missing-translation scan filters, so the view and the counts in the language
 * menu cannot disagree about which fields a slide has. One thing is decided
 * here instead: whether the target version holds the slide at all. That is
 * matched on slide id only; the scan's fallback to the same index is no proof
 * the slide exists, and would show the text of another slide (B762 review 5).
 */
import {
  existingVersionLangs,
  pickVersion,
  slideTextRows,
} from '../../../../shared/i18n-progress.js';

import {
  translationFieldKey,
  translationFieldStatus,
} from '../../../../shared/translation-provenance.js';

const isFilled = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * The `{title, slides}` the editor holds for one language. The active version
 * is `pres` itself: its buffer in `i18n.versions` may lag the live slides
 * until the next save.
 * @param {Object} pres
 * @param {string} lang
 * @param {string} activeLang
 * @returns {{title: string, slides: any[]}}
 */
export function versionOf(pres, lang, activeLang) {
  if (lang === activeLang) {
    return {
      title: typeof pres?.title === 'string' ? pres.title : '',
      slides: Array.isArray(pres?.slides) ? pres.slides : [],
    };
  }
  return pickVersion(pres, lang);
}

/**
 * The languages the view can pair, and the pair it opens on: the deck's
 * source version (`i18n.dominant`) into the first other one (D226 point 5).
 * @param {Object} pres
 * @param {string} activeLang
 * @returns {{langs: string[], source: string, target: string}|null} null
 *   when the deck has one language, so there is nothing to pair
 */
export function defaultLanguagePair(pres, activeLang) {
  const existing = existingVersionLangs(pres);
  const langs = existing.includes(activeLang)
    ? existing
    : [activeLang, ...existing];
  if (langs.length < 2) return null;
  const dominant = pres?.i18n?.dominant;
  const source = langs.includes(dominant) ? dominant : activeLang;
  const target = langs.find((l) => l !== source);
  return { langs, source, target };
}

/**
 * A row whose target the "only empty fields" filter keeps: the source has
 * text and the target has none. The predicate `computeMissingTranslation`
 * applies, so the filter shows exactly what the menu counts as missing.
 * @param {{source: string, target: string}} row
 * @returns {boolean}
 */
export const isEmptyTarget = (row) =>
  isFilled(row.source) && !isFilled(row.target);

/**
 * @param {Object} args
 * @param {Object} args.pres - the editor's live presentation
 * @param {string} args.source - language of the left column
 * @param {string} args.target - language of the right column
 * @param {string} args.activeLang - the language `pres.slides` holds
 * @param {Object} [args.slideTypes] - slide-type registry
 * @returns {{
 *   deck: Object,
 *   slides: Array<{slideId: string, index: number|null, type: string,
 *     only: 'source'|'target'|null, rows: Object[]}>
 * }} `only` names the version a slide exists in when it is missing from the
 *   other; such a slide has no rows
 */
export function translateViewModel({
  pres,
  source,
  target,
  activeLang,
  slideTypes,
}) {
  const src = versionOf(pres, source, activeLang);
  const tgt = versionOf(pres, target, activeLang);
  const tgtIds = new Set(
    (tgt.slides || []).map((s) => s?.id).filter((id) => typeof id === 'string'),
  );

  const rows = slideTextRows(src, tgt, { slideTypes }).map((row) => ({
    ...row,
    status: translationFieldStatus(
      row,
      source,
      pres.i18n?.versions?.[target]?.translationSources?.[
        translationFieldKey(row.slideId, row.path)
      ],
    ),
  }));
  const [deck, ...slideRows] = rows;
  const byId = new Map();
  for (const r of slideRows) {
    if (!byId.has(r.slideId)) byId.set(r.slideId, []);
    byId.get(r.slideId).push(r);
  }

  const slides = [];
  const srcIds = new Set();
  (src.slides || []).forEach((s, index) => {
    if (!s || typeof s !== 'object') return;
    const slideId = typeof s.id === 'string' ? s.id : '';
    if (slideId) srcIds.add(slideId);
    const type = typeof s.type === 'string' ? s.type : '';
    const present = !!slideId && tgtIds.has(slideId);
    slides.push({
      slideId,
      index,
      type,
      only: present ? null : 'source',
      rows: present ? byId.get(slideId) || [] : [],
    });
  });
  // A slide only the target holds: listed, so it is not invisible, without
  // rows to edit (the source has no text to set beside it).
  (tgt.slides || []).forEach((s) => {
    const slideId = typeof s?.id === 'string' ? s.id : '';
    if (!slideId || srcIds.has(slideId)) return;
    slides.push({
      slideId,
      index: null,
      type: typeof s.type === 'string' ? s.type : '',
      only: 'target',
      rows: [],
    });
  });

  return { deck, slides };
}

/**
 * The model with the "only empty fields" filter applied: rows with an empty
 * target, and the slides that keep one. A slide missing from the target has
 * nothing filled there, so it stays.
 * @param {ReturnType<typeof translateViewModel>} model
 * @returns {ReturnType<typeof translateViewModel>}
 */
export function onlyEmptyTargets(model) {
  return {
    deck: isEmptyTarget(model.deck) ? model.deck : null,
    slides: model.slides
      .map((s) =>
        s.only ? s : { ...s, rows: s.rows.filter((r) => isEmptyTarget(r)) },
      )
      .filter((s) => s.only === 'source' || s.rows.length > 0),
  };
}

/** Filter rows and index together, leaving the unfiltered status available. */
export function filterTranslationRows(model, status) {
  if (status === 'empty') return onlyEmptyTargets(model);
  if (!status) return model;
  return {
    deck: model.deck?.status === status ? model.deck : null,
    slides: model.slides
      .map((s) => ({ ...s, rows: s.rows.filter((r) => r.status === status) }))
      .filter((s) => s.rows.length),
  };
}
