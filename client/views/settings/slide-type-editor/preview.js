/**
 * Slide Type Preview Component
 * Live preview of a custom slide type's template rendering.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { esc as escapeHtml } from '../../../../shared/slide-types/helpers.js';

/**
 * Create a slide type preview component.
 * Renders template + CSS in an iframe with 16:9 aspect ratio.
 * @returns {{ el: HTMLElement, update: Function }}
 */
export function createSlideTypePreview() {
  const container = h('div', { class: 'slide-type-preview-container' });
  const wrapper = h('div', { class: 'slide-type-preview-wrapper' });
  const iframe = h('iframe', {
    class: 'slide-type-preview-iframe',
    sandbox: 'allow-same-origin',
    title: t('settings.slideTypes.preview.title', 'Slide type preview'),
  });

  wrapper.append(iframe);
  container.append(wrapper);

  let debounceTimer = null;

  /**
   * Update the preview with current state.
   * @param {Object} state
   * @param {string} [state.template] - HTML template
   * @param {string} [state.css] - Custom CSS
   * @param {Array} [state.fields] - Field definitions
   * @param {Object} [state.defaults] - Default values
   */
  function update(state) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => renderPreview(state), 300);
  }

  function renderPreview(state) {
    const template = state?.template || '';
    const css = state?.css || '';
    const fields = Array.isArray(state?.fields) ? state.fields : [];
    const defaults = state?.defaults && typeof state.defaults === 'object' ? state.defaults : {};

    if (!template) {
      writeIframe(buildPlaceholderHtml());
      return;
    }

    // Build sample data from defaults and field definitions
    const sampleData = {};
    for (const f of fields) {
      const key = f.key;
      if (defaults[key] != null) {
        sampleData[key] = defaults[key];
      } else {
        sampleData[key] = getSampleValue(f);
      }
    }

    // Simple template rendering: replace placeholders
    let html = template;

    // Handle {{#if key}}...{{/if}}
    html = html.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, content) => {
      return sampleData[key] ? content : '';
    });

    // Handle {{#each key}}...{{/each}}
    html = html.replace(/\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_, key, content) => {
      const items = Array.isArray(sampleData[key]) ? sampleData[key] : [];
      return items.map(item => {
        let row = content;
        if (item && typeof item === 'object') {
          for (const [k, v] of Object.entries(item)) {
            row = row.replace(new RegExp(`\\{\\{(?:esc\\s+)?${escapeRegExp(k)}\\}\\}`, 'g'), escapeHtml(String(v ?? '')));
            row = row.replace(new RegExp(`\\{\\{markdown\\s+${escapeRegExp(k)}\\}\\}`, 'g'), String(v ?? ''));
          }
        }
        return row;
      }).join('');
    });

    // Handle {{esc key}}, {{markdown key}}, {{key}}
    html = html.replace(/\{\{(?:esc\s+)?(\w+)\}\}/g, (_, key) => {
      return escapeHtml(String(sampleData[key] ?? ''));
    });
    html = html.replace(/\{\{markdown\s+(\w+)\}\}/g, (_, key) => {
      return String(sampleData[key] ?? '');
    });

    writeIframe(buildSlideHtml(html, css));
  }

  function writeIframe(htmlContent) {
    try {
      const doc = iframe.contentDocument;
      if (doc) {
        doc.open();
        doc.write(htmlContent);
        doc.close();
      }
    } catch {
      // cross-origin restrictions, ignore
    }
  }

  function buildPlaceholderHtml() {
    return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  body { margin: 0; display: flex; align-items: center; justify-content: center;
         height: 100vh; font-family: system-ui, sans-serif; color: #888;
         background: #f8f9fa; }
  p { text-align: center; font-size: 14px; }
</style></head>
<body><p>${escapeHtml(t('settings.slideTypes.preview.noTemplate', 'No template defined'))}</p></body></html>`;
  }

  function buildSlideHtml(bodyHtml, css) {
    return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; padding: 5% 6%; font-family: system-ui, sans-serif;
         font-size: 14px; line-height: 1.5; color: #1f2937; background: #fff;
         min-height: 100vh; }
  img { max-width: 100%; height: auto; }
  h1, h2, h3 { margin: 0 0 0.5em; }
  p { margin: 0 0 0.5em; }
  ${css}
</style></head>
<body>${bodyHtml}</body></html>`;
  }

  return { el: container, update };
}

function getSampleValue(field) {
  switch (field.type) {
    case 'string': return field.placeholder || field.label || 'Sample text';
    case 'markdown': return field.placeholder || `**${field.label || 'Sample'}** content`;
    case 'image': return '';
    case 'images': return [];
    case 'enum': return Array.isArray(field.options) && field.options.length ? field.options[0] : '';
    case 'items': return [];
    default: return '';
  }
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
