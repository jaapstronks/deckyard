/**
 * Slide Type Preview Component
 *
 * Live preview of a custom slide type's template rendering. It compiles through
 * the same seam the deck does — `createTemplateSlideRenderer` — so the markup
 * and the scoped author CSS in this iframe are the markup and CSS
 * `toRuntimeSlideType` produces for the very same definition; a test pins that
 * equality (`tests/slide-type-preview-parity.test.js`).
 *
 * Until B192 this file carried its own regex mini-implementation of the
 * template language and injected the author CSS unscoped into the iframe head,
 * so a maker could get `{{#if}}` right in the preview and wrong in a deck, and
 * a `body { … }` rule that the real path contains would restyle the preview.
 *
 * What the iframe still does *not* reproduce is the deck around the slide: no
 * theme tokens, no deck stylesheet, just neutral chrome. The slide is what this
 * screen is for; the theme is picked elsewhere.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { escapeHtml } from '../../../../shared/slide-types/helpers.js';
import {
  createTemplateSlideRenderer,
  customSlideTypeRootClass,
} from '../../../../shared/slide-types/custom-type-runtime.js';

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
   * @param {string} [state.slug] - Type slug; sets the CSS scope root
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
    const defaults =
      state?.defaults && typeof state.defaults === 'object'
        ? state.defaults
        : {};

    if (!template) {
      writeIframe(
        buildMessageHtml(
          t('settings.slideTypes.preview.noTemplate', 'No template defined'),
        ),
      );
      return;
    }

    let html;
    try {
      html = renderPreviewSlide({
        template,
        css,
        slug: state?.slug,
        fields,
        defaults,
      });
    } catch (err) {
      // The maker is the only one who ever sees this template, so the failure
      // belongs on this screen rather than in a console they do not have open.
      writeIframe(
        buildMessageHtml(
          `${t('settings.slideTypes.preview.error', 'Preview failed')}: ${
            err?.message || err
          }`,
        ),
      );
      return;
    }

    writeIframe(buildSlideHtml(html));
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

  function buildMessageHtml(message) {
    return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  body { margin: 0; display: flex; align-items: center; justify-content: center;
         height: 100vh; font-family: system-ui, sans-serif; color: #888;
         background: #f8f9fa; }
  p { text-align: center; font-size: 14px; padding: 0 1em; }
</style></head>
<body><p>${escapeHtml(message)}</p></body></html>`;
  }

  /**
   * Neutral chrome around the rendered slide. The author's own CSS is *not*
   * injected here — it travels inside `bodyHtml` as a scoped `<style>` block,
   * exactly as it does in a deck.
   * @param {string} bodyHtml - Output of the shared renderer
   * @returns {string}
   */
  function buildSlideHtml(bodyHtml) {
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
</style></head>
<body>${bodyHtml}</body></html>`;
  }

  return { el: container, update };
}

/**
 * The slide markup the preview shows for one draft definition — the whole of
 * what this screen renders, minus the neutral iframe chrome.
 *
 * Exported so it can be pinned against `toRuntimeSlideType` without a DOM:
 * `tests/slide-type-preview-parity.test.js` asserts the two produce byte-equal
 * markup and CSS for the same definition. That equality *is* the feature; a
 * preview drifting from the deck was the whole of B192.
 *
 * @param {Object} draft - The definition as the editor currently holds it
 * @param {string} draft.template - Template source
 * @param {string} [draft.css] - Author CSS, unfiltered and unscoped
 * @param {string} [draft.slug] - Type slug; sets the CSS scope root
 * @param {Array} [draft.fields] - Field definitions, for sample content
 * @param {Object} [draft.defaults] - Default values, preferred over samples
 * @returns {string} Slide markup with its scoped `<style>` block
 */
export function renderPreviewSlide({
  template,
  css,
  slug,
  fields = [],
  defaults = {},
}) {
  const render = createTemplateSlideRenderer({
    template,
    css,
    rootClass: customSlideTypeRootClass({ slug }),
  });
  return render(sampleContent(fields, defaults));
}

/**
 * Stand-in slide content: the type's own defaults where it has them, a
 * type-shaped placeholder where it does not.
 * @param {Array} fields - Field definitions
 * @param {Object} defaults - Default values
 * @returns {Object}
 */
function sampleContent(fields, defaults) {
  const content = {};
  for (const f of fields) {
    const key = f.key;
    content[key] = defaults[key] != null ? defaults[key] : getSampleValue(f);
  }
  return content;
}

function getSampleValue(field) {
  switch (field.type) {
    case 'string':
      return field.placeholder || field.label || 'Sample text';
    case 'markdown':
      return field.placeholder || `**${field.label || 'Sample'}** content`;
    case 'image':
      return '';
    case 'images':
      return [];
    case 'enum':
      return Array.isArray(field.options) && field.options.length
        ? field.options[0]
        : '';
    case 'items':
      return [];
    default:
      return '';
  }
}
