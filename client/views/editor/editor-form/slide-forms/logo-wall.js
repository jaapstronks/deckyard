import { t } from '../../../../lib/ui-i18n.js';
import { MAX_LOGOS } from '../../../../../shared/slide-types/types/logo-wall-slide.js';
import { dragHandleIcon, chevronDownIcon } from '../../../../lib/dom/icons.js';
import { createCollapsedState } from '../../../../lib/slide-authoring/collapsed-state.js';
import { collapseAllToggle } from '../../fields/collapse-all-toggle.js';
import { fieldCardLink } from '../../fields/card-link-field.js';

// Collapsed state manager for logo blocks
const logoBlocksState = createCollapsedState('logo');

/**
 * Sync logos[] back to numbered fields for backward compatibility.
 * This ensures older code paths and the renderer can use either format.
 */
function syncToNumbered(slide) {
  const logos = slide.content.logos || [];
  // logoCount is a strictly validated legacy enum (1..12): cap it. Walls
  // beyond 12 logos live in logos[] only; the numbered mirror carries the
  // first 12 for old code paths.
  slide.content.logoCount = String(Math.min(logos.length, 12) || 1);
  for (let i = 0; i < 12; i++) {
    const l = logos[i] || {};
    slide.content[`logo${i + 1}Image`] = l.image || '';
    slide.content[`logo${i + 1}Name`] = l.name || '';
    slide.content[`logo${i + 1}Alt`] = l.alt || '';
    slide.content[`logo${i + 1}Link`] = l.link || '';
  }
}

export function renderLogoWallForm({
  h,
  form,
  slide,
  add,
  used,
  fieldGrid,
  fieldText,
  fieldImage,
  deckSlides = [],
  markDirty,
  rerenderEditor,
  scheduleUiRefresh,
} = {}) {
  add('title');
  add('subheading');

  const MAX = MAX_LOGOS;
  const LEGACY_MAX = 12;

  // Mark all logo-related fields as used (hide from generic renderer)
  used.add('logos');
  used.add('logoCount');
  for (let i = 1; i <= LEGACY_MAX; i += 1) {
    used.add(`logo${i}Image`);
    used.add(`logo${i}Name`);
    used.add(`logo${i}Alt`);
    used.add(`logo${i}Link`);
  }

  // Normalize: if no logos[] but numbered fields exist, build logos on the fly
  if (!Array.isArray(slide.content.logos) || slide.content.logos.length === 0) {
    const count = Math.max(1, Math.min(LEGACY_MAX, Number(slide.content.logoCount || 1)));
    const logos = [];
    for (let i = 1; i <= count; i++) {
      if (slide.content[`logo${i}Name`] || slide.content[`logo${i}Image`]) {
        logos.push({
          image: slide.content[`logo${i}Image`] || '',
          name: slide.content[`logo${i}Name`] || '',
          alt: slide.content[`logo${i}Alt`] || '',
          link: slide.content[`logo${i}Link`] || '',
        });
      }
    }
    slide.content.logos = logos.length > 0 ? logos : [{ image: '', name: '', alt: '' }];
  }

  const logos = slide.content.logos;
  const count = logos.length;

  // Swap two logos in logos[]
  function swapLogos(fromIdx, toIdx) {
    // Convert 1-based indices to 0-based
    const from = fromIdx - 1;
    const to = toIdx - 1;
    const [moved] = logos.splice(from, 1);
    logos.splice(to, 0, moved);
    syncToNumbered(slide);
    markDirty?.();
    rerenderEditor?.();
    scheduleUiRefresh?.();
  }

  const controls = h('div', { class: 'stack' });
  controls.append(h('div', { class: 'field-label', text: t('editor.logoWall.logos', "Logo's") }));
  const controlsRow = h('div', { class: 'row is-wrap' });

  const addLogo = () => {
    if (count >= MAX) return;
    logos.push({
      image: '',
      name: t('editor.logoWall.placeholderName', 'Logo'),
      alt: '',
      link: '',
    });
    syncToNumbered(slide);
    markDirty?.();
    rerenderEditor?.();
    scheduleUiRefresh?.();
  };

  controlsRow.append(
    h('button', {
      class: 'btn btn-secondary',
      text: t('editor.logoWall.addLogo', '+ Logo toevoegen'),
      disabled: count >= MAX,
      onclick: () => addLogo(),
    }),
    h('div', { class: 'pill', text: `${count} / ${MAX}` })
  );
  const bulkToggle = collapseAllToggle({
    state: logoBlocksState,
    keys: Array.from({ length: count }, (_, idx) => logoBlocksState.getKey(slide.id, idx + 1)),
    rerender: rerenderEditor,
  });
  if (bulkToggle) controlsRow.append(bulkToggle);
  controls.append(controlsRow);
  form.append(controls);

  // Logos container for drag and drop
  const logosContainer = h('div', { class: 'items-reorder-list logo-blocks-list' });

  // Drag state tracking
  let draggingLogoIndex = null;
  let dropTargetIndex = null;

  const clearDropIndicators = () => {
    for (const el of logosContainer.querySelectorAll('.card-group.is-drop-before, .card-group.is-drop-after')) {
      el.classList.remove('is-drop-before', 'is-drop-after');
    }
    dropTargetIndex = null;
  };

  for (let i = 1; i <= count; i += 1) {
    // Get collapsed state for this block
    const blockKey = logoBlocksState.getKey(slide.id, i);
    const isCollapsed = logoBlocksState.isCollapsed(blockKey);

    const wrap = h('div', { class: 'stack card-group' });
    wrap.dataset.logoIndex = String(i);
    if (isCollapsed) {
      wrap.classList.add('is-collapsed');
    }

    // Logo header with drag handle, collapse toggle, title, and remove button
    const header = h('div', { class: 'row spread card-group-header' });

    // Left side: drag handle + collapse toggle + title
    const headerLeft = h('div', { class: 'card-group-header-left' });

    // Drag handle
    const dragHandle = h('button', {
      type: 'button',
      class: 'item-drag-handle',
      title: t('editor.logoWall.dragToReorder', 'Drag to reorder'),
      draggable: 'true',
    });
    dragHandle.appendChild(dragHandleIcon());

    // Drag events on the handle
    dragHandle.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', String(i));
      e.dataTransfer.effectAllowed = 'move';
      draggingLogoIndex = i;
      wrap.classList.add('is-dragging');
    });

    dragHandle.addEventListener('dragend', () => {
      draggingLogoIndex = null;
      wrap.classList.remove('is-dragging');
      clearDropIndicators();
    });

    // Subtle index badge on drag handle
    const indexBadge = h('span', { class: 'item-index-badge' });
    indexBadge.textContent = String(i);
    dragHandle.appendChild(indexBadge);

    headerLeft.append(dragHandle);

    // Collapse/expand toggle button
    const collapseBtn = h('button', {
      type: 'button',
      class: 'row-collapse-toggle',
      title: isCollapsed
        ? t('editor.logoWall.expand', 'Expand')
        : t('editor.logoWall.collapse', 'Collapse'),
    });
    collapseBtn.appendChild(chevronDownIcon());
    collapseBtn.addEventListener('click', (e) => {
      e.preventDefault();
      logoBlocksState.toggle(blockKey);
      rerenderEditor?.();
    });
    headerLeft.append(collapseBtn);

    // Show logo name as header (falls back to placeholder)
    const logoName = logos[i - 1]?.name || '';
    const titlePreview = h('div', {
      class: `card-group-title item-title-preview${logoName ? '' : ' is-placeholder'}`,
      text: logoName || t('editor.logoWall.untitledLogo', 'Untitled logo'),
    });
    headerLeft.append(titlePreview);

    header.append(headerLeft);

    // Remove button (right side)
    if (count > 1) {
      header.append(
        h('button', {
          class: 'btn btn-secondary btn-icon card-remove-btn',
          type: 'button',
          text: '×',
          title: t('editor.logoWall.removeLogoN', 'Remove logo {n}', { n: i }),
          'aria-label': t('editor.logoWall.removeLogoN', 'Remove logo {n}', { n: i }),
          onclick: () => {
            if (logos.length <= 1) return;
            logos.splice(i - 1, 1);
            syncToNumbered(slide);
            markDirty?.();
            rerenderEditor?.();
            scheduleUiRefresh?.();
          },
        })
      );
    }
    wrap.append(header);

    // Collapsible content container
    const content = h('div', { class: 'block-collapsible-content' });
    if (isCollapsed) {
      content.style.display = 'none';
    }

    // Use 0-based index into logos[]
    const idx = i - 1;
    const logo = logos[idx] || {};

    const imgField = fieldImage(
      slide,
      { key: `logo${i}Image`, label: t('editor.logoWall.image', 'Logo afbeelding'), type: 'image' },
      (url) => {
        logo.image = url;
        syncToNumbered(slide);
        markDirty?.();
        rerenderEditor?.();
        scheduleUiRefresh?.();
      }
    );

    const nameField = fieldText(
      t('editor.logoWall.name', 'Naam'),
      logo.name || '',
      (v) => {
        logo.name = v;
        syncToNumbered(slide);
        markDirty?.();
        scheduleUiRefresh?.();
      }
    );

    // Custom alt field that writes to the logo object
    const altWrap = h('div', { class: 'stack' });
    altWrap.append(
      h('div', {
        class: 'field-label',
        text: t('editor.logoWall.altText', 'Alt text (optional)'),
      })
    );
    const altInput = h('input', {
      type: 'text',
      class: 'form-input',
      maxlength: 180,
      value: logo.alt || '',
    });
    altInput.addEventListener('input', () => {
      logo.alt = altInput.value;
      syncToNumbered(slide);
      markDirty?.();
      scheduleUiRefresh?.();
    });
    altWrap.append(altInput);

    const linkField = fieldCardLink({
      value: logo.link || '',
      slides: deckSlides,
      onChange: (v) => {
        logo.link = v;
        syncToNumbered(slide);
        markDirty?.();
        scheduleUiRefresh?.();
      },
      help: t(
        'editor.cards.linkHelp2',
        'Makes the card clickable. Pick a slide to jump to, or type an https:// / mailto: link (opens in a new tab).'
      ),
    });

    content.append(imgField);
    content.append(fieldGrid([nameField, altWrap], 2));
    content.append(linkField);

    wrap.append(content);

    // Drag over handling on the wrapper (works in collapsed mode too)
    wrap.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (draggingLogoIndex === null || draggingLogoIndex === i) {
        clearDropIndicators();
        return;
      }

      const rect = wrap.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const pos = e.clientY < midY ? 'before' : 'after';

      clearDropIndicators();
      wrap.classList.add(`is-drop-${pos}`);
      dropTargetIndex = i;
    });

    wrap.addEventListener('dragleave', (e) => {
      if (e.currentTarget?.contains?.(e.relatedTarget)) return;
      if (dropTargetIndex === i) clearDropIndicators();
    });

    wrap.addEventListener('drop', (e) => {
      e.preventDefault();
      const fromIndex = draggingLogoIndex;
      const toIndex = i;

      if (fromIndex && fromIndex !== toIndex) {
        swapLogos(fromIndex, toIndex);
      }

      draggingLogoIndex = null;
      clearDropIndicators();
    });

    logosContainer.append(wrap);
  }

  form.append(logosContainer);
}
