/**
 * Admin-only JSON debug modal for viewing and editing raw slide data.
 * Includes tabs for:
 * 1. JSON Data - raw slide JSON with edit/save capability
 * 2. Schema - documented field definitions for the slide type
 */

import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/dom/toast.js';
import { confirmModal } from '../../../lib/dom/modal.js';

/**
 * Generate human-readable schema documentation from slide type definition.
 * @param {Object} def - Slide type definition with fields array
 * @param {string} slideType - The slide type key
 * @returns {string} - Formatted schema documentation
 */
function generateSchemaDoc(def, slideType) {
  if (!def) return `No schema found for slide type: ${slideType}`;

  const lines = [];
  lines.push(`# ${def.label || slideType}`);
  lines.push(`Type: "${slideType}"`);
  lines.push('');
  lines.push('## Fields');
  lines.push('');

  const fields = def.fields || [];
  if (!fields.length) {
    lines.push('No fields defined.');
    return lines.join('\n');
  }

  for (const field of fields) {
    const required = field.required ? ' (required)' : '';
    const maxLen = field.maxLength ? ` [max: ${field.maxLength}]` : '';

    lines.push(`### ${field.key}${required}`);
    lines.push(`- **Label:** ${field.label || field.key}`);
    lines.push(`- **Type:** ${field.type}${maxLen}`);

    if (field.helpText) {
      lines.push(`- **Help:** ${field.helpText}`);
    }

    if (field.placeholder) {
      lines.push(`- **Placeholder:** ${field.placeholder}`);
    }

    // Handle enum options
    if (field.type === 'enum' && field.options) {
      const opts = field.options.map(o => {
        if (typeof o === 'string') return `"${o}"`;
        return `"${o.value}" (${o.label})`;
      });
      lines.push(`- **Options:** ${opts.join(', ')}`);
    }

    // Handle items type (arrays)
    if (field.type === 'items' && field.itemFields) {
      if (field.minItems != null) lines.push(`- **Min items:** ${field.minItems}`);
      if (field.maxItems != null) lines.push(`- **Max items:** ${field.maxItems}`);
      lines.push('- **Item fields:**');
      for (const itemField of field.itemFields) {
        const itemReq = itemField.required ? ' (required)' : '';
        const itemMaxLen = itemField.maxLength ? ` [max: ${itemField.maxLength}]` : '';
        lines.push(`  - \`${itemField.key}\`: ${itemField.type}${itemReq}${itemMaxLen}`);
        if (itemField.type === 'enum' && itemField.options) {
          const itemOpts = itemField.options.map(o => typeof o === 'string' ? o : o.value);
          lines.push(`    Options: ${itemOpts.join(', ')}`);
        }
      }
    }

    lines.push('');
  }

  // Add defaults section
  const defaults = def.defaultsByLang || def.defaults;
  if (defaults) {
    lines.push('## Default Values');
    lines.push('');
    if (def.defaultsByLang) {
      for (const [lang, vals] of Object.entries(def.defaultsByLang)) {
        lines.push(`### ${lang}`);
        lines.push('```json');
        lines.push(JSON.stringify(vals, null, 2));
        lines.push('```');
        lines.push('');
      }
    } else if (def.defaults) {
      lines.push('```json');
      lines.push(JSON.stringify(def.defaults, null, 2));
      lines.push('```');
    }
  }

  return lines.join('\n');
}

/**
 * Simple syntax highlighting for JSON
 * @param {string} json - JSON string
 * @returns {string} - HTML with syntax highlighting
 */
function highlightJson(json) {
  return json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Keys
    .replace(/"([^"]+)":/g, '<span class="json-key">"$1"</span>:')
    // Strings (after keys to avoid double-matching)
    .replace(/: "((?:[^"\\]|\\.)*)"/g, ': <span class="json-string">"$1"</span>')
    // Numbers
    .replace(/: (-?\d+\.?\d*)/g, ': <span class="json-number">$1</span>')
    // Booleans and null
    .replace(/: (true|false|null)/g, ': <span class="json-bool">$1</span>');
}

/**
 * Open the JSON debug modal for a slide.
 * @param {Object} options
 * @param {Function} options.h - DOM helper
 * @param {HTMLElement} options.root - Root element to append modal to
 * @param {Object} options.slide - The slide object
 * @param {Object} options.SLIDE_TYPES - Slide type definitions
 * @param {Function} options.openOverlayClosers - Overlay registry
 * @param {Function} options.markDirty - Mark presentation dirty
 * @param {Function} options.rerenderEditor - Re-render editor
 * @param {Function} options.rerenderPreview - Re-render preview
 * @param {Function} options.rerenderSlideList - Re-render slide list
 */
export function openJsonDebugModal({
  h,
  root,
  slide,
  SLIDE_TYPES,
  openOverlayClosers,
  markDirty,
  rerenderEditor,
  rerenderPreview,
  rerenderSlideList,
}) {
  if (!slide) {
    toast.error('No slide selected');
    return;
  }

  const def = SLIDE_TYPES?.[slide.type];
  const overlay = h('div', { class: 'modal-overlay json-debug-overlay' });
  const modal = h('div', { class: 'modal json-debug-modal' });

  // Track current tab and edit state
  let hasUnsavedChanges = false;
  let editedJson = null;

  // Header
  const header = h('div', { class: 'json-debug-header' });
  const title = h('h3', { text: t('admin.jsonDebug.title', 'Slide JSON Debug') });
  const closeBtn = h('button', {
    class: 'btn btn-ghost btn-icon',
    type: 'button',
    'aria-label': t('common.close', 'Close'),
    text: '✕',
  });
  header.append(title, closeBtn);

  // Tabs
  const tabs = h('div', { class: 'json-debug-tabs' });
  const tabJson = h('button', {
    class: 'json-debug-tab is-active',
    type: 'button',
    text: t('admin.jsonDebug.tab.json', 'JSON Data'),
  });
  const tabSchema = h('button', {
    class: 'json-debug-tab',
    type: 'button',
    text: t('admin.jsonDebug.tab.schema', 'Schema'),
  });
  tabs.append(tabJson, tabSchema);

  // Content area
  const content = h('div', { class: 'json-debug-content' });

  // JSON tab content
  const jsonPanel = h('div', { class: 'json-debug-panel' });
  const jsonInfo = h('div', { class: 'json-debug-info help' });
  jsonInfo.innerHTML = `
    <strong>${t('admin.jsonDebug.slideType', 'Slide type')}:</strong> ${slide.type}<br>
    <strong>${t('admin.jsonDebug.slideId', 'Slide ID')}:</strong> <code>${slide.id}</code>
  `;

  const jsonTextarea = h('textarea', {
    class: 'json-debug-textarea form-input',
    spellcheck: 'false',
    autocomplete: 'off',
    autocorrect: 'off',
    autocapitalize: 'off',
  });
  jsonTextarea.value = JSON.stringify(slide, null, 2);

  const jsonError = h('div', { class: 'json-debug-error help' });
  jsonError.style.display = 'none';

  // Validate JSON as user types
  jsonTextarea.addEventListener('input', () => {
    hasUnsavedChanges = true;
    try {
      editedJson = JSON.parse(jsonTextarea.value);
      jsonError.style.display = 'none';
      jsonTextarea.classList.remove('is-invalid');
    } catch (e) {
      jsonError.textContent = t('editor.jsonDebug.parseError', 'JSON error: {message}', { message: e.message });
      jsonError.style.display = 'block';
      jsonTextarea.classList.add('is-invalid');
      editedJson = null;
    }
  });

  // Action buttons for JSON tab
  const jsonActions = h('div', { class: 'json-debug-actions row' });

  const copyBtn = h('button', {
    class: 'btn btn-secondary',
    type: 'button',
    text: t('admin.jsonDebug.copy', 'Copy JSON'),
  });
  copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(jsonTextarea.value);
      toast.success(t('admin.jsonDebug.copied', 'JSON copied to clipboard'));
    } catch (e) {
      toast.error('Failed to copy');
    }
  };

  const formatBtn = h('button', {
    class: 'btn btn-secondary',
    type: 'button',
    text: t('admin.jsonDebug.format', 'Format'),
  });
  formatBtn.onclick = () => {
    try {
      const parsed = JSON.parse(jsonTextarea.value);
      jsonTextarea.value = JSON.stringify(parsed, null, 2);
      jsonError.style.display = 'none';
      jsonTextarea.classList.remove('is-invalid');
    } catch (e) {
      jsonError.textContent = t('editor.jsonDebug.parseError', 'JSON error: {message}', { message: e.message });
      jsonError.style.display = 'block';
    }
  };

  const resetBtn = h('button', {
    class: 'btn btn-secondary',
    type: 'button',
    text: t('admin.jsonDebug.reset', 'Reset'),
  });
  resetBtn.onclick = () => {
    jsonTextarea.value = JSON.stringify(slide, null, 2);
    jsonError.style.display = 'none';
    jsonTextarea.classList.remove('is-invalid');
    hasUnsavedChanges = false;
    editedJson = null;
  };

  const saveBtn = h('button', {
    class: 'btn btn-primary',
    type: 'button',
    text: t('admin.jsonDebug.save', 'Apply Changes'),
  });
  saveBtn.onclick = async () => {
    if (!editedJson) {
      try {
        editedJson = JSON.parse(jsonTextarea.value);
      } catch (e) {
        toast.error(`Invalid JSON: ${e.message}`);
        return;
      }
    }

    // Validate basic structure
    if (!editedJson.id || !editedJson.type) {
      toast.error(t('admin.jsonDebug.error.missingFields', 'Slide must have id and type'));
      return;
    }

    // Warn about ID changes
    if (editedJson.id !== slide.id) {
      const ok = await confirmModal(h, document.body, {
        title: t('admin.jsonDebug.warn.idChangeTitle', 'Change slide ID?'),
        message: t('admin.jsonDebug.warn.idChange', 'Warning: You are changing the slide ID. This may cause issues. Continue?'),
        confirmLabel: t('common.continue', 'Continue'),
        danger: true,
      });
      if (!ok) return;
    }

    // Warn about type changes
    if (editedJson.type !== slide.type) {
      const ok = await confirmModal(h, document.body, {
        title: t('admin.jsonDebug.warn.typeChangeTitle', 'Change slide type?'),
        message: t('admin.jsonDebug.warn.typeChange', 'Warning: You are changing the slide type. The content may not render correctly. Continue?'),
        confirmLabel: t('common.continue', 'Continue'),
        danger: true,
      });
      if (!ok) return;
    }

    // Apply changes to the slide object
    Object.keys(slide).forEach(key => {
      if (!(key in editedJson)) {
        delete slide[key];
      }
    });
    Object.assign(slide, editedJson);

    markDirty?.();
    rerenderEditor?.();
    rerenderPreview?.();
    rerenderSlideList?.();

    hasUnsavedChanges = false;
    toast.success(t('admin.jsonDebug.saved', 'Changes applied'));
  };

  jsonActions.append(copyBtn, formatBtn, resetBtn, saveBtn);
  jsonPanel.append(jsonInfo, jsonTextarea, jsonError, jsonActions);

  // Schema tab content
  const schemaPanel = h('div', { class: 'json-debug-panel', style: 'display: none;' });
  const schemaContent = h('div', { class: 'json-debug-schema' });

  // Generate and render schema documentation
  const schemaDoc = generateSchemaDoc(def, slide.type);
  schemaContent.innerHTML = renderSchemaAsHtml(schemaDoc);

  const schemaCopyBtn = h('button', {
    class: 'btn btn-secondary',
    type: 'button',
    text: t('admin.jsonDebug.copySchema', 'Copy Schema'),
  });
  schemaCopyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(schemaDoc);
      toast.success(t('admin.jsonDebug.schemaCopied', 'Schema copied to clipboard'));
    } catch (e) {
      toast.error('Failed to copy');
    }
  };

  const schemaActions = h('div', { class: 'json-debug-actions row' });
  schemaActions.append(schemaCopyBtn);
  schemaPanel.append(schemaContent, schemaActions);

  // Tab switching
  const switchTab = (tab) => {
    tabJson.classList.toggle('is-active', tab === 'json');
    tabSchema.classList.toggle('is-active', tab === 'schema');
    jsonPanel.style.display = tab === 'json' ? '' : 'none';
    schemaPanel.style.display = tab === 'schema' ? '' : 'none';
  };

  tabJson.onclick = () => switchTab('json');
  tabSchema.onclick = () => switchTab('schema');

  content.append(jsonPanel, schemaPanel);
  modal.append(header, tabs, content);
  overlay.append(modal);

  // Close handler (defined first so it can be referenced)
  let close;

  // ESC key to close
  const onKeydown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  close = async () => {
    if (hasUnsavedChanges) {
      const ok = await confirmModal(h, document.body, {
        title: t('admin.jsonDebug.unsavedChangesTitle', 'Unsaved changes'),
        message: t('admin.jsonDebug.unsavedChanges', 'You have unsaved changes. Close anyway?'),
        confirmLabel: t('common.close', 'Close'),
        danger: true,
      });
      if (!ok) return;
    }
    document.removeEventListener('keydown', onKeydown);
    openOverlayClosers?.delete?.(close);
    overlay.remove();
  };

  document.addEventListener('keydown', onKeydown);

  // Register with overlay registry so it can be closed externally
  openOverlayClosers?.add?.(close);

  closeBtn.onclick = close;
  overlay.onclick = (e) => {
    if (e.target === overlay) close();
  };

  document.body.append(overlay);
  jsonTextarea.focus();
}

/**
 * Convert markdown-ish schema doc to simple HTML
 */
function renderSchemaAsHtml(markdown) {
  return markdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Headers
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // Code blocks
    .replace(/```json\n([\s\S]*?)```/g, (_, code) => `<pre class="json-debug-code">${highlightJson(code.trim())}</pre>`)
    .replace(/```([\s\S]*?)```/g, '<pre class="json-debug-code">$1</pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // List items
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^ {2}- (.+)$/gm, '<li class="nested">$1</li>')
    // Wrap consecutive list items
    .replace(/(<li[^>]*>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    // Line breaks for remaining text
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
}