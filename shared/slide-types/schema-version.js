/**
 * Deck schema versioning + the single migration runner.
 *
 * Move 1b of the datamodel-purity track. Before this, stored decks carried no
 * schema version at all (`version: 1` existed only on the export wire format in
 * deck.js, never on the thing on disk), and backward-compatibility was handled
 * by scattered per-type "fold on edit / fall back on render" resolvers. This
 * module gives the durable deck a stamped `schemaVersion` and one ordered place
 * to migrate old shapes forward.
 *
 * Design (modelled on Jupyter nbformat): a deck declares `schemaVersion`; a
 * single `migratePresentation()` funnel upgrades any older deck to the current
 * in-memory shape via a chain of small, pure steps, so the rest of the engine
 * never branches on version. Migration runs at read time; the upgraded deck is
 * persisted on the next write (reads never write).
 */

import { resolveRows } from './types/text-blocks-slide.js';
import { getSlideType, resolveSlideTypeName } from './registry.js';
import {
  getFieldGroup,
  getFieldGroups,
  groupAlignValues,
} from './field-groups.js';

/** The schema version every freshly written deck is stamped with. */
export const CURRENT_SCHEMA_VERSION = 7;

/**
 * The one legacy collection key each type stored before `items` — the v6 -> v7
 * fold's whole input. Written out here rather than declared on the types,
 * because a migration is a record of a shape that no longer exists: leaving a
 * `legacyKeys` declaration behind would keep the second spelling alive in the
 * schema it is supposed to remove.
 */
const LEGACY_COLLECTION_KEYS = {
  'process-slide': 'steps',
  'funnel-slide': 'stages',
  'cycle-slide': 'stages',
};

/** Type + group the v4 -> v5 quote-alignment fold reads its target key from. */
const QUOTE_SLIDE_TYPE = 'quote-slide';
const QUOTE_BLOCK_GROUP = 'quote-block';

/**
 * Ordered migration steps. `SCHEMA_MIGRATIONS[i]` migrates a deck FROM version
 * `i` TO version `i + 1` and must:
 *  - assume the deck is already at the source version;
 *  - be pure enough to run safely (it may mutate the passed object, which is a
 *    fresh parse from disk, and must return the deck);
 *  - never lose data.
 *
 * The invariant `SCHEMA_MIGRATIONS.length === CURRENT_SCHEMA_VERSION` is
 * enforced by tests, so bumping the version forces you to add a real step.
 *
 * @type {Array<(pres: any) => any>}
 */
export const SCHEMA_MIGRATIONS = [
  // v0 -> v1: baseline stamp. Decks predating schemaVersion are structurally
  // already v1-shaped; their legacy field quirks (bgImage/slideBgImage,
  // image-slide layout->fit, image-text image->images[]) are still handled by
  // the existing lazy per-type resolvers. This step introduces the version
  // without rewriting content. When a later change retires a lazy resolver, it
  // lands as a v1 -> v2 step that folds the shape once, here.
  (pres) => pres,

  // v1 -> v2: fold text-blocks legacy numbered fields (row{n}Count,
  // row{n}Block{m}Title/Body, arrow{n}, row{n}Enabled …) into the canonical
  // `rows[]` model, so the semantic projection and everything else read one
  // shape. Non-destructive: it only *adds* `content.rows` when it is missing or
  // empty (via the type's own resolver), and leaves the legacy keys in place —
  // they are now `hidden` in the type def (ignored by the projection) and get
  // removed in a later deprecation-window cleanup. Idempotent: a slide that
  // already has a populated `rows[]` is untouched.
  (pres) => {
    const slides = Array.isArray(pres?.slides) ? pres.slides : [];
    for (const slide of slides) {
      if (!slide || slide.type !== 'text-blocks-slide') continue;
      const content = slide.content;
      if (!content || typeof content !== 'object') continue;
      if (Array.isArray(content.rows) && content.rows.length > 0) continue;
      const rows = resolveRows(content);
      if (Array.isArray(rows) && rows.length > 0) content.rows = rows;
    }
    return pres;
  },

  // v2 -> v3: historically folded card-stack's legacy numbered fields into a
  // canonical `items[]` so the semantic projection read one shape. card-stack
  // was removed (PR removing the deprecated layer); a stored card-stack slide
  // now renders via the unresolved/archived contract, which reads every stored
  // field directly, so synthesizing `items[]` serves nothing. The step stays as
  // a no-op to keep the migration chain contiguous (SCHEMA_MIGRATIONS.length ===
  // CURRENT_SCHEMA_VERSION) and the version numbers stable — no stored deck is
  // rewritten, and no data is lost.
  (pres) => pres,

  // v3 -> v4: fold stored `slides[].type` down to the bare registry key. Before
  // the shared write-seam (`normalizeSlides`, PR #511) some write paths persisted
  // whatever spelling arrived — the canonical reverse-DNS id
  // (`eu.deckyard.slide.title`), a `core/…` qualified form, or the bare key. Now
  // that storage holds one spelling, this step brings decks written before the
  // seam into line so nothing on disk stays non-canonical. It rewrites the `type`
  // string to the key it already resolves to; a value that names no registered
  // type is left verbatim (a foreign/unknown type is never dropped). Idempotent:
  // a bare key resolves to itself, so a second run is a no-op.
  (pres) => {
    const slides = Array.isArray(pres?.slides) ? pres.slides : [];
    for (const slide of slides) {
      if (!slide || typeof slide.type !== 'string') continue;
      const key = resolveSlideTypeName(slide.type);
      if (key && key !== slide.type) slide.type = key;
    }
    return pres;
  },

  // v4 -> v5: fold quote-slide's block alignment down to the one stored form.
  // Before the field-group model the type hardcoded a lift: it read ONE
  // designated field's per-field align (`textStyles.quote.align`) and applied it
  // to the whole quote/name/role composition. The declared group replaced that
  // with `quoteAlign`, and the type kept a permanent read fallback so decks
  // authored before the group kept their centring — a second stored shape for
  // one meaning, with no end date. This step is that end date: the legacy value
  // moves into the group's own key once, the legacy key is dropped, and the
  // read fallback is gone from the type.
  //
  // Render-equivalent: a group member's own `align` has been inert on render
  // since the group model (`fieldAllowedAlignValues` returns [] for a member),
  // so the lifted block value is the only effect the key ever had, and a value
  // the group does not offer (`right`) already resolved to the default. Only
  // `align` is touched — `color`/`size` on the same field are per-field styling
  // and stay. Idempotent: a slide without the legacy key is untouched.
  (pres) => {
    const group = getFieldGroup(
      getSlideType(QUOTE_SLIDE_TYPE),
      QUOTE_BLOCK_GROUP,
    );
    const alignKey = typeof group?.alignKey === 'string' ? group.alignKey : '';
    if (!alignKey) return pres;
    const offered = groupAlignValues(group);
    const slides = Array.isArray(pres?.slides) ? pres.slides : [];
    for (const slide of slides) {
      if (!slide || slide.type !== QUOTE_SLIDE_TYPE) continue;
      const content = slide.content;
      if (!content || typeof content !== 'object') continue;
      const styles = content.textStyles;
      if (!styles || typeof styles !== 'object') continue;
      const quoteStyle = styles.quote;
      if (!quoteStyle || typeof quoteStyle !== 'object') continue;
      if (!Object.prototype.hasOwnProperty.call(quoteStyle, 'align')) continue;
      const legacy = quoteStyle.align;
      if (!content[alignKey] && offered.includes(legacy))
        content[alignKey] = legacy;
      delete quoteStyle.align;
      if (!Object.keys(quoteStyle).length) delete styles.quote;
      if (!Object.keys(styles).length) delete content.textStyles;
    }
    return pres;
  },

  // v5 -> v6: fold away every remaining inert per-field `align`. The v4 -> v5
  // step handled only quote-slide's one designated field; but since the
  // field-group model (#593) a group MEMBER's own `align` is inert on render for
  // *every* member on *every* adopting type — `fieldAllowedAlignValues` returns
  // [] for a member, so the value has no effect and the block's alignment lives
  // in the group's own `alignKey` (`titleBlockAlign`, `headerAlign`, `quoteAlign`
  // …). That left a second stored shape for one meaning on title/chapter/list/
  // logo-wall/chart/kpi headers and on quote's name/role — with no end date.
  // This is that end date: for each slide, every group-member field on its type
  // drops its `textStyles.<field>.align`.
  //
  // Render-equivalent by construction: the key was already inert, so removing it
  // changes nothing on screen. Only `align` is touched — `color`/`size` on the
  // same field are per-field styling and stay. Members are read from the
  // registry, so a type that adopts a group later is swept by the same code.
  // Idempotent: a field without the legacy key is untouched.
  (pres) => {
    const slides = Array.isArray(pres?.slides) ? pres.slides : [];
    for (const slide of slides) {
      if (!slide || typeof slide.type !== 'string') continue;
      const def = getSlideType(slide.type);
      if (!def) continue;
      const groupIds = new Set(
        getFieldGroups(def)
          .map((g) => (g && typeof g.id === 'string' ? g.id : ''))
          .filter(Boolean),
      );
      if (!groupIds.size) continue;
      const content = slide.content;
      if (!content || typeof content !== 'object') continue;
      const styles = content.textStyles;
      if (!styles || typeof styles !== 'object') continue;
      const fields = Array.isArray(def.fields) ? def.fields : [];
      for (const field of fields) {
        if (!field || typeof field.key !== 'string') continue;
        const group = typeof field.group === 'string' ? field.group.trim() : '';
        if (!group || !groupIds.has(group)) continue;
        const fieldStyle = styles[field.key];
        if (!fieldStyle || typeof fieldStyle !== 'object') continue;
        if (!Object.prototype.hasOwnProperty.call(fieldStyle, 'align'))
          continue;
        delete fieldStyle.align;
        if (!Object.keys(fieldStyle).length) delete styles[field.key];
      }
      if (!Object.keys(styles).length) delete content.textStyles;
    }
    return pres;
  },

  // v6 -> v7: fold the legacy collection aliases into `items`. process-slide
  // stored its steps under `steps`, funnel- and cycle-slide theirs under
  // `stages`, before all three moved to the canonical `items`. The read side
  // has carried a fallback ever since (`getCollectionItems(content, 'items',
  // ['steps'])`), marked "Remove after April 2026" and still in place in
  // August — a second accepted spelling for one collection, with no end date.
  // This is that end date: the array moves once, the legacy key is dropped,
  // and the fallback, the hidden field declarations and the editor's
  // `fieldAliases` plumbing all go with it.
  //
  // Render-equivalent: the fallback only ever fired when `items` was absent or
  // empty, which is exactly when this step moves the value into it. A slide
  // that already has a populated `items` keeps it and the stale alias key is
  // still removed — it was unreachable on every surface. Idempotent: a slide
  // without the legacy key is untouched.
  (pres) => {
    const slides = Array.isArray(pres?.slides) ? pres.slides : [];
    for (const slide of slides) {
      if (!slide || typeof slide.type !== 'string') continue;
      const legacyKey = LEGACY_COLLECTION_KEYS[slide.type];
      if (!legacyKey) continue;
      const content = slide.content;
      if (!content || typeof content !== 'object') continue;
      if (!Object.prototype.hasOwnProperty.call(content, legacyKey)) continue;
      const legacy = content[legacyKey];
      const canonical = content.items;
      const canonicalEmpty =
        !Array.isArray(canonical) || canonical.length === 0;
      if (canonicalEmpty && Array.isArray(legacy) && legacy.length > 0) {
        content.items = legacy;
      }
      delete content[legacyKey];
    }
    return pres;
  },
];

/**
 * The version a deck is currently in. Missing/invalid stamps are treated as
 * version 0 (pre-versioning).
 * @param {any} pres
 * @returns {number}
 */
export function schemaVersionOf(pres) {
  const v = pres == null ? NaN : Number(pres.schemaVersion);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

/**
 * Upgrade a deck to `CURRENT_SCHEMA_VERSION` in memory, running each ordered
 * migration step in turn. Idempotent: an already-current deck is returned with
 * only its stamp normalised. A deck from a *newer* version is left untouched
 * (we never downgrade); validation surfaces that separately.
 * @param {any} pres
 * @returns {any} the same object, migrated and stamped
 */
export function migratePresentation(pres) {
  if (!pres || typeof pres !== 'object') return pres;
  const from = schemaVersionOf(pres);
  if (from >= CURRENT_SCHEMA_VERSION) {
    // Already current, or ahead of us (a deck written by a newer build). Don't
    // downgrade; only normalise the stamp to a number when it is exactly current.
    if (from === CURRENT_SCHEMA_VERSION)
      pres.schemaVersion = CURRENT_SCHEMA_VERSION;
    return pres;
  }
  let out = pres;
  for (let v = from; v < CURRENT_SCHEMA_VERSION; v += 1) {
    const step = SCHEMA_MIGRATIONS[v];
    if (typeof step === 'function') out = step(out) || out;
  }
  out.schemaVersion = CURRENT_SCHEMA_VERSION;
  return out;
}
