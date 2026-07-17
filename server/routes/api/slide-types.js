import { serveJson } from '../../utils/http.js';
import { SLIDE_TYPES } from '../../../shared/slide-types.js';
import { listPublishedCustomSlideTypes } from '../../storage/custom-slide-types.js';
import { createRouteContext } from '../../utils/context.js';

export async function handleSlideTypes({ req, res, url, authedUser }) {
  // Slide type metadata (for editor UI). Keeps client/server in sync.
  // Merges core types (Tier 1) with published custom types (Tier 2).
  if (url.pathname === '/api/slide-types' && req.method === 'GET') {
    const meta = {};

    // Tier 1: Core + file-based types
    for (const [key, def] of Object.entries(SLIDE_TYPES)) {
      meta[key] = {
        label: def.label,
        fields: def.fields,
        defaults: def.defaults,
        themeId:
          typeof def.themeId === 'string' && def.themeId.trim()
            ? def.themeId.trim()
            : undefined,
        defaultsByLang:
          def.defaultsByLang && typeof def.defaultsByLang === 'object'
            ? def.defaultsByLang
            : undefined,
        // Inline-edit descriptor declared on the definition itself: the
        // extension seam for custom slide types (custom/slide-types/*.js).
        // The client's descriptor registry falls back to this when it has no
        // core entry for the type. JSON-only (no function-valued options).
        inline:
          def.inline && typeof def.inline === 'object'
            ? def.inline
            : undefined,
        // Layout catalogue for the editor's layout switcher. Declared on the
        // definition (JSON-safe) so forks that override a type by name bring
        // their own variant set; absent = no switcher chip.
        layoutVariants: Array.isArray(def.layoutVariants)
          ? def.layoutVariants
          : undefined,
        // Which enum field mirrors the layout (image left/right); drives the
        // switcher's mirror toggle. Same fork story as layoutVariants.
        layoutMirror:
          def.layoutMirror && typeof def.layoutMirror === 'object'
            ? def.layoutMirror
            : undefined,
      };
    }

    // Tier 2: Published custom types from the database (per-org)
    try {
      const ctx = createRouteContext(authedUser);
      const customTypes = await listPublishedCustomSlideTypes(ctx);
      for (const ct of customTypes) {
        // Use "custom-<slug>" as the type key to avoid collisions with core types
        const typeKey = `custom-${ct.slug}`;
        meta[typeKey] = {
          label: ct.label,
          fields: ct.fields,
          defaults: ct.defaults,
          defaultsByLang: ct.defaultsByLang || undefined,
          baseType: ct.baseType || undefined,
          isCustom: true,
          customId: ct.id,
          css: ct.css || undefined,
          hasTemplate: Boolean(ct.template),
        };
      }
    } catch {
      // Custom types are additive; if loading fails, core types still work.
    }

    serveJson(res, 200, meta);
    return true;
  }
  return false;
}
