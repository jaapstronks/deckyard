/**
 * Custom Slide Type Runtime
 *
 * Converts database-stored custom slide type definitions into runtime
 * slide type objects that can be merged into the SLIDE_TYPES map.
 *
 * Custom types with templates get a compiled renderHtml function.
 * Custom types without templates fall back to their baseType's renderer.
 */

import { SLIDE_TYPES } from '../../shared/slide-types.js';
import { compileTemplate } from './slide-template-compiler.js';
import { esc } from '../../shared/slide-types/helpers.js';
import { listPublishedCustomSlideTypes } from '../storage/custom-slide-types.js';

function sanitizeCss(css) {
  if (!css) return '';
  // Prevent breaking out of style tag
  return css.replace(/<\/style/gi, '<\\/style');
}

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
    // Compile the safe template into a renderHtml function
    const render = compileTemplate(ct.template);
    def.renderHtml = (content, slide, ctx) => {
      // Inject custom CSS as a scoped <style> block
      const cssBlock = ct.css
        ? `<style>${sanitizeCss(ct.css)}</style>`
        : '';
      return cssBlock + render(content || {});
    };
  } else if (ct.baseType && SLIDE_TYPES[ct.baseType]) {
    // Fall back to the base type's renderer
    def.renderHtml = SLIDE_TYPES[ct.baseType].renderHtml;
  } else {
    // Last resort: render a basic content block
    def.renderHtml = (content) => {
      const title = esc(String(content?.title || ct.label || ''));
      const body = esc(String(content?.body || ''));
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
 * Build a merged slide types map that includes both core and custom types.
 * Used by server-side rendering (exports, previews, share viewer).
 *
 * @param {Object} ctx - Context with organizationId
 * @returns {Promise<Object>} Merged slide types map
 */
export async function buildMergedSlideTypes(ctx) {
  const merged = { ...SLIDE_TYPES };

  try {
    const customTypes = await listPublishedCustomSlideTypes(ctx);
    for (const ct of customTypes) {
      const typeKey = `custom-${ct.slug}`;
      merged[typeKey] = toRuntimeSlideType(ct);
    }
  } catch (err) {
    console.warn('Failed to load custom slide types:', err.message || err);
  }

  return merged;
}
