/**
 * Presentation factory - create new presentation objects.
 */

import { newPresentation } from '../../../../shared/slide-schemas.js';
import { cryptoUuid } from '../../../../shared/slide-types/helpers.js';
import { normalizeI18n } from '../i18n.js';
import { attachSandboxMeta } from '../sandbox.js';
import { sandboxDefaultThemeId, sandboxEnabled } from '../../../config/sandbox.js';
import { resolveThemeId, loadTheme } from '../../../utils/themes.js';
import { normalizeMeta } from './helpers.js';

/**
 * Prepare a new presentation object with all defaults, title slide, and i18n setup.
 * This function does NOT persist the presentation - it just creates the data structure.
 * Used by both file-based and database storage adapters.
 *
 * @param {string} repoRoot - Repository root path (for theme loading)
 * @param {Object} body - Request body with title, lang, theme, settings, ownerEmail
 * @returns {Promise<Object>} Fully prepared presentation object
 */
export async function prepareNewPresentation(repoRoot, body) {
  const title =
    typeof body?.title === 'string' && body.title.trim()
      ? body.title.trim()
      : 'Naamloze presentatie';
  const initialLang = body?.lang === 'nl' || body?.lang === 'en-GB' ? body.lang : 'nl';
  const requestedTheme =
    typeof body?.theme === 'string' && body.theme.trim()
      ? body.theme.trim()
      : null;
  const effectiveTheme = requestedTheme || (sandboxEnabled() ? sandboxDefaultThemeId() : 'default');

  // Default title slide differs per theme.
  // Themes can specify a custom title slide via the `defaultTitleSlide` property.
  let defaultTitleSlide = 'title-slide';
  try {
    const themeId = resolveThemeId(effectiveTheme);
    const theme = await loadTheme(repoRoot, themeId);
    defaultTitleSlide = theme?.defaultTitleSlide || 'title-slide';
  } catch {
    // ignore
  }

  // If slides are provided in the body, use them instead of the default title slide.
  //
  // Each slide may carry per-language content under `contentByLang` (e.g. from
  // the slide library, which stores nl + en-GB). When present, we build one
  // i18n version per language so a composed deck keeps both languages instead
  // of collapsing to the one the picker happened to show. A stable slide id is
  // shared across every language version so they remain the same slide.
  const SUPPORTED_LANGS = ['nl', 'en-GB'];
  const providedSlidesRaw =
    Array.isArray(body?.slides) && body.slides.length > 0 ? body.slides : null;

  let providedSlides = null; // dominant-language slides for pres.slides
  let providedVersions = null; // { [lang]: slides[] } when multilingual content is present

  if (providedSlidesRaw) {
    const base = providedSlidesRaw.map((s) => ({
      id: cryptoUuid(),
      type: typeof s?.type === 'string' ? s.type : 'content-slide',
      notes: typeof s?.notes === 'string' ? s.notes : '',
      content: s?.content && typeof s.content === 'object' ? s.content : {},
      contentByLang:
        s?.contentByLang && typeof s.contentByLang === 'object'
          ? s.contentByLang
          : null,
    }));

    // Which languages appear in any slide's contentByLang?
    const langSet = new Set();
    for (const s of base) {
      if (!s.contentByLang) continue;
      for (const l of SUPPORTED_LANGS) {
        if (s.contentByLang[l] && typeof s.contentByLang[l] === 'object') langSet.add(l);
      }
    }

    const contentFor = (s, lang) => {
      const c = s.contentByLang?.[lang];
      return c && typeof c === 'object' ? c : s.content;
    };

    if (langSet.size > 0) {
      // Always include the dominant language so the top-level version exists.
      langSet.add(initialLang);
      providedVersions = {};
      for (const lang of langSet) {
        providedVersions[lang] = base.map((s) => ({
          id: s.id,
          type: s.type,
          content: contentFor(s, lang),
          notes: s.notes,
        }));
      }
      providedSlides = providedVersions[initialLang];
    } else {
      providedSlides = base.map((s) => ({
        id: s.id,
        type: s.type,
        content: s.content,
        notes: s.notes,
      }));
    }
  }

  const pres = newPresentation({
    title,
    theme: effectiveTheme,
    lang: initialLang,
    defaultTitleSlide,
  });
  pres.lang = initialLang;

  // Use provided slides if any, otherwise keep the default title slide
  if (providedSlides) {
    pres.slides = providedSlides;
  }

  // Allow a small set of safe deck-level settings at creation time.
  // (Keep this allowlisted; do not accept arbitrary settings blobs from clients.)
  try {
    if (typeof body?.settings?.stepParagraphs === 'boolean') {
      pres.settings = pres.settings && typeof pres.settings === 'object' ? pres.settings : {};
      pres.settings.stepParagraphs = body.settings.stepParagraphs;
    }
    const presetRaw =
      typeof body?.settings?.transitions?.preset === 'string'
        ? body.settings.transitions.preset
        : '';
    const preset = String(presetRaw || '').trim();
    const allowed = new Set(['none', 'fade', 'slide', 'push', 'cube']);
    if (allowed.has(preset)) {
      pres.settings = pres.settings && typeof pres.settings === 'object' ? pres.settings : {};
      pres.settings.transitions =
        pres.settings.transitions && typeof pres.settings.transitions === 'object'
          ? pres.settings.transitions
          : {};
      pres.settings.transitions.preset = preset;
    }
  } catch {
    // ignore
  }

  // New presentation UX: make the first title slide read naturally.
  // Keep the presentation title itself as the concise name, but use a friendlier
  // slide title like "Presentatie over <name>" / "Presentation about <name>".
  // Only apply this to default slides, not to provided slides (e.g., from slide library).
  if (!providedSlides) {
    try {
      const s0 = Array.isArray(pres.slides) ? pres.slides[0] : null;
      if (s0?.type === 'title-slide') {
        s0.content = s0.content && typeof s0.content === 'object' ? s0.content : {};
        const prefix = initialLang === 'en-GB' ? 'Presentation about ' : 'Presentatie over ';
        const wanted = `${prefix}${title}`;
        // Respect schema max length (120) with a conservative trim.
        s0.content.title =
          wanted.length > 120 ? wanted.slice(0, 117).trimEnd() + '…' : wanted;
      }
    } catch {
      // ignore
    }
  }

  if (typeof body?.ownerEmail === 'string' && body.ownerEmail.trim())
    pres.ownerEmail = body.ownerEmail.trim().toLowerCase();
  pres.scope = 'private';
  pres.createdBy = pres.ownerEmail || null;
  pres.updatedBy = pres.ownerEmail || null;
  pres.revision = 1;

  // Store Notion source page ID if provided (for "Publish to Notion" feature).
  if (typeof body?.notionSourcePageId === 'string' && body.notionSourcePageId.trim()) {
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
          ])
        )
      : {
          [initialLang]: {
            title: pres.title,
            slides: pres.slides,
          },
        },
  };
  normalizeI18n(pres);

  return normalizeMeta(pres);
}
