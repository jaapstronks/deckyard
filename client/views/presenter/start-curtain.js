import { t } from '../../lib/ui-i18n.js';

/**
 * Start curtain: the first thing the presenter sees when the /present tab
 * opens. It solves two problems at once:
 *   1. Discoverability — fullscreen is offered as the primary, obvious action
 *      instead of being buried in the toolbar.
 *   2. The browser fullscreen gesture — requestFullscreen() needs a user
 *      gesture in *this* tab, which window.open() from the editor doesn't
 *      provide. The curtain's button click is that gesture.
 *
 * @param {object} opts
 * @param {(tag: string, attrs?: object, kids?: any) => Element} opts.h
 * @param {string} opts.title - Deck title.
 * @param {number} opts.slideCount - Number of slides in the deck.
 * @param {() => void} opts.onStartFullscreen - Called (with a live gesture) to enter fullscreen.
 * @param {() => void} opts.onStartWindowed - Called to present without fullscreen.
 * @returns {{ el: Element, dismiss: () => void }}
 */
export function createStartCurtain({
  h,
  title,
  slideCount = 0,
  onStartFullscreen,
  onStartWindowed,
} = {}) {
  let dismissed = false;

  const fsBtn = h('button', {
    class: 'btn btn-primary presenter-start-fs',
    type: 'button',
    text: t('presenter.start.fullscreen', 'Start in fullscreen'),
  });

  const windowedBtn = h('button', {
    class: 'presenter-start-windowed',
    type: 'button',
    text: t('presenter.start.windowed', 'Start in window'),
  });

  const meta =
    slideCount > 0
      ? h('div', {
          class: 'presenter-start-meta',
          text: t('presenter.start.slides', '{n} slides', { n: slideCount }),
        })
      : null;

  const card = h('div', { class: 'presenter-start-card' }, [
    h('div', { class: 'presenter-start-title', text: title || '' }),
    meta,
    fsBtn,
    windowedBtn,
    h('div', {
      class: 'presenter-start-hint',
      text: t(
        'presenter.start.hint',
        '←/→ to navigate · F for fullscreen · Esc to exit'
      ),
    }),
  ]);

  const el = h('div', {
    class: 'presenter-start-curtain',
    role: 'dialog',
    'aria-modal': 'true',
  }, [card]);

  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    el.classList.add('is-leaving');
    const remove = () => {
      try {
        el.remove();
      } catch {}
    };
    // Fade out, then remove (fallback timer in case transitionend doesn't fire).
    let done = false;
    const once = () => {
      if (done) return;
      done = true;
      remove();
    };
    el.addEventListener('transitionend', once, { once: true });
    setTimeout(once, 320);
  };

  fsBtn.addEventListener('click', () => {
    try {
      onStartFullscreen?.();
    } finally {
      dismiss();
    }
  });
  windowedBtn.addEventListener('click', () => {
    try {
      onStartWindowed?.();
    } finally {
      dismiss();
    }
  });

  // Focus the primary action so Enter/Space starts immediately.
  requestAnimationFrame(() => {
    try {
      fsBtn.focus();
    } catch {}
  });

  return { el, dismiss };
}
