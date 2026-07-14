import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/toast.js';
import { createSlideLibraryPicker } from '../../../lib/slide-library/index.js';

export function openSlideLibraryModal({
  h,
  root,
  api,
  nav,
  openOverlayClosers,
} = {}) {
  const backdrop = h('div', { class: 'modal-backdrop ps-modal-overlay' });
  const modal = h('div', { class: 'modal ps-modal slide-library-modal' });
  const header = h('div', { class: 'ps-modal-header' });
  const title = h('h2', {
    text: t('slideLibrary.modal.title', 'Slide library'),
  });
  const closeBtn = h(
    'button',
    {
      class: 'btn btn-secondary btn-icon ps-modal-close',
      type: 'button',
      'aria-label': t('common.close', 'Close'),
      onclick: () => close(),
    },
    [
      h(
        'svg',
        {
          width: '16',
          height: '16',
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': '2',
        },
        [h('path', { d: 'M18 6L6 18M6 6l12 12' })]
      ),
    ]
  );
  header.append(title, closeBtn);

  const body = h('div', { class: 'ps-modal-body' });
  const hint = h('div', {
    class: 'help',
    text: t(
      'slideLibrary.modal.browseHelp',
      'Browse your slide library. Copy a slide to paste later, or start a new presentation with it.'
    ),
  });

  const mount = h('div', { class: 'ps-slide-library-mount' });
  body.append(hint, mount);
  modal.append(header, body);
  backdrop.append(modal);

  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try {
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
    } finally {
      openOverlayClosers?.delete?.(close);
    }
  };
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  root.append(backdrop);
  openOverlayClosers?.add?.(close);
  document.addEventListener('keydown', onKey);

  // Copy slide to clipboard
  const handleCopySlide = async (item) => {
    try {
      const slideData = {
        type: item.slideType,
        content: item.content || {},
        fromLibrary: true,
      };
      const json = JSON.stringify(slideData);
      await navigator.clipboard.writeText(json);
      toast.success(t('slideLibrary.copy.done', 'Slide copied! Paste it in a presentation with Ctrl/Cmd+V.'));
    } catch (err) {
      console.error('Failed to copy slide:', err);
      toast.error(t('slideLibrary.copy.failed', 'Failed to copy slide to clipboard.'));
    }
  };

  // Create new presentation with this slide
  const handleNewPresentation = async (item) => {
    try {
      // Create a new presentation via API
      const created = await api('/api/presentations', {
        method: 'POST',
        body: JSON.stringify({
          title: item.name || t('slideLibrary.newPresentation.defaultTitle', 'New Presentation'),
          lang: 'nl',
          scope: 'private',
          themeId: item.themeId || 'deckyard',
        }),
      });

      if (!created?.id) {
        throw new Error('Failed to create presentation');
      }

      // Add the slide to the new presentation
      await api(`/api/presentations/${created.id}/slides`, {
        method: 'POST',
        body: JSON.stringify({
          type: item.slideType,
          content: item.content || {},
        }),
      });

      toast.success(t('slideLibrary.newPresentation.done', 'Presentation created!'));
      close();

      // Navigate to the editor
      if (nav) {
        nav(`/app/edit/${created.id}`);
      }
    } catch (err) {
      console.error('Failed to create presentation:', err);
      toast.error(t('slideLibrary.newPresentation.failed', 'Failed to create presentation.'));
    }
  };

  const picker = createSlideLibraryPicker({
    h,
    api,
    themeId: '',
    SLIDE_TYPES: null,
    allowInsert: false,
    onCopySlide: handleCopySlide,
    onNewPresentation: handleNewPresentation,
  });
  picker.renderSlideLibraryPicker(mount, {});

  return { close };
}