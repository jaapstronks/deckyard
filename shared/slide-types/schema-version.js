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
export const CURRENT_SCHEMA_VERSION = 11;

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

/**
 * The legacy numbered slot families the v7 -> v8 fold reads — the last three
 * types that carried a flat `card1Name` / `logo1Image` family beside their
 * canonical array. Each entry records the array the slots move into, the
 * numbered prefix and the count key that bounded them, and how the slot
 * suffixes map onto item keys.
 *
 * Written out here rather than declared on the types, for the same reason the
 * v6 -> v7 table is: a migration is a record of a shape that no longer exists,
 * and a `legacySlots` declaration left on the type would keep the second
 * spelling alive in the schema this step removes.
 *
 * The per-family knobs are not preferences — each one pins what that type's own
 * read fallback did, so the fold is render-equivalent:
 *  - `presence`: which item keys made a slot count as filled (a slot with only
 *    an alt text or a focus point was skipped by the resolver, so it is skipped
 *    here too);
 *  - `countFallback`: what an absent count key meant (team-cards and logo-wall
 *    fell back to one slot, icon-card-grid to the full grid of six);
 *  - `scanBeyondCount`: team-cards and logo-wall deliberately scanned past the
 *    count for populated slots ("be forgiving"), icon-card-grid did not;
 *  - `trimStrings` / `keepInteriorBlanks`: icon-card-grid trimmed every value
 *    and kept blank slots inside the count (a blank card still occupied a cell),
 *    trailing blanks aside — see the fold below.
 *
 * @type {Record<string, {arrayKey: string, prefix: string, countKey: string,
 *   maxSlots: number, keys: Record<string,string>, presence: string[],
 *   itemDefaults?: Record<string, any>, countFallback: number,
 *   scanBeyondCount: boolean, trimStrings?: boolean,
 *   keepInteriorBlanks?: boolean}>}
 */
const LEGACY_SLOT_FAMILIES = {
  'team-cards-slide': {
    arrayKey: 'members',
    prefix: 'card',
    countKey: 'cardCount',
    maxSlots: 25,
    keys: {
      Image: 'image',
      Alt: 'alt',
      ImageFocusX: 'imageFocusX',
      ImageFocusY: 'imageFocusY',
      Name: 'name',
      Byline: 'byline',
      Linkedin: 'linkedin',
    },
    presence: ['image', 'name', 'byline'],
    // `resolveMembers` read focus with `?? 50`: a slot without a focus point
    // centres its crop. The item carries that explicitly.
    itemDefaults: { imageFocusX: 50, imageFocusY: 50 },
    countFallback: 1,
    scanBeyondCount: true,
  },
  'logo-wall-slide': {
    arrayKey: 'logos',
    prefix: 'logo',
    countKey: 'logoCount',
    maxSlots: 12,
    keys: { Image: 'image', Name: 'name', Alt: 'alt', Link: 'link' },
    presence: ['image', 'name'],
    countFallback: 1,
    scanBeyondCount: true,
  },
  'icon-card-grid-slide': {
    arrayKey: 'items',
    prefix: 'card',
    countKey: 'cardCount',
    maxSlots: 6,
    keys: { Icon: 'icon', Title: 'title', Body: 'body', Link: 'link' },
    presence: ['icon', 'title', 'body'],
    countFallback: 6,
    scanBeyondCount: false,
    trimStrings: true,
    keepInteriorBlanks: true,
  },
};

/**
 * The flat option slots the v8 -> v9 fold reads — the last legacy numbered
 * family, and the only one whose identity is load-bearing at *runtime* rather
 * than only on render: an audience vote is stored as an `option_index`
 * (`server/storage/interactions.js`), and that index has always been the
 * position in the *compacted* list of non-empty options, because a numbered
 * family can have holes.
 *
 * So the fold compacts exactly the way both readers did — `optionsFromContent`
 * on the type and `pollOptionsFromSlide`/`likertOptionsFromSlide` on the server
 * agreed on `nonEmpty`-and-drop — and every already-cast vote keeps pointing at
 * the answer it was cast on. After the fold the array has no holes, so nothing
 * compacts anywhere and the index is simply the position.
 *
 * Written out here rather than declared on the types, for the same reason the
 * v6 -> v7 and v7 -> v8 tables are: a migration is a record of a shape that no
 * longer exists.
 *
 * @type {Record<string, {arrayKey: string, prefix: string, maxSlots: number,
 *   itemKey: string}>}
 */
const LEGACY_OPTION_SLOTS = {
  'poll-slide': {
    arrayKey: 'options',
    prefix: 'option',
    maxSlots: 4,
    itemKey: 'text',
  },
  'likert-slide': {
    arrayKey: 'options',
    prefix: 'option',
    maxSlots: 10,
    itemKey: 'text',
  },
};

/**
 * Every stored key that belongs to a family's flat form: its count key plus
 * `${prefix}${n}${suffix}` for every declared slot suffix.
 * @param {typeof LEGACY_SLOT_FAMILIES[string]} family
 * @param {object} content
 * @returns {string[]}
 */
function legacySlotKeys(family, content) {
  const suffixes = Object.keys(family.keys);
  const out = [];
  if (Object.prototype.hasOwnProperty.call(content, family.countKey))
    out.push(family.countKey);
  for (const key of Object.keys(content)) {
    if (!key.startsWith(family.prefix)) continue;
    const m = key.slice(family.prefix.length).match(/^(\d+)(.+)$/);
    if (!m) continue;
    const n = Number(m[1]);
    if (!(n >= 1 && n <= family.maxSlots)) continue;
    if (!suffixes.includes(m[2])) continue;
    out.push(key);
  }
  return out;
}

/**
 * Fold one family's numbered slots into the item array its type reads today,
 * reproducing that type's own read fallback exactly.
 * @param {typeof LEGACY_SLOT_FAMILIES[string]} family
 * @param {object} content
 * @returns {Array<object>}
 */
function foldLegacySlots(family, content) {
  const { prefix, keys, presence, maxSlots, itemDefaults = {} } = family;
  const suffixes = Object.entries(keys);
  const presenceSuffixes = suffixes
    .filter(([, itemKey]) => presence.includes(itemKey))
    .map(([suffix]) => suffix);
  const slotValue = (n, suffix) => content[`${prefix}${n}${suffix}`];

  const declared = Number(content[family.countKey]);
  const valid = Number.isFinite(declared) && declared > 0;
  const count = Math.max(
    1,
    Math.min(maxSlots, valid ? declared : family.countFallback),
  );

  // "Be forgiving": team-cards and logo-wall walked every declared slot and
  // took the highest populated one, so content stored past the count still
  // rendered. icon-card-grid was hard-bounded by its count.
  let scanCount = count;
  if (family.scanBeyondCount) {
    for (let n = 1; n <= maxSlots; n += 1) {
      if (presenceSuffixes.some((suffix) => str(slotValue(n, suffix))))
        scanCount = Math.max(scanCount, n);
    }
  }

  const out = [];
  for (let n = 1; n <= scanCount; n += 1) {
    const item = {};
    for (const [suffix, itemKey] of suffixes) {
      const raw = slotValue(n, suffix);
      if (typeof raw === 'number') {
        item[itemKey] = raw;
        continue;
      }
      const v = raw == null ? '' : String(raw);
      item[itemKey] = family.trimStrings ? v.trim() : v;
    }
    for (const [itemKey, fallback] of Object.entries(itemDefaults))
      if (item[itemKey] === '') item[itemKey] = fallback;
    const filled = presence.some((k) => str(item[k]));
    if (filled || family.keepInteriorBlanks) out.push(item);
  }

  // A trailing blank slot is a slot the canonical array simply does not have.
  // Only `keepInteriorBlanks` families can produce one, and for those this is
  // the same trim the editor's `ensure` knob has been committing on every
  // legacy deck it opened.
  while (out.length && !presence.some((k) => str(out[out.length - 1][k])))
    out.pop();
  return out;
}

/**
 * A stored value as a trimmed string — the emptiness test every one of the
 * three read fallbacks used.
 * @param {any} v
 * @returns {string}
 */
function str(v) {
  return v == null ? '' : String(v).trim();
}

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

  // v7 -> v8: fold the last three legacy numbered slot families into their
  // canonical arrays. team-cards stored `card1Name`…`card25Linkedin`,
  // icon-card-grid `card1Icon`…`card6Link`, logo-wall `logo1Image`…`logo12Link`
  // — around 250 field declarations mirroring `members[]` / `items[]` /
  // `logos[]`, each family bounded by a count enum (`cardCount`, `logoCount`).
  // The read side carried a per-type fallback for them, the editor's `ensure`
  // knob folded them on first mount, and — worst of the three — the `defaults`
  // of team-cards and icon-card-grid *seeded* the flat form, so a freshly
  // created slide stored the legacy shape until someone touched it. A deck
  // could therefore hold both spellings at once, which is why the projection's
  // repeating-group bridge was never the answer: it would have projected such a
  // deck twice.
  //
  // This is the end date. Per slide: if the canonical array already holds
  // entries it wins untouched — the flat slots were unreachable on every
  // surface, since all three resolvers preferred the array — and the legacy
  // keys are dropped. Otherwise the slots fold into the array by the same rule
  // that type's own fallback used (see LEGACY_SLOT_FAMILIES for the per-family
  // knobs and why each one is what it is), and then the legacy keys are
  // dropped. Nothing is lost: a slot the resolver ignored rendered nowhere.
  //
  // Idempotent: a slide with no key from the family is untouched, and after one
  // run there is no such key left.
  (pres) => {
    const slides = Array.isArray(pres?.slides) ? pres.slides : [];
    for (const slide of slides) {
      if (!slide || typeof slide.type !== 'string') continue;
      const family = LEGACY_SLOT_FAMILIES[slide.type];
      if (!family) continue;
      const content = slide.content;
      if (!content || typeof content !== 'object') continue;
      const stored = legacySlotKeys(family, content);
      if (!stored.length) continue;
      const canonical = content[family.arrayKey];
      if (!Array.isArray(canonical) || canonical.length === 0) {
        const folded = foldLegacySlots(family, content);
        if (folded.length) content[family.arrayKey] = folded;
      }
      for (const key of stored) delete content[key];
    }
    return pres;
  },

  // v8 -> v9: fold poll-slide's `option1..option4` and likert-slide's
  // `option1..option10` into one canonical `options[]` array of `{ text }`.
  // These were the last flat numbered family, and the reason they outlived the
  // v7 -> v8 sweep is that its regex looks for a capitalised suffix
  // (`card1Title`): a bare `option1` slipped through. They were also the two
  // types whose declared `structure` contradicted their schema — both said
  // `fixed-collection`, which means one item array, while carrying scalars.
  //
  // Render-equivalent by construction: both readers (the type's own
  // `optionsFromContent` and the server's `pollOptionsFromSlide` /
  // `likertOptionsFromSlide`) took the non-empty slots in order and dropped the
  // holes, so the folded array is exactly the list every surface already saw —
  // which is what keeps a stored `option_index` pointing at the same answer
  // (see LEGACY_OPTION_SLOTS).
  //
  // As in v7 -> v8: a populated canonical array wins untouched and the legacy
  // keys are dropped either way. Idempotent — after one run no slot key is
  // left, and a slide that never had one is untouched.
  (pres) => {
    const slides = Array.isArray(pres?.slides) ? pres.slides : [];
    for (const slide of slides) {
      if (!slide || typeof slide.type !== 'string') continue;
      const family = LEGACY_OPTION_SLOTS[slide.type];
      if (!family) continue;
      const content = slide.content;
      if (!content || typeof content !== 'object') continue;
      const stored = [];
      const folded = [];
      for (let n = 1; n <= family.maxSlots; n += 1) {
        const key = `${family.prefix}${n}`;
        if (!Object.prototype.hasOwnProperty.call(content, key)) continue;
        stored.push(key);
        const text = str(content[key]);
        if (text) folded.push({ [family.itemKey]: text });
      }
      if (!stored.length) continue;
      const canonical = content[family.arrayKey];
      if (
        (!Array.isArray(canonical) || canonical.length === 0) &&
        folded.length
      ) {
        content[family.arrayKey] = folded;
      }
      for (const key of stored) delete content[key];
    }
    return pres;
  },

  // v9 -> v10: fold the pre-rename `subtitle` spelling into `subheading`.
  //
  // The rename shipped as a one-off SQL migration
  // (`server/db/migrations/020_rename_subtitle_to_subheading.js`), which folded
  // the stored rows once and then stopped being reachable. Import never touched
  // it: `deckToPresentationParts` runs THIS funnel, so a deck exported before
  // the rename — or hand-written against an old example — carried `subtitle`
  // straight past every renamed type, which declares only `subheading`. The
  // scattered readers that had been left behind to catch it (two conversion
  // branches, an alt-text fallback, the search indexer, two AI prompts) are the
  // "accepts both spellings" shape the beta stance rules out; folding here is
  // what lets them go, and gives import the normalisation the database got.
  //
  // Scoped to types that declare `subheading` and NOT `subtitle`: on those the
  // legacy key is unambiguously the old spelling of the field beside it. A
  // custom type that declares `subtitle` for its own sake keeps it untouched
  // (nothing is renamed out from under a fork), and a slide whose type is not
  // registered is skipped entirely.
  //
  // As in v7 -> v8 and v8 -> v9: a populated canonical value wins untouched and
  // the legacy key is dropped either way. Idempotent — after one run no
  // `subtitle` is left on a folded type, and a slide that never had one is
  // untouched.
  (pres) => {
    const slides = Array.isArray(pres?.slides) ? pres.slides : [];
    for (const slide of slides) {
      if (!slide || typeof slide.type !== 'string') continue;
      const content = slide.content;
      if (!content || typeof content !== 'object') continue;
      if (!Object.prototype.hasOwnProperty.call(content, 'subtitle')) continue;
      const def = getSlideType(slide.type);
      if (!def) continue;
      const declared = new Set(
        (def.fields || []).map((f) => String(f?.key || '')),
      );
      if (!declared.has('subheading') || declared.has('subtitle')) continue;
      const legacy = str(content.subtitle);
      if (legacy && !str(content.subheading)) content.subheading = legacy;
      delete content.subtitle;
    }
    return pres;
  },

  // v10 -> v11: drop the stored `i18n.progress` block.
  //
  // It cached two numbers — `missingNlToEnGb` and `missingEnGbToNl` — that
  // `normalizeI18n` recomputed on every write. A cache of a cheap pure scan is
  // a second place the truth can live, and this one could only ever describe
  // the NL/EN pair: a deck with a German version carried counters that said
  // nothing about it. `translationProgress()` in `shared/i18n-progress.js`
  // answers the question per existing version, where it is read (D72).
  //
  // Nothing reads the field any more, so this step only stops old decks from
  // carrying a stale number around. Idempotent, and a deck without an i18n
  // block is untouched.
  (pres) => {
    const i18n = pres?.i18n;
    if (i18n && typeof i18n === 'object') delete i18n.progress;
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
