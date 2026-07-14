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
