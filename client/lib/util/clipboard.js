/**
 * Shared clipboard utility with multiple fallback strategies.
 * Used across the application for consistent clipboard operations.
 */

import { createModal, createTextArea } from '../dom/modal.js';
import { h } from '../dom.js';
import { t } from '../ui-i18n.js';

/**
 * Copy text to the clipboard with fallbacks for older browsers.
 * @param {string} text - Text to copy
 * @returns {Promise<boolean>} True if copy succeeded
 */
export async function copyToClipboard(text) {
  const t = String(text ?? '');
  try {
    await navigator.clipboard?.writeText?.(t);
    return true;
  } catch {
    // Fallback: execCommand (best-effort for older Safari / blocked clipboard API)
    try {
      const ta = document.createElement('textarea');
      ta.value = t;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return Boolean(ok);
    } catch {
      return false;
    }
  }
}

/**
 * Show an accessible read-only modal with the text pre-selected, so the user
 * can copy it manually. Used as a last-resort fallback when the Clipboard API
 * and execCommand both fail (e.g. non-secure context).
 * @param {string} text - Text to display for manual copy
 * @param {string} [label] - Modal title
 */
export function showCopyFallbackModal(text, label) {
  const modalApi = createModal(h, { title: label || t('common.copy', 'Copy') });
  const hint = h('div', {
    class: 'help',
    text: t('common.copyManualHint', 'Select the text below and copy it manually (Ctrl/Cmd+C).'),
  });
  const field = createTextArea(h, { value: String(text ?? ''), minHeight: '160px' });
  field.textarea.readOnly = true;
  const actions = h('div', { class: 'row is-end is-mt-8' });
  actions.append(
    h('button', {
      class: 'btn btn-primary',
      text: t('common.done', 'Done'),
      onclick: () => modalApi.close(),
    })
  );
  modalApi.content.append(hint, field.wrap, actions);
  modalApi.show(document.body);
  try {
    field.textarea.focus();
    field.textarea.select();
  } catch {
    // ignore
  }
}

/**
 * Copy text to the clipboard with an accessible modal fallback if copy fails.
 * @param {string} text - Text to copy
 * @param {string} [promptLabel] - Title for the fallback modal
 * @returns {Promise<boolean>} True if copy succeeded (without needing the fallback)
 */
export async function copyToClipboardWithPromptFallback(text, promptLabel) {
  const ok = await copyToClipboard(text);
  if (!ok) {
    showCopyFallbackModal(String(text ?? ''), promptLabel);
  }
  return ok;
}