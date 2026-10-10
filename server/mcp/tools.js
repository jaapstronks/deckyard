/**
 * MCP Tool Definitions for Deckyard
 *
 * Each tool wraps existing Deckyard functionality.
 * Tools are registered on the McpServer instance.
 */

import { repoRoot } from '../config/paths.js';
import { getAppBaseUrl } from '../config/utils.js';
import { loadPresentationChecked, mcpActor } from './presentation-access.js';
import { singleOrganizationScope } from '../storage/scope.js';
import {
  enrichCommentsWithSlideContext,
  slideContextFor,
} from '../services/comment-slide-context.js';
import {
  createComment,
  listComments,
  listRecentComments,
  setCommentStatus,
} from '../services/comments.js';
import {
  assertCreatableDeckInput,
  createPresentation,
  deletePresentation,
  duplicatePresentation,
  DECK_LIST_OWNERSHIPS,
  listPresentationsForActor,
  publicDeckTimestamps,
} from '../services/presentations.js';
import {
  addSlide,
  removeSlide,
  reorderSlides,
  replaceSlides,
  updateSlide,
} from '../services/slides.js';
import {
  deckToPresentationParts,
  newSlide,
  presentationToDeck,
  resolveSlideTypeName,
} from '../../shared/slide-types.js';
import {
  VISIBILITY_PRESETS,
  validateVisibility,
} from '../../shared/slide-visibility.js';
import {
  AppError,
  UnauthorizedError,
  ValidationError,
} from '../utils/errors.js';
import { generateDeckV2 } from '../utils/ai/index.js';
import {
  validateAndFixRefinedSlides,
  validateRefinedSlidesStrict,
  diffAppliedFixes,
  RawSlideValidationError,
} from '../utils/ai/validate-slides/index.js';
import { iteratePresentation } from '../utils/ai/iterate-deck.js';
import {
  analyzeForCompression,
  applyCompression,
} from '../utils/ai/compress-deck.js';
import { analyzePresentation } from '../utils/ai/analyze-presentation.js';
import { convertSlideWithAi } from '../utils/openai/convert-slide.js';
import { generateSlidesToAppendFromRawContent } from '../utils/openai/append.js';
import {
  loadDeckTheme,
  loadThemeAssets,
  settleNewDeckTheme,
} from '../utils/themes.js';
import { listThemes } from '../storage/themes.js';
import { buildMergedSlideTypes } from '../utils/custom-slide-type-runtime.js';
import { GLOBAL_SLIDE_OPTIONS } from '../utils/ai/slide-type-catalog.js';
import { resolveAgentSlideTypes } from '../utils/ai/slide-catalog/agent-catalog.js';
import {
  loadDisabledSlideTypes,
  loadCustomSlideTypes,
} from '../utils/org-slide-types.js';
import {
  buildSlidePreviewHtml,
  buildSingleSlidePreviewHtml,
} from './preview.js';
import {
  DEFAULT_DECK_LANG,
  resolveDeckLang,
  TRANSLATION_LANGS,
} from '../../shared/i18n-utils.js';
import { resolveDocLangFromPresentation } from '../utils/doc-lang.js';
import { buildExportContext } from '../services/exports.js';
import { normalizeLang } from '../utils/i18n.js';
import { needsNativeComposition } from '../../shared/slide-types/fidelity.js';
import { getSlideType } from '../../shared/slide-types/registry.js';
import { slideTitle } from '../../shared/slide-types/semantic-projection.js';

/**
 * The one description of a `content` argument (create_presentation_from_slides,
 * update_slide, add_slide), so the text-style contract is stated once: the
 * keys and values come from the type's `textStyles` in get_slide_types
 * (`acceptedTextStyles()`), and the write seam refuses the rest with an error
 * that names the key and why (B464).
 */
const SLIDE_CONTENT_DESCRIPTION =
  'Slide content matching the type schema (see get_slide_types). ' +
  'Optional `textStyles` sets alignment and size, but only under the keys ' +
  "and values the type's get_slide_types entry lists in `textStyles`; a type " +
  'without that entry offers no text styling. Anything else (another key, a ' +
  'single list item such as `quotes.1.quote`, `color`, a value not listed) ' +
  'is refused, and the error names the key and why.';

/**
 * Build a presentation URL (edit or present mode). Edit links go to the
 * SPA's real editor route /app/:id (there is no /edit route), optionally
 * anchored to a slide via ?slideId= (honored by editor and viewer mode).
 */
function presentationUrl(id, mode = 'edit', { slideId } = {}) {
  const base = getAppBaseUrl();
  if (!base) return null;
  const path = mode === 'edit' ? 'app' : mode;
  const anchor = slideId ? `?slideId=${encodeURIComponent(slideId)}` : '';
  return `${base}/${path}/${id}${anchor}`;
}

/** Render the service's conversion refusal in MCP's tool vocabulary. */
function mcpConversionRefusal(err, slideIndex, slideTypes) {
  const name = (value) => resolveSlideTypeName(value, slideTypes) || value;
  const from = name(err.details.from);
  const to = name(err.details.to);
  const convertible = err.details.convertible.map(name);
  const converts = convertible.length
    ? `A ${from} converts only to: ${convertible.join(', ')}.`
    : `A ${from} converts to no other type.`;
  return new AppError(
    `Cannot change slide ${slideIndex} from ${from} to ${to}: no conversion is declared for that pair, so its content would not carry over. ${converts} ` +
      `To replace it, add a ${to} slide with add_slide, then either remove this one with remove_slide or keep it as a draft with update_slide ` +
      `(visibility: ${JSON.stringify(VISIBILITY_PRESETS.draft)}), which hides it from the presentation, exports and published pages.`,
    err.statusCode,
    { from, to, convertible },
    err.code,
  );
}

/**
 * Register all Deckyard tools on an McpServer instance
 *
 * @param {McpServer} server
 * @param {Object} options
 * @param {string} options.defaultOwnerEmail - Default owner email for new presentations (from env/config)
 * @param {function(McpServer, Object)} [options.registerCustom] - Extension seam
 *   for downstream forks: called once after the core tools with
 *   `(server, ctx)`, so a fork registers its own tools from its own file
 *   instead of editing this one. `ctx` is the documented helper surface:
 *   `{ repoRoot, defaultOwnerEmail, getOwner, storageScopeOf, getAppBaseUrl,
 *   presentationUrl }`. `storageScopeOf(context)` is what a storage call takes:
 *   the facade refuses a bare `repoRoot` string, so a fork that reaches storage
 *   goes through this rather than rebuilding the scope itself.
 *   Usually supplied by the `custom/mcp-tools.js` auto-loader
 *   (see ./custom-tools-loader.js); docs in docs/reference/mcp-server.md.
 */
export function registerTools(
  server,
  { defaultOwnerEmail = null, registerCustom = null } = {},
) {
  /**
   * Resolve the effective owner email, preferring SSE session context
   * over the static defaultOwnerEmail (stdio).
   * @param {Object} [context] - Per-request context from SSE transport
   * @returns {string|null}
   */
  function getOwner(context) {
    return context?.ownerEmail || defaultOwnerEmail || null;
  }

  /**
   * The storage scope for this MCP call. An SSE session acts in the
   * organization its API key belongs to. A stdio session has no key and no
   * organization — it is a trusted local process bound to the instance — so it
   * takes the single organization, and refuses to guess once there are several.
   *
   * Handed to the custom-tools seam below: a fork's storage calls need the same
   * scope, and the alternative — copying these four lines into the fork — is a
   * copy of core logic that drifts on every upstream merge.
   * @param {Object} [context] - Per-request context (SSE session)
   * @returns {Object} storage scope
   */
  function storageScopeOf(context) {
    const organizationId = context?.organizationId || null;
    return organizationId
      ? { repoRoot, organizationId, actorEmail: getOwner(context) }
      : singleOrganizationScope(repoRoot, 'MCP stdio session', {
          actorEmail: getOwner(context),
        });
  }

  /**
   * The slide-type registry this MCP call validates against: core and
   * file-based types plus the session organization's published custom ones.
   * Every validating tool goes through here rather than leaning on the
   * process-wide map, which cannot hold a per-organization DB row — so a
   * published `custom-<slug>` is a known type on the MCP write path too.
   * Built per call and never cached across organizations.
   * @param {Object} [context] - Per-request context (SSE session)
   * @returns {Promise<Record<string, Object>>} the merged registry
   */
  function sessionSlideTypes(context) {
    return buildMergedSlideTypes(storageScopeOf(context));
  }

  // A slide an MCP tool creates is composed by the shared slide factory like
  // every other route's: validation first (an agent's content is checked against the type
  // before anything is built from it), then the validated content goes in as
  // the factory's patch, so the slide arrives with the type's defaults for the
  // keys the agent left out, a theme background if the type declares one, and
  // its instance keys. The write path used to store validated content raw —
  // an agent-created poll slide reached storage without a `pollId`.

  /**
   * The acting machine client for a service call: the session owner in the
   * session's own organization, or the unrestricted operator for a local
   * session without an owner ({@link mcpActor}).
   * @param {Object} [context] - Per-request context (SSE session)
   * @returns {import('../services/actor.js').Actor}
   */
  function actorOf(context) {
    return mcpActor(storageScopeOf(context), getOwner(context));
  }

  /**
   * Load a deck by id and enforce the session owner's access to it.
   * `access: 'write'` for mutating tools, `'delete'` for deletion,
   * default read for everything else. No owner configured = trusted
   * local (stdio) session, no per-deck check.
   * @param {string} presentationId
   * @param {Object} [context] - Per-request context (SSE session)
   * @param {{access?: 'read'|'write'|'delete'}} [options]
   * @returns {Promise<Object>}
   */
  function getCheckedPresentation(presentationId, context, options) {
    return loadPresentationChecked(
      storageScopeOf(context),
      presentationId,
      getOwner(context),
      options,
    );
  }

  // ─── get_slide_types ────────────────────────────────────────────────────

  server.tool(
    'get_slide_types',
    'List the slide types you may use, resolved for your organization (core types plus any slide types this organization defined itself, keyed `custom-<slug>`). Each entry carries its canonical `typeId`, a schema, and a working `example` content object you can copy and edit when calling create_presentation_from_slides. `documented: false` means nobody has written usage guidance for that type yet and its schema was derived from the field definitions — still usable, just less described. When an entry carries a `usage` field, it holds the rules THIS organization set for filling that slide type (sources, cut-off dates, mandatory explanations); treat it as binding and follow it when you write the content. When an entry carries `textStyles`, those are the only `content.textStyles` keys that type accepts, each with the alignment and size values it takes; a type without it offers no text styling. The response also includes `globalOptions`: optional fields (background image, logo, text colour) that may be added to ANY slide type.',
    {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description:
            'Filter by category: "structural", "content", "all" (default: "all")',
          enum: ['structural', 'content', 'all'],
        },
        lang: {
          type: 'string',
          description: `Language for the example content, one of ${TRANSLATION_LANGS.join(', ')} (default: ${DEFAULT_DECK_LANG})`,
          enum: [...TRANSLATION_LANGS],
        },
      },
    },
    async ({ category = 'all', lang = DEFAULT_DECK_LANG } = {}, context) => {
      // Resolve for the calling session's organization, the same way
      // /api/slide-types and the AI generator do: Tier 1 from the registry,
      // Tier 2 from the database, minus whatever the org disabled. A stdio
      // session has no organization and falls back to the default one.
      const ctx = { organizationId: context?.organizationId };
      const [disabledSlideTypes, customSlideTypes] = await Promise.all([
        loadDisabledSlideTypes(ctx),
        loadCustomSlideTypes(ctx),
      ]);

      const types = resolveAgentSlideTypes({
        lang,
        category,
        disabledSlideTypes,
        customSlideTypes,
      });

      return {
        types,
        count: Object.keys(types).length,
        exampleLang: lang,
        globalOptions: GLOBAL_SLIDE_OPTIONS,
      };
    },
    { readOnly: true, permission: 'read' },
  );

  // ─── list_presentations ─────────────────────────────────────────────────

  server.tool(
    'list_presentations',
    'List presentations you can access. Returns id, title, theme, creation date, and slide count for each, newest first. Use `ownership` to choose which decks: "owned" (default; decks you own or made), "collection" (yours plus every organization-visible deck, as on Home), "shared" (decks shared with you as a collaborator), or "all" (every deck you can open).',
    {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Max results, a whole number from 1 (default: 50)',
        },
        ownership: {
          type: 'string',
          description:
            'Which decks to include: "owned" (default), "collection" (owned plus organization-visible), "shared" (decks shared with you), or "all" (collection plus shared). Any other value is refused.',
          enum: [...DECK_LIST_OWNERSHIPS],
        },
      },
    },
    async ({ limit = 50, ownership = 'owned' } = {}, context) => {
      const owner = getOwner(context);
      const { presentations, total } = await listPresentationsForActor(
        storageScopeOf(context),
        { actor: actorOf(context) },
        { ownership, limit },
      );

      const items = presentations.map((p) => {
        // slideCount: try slides array, then slideCount property, else omit.
        // list sources may not include the full slides array (too heavy).
        const slideCount = Array.isArray(p.slides)
          ? p.slides.length
          : typeof p.slideCount === 'number'
            ? p.slideCount
            : null;

        const item = {
          id: p.id,
          title: p.title || 'Untitled',
          theme: p.theme || 'default',
          ...publicDeckTimestamps(p),
        };
        if (slideCount !== null) item.slideCount = slideCount;
        // Present on shared decks; marks how the caller has access.
        if (p.permission) item.permission = p.permission;
        const url = presentationUrl(p.id, 'edit');
        if (url) item.editUrl = url;
        return item;
      });

      return {
        presentations: items,
        total,
        ownerFilter: owner || null,
        ownership,
      };
    },
    { readOnly: true, permission: 'read' },
  );

  // ─── get_presentation ───────────────────────────────────────────────────

  server.tool(
    'get_presentation',
    'Get full presentation data including all slides. Use to read existing deck content before modifying.',
    {
      type: 'object',
      properties: {
        presentationId: { type: 'string', description: 'Presentation ID' },
      },
      required: ['presentationId'],
    },
    async ({ presentationId }, context) => {
      const pres = await getCheckedPresentation(presentationId, context);

      return {
        id: pres.id,
        title: pres.title,
        theme: pres.theme,
        lang: pres.lang,
        slides: (pres.slides || []).map((s, i) => ({
          index: i,
          id: s.id,
          type: s.type,
          content: s.content,
          notes: s.notes || '',
        })),
        slideCount: pres.slides?.length || 0,
      };
    },
    { readOnly: true, permission: 'read' },
  );

  // ─── create_presentation ────────────────────────────────────────────────

  server.tool(
    'create_presentation',
    'Generate a new presentation from raw content using AI. Provide text/notes/document content and get a complete slide deck. This is the primary way to create presentations.',
    {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description:
            'Source text to generate presentation from (meeting notes, article, bullet points, etc.)',
        },
        title: {
          type: 'string',
          description:
            'Optional presentation title (auto-generated if not provided)',
        },
        theme: {
          type: 'string',
          description:
            "Theme ID, as list_themes names it. Omit for this installation's default; an unknown id is refused.",
        },
        lang: {
          type: 'string',
          description: `Language, one of ${TRANSLATION_LANGS.join(', ')} (auto-detected if not provided)`,
          enum: [...TRANSLATION_LANGS],
        },
        speaker: {
          type: 'string',
          description: 'Speaker name for the title slide',
        },
        vendor: {
          type: 'string',
          description:
            'LLM vendor override (e.g. "openai", "anthropic"). Uses server default if not specified.',
        },
      },
      required: ['content'],
    },
    async (args, context) => {
      const {
        content,
        title,
        theme: requestedTheme,
        lang,
        speaker = '',
        vendor,
      } = args;
      // Refused before the generation, so a refused call costs no LLM call;
      // the deck is the session owner's (B521).
      assertCreatableDeckInput(args);
      // Checked before the generation, so an unknown theme costs no LLM call.
      const { themeId: theme, theme: themeObj } = await settleNewDeckTheme(
        repoRoot,
        requestedTheme,
        storageScopeOf(context),
      );
      const titleSlideType = themeObj?.defaultTitleSlide || 'title-slide';

      const deck = await generateDeckV2(content, {
        userName: speaker,
        targetLang: lang || null,
        theme,
        titleSlideType,
        enableLogging: false,
        vendor: vendor || null,
      });

      // One create carries the generated slides (B609); no empty deck is
      // written first and filled afterwards.
      const parts = deckToPresentationParts(deck, { theme: themeObj, lang });
      if (title) parts.title = title;

      const created = await createPresentation(
        storageScopeOf(context),
        { actor: actorOf(context) },
        {
          title: parts.title,
          slides: parts.slides,
          theme,
          lang: lang || undefined,
        },
      );

      const slideTypes = await sessionSlideTypes(context);
      const deckLang = resolveDocLangFromPresentation(created);
      const result = {
        id: created.id,
        title: created.title,
        theme,
        slideCount: created.slides?.length || 0,
        slides: (created.slides || []).map((s, i) => ({
          index: i,
          type: s.type,
          title: slideTitle(s, getSlideType(s.type, slideTypes), {
            lang: deckLang,
          }),
        })),
      };
      const editUrl = presentationUrl(created.id, 'edit');
      const presentUrl = presentationUrl(created.id, 'present');
      if (editUrl) result.editUrl = editUrl;
      if (presentUrl) result.presentUrl = presentUrl;
      return result;
    },
    { permission: 'ai', feature: 'ai' },
  );

  // ─── create_presentation_from_slides ────────────────────────────────────

  server.tool(
    'create_presentation_from_slides',
    'Create a presentation from a pre-structured slide array — no AI generation. Use this when the caller already knows exactly what slide types and content it wants (e.g. an upstream LLM with structured data). Validates against slide-type schemas and writes directly. For AI-driven generation from free text, use create_presentation instead.',
    {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Presentation title',
        },
        slides: {
          type: 'array',
          description:
            'Slide array. Each item: { type, content, notes? }. See get_slide_types for valid types and example content.',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                description:
                  'Slide type (e.g. "title-slide", "team-cards-slide")',
              },
              content: {
                type: 'object',
                description: SLIDE_CONTENT_DESCRIPTION,
              },
              notes: {
                type: 'string',
                description: 'Speaker notes (optional)',
              },
            },
            required: ['type', 'content'],
          },
          minItems: 1,
          maxItems: 50,
        },
        theme: {
          type: 'string',
          description:
            "Theme ID, as list_themes names it. Omit for this installation's default; an unknown id is refused.",
        },
        lang: {
          type: 'string',
          description: `Language, one of ${TRANSLATION_LANGS.join(', ')} (default: ${DEFAULT_DECK_LANG})`,
          enum: [...TRANSLATION_LANGS],
        },
        validation: {
          type: 'string',
          description:
            '"strict" (default) throws on first issue with structured detail. "fix" applies auto-fixes (truncate, pad, layout switch) and returns them in `appliedFixes`.',
          enum: ['strict', 'fix'],
        },
        auto_prepend_title: {
          type: 'boolean',
          description:
            "When true and the first slide is not the theme's default title-slide type, prepend an empty title slide using `title`. Default: false.",
        },
      },
      required: ['title', 'slides'],
    },
    async (args, context) => {
      const {
        title,
        slides,
        theme: requestedTheme,
        lang = DEFAULT_DECK_LANG,
        validation = 'strict',
        auto_prepend_title = false,
      } = args;
      if (!Array.isArray(slides) || slides.length === 0) {
        throw new ValidationError('"slides" must be a non-empty array');
      }
      assertCreatableDeckInput(args);

      // Strip incoming `id` fields so storage assigns fresh UUIDs; preserve type/content/notes.
      let inputSlides = slides.map((s) => ({
        type: s?.type,
        content: s?.content,
        notes: typeof s?.notes === 'string' ? s.notes : '',
      }));

      const { themeId: theme, theme: themeObj } = await settleNewDeckTheme(
        repoRoot,
        requestedTheme,
        storageScopeOf(context),
      );

      // Optional escape hatch: prepend an empty title slide if missing.
      if (auto_prepend_title) {
        const titleSlideType = themeObj?.defaultTitleSlide || 'title-slide';

        if (inputSlides[0]?.type !== titleSlideType) {
          inputSlides = [
            { type: titleSlideType, content: { title }, notes: '' },
            ...inputSlides,
          ];
        }
      }

      // Validation, against this session organization's registry so a
      // published custom type is not refused before its content is read.
      const slideTypes = await sessionSlideTypes(context);
      let validatedSlides;
      let appliedFixes = [];
      if (validation === 'fix') {
        const fixed = validateAndFixRefinedSlides(
          inputSlides.map((s) => ({ type: s.type, content: s.content })),
          { slideTypes },
        );
        appliedFixes = diffAppliedFixes(inputSlides, fixed);
        validatedSlides = fixed.map((s, i) => ({
          type: s.type,
          content: s.content,
          notes: inputSlides[i]?.notes || '',
        }));
      } else {
        try {
          validateRefinedSlidesStrict(
            inputSlides.map((s) => ({ type: s.type, content: s.content })),
            { slideTypes },
          );
        } catch (err) {
          if (err instanceof RawSlideValidationError) {
            // The issue under the one list strict slide validation uses
            // (`bad_request`'s `errors`), so a caller reads it the same way.
            throw new ValidationError(`Validation failed: ${err.message}`, {
              errors: [err.message],
            });
          }
          throw err;
        }
        validatedSlides = inputSlides;
      }

      // One create carries the slides (B609). The write seam inside it
      // refuses what no validation above checks (a text style the type does
      // not offer) before any row exists, so a refusal leaves no empty deck
      // behind; the factory re-keys ids and `presentation-id` instance keys
      // against the new deck, so the slide factory needs no deck id here.
      const created = await createPresentation(
        storageScopeOf(context),
        { actor: actorOf(context) },
        {
          title,
          theme,
          lang,
          slides: validatedSlides.map((s) => ({
            ...newSlide({
              type: s.type,
              content: s.content,
              slideTypes,
              theme: themeObj,
              lang,
            }),
            notes: s.notes || '',
          })),
        },
      );

      const result = {
        id: created.id,
        title: created.title,
        theme,
        lang,
        slideCount: created.slides?.length || 0,
        slides: (created.slides || []).map((s, i) => ({
          index: i,
          type: s.type,
          title: slideTitle(s, getSlideType(s.type, slideTypes), {
            lang: resolveDocLangFromPresentation(created),
          }),
        })),
      };
      const editUrl = presentationUrl(created.id, 'edit');
      const presentUrl = presentationUrl(created.id, 'present');
      if (editUrl) result.editUrl = editUrl;
      if (presentUrl) result.presentUrl = presentUrl;
      if (validation === 'fix') result.appliedFixes = appliedFixes;
      return result;
    },
    { permission: 'write' },
  );

  // ─── update_slide ───────────────────────────────────────────────────────

  server.tool(
    'update_slide',
    "Patch a slide's content: every key in `content` replaces the stored value, keys you omit stay as they are (to clear one, pass its empty value). Keys must match the slide type schema. The REST `PUT /api/v1/presentations/{id}/slides/{slideId}` replaces the whole content instead.",
    {
      type: 'object',
      properties: {
        presentationId: { type: 'string', description: 'Presentation ID' },
        slideIndex: { type: 'number', description: 'Slide index (0-based)' },
        content: {
          type: 'object',
          description: SLIDE_CONTENT_DESCRIPTION,
        },
        type: {
          type: 'string',
          description:
            'Optional: convert the slide to another type. Only the pairs the editor converts between are supported (content ↔ image-text, image → image-text, list → content, title ↔ chapter-title); other pairs are refused. Replacing a slide by one of another type is add_slide plus remove_slide, or add_slide plus parking this one as a draft through `visibility`.',
        },
        visibility: {
          type: 'object',
          description: `Optional: where the slide appears, replacing its current flags (hideInPresentation, hideInExport, hideInPublished, hideFromViewers; all booleans, missing = false). A draft is ${JSON.stringify(VISIBILITY_PRESETS.draft)}.`,
        },
      },
      required: ['presentationId', 'slideIndex', 'content'],
    },
    async (
      { presentationId, slideIndex, content, type, visibility },
      context,
    ) => {
      const pres = await getCheckedPresentation(presentationId, context, {
        access: 'write',
      });
      if (slideIndex < 0 || slideIndex >= pres.slides.length) {
        throw new ValidationError(
          `Slide index ${slideIndex} out of range (0-${pres.slides.length - 1})`,
        );
      }

      if (visibility !== undefined) {
        const errors = validateVisibility(visibility);
        if (visibility === null || errors.length > 0) {
          throw new ValidationError(
            `Invalid visibility: ${errors.join('; ') || 'must be an object'}`,
          );
        }
      }
      let slide;
      try {
        ({ slide } = await updateSlide(
          storageScopeOf(context),
          { actor: actorOf(context) },
          {
            presentationId,
            slideId: pres.slides[slideIndex].id,
            type,
            content,
            contentMode: 'merge',
            visibility,
            normalizeContent: (candidate, slideTypes) =>
              validateAndFixRefinedSlides([candidate], { slideTypes })[0]
                .content,
          },
        ));
      } catch (err) {
        if (err.code !== 'unsupported_conversion') throw err;
        throw mcpConversionRefusal(
          err,
          slideIndex,
          await sessionSlideTypes(context),
        );
      }

      return {
        updated: true,
        slideIndex,
        type: slide.type,
        content: slide.content,
        visibility: slide.visibility || {},
      };
    },
    { permission: 'write' },
  );

  // ─── add_slide ──────────────────────────────────────────────────────────

  server.tool(
    'add_slide',
    'Add a new slide to an existing presentation at a specific position.',
    {
      type: 'object',
      properties: {
        presentationId: { type: 'string', description: 'Presentation ID' },
        type: {
          type: 'string',
          description: 'Slide type (e.g. "list-slide", "content-slide")',
        },
        content: {
          type: 'object',
          description: SLIDE_CONTENT_DESCRIPTION,
        },
        position: {
          type: 'number',
          description: 'Insert position (0-based). If omitted, appends at end.',
        },
      },
      required: ['presentationId', 'type', 'content'],
    },
    async ({ presentationId, type, content, position }, context) => {
      await getCheckedPresentation(presentationId, context, {
        access: 'write',
      });
      // Validate the new slide
      const slideTypes = await sessionSlideTypes(context);
      const [validated] = validateAndFixRefinedSlides([{ type, content }], {
        slideTypes,
      });

      const {
        slide: added,
        index: insertAt,
        presentation,
      } = await addSlide(
        storageScopeOf(context),
        { actor: actorOf(context) },
        {
          presentationId,
          type: validated.type,
          content: validated.content,
          position,
        },
      );

      return {
        added: true,
        slideId: added.id,
        position: insertAt,
        type: added.type,
        totalSlides: presentation.slides.length,
      };
    },
    { permission: 'write' },
  );

  // ─── convert_slide ──────────────────────────────────────────────────────

  server.tool(
    'convert_slide',
    'Convert a slide to a different type using AI. The content is restructured to fit the target type schema.',
    {
      type: 'object',
      properties: {
        presentationId: { type: 'string', description: 'Presentation ID' },
        slideIndex: { type: 'number', description: 'Slide index (0-based)' },
        targetType: {
          type: 'string',
          description: 'Target slide type (e.g. "list-slide")',
        },
        vendor: {
          type: 'string',
          description: 'LLM vendor override (e.g. "openai", "anthropic")',
        },
      },
      required: ['presentationId', 'slideIndex', 'targetType'],
    },
    async ({ presentationId, slideIndex, targetType, vendor }, context) => {
      const pres = await getCheckedPresentation(presentationId, context, {
        access: 'write',
      });
      if (slideIndex < 0 || slideIndex >= pres.slides.length) {
        throw new ValidationError(`Slide index ${slideIndex} out of range`);
      }

      const slide = pres.slides[slideIndex];
      const lang = resolveDeckLang(pres) || DEFAULT_DECK_LANG;

      const result = await convertSlideWithAi(slide, targetType, {
        vendor: vendor || null,
        lang,
      });

      if (!result?.content)
        // The provider answered without a slide: an upstream failure whose
        // sentence is still worth showing.
        throw new AppError('Conversion failed — no content returned', 502);

      const fromType = slide.type;
      const { slide: converted } = await updateSlide(
        storageScopeOf(context),
        { actor: actorOf(context) },
        {
          presentationId,
          slideId: slide.id,
          type: result.type || targetType,
          content: result.content,
          conversion: 'replace',
        },
      );

      return {
        converted: true,
        slideIndex,
        fromType,
        toType: converted.type,
        content: converted.content,
      };
    },
    { permission: 'ai', feature: 'ai' },
  );

  // ─── iterate_presentation ───────────────────────────────────────────────

  server.tool(
    'iterate_presentation',
    'Modify a presentation using natural language commands. Examples: "make slide 3 punchier", "split the KPI slide", "more visual variety", "shorten everything". Can target a specific slide or the whole deck.',
    {
      type: 'object',
      properties: {
        presentationId: { type: 'string', description: 'Presentation ID' },
        command: {
          type: 'string',
          description:
            'Natural language instruction (e.g. "make this punchier", "split slide 3")',
        },
        vendor: {
          type: 'string',
          description: 'LLM vendor override (e.g. "openai", "anthropic")',
        },
      },
      required: ['presentationId', 'command'],
    },
    async ({ presentationId, command, vendor }, context) => {
      const pres = await getCheckedPresentation(presentationId, context, {
        access: 'write',
      });

      const lang = resolveDeckLang(pres) || DEFAULT_DECK_LANG;

      const {
        deck: newDeck,
        plan,
        targetSlideIndex,
      } = await iteratePresentation(pres, command, {
        lang,
        vendor: vendor || null,
      });

      const { presentation } = await replaceSlides(
        storageScopeOf(context),
        { actor: actorOf(context) },
        { presentationId, slides: newDeck.slides },
      );

      return {
        applied: true,
        targetSlideIndex,
        summary: plan.summary,
        modifications:
          plan.modifications?.map((m) => ({
            slideIndex: m.slideIndex,
            action: m.action,
            reasoning: m.reasoning,
          })) || [],
        totalSlides: presentation.slides.length,
      };
    },
    { permission: 'ai', feature: 'ai' },
  );

  // ─── validate_presentation ──────────────────────────────────────────────

  server.tool(
    'validate_presentation',
    "Validate a presentation's slides for schema compliance, content density, and type variety issues. Returns warnings and fix suggestions.",
    {
      type: 'object',
      properties: {
        presentationId: { type: 'string', description: 'Presentation ID' },
      },
      required: ['presentationId'],
    },
    async ({ presentationId }, context) => {
      const pres = await getCheckedPresentation(presentationId, context);

      const slideTypes = await sessionSlideTypes(context);
      const validated = validateAndFixRefinedSlides(
        pres.slides.map((s) => ({
          type: s.type,
          content: s.content,
          reasoning: '',
        })),
        { slideTypes },
      );

      const warnings = [];
      validated.forEach((slide, i) => {
        if (slide._aiWarnings?.length) {
          warnings.push({
            slideIndex: i,
            type: slide.type,
            title: slideTitle(slide, getSlideType(slide.type, slideTypes), {
              lang: resolveDocLangFromPresentation(pres),
            }),
            warnings: slide._aiWarnings,
          });
        }
      });

      return {
        slideCount: pres.slides.length,
        warningCount: warnings.reduce((n, w) => n + w.warnings.length, 0),
        warnings,
        isValid: warnings.length === 0,
      };
    },
    { readOnly: true, permission: 'read' },
  );

  // ─── list_themes ────────────────────────────────────────────────────────

  server.tool(
    'list_themes',
    'List all available presentation themes.',
    {
      type: 'object',
      properties: {},
    },
    async (_args, context) => {
      const records = await listThemes(storageScopeOf(context));
      return {
        themes: records.map((theme) => ({
          id: theme.id,
          slug: theme.slug,
          source: theme.source,
          label: theme.label,
        })),
      };
    },
    { readOnly: true, permission: 'read' },
  );

  // ─── delete_presentation ────────────────────────────────────────────────

  server.tool(
    'delete_presentation',
    'Delete (trash) a presentation. Requires confirm: true as a safety measure.',
    {
      type: 'object',
      properties: {
        presentationId: { type: 'string', description: 'Presentation ID' },
        confirm: {
          type: 'boolean',
          description:
            'Must be true to actually delete. Prevents accidental deletion.',
        },
      },
      required: ['presentationId', 'confirm'],
    },
    async ({ presentationId, confirm }, context) => {
      if (!confirm) {
        // The preview asks the right the delete asks, so a session that may
        // not trash the deck is refused here, not invited to confirm.
        const pres = await getCheckedPresentation(presentationId, context, {
          access: 'delete',
        });
        return {
          deleted: false,
          id: presentationId,
          title: pres?.title || 'Unknown',
          slideCount: pres?.slides?.length || 0,
          message:
            'Set confirm: true to delete this presentation. This action moves it to trash.',
        };
      }
      await deletePresentation(
        storageScopeOf(context),
        { actor: actorOf(context) },
        presentationId,
      );
      return { deleted: true, id: presentationId };
    },
    { permission: 'write' },
  );

  // ─── remove_slide ───────────────────────────────────────────────────────

  server.tool(
    'remove_slide',
    'Remove a slide from a presentation by index. The last slide of a presentation cannot be removed.',
    {
      type: 'object',
      properties: {
        presentationId: { type: 'string', description: 'Presentation ID' },
        slideIndex: {
          type: 'number',
          description: 'Slide index to remove (0-based)',
        },
      },
      required: ['presentationId', 'slideIndex'],
    },
    async ({ presentationId, slideIndex }, context) => {
      const { slide: removed, presentation } = await removeSlide(
        storageScopeOf(context),
        { actor: actorOf(context) },
        { presentationId, slideIndex },
      );

      const slideTypes = await sessionSlideTypes(context);
      return {
        removed: true,
        slideIndex,
        removedType: removed.type,
        removedTitle: slideTitle(
          removed,
          getSlideType(removed.type, slideTypes),
          { lang: resolveDocLangFromPresentation(presentation) },
        ),
        totalSlides: presentation.slides.length,
      };
    },
    { permission: 'write' },
  );

  // ─── reorder_slides ─────────────────────────────────────────────────────

  server.tool(
    'reorder_slides',
    'Move a slide from one position to another.',
    {
      type: 'object',
      properties: {
        presentationId: { type: 'string', description: 'Presentation ID' },
        fromIndex: {
          type: 'number',
          description: 'Current slide position (0-based)',
        },
        toIndex: { type: 'number', description: 'Target position (0-based)' },
      },
      required: ['presentationId', 'fromIndex', 'toIndex'],
    },
    async ({ presentationId, fromIndex, toIndex }, context) => {
      const { slides, presentation } = await reorderSlides(
        storageScopeOf(context),
        { actor: actorOf(context) },
        { presentationId, move: { fromIndex, toIndex } },
      );

      const slideTypes = await sessionSlideTypes(context);
      const slide = slides[toIndex];

      return {
        moved: true,
        slide: {
          type: slide.type,
          title: slideTitle(slide, getSlideType(slide.type, slideTypes), {
            lang: resolveDocLangFromPresentation(presentation),
          }),
        },
        from: fromIndex,
        to: toIndex,
      };
    },
    { permission: 'write' },
  );

  // ─── append_slides ──────────────────────────────────────────────────────

  server.tool(
    'append_slides',
    'Add new slides to an existing presentation by providing additional content. AI generates appropriate slide types from the text.',
    {
      type: 'object',
      properties: {
        presentationId: { type: 'string', description: 'Presentation ID' },
        content: {
          type: 'string',
          description: 'New content to generate slides from',
        },
        vendor: {
          type: 'string',
          description: 'LLM vendor override (e.g. "openai", "anthropic")',
        },
      },
      required: ['presentationId', 'content'],
    },
    async ({ presentationId, content, vendor }, context) => {
      const pres = await getCheckedPresentation(presentationId, context, {
        access: 'write',
      });

      const lang = resolveDeckLang(pres) || DEFAULT_DECK_LANG;
      const existingDeck = presentationToDeck(pres);

      const { slides: newSlides } = await generateSlidesToAppendFromRawContent(
        content,
        {
          existingDeck,
          targetLang: lang,
          contentOnly: true,
          vendor: vendor || null,
        },
      );

      if (!newSlides?.length)
        return { appended: 0, totalSlides: pres.slides.length };

      // The model answers in the portable deck format: compose its slides the
      // way the editor's append route does (factory defaults, ids, the deck's
      // theme), then fix what the lenient pass can before the service's strict
      // validation.
      const slideTypes = await sessionSlideTypes(context);
      const parts = deckToPresentationParts(newSlides, {
        theme: await loadDeckTheme(
          repoRoot,
          pres.theme,
          storageScopeOf(context),
        ),
        lang,
        slideTypes,
      });
      const slidesToInsert = validateAndFixRefinedSlides(parts.slides || [], {
        slideTypes,
      });

      // Find insert position: before structural closing slides (payoff, end).
      // The follow-along invite used to be listed here too, against its own
      // declaration: it sits anywhere in the deck and claims no closing beat
      // (shared/slide-types/types/follow-invite-slide.js), so a trailing one
      // is appended after like any other slide (B413).
      const closingTypes = new Set(['payoff-slide', 'end-slide']);
      let insertAt = pres.slides.length;
      for (let i = pres.slides.length - 1; i >= 0; i--) {
        if (closingTypes.has(pres.slides[i].type)) {
          insertAt = i;
        } else {
          break;
        }
      }

      const slides = [...pres.slides];
      slides.splice(insertAt, 0, ...slidesToInsert);
      const { presentation } = await replaceSlides(
        storageScopeOf(context),
        { actor: actorOf(context) },
        { presentationId, slides },
      );

      return {
        appended: slidesToInsert.length,
        insertedAt: insertAt,
        totalSlides: presentation.slides.length,
        newSlides: slidesToInsert.map((s) => ({
          type: s.type,
          title: slideTitle(s, getSlideType(s.type, slideTypes), { lang }),
        })),
      };
    },
    { permission: 'ai', feature: 'ai' },
  );

  // ─── compress_presentation ──────────────────────────────────────────────

  server.tool(
    'compress_presentation',
    'Analyze a presentation for compression opportunities: merge similar slides, remove redundancy, tighten content. Can preview changes or apply them directly.',
    {
      type: 'object',
      properties: {
        presentationId: { type: 'string', description: 'Presentation ID' },
        apply: {
          type: 'boolean',
          description: 'Apply changes (default: false = preview only)',
        },
        intensity: {
          type: 'string',
          description: '"moderate" (default) or "aggressive"',
          enum: ['moderate', 'aggressive'],
        },
        vendor: {
          type: 'string',
          description: 'LLM vendor override (e.g. "openai", "anthropic")',
        },
      },
      required: ['presentationId'],
    },
    async (
      { presentationId, apply = false, intensity = 'moderate', vendor },
      context,
    ) => {
      const pres = await getCheckedPresentation(presentationId, context, {
        access: apply ? 'write' : 'read',
      });

      const recommendations = await analyzeForCompression(pres, {
        targetReduction: intensity,
        vendor: vendor || null,
        slideTypes: await sessionSlideTypes(context),
      });

      let slidesAfter = pres.slides.length;
      if (
        apply &&
        (recommendations.merges.length > 0 ||
          recommendations.removals.length > 0)
      ) {
        const { presentation } = await replaceSlides(
          storageScopeOf(context),
          { actor: actorOf(context) },
          {
            presentationId,
            slides: applyCompression(pres, recommendations).slides,
          },
        );
        slidesAfter = presentation.slides.length;
      }

      return {
        applied: apply,
        merges: recommendations.merges?.length || 0,
        removals: recommendations.removals?.length || 0,
        recommendations,
        slidesAfter: apply ? slidesAfter : undefined,
      };
    },
    { permission: 'ai', feature: 'ai' },
  );

  // ─── analyze_presentation ───────────────────────────────────────────────

  server.tool(
    'analyze_presentation',
    'Get AI-powered improvement suggestions for a presentation: language, structure, slide types, visual balance, brevity, repetition, and more.',
    {
      type: 'object',
      properties: {
        presentationId: { type: 'string', description: 'Presentation ID' },
        vendor: {
          type: 'string',
          description: 'LLM vendor override (e.g. "openai", "anthropic")',
        },
      },
      required: ['presentationId'],
    },
    async ({ presentationId, vendor }, context) => {
      const pres = await getCheckedPresentation(presentationId, context);

      // analyzePresentation auto-detects language from slide content
      const result = await analyzePresentation(pres, {
        vendor: vendor || null,
      });

      // analyzePresentation returns { suggestions: [...], metadata: {...} }
      const suggestions = result?.suggestions || [];
      const slideTypes = await sessionSlideTypes(context);

      return {
        slideCount: pres.slides.length,
        suggestionCount: suggestions.length,
        suggestions: suggestions.map((s) => ({
          slideIndex: s.slideIndex,
          category: s.category,
          body: s.body,
          proposedSlide: s.proposedSlide
            ? {
                type: s.proposedSlide.type,
                title: slideTitle(
                  s.proposedSlide,
                  getSlideType(s.proposedSlide.type, slideTypes),
                  { lang: resolveDocLangFromPresentation(pres) },
                ),
              }
            : null,
        })),
      };
    },
    { readOnly: true, permission: 'ai', feature: 'ai' },
  );

  // ─── duplicate_presentation ─────────────────────────────────────────────

  server.tool(
    'duplicate_presentation',
    'Create a copy of an existing presentation.',
    {
      type: 'object',
      properties: {
        presentationId: {
          type: 'string',
          description: 'Presentation ID to duplicate',
        },
      },
      required: ['presentationId'],
    },
    async ({ presentationId }, context) => {
      const dup = await duplicatePresentation(
        storageScopeOf(context),
        { actor: actorOf(context) },
        presentationId,
      );

      const result = {
        id: dup.id,
        title: dup.title,
        slideCount: dup.slides?.length || 0,
      };
      const url = presentationUrl(dup.id, 'edit');
      if (url) result.editUrl = url;
      return result;
    },
    { permission: 'write' },
  );

  // ─── get_presentation_url ───────────────────────────────────────────────

  server.tool(
    'get_presentation_url',
    'Get the edit and presentation URLs for a deck. Useful for sharing links.',
    {
      type: 'object',
      properties: {
        presentationId: { type: 'string', description: 'Presentation ID' },
      },
      required: ['presentationId'],
    },
    async ({ presentationId }, context) => {
      // Verify it exists and is accessible
      const pres = await getCheckedPresentation(presentationId, context);

      const base = getAppBaseUrl();
      if (!base) {
        return {
          id: presentationId,
          title: pres.title,
          note: 'APP_URL or DOMAIN not configured — cannot generate URLs. Set APP_URL in .env.',
        };
      }

      return {
        id: presentationId,
        title: pres.title,
        editUrl: presentationUrl(presentationId, 'edit'),
        presentUrl: presentationUrl(presentationId, 'present'),
      };
    },
    { readOnly: true, permission: 'read' },
  );

  // ─── export_presentation ────────────────────────────────────────────────

  server.tool(
    'export_presentation',
    'Get a download URL for a finished export of a deck (PDF, pixel-perfect or editable PPTX, self-contained HTML, deck JSON, or a zip of per-slide PNGs). Returns a URL the user opens in a browser where they are signed in to Deckyard; the server renders the file on demand. Use this to deliver a downloadable file. For an inline visual preview instead, use preview_presentation.',
    {
      type: 'object',
      properties: {
        presentationId: { type: 'string', description: 'Presentation ID' },
        format: {
          type: 'string',
          enum: ['pdf', 'pptx', 'pptx-editable', 'html', 'json', 'png-zip'],
          description:
            'Export format. pdf = server-rendered PDF; pptx = pixel-perfect PowerPoint (video plays); pptx-editable = editable PowerPoint, with imageSlides listing the 1-based exported slide numbers that remain images; html = self-contained HTML; json = deck source; png-zip = one PNG per slide, zipped.',
        },
        lang: {
          type: 'string',
          description:
            'Optional language projection for multilingual decks (e.g. "nl" or "en-GB"). Omit to export the deck as-is.',
        },
      },
      required: ['presentationId', 'format'],
    },
    async ({ presentationId, format, lang }, context) => {
      const pres = await getCheckedPresentation(presentationId, context);

      // Agent-friendly format name → in-app export route (cookie-authenticated).
      const EXPORT_PATHS = {
        pdf: 'export/pdf-slides.pdf',
        pptx: 'export/pptx',
        'pptx-editable': 'export/pptx-editable',
        html: 'export/html',
        json: 'export/json',
        'png-zip': 'export/png.zip',
      };
      const relPath = EXPORT_PATHS[format];
      if (!relPath) {
        throw new ValidationError(
          `Unsupported format "${format}". Use one of: ${Object.keys(EXPORT_PATHS).join(', ')}.`,
        );
      }

      const base = getAppBaseUrl();
      if (!base) {
        return {
          id: presentationId,
          title: pres.title,
          format,
          note: 'APP_URL or DOMAIN not configured — cannot generate a download URL. Set APP_URL in .env.',
        };
      }

      // Describe the same projected, filtered deck the download route builds,
      // without rendering it twice or counting a download before it happens.
      let imageSlides;
      if (format === 'pptx-editable') {
        const { filteredPres, slideTypes } = await buildExportContext(
          storageScopeOf(context),
          pres,
          { exportLang: normalizeLang(lang), stripLiveOnly: true },
        );
        imageSlides = filteredPres.slides.flatMap((slide, index) =>
          needsNativeComposition(slideTypes[slide.type], 'pptx')
            ? []
            : [index + 1],
        );
      }

      let downloadUrl = `${base}/api/presentations/${presentationId}/${relPath}`;
      if (lang) downloadUrl += `?lang=${encodeURIComponent(lang)}`;

      return {
        id: presentationId,
        title: pres.title,
        format,
        downloadUrl,
        ...(imageSlides ? { imageSlides } : {}),
        note: 'Open this URL in a browser signed in to Deckyard to download the file. PDF/PPTX/PNG are rendered on demand and may take a few seconds for large decks.',
      };
    },
    { readOnly: true, permission: 'export' },
  );

  // ─── preview_slide ──────────────────────────────────────────────────────
  //
  // Both preview tools require `read`, not `export`: they render content the
  // key can already fetch with get_presentation, and they produce no file and
  // no download. The `export` permission guards the export endpoints and their
  // daily budget, which a preview does not spend.

  server.tool(
    'preview_slide',
    'Render a single slide as self-contained HTML. Returns an HTML document — display it as an artifact to show a visual preview. The HTML includes all CSS and embedded images.',
    {
      type: 'object',
      properties: {
        presentationId: { type: 'string', description: 'Presentation ID' },
        slideIndex: { type: 'number', description: 'Slide index (0-based)' },
      },
      required: ['presentationId', 'slideIndex'],
    },
    async ({ presentationId, slideIndex }, context) => {
      const pres = await getCheckedPresentation(presentationId, context);
      if (slideIndex < 0 || slideIndex >= pres.slides.length) {
        throw new ValidationError(
          `Slide index ${slideIndex} out of range (0-${pres.slides.length - 1})`,
        );
      }

      const slide = pres.slides[slideIndex];
      let theme = null;
      try {
        theme = await loadThemeAssets(
          repoRoot,
          pres.theme,
          storageScopeOf(context),
        );
      } catch {
        /* use default styling */
      }

      const html = await buildSingleSlidePreviewHtml(slide, {
        theme,
        lang: resolveDeckLang(pres),
        docLang: resolveDocLangFromPresentation(pres),
      });

      // Return HTML directly as text — Claude Desktop will render it as an artifact
      return html;
    },
    { readOnly: true, permission: 'read' },
  );

  // ─── preview_presentation ───────────────────────────────────────────────

  server.tool(
    'preview_presentation',
    'Render slides as self-contained HTML. Returns an HTML document — display it as an artifact to show a visual slide gallery. Supports optional slide range.',
    {
      type: 'object',
      properties: {
        presentationId: { type: 'string', description: 'Presentation ID' },
        slideRange: {
          type: 'string',
          description:
            'Optional: slide range to preview, e.g. "0-4" or "3-7". Omit for all slides.',
        },
      },
      required: ['presentationId'],
    },
    async ({ presentationId, slideRange }, context) => {
      const pres = await getCheckedPresentation(presentationId, context);

      let theme = null;
      try {
        theme = await loadThemeAssets(
          repoRoot,
          pres.theme,
          storageScopeOf(context),
        );
      } catch {
        /* use default styling */
      }

      let slides = pres.slides || [];
      let startIndex = 0;

      // Parse optional slide range
      if (slideRange) {
        const match = slideRange.match(/^(\d+)-(\d+)$/);
        if (match) {
          const from = Math.max(0, parseInt(match[1], 10));
          const to = Math.min(slides.length - 1, parseInt(match[2], 10));
          startIndex = from;
          slides = slides.slice(from, to + 1);
        }
      }

      const html = await buildSlidePreviewHtml(slides, {
        theme,
        title: pres.title,
        startIndex,
        lang: resolveDeckLang(pres),
        docLang: resolveDocLangFromPresentation(pres),
      });

      // Return HTML directly as text — Claude Desktop will render it as an artifact
      return html;
    },
    { readOnly: true, permission: 'read' },
  );

  // ─── list_comments ──────────────────────────────────────────────────────

  server.tool(
    'list_comments',
    'List comments on a single presentation (newest first) with nested replies. Use to read reviewer/AI feedback on one deck. Each comment carries current slide context (index, type, title, or deleted), the slide snapshot captured at create time (null for older comments), and an editUrl anchored to the slide. Access is scoped to decks you own or that are shared with you.',
    {
      type: 'object',
      properties: {
        presentationId: { type: 'string', description: 'Presentation ID' },
        status: {
          type: 'string',
          description: 'Filter by status (default: all)',
          enum: ['open', 'resolved', 'dismissed', 'all'],
        },
        slideId: {
          type: 'string',
          description: 'Only comments anchored to this slide id',
        },
        since: {
          type: 'string',
          description:
            'Only comments created at/after this ISO 8601 date/datetime (e.g. "2026-07-15" or "2026-07-15T12:00:00Z")',
        },
        includeReplies: {
          type: 'boolean',
          description:
            'When true, return replies as separate top-level rows instead of nested under their parent (default: false)',
        },
      },
      required: ['presentationId'],
    },
    async (
      {
        presentationId,
        status = 'all',
        slideId,
        since,
        includeReplies = false,
      },
      context,
    ) => {
      const { comments, presentation: pres } = await listComments(
        storageScopeOf(context),
        { actor: actorOf(context) },
        { presentationId, status, slideId, since, includeReplies },
      );

      // Slide context reflects the deck as it is now; the stored
      // slideSnapshot on each comment shows the slide at create time.
      const slideTypes = await sessionSlideTypes(context);
      const enriched = enrichCommentsWithSlideContext(comments, pres, {
        slideTypes,
      }).map((c) => ({
        ...c,
        editUrl: presentationUrl(presentationId, 'edit', {
          slideId: c.slideId,
        }),
      }));

      return {
        presentationId,
        presentationTitle: pres.title,
        comments: enriched,
        total: enriched.length,
      };
    },
    { readOnly: true, permission: 'comments:read' },
  );

  // ─── list_recent_comments ───────────────────────────────────────────────

  server.tool(
    'list_recent_comments',
    'List the most recent comments across the presentations you can open (newest first; `ownership` narrows the decks), optionally filtered to one reviewer or a since-date. Answers "what are the latest comments on my decks?". Each row carries the deck title, current slide context, create-time slide snapshot and a slide-anchored edit URL so it reads standalone. Requires the DB storage backend (returns empty in file mode).',
    {
      type: 'object',
      properties: {
        ownership: {
          type: 'string',
          description:
            'Which decks to include, as in list_presentations: "owned" (decks you own or made), "collection" (owned plus organization-visible), "shared" (decks shared with you), or "all" (default; every deck you can open). Any other value is refused.',
          enum: [...DECK_LIST_OWNERSHIPS],
        },
        authorEmail: {
          type: 'string',
          description: 'Optional: only comments left by this author email',
        },
        status: {
          type: 'string',
          description: 'Filter by status (default: all)',
          enum: ['open', 'resolved', 'dismissed', 'all'],
        },
        since: {
          type: 'string',
          description:
            'Only comments created at/after this ISO 8601 date/datetime',
        },
        limit: {
          type: 'number',
          description: 'Max comments to return (default: 50, max: 200)',
        },
      },
    },
    async (
      {
        ownership = 'all',
        authorEmail,
        status = 'all',
        since,
        limit = 50,
      } = {},
      context,
    ) => {
      const owner = getOwner(context);
      const { items: listed, total } = await listRecentComments(
        storageScopeOf(context),
        { actor: actorOf(context) },
        { ownership, authorEmail, status, since, limit },
      );

      const slideTypes = await sessionSlideTypes(context);
      const items = [];
      for (const { comment: c, presentation: pres } of listed) {
        const item = {
          id: c.id,
          presentationId: c.presentationId,
          presentationTitle: c.presentationTitle,
          slideId: c.slideId,
          slide: slideContextFor(pres || { slides: [] }, c.slideId, {
            slideTypes,
          }),
          slideSnapshot: c.slideSnapshot ?? null,
          // The author, named rather than addressed — the same shape the app
          // API uses since D22 (docs/reference/identity-in-responses.md).
          author: c.author || null,
          body: c.body,
          status: c.status,
          createdAt: c.createdAt,
        };
        const url = presentationUrl(c.presentationId, 'edit', {
          slideId: c.slideId,
        });
        if (url) item.editUrl = url;
        items.push(item);
      }

      return {
        comments: items,
        total,
        ownership,
        ownerFilter: owner || null,
      };
    },
    { readOnly: true, permission: 'comments:read' },
  );

  // ─── comment write tools (shared plumbing) ──────────────────────────────

  /**
   * Resolve the acting user for a comment mutation, or throw.
   * Writes need an author identity; a trusted local session without an
   * owner email cannot attribute the comment to anyone.
   */
  function requireCommentActor(context) {
    const owner = getOwner(context);
    if (!owner) {
      throw new UnauthorizedError(
        'This tool needs an acting user email to attribute the comment to. Configure the MCP owner email (stdio) or use an API-key session (HTTP).',
      );
    }
    return owner;
  }

  /**
   * Shared create path for add_comment and reply_to_comment. The flow is
   * `services/comments.js`; this adapter names the actor and shapes the tool
   * result.
   */
  async function createCommentAsActor(
    { presentationId, body, slideId = null, parentId = null },
    context,
  ) {
    requireCommentActor(context);
    const { comment, presentation } = await createComment(
      storageScopeOf(context),
      { actor: actorOf(context) },
      { presentationId, body, slideId, parentId },
    );
    return {
      ok: true,
      comment: {
        ...comment,
        slide: slideContextFor(presentation, comment.slideId, {
          slideTypes: await sessionSlideTypes(context),
        }),
        editUrl: presentationUrl(presentationId, 'edit', {
          slideId: comment.slideId,
        }),
      },
    };
  }

  // ─── add_comment ────────────────────────────────────────────────────────

  server.tool(
    'add_comment',
    'Add a new top-level comment to a presentation as the acting user. Optionally anchor it to a slide via slideId — a snapshot of that slide is stored with the comment. Requires the DB storage backend.',
    {
      type: 'object',
      properties: {
        presentationId: { type: 'string', description: 'Presentation ID' },
        body: {
          type: 'string',
          description: 'Comment text (max 5000 characters)',
        },
        slideId: {
          type: 'string',
          description: 'Optional: anchor the comment to this slide id',
        },
      },
      required: ['presentationId', 'body'],
    },
    async ({ presentationId, body, slideId }, context) =>
      createCommentAsActor(
        { presentationId, body, slideId: slideId || null },
        context,
      ),
    { permission: 'comments:write' },
  );

  // ─── reply_to_comment ───────────────────────────────────────────────────

  server.tool(
    'reply_to_comment',
    'Reply to an existing comment thread as the acting user (e.g. "good point, fixed in slide 7"). Replying to a reply attaches to the same top-level thread. Requires the DB storage backend.',
    {
      type: 'object',
      properties: {
        presentationId: {
          type: 'string',
          description: 'Presentation ID the comment belongs to',
        },
        commentId: {
          type: 'string',
          description: 'Comment (or reply) ID to respond to',
        },
        body: {
          type: 'string',
          description: 'Reply text (max 5000 characters)',
        },
      },
      required: ['presentationId', 'commentId', 'body'],
    },
    async ({ presentationId, commentId, body }, context) =>
      createCommentAsActor(
        { presentationId, body, parentId: commentId },
        context,
      ),
    { permission: 'comments:write' },
  );

  // ─── set_comment_status ─────────────────────────────────────────────────

  server.tool(
    'set_comment_status',
    'Resolve, reopen or dismiss a comment. Allowed transitions follow the app: open→resolved, open→dismissed, resolved→open. Only the presentation owner/creator may change status. Requires the DB storage backend.',
    {
      type: 'object',
      properties: {
        presentationId: {
          type: 'string',
          description: 'Presentation ID the comment belongs to',
        },
        commentId: { type: 'string', description: 'Comment ID' },
        status: {
          type: 'string',
          description: 'New status',
          enum: ['resolved', 'open', 'dismissed'],
        },
      },
      required: ['presentationId', 'commentId', 'status'],
    },
    async ({ presentationId, commentId, status }, context) => {
      requireCommentActor(context);
      const { comment } = await setCommentStatus(
        storageScopeOf(context),
        { actor: actorOf(context) },
        { presentationId, commentId, status },
      );
      return { ok: true, comment };
    },
    { permission: 'comments:write' },
  );

  // ─── custom tools (fork extension seam) ─────────────────────────────────
  // Keep this the last thing in registerTools: core's tool count stays
  // deterministic for tests, and custom tools can rely on core being present.
  if (typeof registerCustom === 'function') {
    registerCustom(server, {
      repoRoot,
      defaultOwnerEmail,
      getOwner,
      storageScopeOf,
      getAppBaseUrl,
      presentationUrl,
    });
  }
}
