import { h } from '../../../lib/dom/index.js';
import { t } from '../../../lib/ui-i18n.js';

/** The controls that hold a caret, so the keys belong to the text. */
const CARET_CONTROLS = 'input, textarea, [contenteditable="true"]';

/** Translation progress over all source texts, independent of the row filter. */
export function translationStatus(slide) {
  if (slide.only === 'source') return 'empty';
  if (slide.rows.some((r) => r.status === 'changed')) return 'changed';
  const rows = slide.rows.filter((r) => r.source.trim());
  const filled = rows.filter((r) => r.target.trim()).length;
  return !rows.length || filled === rows.length
    ? 'complete'
    : filled === 0
      ? 'empty'
      : 'partial';
}

/** Owns slide navigation and its listeners; all selection uses the editor seam. */
export function createTranslateNavigation({
  body,
  index,
  getSelectedSlideId,
  selectSlide,
}) {
  let slides = [];
  let buttons = new Map();
  let frame = 0;
  let jumpScrollTop = null;
  const sections = () => [...body.querySelectorAll('section[data-slide-id]')];
  const mark = () => {
    for (const [id, button] of buttons) {
      if (id === getSelectedSlideId?.()) {
        button.setAttribute('aria-current', 'true');
        const bounds = index.getBoundingClientRect();
        const item = button.getBoundingClientRect();
        if (item.top < bounds.top) index.scrollTop -= bounds.top - item.top;
        else if (item.bottom > bounds.bottom)
          index.scrollTop += item.bottom - bounds.bottom;
      } else button.removeAttribute('aria-current');
    }
  };
  const select = (id) => {
    if (id !== getSelectedSlideId?.()) selectSlide?.(id);
    mark();
    return id === getSelectedSlideId?.();
  };
  const go = (id) => {
    const section = sections().find((s) => s.dataset.slideId === id);
    if (!section || !select(id)) return;
    const head = body.querySelector('.translate-view-head');
    body.scrollTop +=
      section.getBoundingClientRect().top -
      body.getBoundingClientRect().top -
      (head?.getBoundingClientRect().height || 0);
    jumpScrollTop = body.scrollTop;
  };
  /**
   * The slide holding the caret, while it is still in view. Focusing a field
   * scrolls it into view, and that scroll must not hand the selection to
   * whichever slide ends up at the top: you are editing this one. Scroll it
   * off screen and the viewport takes over again.
   */
  const caretSection = () => {
    const el = document.activeElement;
    if (!el?.matches?.(CARET_CONTROLS)) return null;
    const section = el.closest('section[data-slide-id]');
    if (!section || !body.contains(section)) return null;
    const bounds = body.getBoundingClientRect();
    const rect = section.getBoundingClientRect();
    return rect.bottom > bounds.top && rect.top < bounds.bottom
      ? section
      : null;
  };
  const onScroll = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (jumpScrollTop !== null && body.scrollTop === jumpScrollTop) {
        jumpScrollTop = null;
        return;
      }
      jumpScrollTop = null;
      const held = caretSection();
      if (held) {
        select(held.dataset.slideId);
        return;
      }
      const top =
        body.getBoundingClientRect().top +
        (body.querySelector('.translate-view-head')?.getBoundingClientRect()
          .height || 0) +
        1;
      const all = sections();
      const section =
        all.find((s) => s.getBoundingClientRect().bottom > top) || all.at(-1);
      if (section) select(section.dataset.slideId);
    });
  };
  const onFocus = (event) => {
    const section = event.target.closest('section[data-slide-id]');
    if (section) select(section.dataset.slideId);
  };
  const onKey = (event) => {
    if (
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.target.closest(`${CARET_CONTROLS}, select`)
    )
      return;
    const delta = ['ArrowDown', 'ArrowRight', 'PageDown'].includes(event.key)
      ? 1
      : ['ArrowUp', 'ArrowLeft', 'PageUp'].includes(event.key)
        ? -1
        : 0;
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    const current = slides.findIndex(
      (s) => s.slideId === getSelectedSlideId?.(),
    );
    const next = slides[current + delta];
    if (next) go(next.slideId);
  };
  body.addEventListener('scroll', onScroll);
  body.addEventListener('focusin', onFocus);
  const frameEl = body.closest('.translate-view-frame');
  frameEl.addEventListener('keydown', onKey);
  return {
    go,
    update(shown, full) {
      slides = shown;
      const previous = buttons;
      const sameOrder =
        [...previous.keys()].join() === shown.map((s) => s.slideId).join();
      buttons = new Map();
      const items = shown.map((s) => {
        const status = translationStatus(
          full.find((x) => x.slideId === s.slideId) || s,
        );
        const label =
          status === 'changed'
            ? t('editor.translateView.fieldStatus.changed', 'Source changed')
            : status === 'empty'
              ? t('editor.translateView.status.empty', 'Empty')
              : status === 'partial'
                ? t('editor.translateView.status.partial', 'Incomplete')
                : t('editor.translateView.status.complete', 'Complete');
        const number = s.index == null ? '·' : String(s.index + 1);
        const button =
          previous.get(s.slideId) ||
          h(
            'button',
            {
              type: 'button',
              class: 'translate-view-index-item',
              title: label,
              'aria-label': `${t('editor.translateView.slide', 'Slide')} ${number}: ${label}`,
              onclick: () => go(s.slideId),
            },
            [
              h('span', { text: number }),
              h('span', {
                class: `translate-view-dot is-${status}`,
                'aria-hidden': 'true',
              }),
            ],
          );
        button.title = label;
        button.setAttribute(
          'aria-label',
          `${t('editor.translateView.slide', 'Slide')} ${number}: ${label}`,
        );
        button.firstElementChild.textContent = number;
        button.lastElementChild.className = `translate-view-dot is-${status}`;
        buttons.set(s.slideId, button);
        return button;
      });
      if (!sameOrder) index.replaceChildren(...items);
      mark();
    },
    detach() {
      cancelAnimationFrame(frame);
      body.removeEventListener('scroll', onScroll);
      body.removeEventListener('focusin', onFocus);
      frameEl.removeEventListener('keydown', onKey);
    },
  };
}
