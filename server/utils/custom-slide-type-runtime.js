/**
 * Custom Slide Type Runtime
 *
 * Converts database-stored custom slide type definitions into runtime
 * slide type objects that can be merged into the SLIDE_TYPES map.
 *
 * Custom types with templates get a compiled renderHtml function.
 * Custom types without templates fall back to their baseType's renderer.
 *
 * This module is the *server* half: it needs storage and the process-wide
 * `SLIDE_TYPES` map. The render itself — compile, sanitize, scope the author
 * CSS, place the scope root — is isomorphic and lives in
 * `shared/slide-types/custom-type-runtime.js`, where the Settings preview can
 * reach the very same four steps (B192).
 *
 * ## One registry per organization
 *
 * `SLIDE_TYPES` is the process-wide registry: core plus whatever a fork put in
 * `custom/slide-types/`. It is the same map for every request, so it cannot
 * hold an org's DB-backed types. {@link buildMergedSlideTypes} is the seam that
 * answers "which types does *this* organization have" — and it is the only one.
 * Every server path that resolves a `slides[].type` against anything other than
 * bare `SLIDE_TYPES` takes its map from here, reads and writes alike: the
 * storage write seam (`normalizeSlides`), the export pipeline, the published /
 * embed viewers, the thumbnail and single-slide renderers.
 *
 * Building the map is cheap on purpose — a template is compiled on first
 * render, not on construction — so the write path, which only needs to know
 * whether a key exists, pays a lookup and not a compile (B129).
 */

import { SLIDE_TYPES } from '../../shared/slide-types.js';
import { escapeHtml } from '../../shared/slide-types/helpers.js';
import {
  createTemplateSlideRenderer,
  customSlideTypeKey,
  customSlideTypeRootClass,
} from '../../shared/slide-types/custom-type-runtime.js';
import { listPublishedCustomSlideTypes } from '../storage/custom-slide-types.js';
import { createLogger } from './logger.js';

const log = createLogger('custom-slide-type-runtime');

/**
 * Convert a custom slide type record into a runtime slide type definition.
 *
 * @param {Object} ct - Custom slide type record from the database
 * @returns {Object} Runtime slide type definition (label, fields, defaults, renderHtml)
 */
export function toRuntimeSlideType(ct) {
  const def = {
    label: ct.label,
    fields: ct.fields || [],
    defaults: ct.defaults || {},
    defaultsByLang: ct.defaultsByLang || undefined,
    isCustom: true,
    customId: ct.id,
  };

  if (ct.template) {
    // The render itself is isomorphic and lives in shared/, because the
    // Settings preview renders the same definition through the same four steps
    // (B192). Nothing is compiled here: `buildMergedSlideTypes` also builds the
    // registry the storage write seam validates against, and a deck save has no
    // business compiling every published template in the org just to learn that
    // a type key exists (B129).
    def.renderHtml = createTemplateSlideRenderer({
      template: ct.template,
      css: ct.css,
      rootClass: customSlideTypeRootClass(ct),
    });
  } else if (ct.baseType && SLIDE_TYPES[ct.baseType]) {
    // Fall back to the base type's renderer
    def.renderHtml = SLIDE_TYPES[ct.baseType].renderHtml;
  } else {
    // Last resort: render a basic content block
    def.renderHtml = (content) => {
      const title = escapeHtml(String(content?.title || ct.label || ''));
      const body = escapeHtml(String(content?.body || ''));
      return `
        <div class="slide is-lime">
          <div class="slide-inner">
            <h2 class="heading">${title}</h2>
            ${body ? `<div class="body">${body}</div>` : ''}
          </div>
        </div>
      `;
    };
  }

  return def;
}

/**
 * Build the slide-type registry for one organization: core and file-based
 * types, plus that org's **published** custom types under their
 * {@link customSlideTypeKey}.
 *
 * This is the map every org-aware path resolves against — see the module note
 * on why there is exactly one of them. It is org-scoped by construction, so it
 * is built per request and never cached across organizations.
 *
 * A failed load leaves the core registry intact rather than throwing: on a read
 * path that degrades a custom slide to the unknown-type fallback, and on the
 * write path it degrades to the pre-B129 behaviour (a 400) — both are better
 * than a 500, and neither persists anything wrong.
 *
 * @param {Object} ctx - Context with organizationId (a storage scope qualifies)
 * @returns {Promise<Object>} Merged slide types map
 */
export async function buildMergedSlideTypes(ctx) {
  const merged = { ...SLIDE_TYPES };

  try {
    const customTypes = await listPublishedCustomSlideTypes(ctx);
    for (const ct of customTypes) {
      merged[customSlideTypeKey(ct)] = toRuntimeSlideType(ct);
    }
  } catch (err) {
    log.warn('Failed to load custom slide types:', err.message || err);
  }

  return merged;
}
