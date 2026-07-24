import { h } from '../../../../lib/dom.js';
import { t } from '../../../../lib/ui-i18n.js';
import { createCurationThumbnail } from './curation-thumbnails.js';

/**
 * Open the full-screen lightbox preview for a core slide type, with prev/next
 * navigation across the catalog, an enabled-in-picker toggle synced back to the
 * grid card, and a "duplicate as custom type" action.
 *
 * @param {string} type - the slide type key to open on
 * @param {Array<{type:string, category:string}>} allTypesList - navigable catalog
 * @param {object} ctx
 * @param {Object} ctx.slideTypeMeta - type key -> metadata
 * @param {Set<string>} ctx.disabledTypes - mutated as the toggle flips
 * @param {HTMLElement} ctx.curationSection - grid container, to sync the card
 * @param {object|null} ctx.theme - resolved theme for thumbnail rendering
 * @param {Function} ctx.saveCuration - debounced persist of disabledTypes
 * @param {Function} ctx.duplicateCoreType - (typeKey, meta) => open editor
 */
export function openTypePreview(type, allTypesList, ctx) {
  const { slideTypeMeta, disabledTypes, curationSection, theme, saveCuration, duplicateCoreType } = ctx;

  let currentIdx = allTypesList.findIndex(entry => entry.type === type);
  if (currentIdx < 0) currentIdx = 0;

  // Backdrop
  const backdrop = h('div', { class: 'slide-type-preview-backdrop' });

  // Modal
  const modal = h('div', { class: 'slide-type-preview-modal' });

  // Header
  const header = h('div', { class: 'slide-type-preview-header' });
  const titleWrap = h('div', { class: 'slide-type-preview-title-wrap' });
  const nameEl = h('span', { class: 'slide-type-preview-name' });
  const keyEl = h('span', { class: 'slide-type-preview-key' });
  titleWrap.append(nameEl, keyEl);

  const navWrap = h('div', { class: 'slide-type-preview-nav' });
  const prevBtn = h('button', {
    class: 'btn btn-secondary btn-sm btn-icon',
    type: 'button',
    'aria-label': t('common.previous', 'Previous'),
    onclick: () => navigate(-1),
  });
  prevBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>`;

  const counterEl = h('span', { class: 'slide-type-preview-counter' });

  const nextBtn = h('button', {
    class: 'btn btn-secondary btn-sm btn-icon',
    type: 'button',
    'aria-label': t('common.next', 'Next'),
    onclick: () => navigate(1),
  });
  nextBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>`;

  navWrap.append(prevBtn, counterEl, nextBtn);

  const closeBtn = h('button', {
    class: 'btn btn-secondary btn-sm btn-icon',
    type: 'button',
    'aria-label': t('common.close', 'Close'),
    onclick: close,
  });
  closeBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>`;

  header.append(titleWrap, navWrap, closeBtn);

  // Stage
  const stage = h('div', { class: 'slide-type-preview-stage' });

  // Footer
  const footer = h('div', { class: 'slide-type-preview-footer' });
  const toggleLabel = h('label', { class: 'slide-type-preview-toggle' });
  const toggleCheckbox = h('input', { type: 'checkbox' });
  const toggleText = h('span', { text: t('settings.slideTypes.enabledInPicker', 'Enabled in picker') });
  toggleLabel.append(toggleCheckbox, toggleText);

  toggleCheckbox.addEventListener('change', () => {
    const entry = allTypesList[currentIdx];
    if (toggleCheckbox.checked) {
      disabledTypes.delete(entry.type);
    } else {
      disabledTypes.add(entry.type);
    }
    // Sync grid card
    const gridCard = curationSection.querySelector(`[data-type="${entry.type}"]`);
    if (gridCard) {
      gridCard.classList.toggle('is-disabled', !toggleCheckbox.checked);
      const gridToggle = gridCard.querySelector('input[type="checkbox"]');
      if (gridToggle) gridToggle.checked = toggleCheckbox.checked;
    }
    saveCuration();
  });

  const dupBtn = h('button', {
    class: 'btn btn-secondary btn-sm',
    type: 'button',
    text: t('settings.slideTypes.duplicateAsCustom', 'Duplicate as custom type'),
    onclick: () => {
      const entry = allTypesList[currentIdx];
      const meta = slideTypeMeta[entry.type];
      close();
      duplicateCoreType(entry.type, meta);
    },
  });

  footer.append(toggleLabel, dupBtn);

  // Assemble
  modal.append(header, stage, footer);
  backdrop.append(modal);

  function renderCurrent() {
    const entry = allTypesList[currentIdx];
    const meta = slideTypeMeta[entry.type];

    nameEl.textContent = meta?.label || entry.type;
    keyEl.textContent = entry.type;
    counterEl.textContent = `${currentIdx + 1} / ${allTypesList.length}`;

    stage.innerHTML = '';
    stage.append(createCurationThumbnail(entry.type, 'slide-type-preview-thumb', theme));

    toggleCheckbox.checked = !disabledTypes.has(entry.type);
  }

  function navigate(delta) {
    currentIdx = (currentIdx + delta + allTypesList.length) % allTypesList.length;
    renderCurrent();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { close(); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { navigate(-1); e.preventDefault(); }
    if (e.key === 'ArrowRight') { navigate(1); e.preventDefault(); }
  }

  function close() {
    document.removeEventListener('keydown', onKeyDown);
    backdrop.remove();
  }

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  document.addEventListener('keydown', onKeyDown);
  document.body.append(backdrop);
  renderCurrent();
}
