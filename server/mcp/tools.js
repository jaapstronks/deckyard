/**
 * MCP Tool Definitions for Deckyard
 *
 * Each tool wraps existing Deckyard functionality.
 * Tools are registered on the McpServer instance.
 */

import { repoRoot } from '../config/paths.js';
import { getAppBaseUrl } from '../config/utils.js';
import {
  listPresentations,
  getPresentation,
  createPresentation,
  updatePresentation,
  deletePresentation,
  duplicatePresentation,
} from '../storage/presentations.js';
import {
  listComments,
  listRecentCommentsForOwner,
  listAccessiblePresentationRefs,
} from '../storage/presentation-comments.js';
import {
  deckToPresentationParts,
  presentationToDeck,
} from '../../shared/slide-types.js';
import { generateDeckV2 } from '../utils/ai/index.js';
import {
  validateAndFixRefinedSlides,
  validateRefinedSlidesStrict,
  diffAppliedFixes,
  RawSlideValidationError,
} from '../utils/ai/validate-slides.js';
import { SLIDE_TYPES } from '../../shared/slide-types/registry.js';
import { iteratePresentation } from '../utils/ai/iterate-deck.js';
import { analyzeForCompression, applyCompression } from '../utils/ai/compress-deck.js';
import { analyzePresentation } from '../utils/ai/analyze-presentation.js';
import { convertSlideWithAi } from '../utils/ai.js';
import { generateSlidesToAppendFromRawContent } from '../utils/openai/append.js';
import { listThemeIds, loadTheme, resolveThemeId } from '../utils/themes.js';
import { SLIDE_TYPE_CATALOG, GLOBAL_SLIDE_OPTIONS } from '../utils/ai/slide-type-catalog.js';
import { buildSlidePreviewHtml, buildSingleSlidePreviewHtml } from './preview.js';

/**
 * Get the best display title for a slide, regardless of type.
 * Falls through: title → tagline → quote → label → value → first non-empty string field.
 */
function slideTitle(slide) {
  const c = slide?.content;
  if (!c) return '';
  return c.title || c.tagline || c.quote || c.label || c.value || '';
}

/**
 * Build a presentation URL (edit or present mode)
 */
function presentationUrl(id, mode = 'edit') {
  const base = getAppBaseUrl();
  if (!base) return null;
  return `${base}/${mode}/${id}`;
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
 *   `{ repoRoot, defaultOwnerEmail, getOwner, getAppBaseUrl, presentationUrl }`.
 *   Usually supplied by the `custom/mcp-tools.js` auto-loader
 *   (see ./custom-tools-loader.js); docs in docs/reference/mcp-server.md.
 */
export function registerTools(
  server,
  { defaultOwnerEmail = null, registerCustom = null } = {}
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

  // ─── get_slide_types ────────────────────────────────────────────────────

  server.tool(
    'get_slide_types',
    'List all available slide types with their schemas, descriptions, and best-use guidance. Each entry also includes a working `example` content object (from defaults) you can copy and edit when calling create_presentation_from_slides. The response also includes `globalOptions`: optional fields (background image, logo, text colour) that may be added to ANY slide type.',
    {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Filter by category: "structural", "content", "all" (default: "all")',
          enum: ['structural', 'content', 'all'],
        },
        lang: {
          type: 'string',
          description: 'Language for the example content: "nl" or "en-GB" (default: "nl")',
          enum: ['nl', 'en-GB'],
        },
      },
    },
    async ({ category = 'all', lang = 'nl' } = {}) => {
      const types = {};

      for (const [name, def] of Object.entries(SLIDE_TYPE_CATALOG)) {
        const isStructural = def.resolveInPhase1;

        if (category === 'structural' && !isStructural) continue;
        if (category === 'content' && isStructural) continue;

        const registryDef = SLIDE_TYPES[name];
        const example = registryDef?.defaultsByLang?.[lang]
          || registryDef?.defaultsByLang?.nl
          || registryDef?.defaults
          || null;

        types[name] = {
          category: isStructural ? 'structural' : 'content',
          description: (def.description || '').trim(),
          bestFor: def.bestFor || [],
          notFor: def.notFor || [],
          schema: def.schema || null,
          example,
        };
      }

      return {
        types,
        count: Object.keys(types).length,
        exampleLang: lang,
        globalOptions: GLOBAL_SLIDE_OPTIONS,
      };
    }
  );

  // ─── list_presentations ─────────────────────────────────────────────────

  server.tool(
    'list_presentations',
    'List all presentations. Returns id, title, theme, creation date, and slide count for each.',
    {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Max results (default: 50)',
        },
      },
    },
    async ({ limit = 50 } = {}, context) => {
      const all = await listPresentations(repoRoot);

      // Filter to only show presentations owned by the authenticated user
      const owner = getOwner(context);
      const owned = owner
        ? all.filter(p => p.ownerEmail === owner)
        : all;

      const items = owned.slice(0, limit).map(p => {
        // slideCount: try slides array, then slideCount property, then fall back to 0
        // listPresentations may not include full slides array (too heavy for lists)
        const slideCount = Array.isArray(p.slides) ? p.slides.length
          : (typeof p.slideCount === 'number' ? p.slideCount : null);

        const item = {
          id: p.id,
          title: p.title || 'Untitled',
          theme: p.theme || 'default',
          createdAt: p.created || p.createdAt,
          updatedAt: p.modified || p.updatedAt,
        };
        if (slideCount !== null) item.slideCount = slideCount;
        const url = presentationUrl(p.id, 'edit');
        if (url) item.editUrl = url;
        return item;
      });

      return {
        presentations: items,
        total: owned.length,
        ownerFilter: owner || null,
      };
    }
  );

  // ─── get_presentation ───────────────────────────────────────────────────

  server.tool(
    'get_presentation',
    'Get full presentation data including all slides. Use to read existing deck content before modifying.',
    {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Presentation ID' },
      },
      required: ['id'],
    },
    async ({ id }) => {
      const pres = await getPresentation(repoRoot, id);
      if (!pres) throw new Error(`Presentation not found: ${id}`);

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
    }
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
          description: 'Source text to generate presentation from (meeting notes, article, bullet points, etc.)',
        },
        title: {
          type: 'string',
          description: 'Optional presentation title (auto-generated if not provided)',
        },
        theme: {
          type: 'string',
          description: 'Theme ID (default: "default")',
        },
        lang: {
          type: 'string',
          description: 'Language: "nl" or "en-GB" (auto-detected if not provided)',
          enum: ['nl', 'en-GB'],
        },
        speaker: {
          type: 'string',
          description: 'Speaker name for the title slide',
        },
        ownerEmail: {
          type: 'string',
          description: 'Email of the presentation owner (for access control). If not provided, uses the server default.',
        },
        vendor: {
          type: 'string',
          description: 'LLM vendor override (e.g. "openai", "anthropic"). Uses server default if not specified.',
        },
      },
      required: ['content'],
    },
    async ({ content, title, theme = 'default', lang, speaker = '', ownerEmail, vendor }, context) => {
      const effectiveOwner = ownerEmail || getOwner(context);
      // Load theme for title slide type
      let titleSlideType = 'title-slide';
      try {
        const themeObj = await loadTheme(repoRoot, resolveThemeId(theme));
        titleSlideType = themeObj?.defaultTitleSlide || 'title-slide';
      } catch { /* use default */ }

      const deck = await generateDeckV2(content, {
        userName: speaker,
        targetLang: lang || null,
        theme,
        titleSlideType,
        enableLogging: false,
        vendor: vendor || null,
      });

      // Create and save the presentation
      const parts = deckToPresentationParts(deck);
      if (title) parts.title = title;

      const created = await createPresentation(repoRoot, {
        title: parts.title,
        theme,
        lang: lang || undefined,
        ownerEmail: effectiveOwner,
      });

      const updated = await updatePresentation(repoRoot, created.id, {
        ...created,
        slides: parts.slides,
        title: parts.title,
      });

      const result = {
        id: updated.id,
        title: updated.title,
        theme,
        slideCount: updated.slides?.length || 0,
        slides: (updated.slides || []).map((s, i) => ({
          index: i,
          type: s.type,
          title: slideTitle(s),
        })),
      };
      const editUrl = presentationUrl(updated.id, 'edit');
      const presentUrl = presentationUrl(updated.id, 'present');
      if (editUrl) result.editUrl = editUrl;
      if (presentUrl) result.presentUrl = presentUrl;
      return result;
    }
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
          description: 'Slide array. Each item: { type, content, notes? }. See get_slide_types for valid types and example content.',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', description: 'Slide type (e.g. "title-slide", "team-cards-slide")' },
              content: { type: 'object', description: 'Slide content matching the type schema' },
              notes: { type: 'string', description: 'Speaker notes (optional)' },
            },
            required: ['type', 'content'],
          },
          minItems: 1,
          maxItems: 50,
        },
        theme: {
          type: 'string',
          description: 'Theme ID (default: "default")',
        },
        lang: {
          type: 'string',
          description: 'Language: "nl" or "en-GB" (default: "nl")',
          enum: ['nl', 'en-GB'],
        },
        ownerEmail: {
          type: 'string',
          description: 'Email of the presentation owner. Defaults to the session/server owner.',
        },
        validation: {
          type: 'string',
          description: '"strict" (default) throws on first issue with structured detail. "fix" applies auto-fixes (truncate, pad, layout switch) and returns them in `appliedFixes`.',
          enum: ['strict', 'fix'],
        },
        auto_prepend_title: {
          type: 'boolean',
          description: 'When true and the first slide is not the theme\'s default title-slide type, prepend an empty title slide using `title`. Default: false.',
        },
      },
      required: ['title', 'slides'],
    },
    async ({
      title,
      slides,
      theme = 'default',
      lang = 'nl',
      ownerEmail,
      validation = 'strict',
      auto_prepend_title = false,
    }, context) => {
      if (!Array.isArray(slides) || slides.length === 0) {
        throw new Error('"slides" must be a non-empty array');
      }

      const effectiveOwner = ownerEmail || getOwner(context);

      // Strip incoming `id` fields so storage assigns fresh UUIDs; preserve type/content/notes.
      let inputSlides = slides.map((s) => ({
        type: s?.type,
        content: s?.content,
        notes: typeof s?.notes === 'string' ? s.notes : '',
      }));

      // Optional escape hatch: prepend an empty title slide if missing.
      if (auto_prepend_title) {
        let titleSlideType = 'title-slide';
        try {
          const themeObj = await loadTheme(repoRoot, resolveThemeId(theme));
          titleSlideType = themeObj?.defaultTitleSlide || 'title-slide';
        } catch { /* keep default */ }

        if (inputSlides[0]?.type !== titleSlideType) {
          inputSlides = [
            { type: titleSlideType, content: { title }, notes: '' },
            ...inputSlides,
          ];
        }
      }

      // Validation
      let validatedSlides;
      let appliedFixes = [];
      if (validation === 'fix') {
        const fixed = validateAndFixRefinedSlides(
          inputSlides.map((s) => ({ type: s.type, content: s.content }))
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
            inputSlides.map((s) => ({ type: s.type, content: s.content }))
          );
        } catch (err) {
          if (err instanceof RawSlideValidationError) {
            const wrapped = new Error(`Validation failed: ${err.message}`);
            wrapped.details = err.details;
            throw wrapped;
          }
          throw err;
        }
        validatedSlides = inputSlides;
      }

      // Create stub row, then write the slide payload in one update.
      const created = await createPresentation(repoRoot, {
        title,
        theme,
        lang,
        ownerEmail: effectiveOwner,
      });
      if (created?.ok === false) {
        throw new Error(`createPresentation failed: ${created.reason || 'unknown'}`);
      }

      const updated = await updatePresentation(repoRoot, created.id, {
        ...created,
        title,
        slides: validatedSlides.map((s) => ({
          type: s.type,
          content: s.content,
          notes: s.notes || '',
        })),
      });
      if (updated?.ok === false) {
        throw new Error(`updatePresentation failed: ${updated.reason || 'unknown'}`);
      }

      const result = {
        id: updated.id,
        title: updated.title,
        theme,
        lang,
        slideCount: updated.slides?.length || 0,
        slides: (updated.slides || []).map((s, i) => ({
          index: i,
          type: s.type,
          title: slideTitle(s),
        })),
      };
      const editUrl = presentationUrl(updated.id, 'edit');
      const presentUrl = presentationUrl(updated.id, 'present');
      if (editUrl) result.editUrl = editUrl;
      if (presentUrl) result.presentUrl = presentUrl;
      if (validation === 'fix') result.appliedFixes = appliedFixes;
      return result;
    }
  );

  // ─── update_slide ───────────────────────────────────────────────────────

  server.tool(
    'update_slide',
    'Update a specific slide\'s content in a presentation. You must provide the exact content structure matching the slide type schema.',
    {
      type: 'object',
      properties: {
        presentationId: { type: 'string', description: 'Presentation ID' },
        slideIndex: { type: 'number', description: 'Slide index (0-based)' },
        content: {
          type: 'object',
          description: 'New content for the slide (must match slide type schema)',
        },
        type: {
          type: 'string',
          description: 'Optional: change the slide type',
        },
      },
      required: ['presentationId', 'slideIndex', 'content'],
    },
    async ({ presentationId, slideIndex, content, type }) => {
      const pres = await getPresentation(repoRoot, presentationId);
      if (!pres) throw new Error(`Presentation not found: ${presentationId}`);
      if (slideIndex < 0 || slideIndex >= pres.slides.length) {
        throw new Error(`Slide index ${slideIndex} out of range (0-${pres.slides.length - 1})`);
      }

      const slide = pres.slides[slideIndex];
      if (type) slide.type = type;
      slide.content = { ...slide.content, ...content };

      // Validate the updated slide
      const [validated] = validateAndFixRefinedSlides([{
        type: slide.type,
        content: slide.content,
      }]);
      slide.content = validated.content;

      await updatePresentation(repoRoot, presentationId, pres);

      return {
        updated: true,
        slideIndex,
        type: slide.type,
        content: slide.content,
      };
    }
  );

  // ─── add_slide ──────────────────────────────────────────────────────────

  server.tool(
    'add_slide',
    'Add a new slide to an existing presentation at a specific position.',
    {
      type: 'object',
      properties: {
        presentationId: { type: 'string', description: 'Presentation ID' },
        type: { type: 'string', description: 'Slide type (e.g. "list-slide", "content-slide")' },
        content: {
          type: 'object',
          description: 'Slide content matching the type schema',
        },
        position: {
          type: 'number',
          description: 'Insert position (0-based). If omitted, appends at end.',
        },
      },
      required: ['presentationId', 'type', 'content'],
    },
    async ({ presentationId, type, content, position }) => {
      const pres = await getPresentation(repoRoot, presentationId);
      if (!pres) throw new Error(`Presentation not found: ${presentationId}`);

      // Validate the new slide
      const [validated] = validateAndFixRefinedSlides([{ type, content }]);

      const newSlide = {
        id: crypto.randomUUID(),
        type: validated.type,
        content: validated.content,
        notes: '',
      };

      const insertAt = position != null
        ? Math.max(0, Math.min(pres.slides.length, position))
        : pres.slides.length;

      pres.slides.splice(insertAt, 0, newSlide);
      await updatePresentation(repoRoot, presentationId, pres);

      return {
        added: true,
        slideId: newSlide.id,
        position: insertAt,
        type: newSlide.type,
        totalSlides: pres.slides.length,
      };
    }
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
        targetType: { type: 'string', description: 'Target slide type (e.g. "list-slide")' },
        vendor: {
          type: 'string',
          description: 'LLM vendor override (e.g. "openai", "anthropic")',
        },
      },
      required: ['presentationId', 'slideIndex', 'targetType'],
    },
    async ({ presentationId, slideIndex, targetType, vendor }) => {
      const pres = await getPresentation(repoRoot, presentationId);
      if (!pres) throw new Error(`Presentation not found: ${presentationId}`);
      if (slideIndex < 0 || slideIndex >= pres.slides.length) {
        throw new Error(`Slide index ${slideIndex} out of range`);
      }

      const slide = pres.slides[slideIndex];
      const lang = pres.lang || 'en-GB';

      const result = await convertSlideWithAi(slide, targetType, {
        vendor: vendor || null,
        lang,
      });

      if (!result?.content) throw new Error('Conversion failed — no content returned');

      const fromType = slide.type;
      slide.type = result.type || targetType;
      slide.content = result.content;
      await updatePresentation(repoRoot, presentationId, pres);

      return {
        converted: true,
        slideIndex,
        fromType,
        toType: slide.type,
        content: slide.content,
      };
    }
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
          description: 'Natural language instruction (e.g. "make this punchier", "split slide 3")',
        },
        vendor: {
          type: 'string',
          description: 'LLM vendor override (e.g. "openai", "anthropic")',
        },
      },
      required: ['presentationId', 'command'],
    },
    async ({ presentationId, command, vendor }) => {
      const pres = await getPresentation(repoRoot, presentationId);
      if (!pres) throw new Error(`Presentation not found: ${presentationId}`);

      const lang = pres.lang || 'en-GB';

      const { deck: newDeck, plan, targetSlideIndex } = await iteratePresentation(pres, command, {
        lang,
        vendor: vendor || null,
      });

      // Save the modified deck
      pres.slides = newDeck.slides;
      await updatePresentation(repoRoot, presentationId, pres);

      return {
        applied: true,
        targetSlideIndex,
        summary: plan.summary,
        modifications: plan.modifications?.map(m => ({
          slideIndex: m.slideIndex,
          action: m.action,
          reasoning: m.reasoning,
        })) || [],
        totalSlides: pres.slides.length,
      };
    }
  );

  // ─── validate_presentation ──────────────────────────────────────────────

  server.tool(
    'validate_presentation',
    'Validate a presentation\'s slides for schema compliance, content density, and type variety issues. Returns warnings and fix suggestions.',
    {
      type: 'object',
      properties: {
        presentationId: { type: 'string', description: 'Presentation ID' },
      },
      required: ['presentationId'],
    },
    async ({ presentationId }) => {
      const pres = await getPresentation(repoRoot, presentationId);
      if (!pres) throw new Error(`Presentation not found: ${presentationId}`);

      const validated = validateAndFixRefinedSlides(
        pres.slides.map(s => ({ type: s.type, content: s.content, reasoning: '' }))
      );

      const warnings = [];
      validated.forEach((slide, i) => {
        if (slide._aiWarnings?.length) {
          warnings.push({
            slideIndex: i,
            type: slide.type,
            title: slideTitle(slide),
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
    }
  );

  // ─── list_themes ────────────────────────────────────────────────────────

  server.tool(
    'list_themes',
    'List all available presentation themes.',
    {
      type: 'object',
      properties: {},
    },
    async () => {
      const ids = await listThemeIds(repoRoot);
      const themes = [];

      for (const id of ids) {
        try {
          const theme = await loadTheme(repoRoot, id);
          themes.push({
            id: theme.id,
            label: theme.label || theme.id,
            brandColors: theme.brandColors || [],
            hasBackgroundImages: !!(theme.backgroundPresets?.length),
          });
        } catch {
          themes.push({ id, label: id });
        }
      }

      return { themes };
    }
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
          description: 'Must be true to actually delete. Prevents accidental deletion.',
        },
      },
      required: ['presentationId', 'confirm'],
    },
    async ({ presentationId, confirm }) => {
      if (!confirm) {
        // Fetch title for confirmation prompt
        const pres = await getPresentation(repoRoot, presentationId);
        return {
          deleted: false,
          id: presentationId,
          title: pres?.title || 'Unknown',
          slideCount: pres?.slides?.length || 0,
          message: 'Set confirm: true to delete this presentation. This action moves it to trash.',
        };
      }
      await deletePresentation(repoRoot, presentationId);
      return { deleted: true, id: presentationId };
    }
  );

  // ─── remove_slide ───────────────────────────────────────────────────────

  server.tool(
    'remove_slide',
    'Remove a slide from a presentation by index.',
    {
      type: 'object',
      properties: {
        presentationId: { type: 'string', description: 'Presentation ID' },
        slideIndex: { type: 'number', description: 'Slide index to remove (0-based)' },
      },
      required: ['presentationId', 'slideIndex'],
    },
    async ({ presentationId, slideIndex }) => {
      const pres = await getPresentation(repoRoot, presentationId);
      if (!pres) throw new Error(`Presentation not found: ${presentationId}`);
      if (slideIndex < 0 || slideIndex >= pres.slides.length) {
        throw new Error(`Slide index ${slideIndex} out of range (0-${pres.slides.length - 1})`);
      }

      const removed = pres.slides.splice(slideIndex, 1)[0];
      await updatePresentation(repoRoot, presentationId, pres);

      return {
        removed: true,
        slideIndex,
        removedType: removed.type,
        removedTitle: slideTitle(removed),
        totalSlides: pres.slides.length,
      };
    }
  );

  // ─── reorder_slides ─────────────────────────────────────────────────────

  server.tool(
    'reorder_slides',
    'Move a slide from one position to another.',
    {
      type: 'object',
      properties: {
        presentationId: { type: 'string', description: 'Presentation ID' },
        fromIndex: { type: 'number', description: 'Current slide position (0-based)' },
        toIndex: { type: 'number', description: 'Target position (0-based)' },
      },
      required: ['presentationId', 'fromIndex', 'toIndex'],
    },
    async ({ presentationId, fromIndex, toIndex }) => {
      const pres = await getPresentation(repoRoot, presentationId);
      if (!pres) throw new Error(`Presentation not found: ${presentationId}`);
      const len = pres.slides.length;
      if (fromIndex < 0 || fromIndex >= len) throw new Error(`fromIndex ${fromIndex} out of range`);
      if (toIndex < 0 || toIndex >= len) throw new Error(`toIndex ${toIndex} out of range`);

      const [slide] = pres.slides.splice(fromIndex, 1);
      pres.slides.splice(toIndex, 0, slide);
      await updatePresentation(repoRoot, presentationId, pres);

      return {
        moved: true,
        slide: { type: slide.type, title: slideTitle(slide) },
        from: fromIndex,
        to: toIndex,
      };
    }
  );

  // ─── append_slides ──────────────────────────────────────────────────────

  server.tool(
    'append_slides',
    'Add new slides to an existing presentation by providing additional content. AI generates appropriate slide types from the text.',
    {
      type: 'object',
      properties: {
        presentationId: { type: 'string', description: 'Presentation ID' },
        content: { type: 'string', description: 'New content to generate slides from' },
        vendor: {
          type: 'string',
          description: 'LLM vendor override (e.g. "openai", "anthropic")',
        },
      },
      required: ['presentationId', 'content'],
    },
    async ({ presentationId, content, vendor }) => {
      const pres = await getPresentation(repoRoot, presentationId);
      if (!pres) throw new Error(`Presentation not found: ${presentationId}`);

      const lang = pres.lang || 'en-GB';
      const existingDeck = presentationToDeck(pres);

      const { slides: newSlides } = await generateSlidesToAppendFromRawContent(content, {
        existingDeck,
        targetLang: lang,
        contentOnly: true,
        vendor: vendor || null,
      });

      if (!newSlides?.length) return { appended: 0, totalSlides: pres.slides.length };

      // Find insert position: before structural closing slides (payoff, end, follow-invite)
      const closingTypes = new Set(['payoff-slide', 'end-slide', 'follow-invite-slide']);
      let insertAt = pres.slides.length;
      for (let i = pres.slides.length - 1; i >= 0; i--) {
        if (closingTypes.has(pres.slides[i].type)) {
          insertAt = i;
        } else {
          break;
        }
      }

      const slidesToInsert = newSlides.map(s => ({
        id: crypto.randomUUID(),
        type: s.type,
        content: s.content,
        notes: '',
      }));

      pres.slides.splice(insertAt, 0, ...slidesToInsert);

      await updatePresentation(repoRoot, presentationId, pres);

      return {
        appended: newSlides.length,
        insertedAt: insertAt,
        totalSlides: pres.slides.length,
        newSlides: newSlides.map(s => ({
          type: s.type,
          title: slideTitle(s),
        })),
      };
    }
  );

  // ─── compress_presentation ──────────────────────────────────────────────

  server.tool(
    'compress_presentation',
    'Analyze a presentation for compression opportunities: merge similar slides, remove redundancy, tighten content. Can preview changes or apply them directly.',
    {
      type: 'object',
      properties: {
        presentationId: { type: 'string', description: 'Presentation ID' },
        apply: { type: 'boolean', description: 'Apply changes (default: false = preview only)' },
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
    async ({ presentationId, apply = false, intensity = 'moderate', vendor }) => {
      const pres = await getPresentation(repoRoot, presentationId);
      if (!pres) throw new Error(`Presentation not found: ${presentationId}`);

      const recommendations = await analyzeForCompression(pres, {
        targetReduction: intensity,
        vendor: vendor || null,
      });

      if (apply && (recommendations.merges.length > 0 || recommendations.removals.length > 0)) {
        const compressed = applyCompression(pres, recommendations);
        pres.slides = compressed.slides;
        await updatePresentation(repoRoot, presentationId, pres);
      }

      return {
        applied: apply,
        merges: recommendations.merges?.length || 0,
        removals: recommendations.removals?.length || 0,
        recommendations,
        slidesAfter: apply ? pres.slides.length : undefined,
      };
    }
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
    async ({ presentationId, vendor }) => {
      const pres = await getPresentation(repoRoot, presentationId);
      if (!pres) throw new Error(`Presentation not found: ${presentationId}`);

      // analyzePresentation auto-detects language from slide content
      const result = await analyzePresentation(pres, {
        vendor: vendor || null,
      });

      // analyzePresentation returns { suggestions: [...], metadata: {...} }
      const suggestions = result?.suggestions || [];

      return {
        slideCount: pres.slides.length,
        suggestionCount: suggestions.length,
        suggestions: suggestions.map(s => ({
          slideIndex: s.slideIndex,
          category: s.category,
          body: s.body,
          proposedSlide: s.proposedSlide ? {
            type: s.proposedSlide.type,
            title: slideTitle(s.proposedSlide),
          } : null,
        })),
      };
    }
  );

  // ─── duplicate_presentation ─────────────────────────────────────────────

  server.tool(
    'duplicate_presentation',
    'Create a copy of an existing presentation.',
    {
      type: 'object',
      properties: {
        presentationId: { type: 'string', description: 'Presentation ID to duplicate' },
      },
      required: ['presentationId'],
    },
    async ({ presentationId }, context) => {
      const dup = await duplicatePresentation(repoRoot, presentationId, {
        ownerEmail: getOwner(context),
      });
      if (!dup?.id) throw new Error('Duplication failed');

      const result = {
        id: dup.id,
        title: dup.title,
        slideCount: dup.slides?.length || 0,
      };
      const url = presentationUrl(dup.id, 'edit');
      if (url) result.editUrl = url;
      return result;
    }
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
    async ({ presentationId }) => {
      // Verify it exists
      const pres = await getPresentation(repoRoot, presentationId);
      if (!pres) throw new Error(`Presentation not found: ${presentationId}`);

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
        editUrl: `${base}/edit/${presentationId}`,
        presentUrl: `${base}/present/${presentationId}`,
      };
    }
  );

  // ─── export_presentation ────────────────────────────────────────────────

  server.tool(
    'export_presentation',
    'Get a download URL for a finished export of a deck (PDF, PPTX, self-contained HTML, deck JSON, or a zip of per-slide PNGs). Returns a URL the user opens in a browser where they are signed in to Deckyard; the server renders the file on demand. Use this to deliver a downloadable file. For an inline visual preview instead, use preview_presentation.',
    {
      type: 'object',
      properties: {
        presentationId: { type: 'string', description: 'Presentation ID' },
        format: {
          type: 'string',
          enum: ['pdf', 'pptx', 'html', 'json', 'png-zip'],
          description:
            'Export format. pdf = server-rendered PDF; pptx = PowerPoint; html = self-contained HTML; json = deck source; png-zip = one PNG per slide, zipped.',
        },
        lang: {
          type: 'string',
          description:
            'Optional language projection for multilingual decks (e.g. "nl" or "en-GB"). Omit to export the deck as-is.',
        },
      },
      required: ['presentationId', 'format'],
    },
    async ({ presentationId, format, lang }) => {
      const pres = await getPresentation(repoRoot, presentationId);
      if (!pres) throw new Error(`Presentation not found: ${presentationId}`);

      // Agent-friendly format name → in-app export route (cookie-authenticated).
      const EXPORT_PATHS = {
        pdf: 'export/pdf-slides.pdf',
        pptx: 'export/pptx',
        html: 'export/html',
        json: 'export/json',
        'png-zip': 'export/png.zip',
      };
      const relPath = EXPORT_PATHS[format];
      if (!relPath) {
        throw new Error(
          `Unsupported format "${format}". Use one of: ${Object.keys(EXPORT_PATHS).join(', ')}.`
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

      let downloadUrl = `${base}/api/presentations/${presentationId}/${relPath}`;
      if (lang) downloadUrl += `?lang=${encodeURIComponent(lang)}`;

      return {
        id: presentationId,
        title: pres.title,
        format,
        downloadUrl,
        note: 'Open this URL in a browser signed in to Deckyard to download the file. PDF/PPTX/PNG are rendered on demand and may take a few seconds for large decks.',
      };
    }
  );

  // ─── preview_slide ──────────────────────────────────────────────────────

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
    async ({ presentationId, slideIndex }) => {
      const pres = await getPresentation(repoRoot, presentationId);
      if (!pres) throw new Error(`Presentation not found: ${presentationId}`);
      if (slideIndex < 0 || slideIndex >= pres.slides.length) {
        throw new Error(`Slide index ${slideIndex} out of range (0-${pres.slides.length - 1})`);
      }

      const slide = pres.slides[slideIndex];
      let theme = null;
      try {
        theme = await loadTheme(repoRoot, resolveThemeId(pres.theme));
      } catch { /* use default styling */ }

      const html = await buildSingleSlidePreviewHtml(slide, { theme });

      // Return HTML directly as text — Claude Desktop will render it as an artifact
      return html;
    }
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
          description: 'Optional: slide range to preview, e.g. "0-4" or "3-7". Omit for all slides.',
        },
      },
      required: ['presentationId'],
    },
    async ({ presentationId, slideRange }) => {
      const pres = await getPresentation(repoRoot, presentationId);
      if (!pres) throw new Error(`Presentation not found: ${presentationId}`);

      let theme = null;
      try {
        theme = await loadTheme(repoRoot, resolveThemeId(pres.theme));
      } catch { /* use default styling */ }

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
      });

      // Return HTML directly as text — Claude Desktop will render it as an artifact
      return html;
    }
  );

  // ─── list_comments ──────────────────────────────────────────────────────

  server.tool(
    'list_comments',
    'List comments on a single presentation (newest first) with nested replies. Use to read reviewer/AI feedback on one deck. Access is scoped to decks you own or that are shared with you.',
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
        includeReplies: {
          type: 'boolean',
          description:
            'When true, return replies as separate top-level rows instead of nested under their parent (default: false)',
        },
      },
      required: ['presentationId'],
    },
    async ({ presentationId, status = 'all', slideId, includeReplies = false }, context) => {
      const owner = getOwner(context);
      const ctx = { actorEmail: owner, organizationId: context?.organizationId };

      // Access guard: only decks the acting owner can see (owned or shared).
      const refs = await listAccessiblePresentationRefs(repoRoot, ctx, 'all');
      const ref = refs.find((r) => r.id === presentationId);
      if (!ref) {
        throw new Error(`Presentation not found or not accessible: ${presentationId}`);
      }

      const comments = await listComments(presentationId, ctx, {
        status: status === 'all' ? undefined : status,
        slideId: slideId || undefined,
        includeReplies,
      });

      return {
        presentationId,
        presentationTitle: ref.title,
        comments,
        total: comments.length,
      };
    }
  );

  // ─── list_recent_comments ───────────────────────────────────────────────

  server.tool(
    'list_recent_comments',
    'List the most recent comments across all your presentations (newest first), optionally filtered to one reviewer. Answers "what are the latest comments on my decks?". Each row carries the deck title and edit URL so it reads standalone. Requires the DB storage backend (returns empty in file mode).',
    {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          description: 'Which decks to include: owned, shared, or all (default: all)',
          enum: ['owned', 'shared', 'all'],
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
        limit: {
          type: 'number',
          description: 'Max comments to return (default: 50, max: 200)',
        },
      },
    },
    async ({ scope = 'all', authorEmail, status = 'all', limit = 50 } = {}, context) => {
      const owner = getOwner(context);
      const ctx = { actorEmail: owner, organizationId: context?.organizationId };

      const { comments, total } = await listRecentCommentsForOwner(repoRoot, ctx, {
        scope,
        authorEmail: authorEmail || null,
        status,
        limit,
      });

      const items = comments.map((c) => {
        const item = {
          presentationId: c.presentationId,
          presentationTitle: c.presentationTitle,
          slideId: c.slideId,
          authorName: c.authorName,
          authorEmail: c.authorEmail,
          body: c.body,
          status: c.status,
          createdAt: c.createdAt,
        };
        const url = presentationUrl(c.presentationId, 'edit');
        if (url) item.editUrl = url;
        return item;
      });

      return {
        comments: items,
        total,
        scope,
        ownerFilter: owner || null,
      };
    }
  );

  // ─── custom tools (fork extension seam) ─────────────────────────────────
  // Keep this the last thing in registerTools: core's tool count stays
  // deterministic for tests, and custom tools can rely on core being present.
  if (typeof registerCustom === 'function') {
    registerCustom(server, {
      repoRoot,
      defaultOwnerEmail,
      getOwner,
      getAppBaseUrl,
      presentationUrl,
    });
  }
}
