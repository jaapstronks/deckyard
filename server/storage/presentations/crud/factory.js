/**
 * Presentation factory - create new presentation objects.
 */

import { newPresentation } from '../../../../shared/slide-schemas.js';
import { cryptoUuid } from '../../../../shared/slide-types/helpers.js';
import { normalizeI18n, refuseNonCanonicalVersionKeys } from '../i18n.js';
import {
  DEFAULT_DECK_LANG,
  normalizeLang,
} from '../../../../shared/i18n-utils.js';
import { AppError } from '../../../utils/errors.js';
import { attachSandboxMeta } from '../sandbox.js';
import { settleNewDeckTheme } from '../../../utils/themes.js';
import { normalizeMeta } from './helpers.js';
import { rekeyNewDeckSlides } from './rekey-new-deck.js';
import { normalizeRevealStyle } from '../../../../shared/reveal-style.js';

/** @param {unknown} value */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Refuse a `slides[i].contentByLang` the factory could only read by repairing
 * it. The map becomes the deck's language versions, so it must be an object
 * of content objects keyed by canonical deck language: a non-object map (or
 * `null`) was ignored, a non-object language value (`"de": "tekst"`) fell back
 * to the flat `content` and that version never appeared (B485), and an alias
 * or off-axis key was dropped (B483). The keys pass the check the stored
 * version keys pass (B481), under the same field and path.
 *
 * @param {unknown} contentByLang
 * @param {number} i - the slide's index in the create body
 * @throws {AppError} 400 `invalid`, `details.field` = `slides`
 */
function refuseMalformedContentByLang(contentByLang, i) {
  const path = `slides[${i}].contentByLang`;
  const refuse = (message) => {
    throw new AppError(message, 400, { field: 'slides' }, 'invalid');
  };
  if (!isPlainObject(contentByLang)) {
    refuse(`${path} must be an object of content per deck language`);
  }
  refuseNonCanonicalVersionKeys(contentByLang, { field: 'slides', path });
  for (const [lang, content] of Object.entries(contentByLang)) {
    if (!isPlainObject(content)) {
      refuse(`${path} key ${JSON.stringify(lang)} must be a content object`);
    }
  }
}

/**
 * Prepare a new presentation object with all defaults, title slide, and i18n setup.
 * This function does NOT persist the presentation - it just creates the data structure.
 * Used by both file-based and database storage adapters.
 *
 * @param {string} repoRoot - Repository root path (for theme loading)
 * @param {Object} body - Request body with title, lang, theme, settings, ownerEmail
 * @param {Object} [opts]
 * @param {Record<string, object>} [opts.slideTypes] - the organization's slide
 *   type registry. A deck can be created *with* slides (library insert, import,
 *   agent payload), and those go through the same write seam, so the org's
 *   DB-backed custom types have to be resolvable here as well (B129).
 * @param {Object} [opts.storageScope] - the acting storage scope, so a custom
 *   theme is found only in its own organization
 * @returns {Promise<Object>} Fully prepared presentation object
 * @throws {AppError} 400 `invalid` with `details.field` = `theme` for a theme
 *   this instance does not have, or `slides` for a malformed `contentByLang`
 */
export async function prepareNewPresentation(
  repoRoot,
  body,
  { slideTypes, storageScope = null } = {},
) {
  const title =
    typeof body?.title === 'string' && body.title.trim()
      ? body.title.trim()
      : 'Naamloze presentatie';
  const initialLang = normalizeLang(body?.lang) || DEFAULT_DECK_LANG;
  // The one place a create's theme is checked (B486): absent is the
  // installation default, anything else must be a theme this instance has, in
  // its one spelling, or the create is refused.
  const { themeId: effectiveTheme, theme: themeConfig } =
    await settleNewDeckTheme(repoRoot, body?.theme, storageScope);
  // Default title slide differs per theme. The theme also rides into
  // newPresentation and on to newSlide, so that a slide type opting in via
  // `autoBackgroundPreset` can draw a background from the theme's own presets.
  // That declaration is the only rule, on every route (D92); no core type sets
  // it today, so the default title slide stays flat.
  const defaultTitleSlide = themeConfig?.defaultTitleSlide || 'title-slide';

  // If slides are provided in the body, use them instead of the default title slide.
  //
  // Each slide may carry per-language content under `contentByLang` (e.g. from
  // the slide library, which stores nl + en-GB). When present, we build one
  // i18n version per language so a composed deck keeps both languages instead
  // of collapsing to the one the picker happened to show. A stable slide id is
  // shared across every language version so they remain the same slide.
  //
  // Every provided slide gets a fresh id, so a provided `parentId` is remapped
  // onto the new ids the same way the editor's clone helper does it: a nested
  // slide posted with its parent stays nested, one posted without its parent
  // lands at the top level rather than pointing at a slide of some other deck.
  // Content is deep-copied first — the rekey pass below writes into it, and two
  // slides of one request may well name the same object.
  //
  // Everything else a slide carries (`visibility`, `duration`, `dataSource`,
  // the AI wizard's `_aiReasoning` / `_aiAlternatives` the editor's review
  // grid reads) rides along as it would through an update: the write seam
  // (`normalizeSlides`, which `normalizeI18n` runs on every version below)
  // keeps unknown keys, and a create that carries its content (B609) must not
  // drop what the update-after-create used to keep.
  const providedSlidesRaw =
    Array.isArray(body?.slides) && body.slides.length > 0 ? body.slides : null;

  let providedSlides = null; // dominant-language slides for pres.slides
  let providedVersions = null; // { [lang]: slides[] } when multilingual content is present

  if (providedSlidesRaw) {
    const idMap = new Map();
    for (const s of providedSlidesRaw) {
      const sourceId = typeof s?.id === 'string' && s.id ? s.id : null;
      if (sourceId && !idMap.has(sourceId)) idMap.set(sourceId, cryptoUuid());
    }
    // A payload id names one slide: the first slide carrying it gets the
    // mapped fresh id (and the parentId links pointing at it), a repeat is a
    // slide of its own — the deck must never store two slides under one id.
    const claimed = new Set();
    const base = providedSlidesRaw.map((s, i) => {
      const sourceId = typeof s?.id === 'string' && s.id ? s.id : null;
      const mapped =
        sourceId && !claimed.has(sourceId) ? idMap.get(sourceId) : null;
      if (sourceId) claimed.add(sourceId);
      if (s?.contentByLang !== undefined) {
        refuseMalformedContentByLang(s.contentByLang, i);
      }
      const { contentByLang: _byLang, ...rest } = isPlainObject(s) ? s : {};
      return {
        ...rest,
        id: mapped || cryptoUuid(),
        parentId:
          (typeof s?.parentId === 'string' && idMap.get(s.parentId)) || null,
        type: typeof s?.type === 'string' ? s.type : 'content-slide',
        notes: typeof s?.notes === 'string' ? s.notes : '',
        content:
          s?.content && typeof s.content === 'object'
            ? structuredClone(s.content)
            : {},
        contentByLang:
          s?.contentByLang !== undefined
            ? structuredClone(s.contentByLang)
            : null,
      };
    });

    // Which languages appear in any slide's contentByLang? Its keys are
    // canonical and its values objects, refused otherwise above.
    const langSet = new Set();
    for (const s of base) {
      for (const l of Object.keys(s.contentByLang || {})) langSet.add(l);
    }

    const contentFor = (s, lang) => s.contentByLang?.[lang] ?? s.content;
    const withoutByLang = (s, content) => {
      const { contentByLang: _byLang, ...slide } = s;
      return { ...slide, content };
    };

    if (langSet.size > 0) {
      // Always include the dominant language so the top-level version exists.
      langSet.add(initialLang);
      providedVersions = {};
      for (const lang of langSet) {
        providedVersions[lang] = base.map((s) =>
          withoutByLang(s, contentFor(s, lang)),
        );
      }
      providedSlides = providedVersions[initialLang];
    } else {
      providedSlides = base.map((s) => withoutByLang(s, s.content));
    }
  }

  const pres = newPresentation({
    title,
    theme: effectiveTheme,
    lang: initialLang,
    defaultTitleSlide,
    themeConfig,
  });
  pres.lang = initialLang;
  pres.extensions = body?.extensions ?? [];

  // Use provided slides if any, otherwise keep the default title slide
  if (providedSlides) {
    pres.slides = providedSlides;
  }

  // Allow a small set of safe deck-level settings at creation time.
  // (Keep this allowlisted; do not accept arbitrary settings blobs from clients.)
  try {
    if (typeof body?.settings?.stepParagraphs === 'boolean') {
      pres.settings =
        pres.settings && typeof pres.settings === 'object' ? pres.settings : {};
      pres.settings.stepParagraphs = body.settings.stepParagraphs;
    }
    // Reveal style for builds (default | typewriter). Lets an AI-authored deck
    // set typewriter-per-bullet at creation, matching Deckyard's "for humans and
    // AI agents" stance. Unknown values are ignored by normalizeRevealStyle.
    const revealStyle = normalizeRevealStyle(body?.settings?.revealStyle);
    if (revealStyle) {
      pres.settings =
        pres.settings && typeof pres.settings === 'object' ? pres.settings : {};
      pres.settings.revealStyle = revealStyle;
    }
    const presetRaw =
      typeof body?.settings?.transitions?.preset === 'string'
        ? body.settings.transitions.preset
        : '';
    const preset = String(presetRaw || '').trim();
    const allowed = new Set(['none', 'fade', 'slide', 'push', 'cube']);
    if (allowed.has(preset)) {
      pres.settings =
        pres.settings && typeof pres.settings === 'object' ? pres.settings : {};
      pres.settings.transitions =
        pres.settings.transitions &&
        typeof pres.settings.transitions === 'object'
          ? pres.settings.transitions
          : {};
      pres.settings.transitions.preset = preset;
    }
  } catch {
    // ignore
  }

  // New presentation UX: the opening title slide carries the deck's own name.
  // It used to read "Presentatie over <name>" / "Presentation about <name>",
  // which is stiff and is never what someone would type themselves — a title
  // slide's title simply *is* the deck title. Dropping the prefix also makes
  // this language-independent.
  // Only apply this to default slides, not to provided slides (e.g., from slide library).
  if (!providedSlides) {
    try {
      const s0 = Array.isArray(pres.slides) ? pres.slides[0] : null;
      if (s0?.type === 'title-slide') {
        s0.content =
          s0.content && typeof s0.content === 'object' ? s0.content : {};
        // Respect schema max length (120) with a conservative trim.
        s0.content.title =
          title.length > 120 ? title.slice(0, 119).trimEnd() + '…' : title;
      }
    } catch {
      // ignore
    }
  }

  if (typeof body?.ownerEmail === 'string' && body.ownerEmail.trim())
    pres.ownerEmail = body.ownerEmail.trim().toLowerCase();
  pres.visibility = 'private';
  pres.createdBy = pres.ownerEmail || null;
  pres.updatedBy = pres.ownerEmail || null;
  pres.revision = 1;

  // Store Notion source page ID if provided (for "Publish to Notion" feature).
  if (
    typeof body?.notionSourcePageId === 'string' &&
    body.notionSourcePageId.trim()
  ) {
    pres.notionSourcePageId = body.notionSourcePageId.trim().toLowerCase();
  }

  // Sandbox mode: ephemeral decks expire after TTL.
  attachSandboxMeta(pres);

  // Ensure new presentations immediately include i18n scaffolding + follow-invite slide.
  // When the provided slides carried multilingual content, seed a version per
  // language so both survive the round-trip; otherwise seed just the dominant one.
  pres.i18n = {
    dominant: initialLang,
    active: initialLang,
    versions: providedVersions
      ? Object.fromEntries(
          Object.entries(providedVersions).map(([lang, slides]) => [
            lang,
            { title: pres.title, slides },
          ]),
        )
      : {
          [initialLang]: {
            title: pres.title,
            slides: pres.slides,
          },
        },
  };
  normalizeI18n(pres, { slideTypes });

  // The slides came from somewhere else — a library item, another deck, an
  // agent's payload — so the content keys a type declares as instance-bound are
  // re-derived against *this* deck before it is stored.
  rekeyNewDeckSlides(pres);

  return normalizeMeta(pres);
}
