/**
 * "See what changed" modal shown after the server merges another editor's
 * changes into the deck. Lists the slides that changed and lets the user jump
 * straight to one. "By whom" is intentionally not shown: the merge response
 * carries changed slide ids only, not per-slide authorship.
 */
import { createModal } from '../../../lib/modal.js';
import { t } from '../../../lib/ui-i18n.js';

/**
 * Derive a short display label for a slide: its position plus a best-effort
 * title from common heading fields.
 * @param {Object} slide - Slide object
 * @param {number} index - Zero-based position in the deck
 * @returns {string}
 */
function slideLabel(slide, index) {
  const pos = t('editor.remoteMerge.slideN', 'Slide {n}', { n: index + 1 });
  const raw = slide && (slide.title || slide.heading || slide.headline || slide.text);
  const clean = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  const short = clean.length > 60 ? `${clean.slice(0, 60)}…` : clean;
  return short ? `${pos} · ${short}` : pos;
}

/**
 * Open the remote-merge summary modal.
 * @param {Object} opts
 * @param {Function} opts.h - DOM factory
 * @param {HTMLElement} opts.root - Mount root
 * @param {Object[]} opts.slides - Current deck slides
 * @param {string[]} opts.changedSlideIds - Ids of slides changed by the merge
 * @param {Function} opts.onJumpToSlide - Called with a slide id to navigate to it
 * @param {Set} [opts.openOverlayClosers] - Overlay registry for cleanup
 */
export function openRemoteMergeModal({
  h,
  root,
  slides,
  changedSlideIds,
  onJumpToSlide,
  openOverlayClosers,
}) {
  const changed = new Set(Array.isArray(changedSlideIds) ? changedSlideIds : []);
  const rows = (Array.isArray(slides) ? slides : [])
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s && typeof s.id === 'string' && changed.has(s.id));

  const modalApi = createModal(h, {
    title: t('editor.remoteMerge.title', 'Changes merged in'),
  });

  const intro = h('div', {
    class: 'help',
    text: t(
      'editor.remoteMerge.intro',
      'Another editor changed these slides while you were working. Your own unsaved edits were kept.'
    ),
  });

  const list = h('div', { class: 'stack is-mt-8' });
  for (const { s, i } of rows) {
    list.append(
      h('button', {
        class: 'btn btn-secondary is-between',
        type: 'button',
        text: slideLabel(s, i),
        onclick: () => {
          onJumpToSlide?.(s.id);
          modalApi.close();
        },
      })
    );
  }

  const actions = h('div', { class: 'row is-end is-mt-8' });
  actions.append(
    h('button', {
      class: 'btn btn-primary',
      type: 'button',
      text: t('common.close', 'Close'),
      onclick: () => modalApi.close(),
    })
  );

  modalApi.content.append(intro, list, actions);
  modalApi.show(root, openOverlayClosers);
  return modalApi;
}
