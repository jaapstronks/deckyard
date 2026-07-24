import { api } from '../lib/api.js';
import { h } from '../lib/dom.js';
import { attachThumbScale } from '../lib/slide-runtime/thumb-scale.js';
import {
  cleanupSlideRuntimes,
  mountSlideInto,
} from '../lib/slide-runtime/slide-render.js';
import { markdownToSafeHtml } from '../../shared/markdown.js';
import { normalizeLang } from '../lib/format/i18n.js';
import { t } from '../lib/ui-i18n.js';
import { loadThemeById } from '../lib/theme/theme.js';
import { clamp, normalizeNotes, normalizePresentation } from './notes/utils.js';
import { createNotesQaController } from './notes/qa.js';
import { createNotesSessionSse } from './notes/session-sse.js';
import { attachSwipeNavigation } from '../lib/dom/swipe-nav.js';
import { createUiModeSwitcher } from './ui-mode-switcher.js';

export async function renderNotes(
  root,
  sessionId,
  { user } = {}
) {
  // Lock page to avoid sideways scroll on mobile.
  document.documentElement.classList.add('is-notes');

  const shell = h('div', { class: 'notes-shell' });
  const topbar = h('div', { class: 'notes-topbar' });
  const title = h('div', {
    class: 'notes-title',
    text: t('notes.speakerNotes', 'Speaker notes'),
  });
  const uiMode = createUiModeSwitcher({ h, className: 'notes-ui-mode' });
  const refollowBtn = h('button', {
    class: 'btn btn-secondary',
    text: t('notes.refollow', 'Re-follow'),
    hidden: true,
  });
  topbar.append(
    h('div', { class: 'row' }, [
      title,
    ]),
    h('div', { class: 'row' }, [
      uiMode.el,
      refollowBtn,
    ])
  );

  const presenterHint = h('div', {
    class: 'notes-hint',
    hidden: true,
  });

  const previewControls = h('div', {
    class: 'notes-preview-controls',
  });
  const previewPrevBtn = h('button', {
    class: 'btn btn-secondary notes-preview-prev',
    text: t('notes.previewPrev', '◀︎ Preview'),
    title: t('notes.prevSlide.title', 'Previous slide (local only)'),
  });
  const previewNextBtn = h('button', {
    class: 'btn btn-secondary notes-preview-next',
    text: t('notes.previewNext', 'Preview ▶︎'),
    title: t('notes.nextSlide.title', 'Next slide (local only)'),
  });
  const previewMeta = h('div', {
    class: 'help notes-preview-meta',
    text: '',
  });
  previewControls.append(
    previewPrevBtn,
    previewMeta,
    previewNextBtn
  );

  const previewWrap = h('div', {
    class: 'notes-preview thumb',
  });

  // "Up next" preview: the slide after the current view. Lets the presenter
  // see what's coming without peeking ahead (which detaches from the live deck).
  const nextLabel = h('div', {
    class: 'help notes-next-label',
    text: t('notes.upNext', 'Up next'),
  });
  const nextPreviewWrap = h('div', {
    class: 'notes-next-preview thumb',
  });
  const nextPreview = h('div', { class: 'notes-next' }, [
    nextLabel,
    nextPreviewWrap,
  ]);

  const notesWrap = h('div', { class: 'notes-panel' });
  const notesTitle = h('div', {
    class: 'notes-panel-title',
    text: t('notes.notes', 'Notes'),
  });
  const notesBody = h('div', {
    class: 'notes-body',
  });
  notesWrap.append(notesTitle, notesBody);

  const qaWrap = h('div', { class: 'notes-panel notes-qa-panel' });
  const qaTitle = h('div', { class: 'notes-panel-title', text: t('notes.qa', 'Q&A') });
  const qaBody = h('div', { class: 'stack' });
  qaWrap.append(qaTitle, qaBody);

  shell.append(
    topbar,
    presenterHint,
    previewControls,
    previewWrap,
    nextPreview,
    notesWrap,
    qaWrap
  );
  root.append(shell);

  let detachThumb = () => {};
  detachThumb = attachThumbScale(previewWrap, {
    virtualWidth: 1600,
  });
  let detachNextThumb = () => {};
  detachNextThumb = attachThumbScale(nextPreviewWrap, {
    virtualWidth: 1600,
  });

  const sess = await api(
    `/api/present-sessions/${sessionId}/state`
  );
  let pres = normalizePresentation(
    await api(`/api/presentations/${sess.presentationId}`)
  );
  let theme = await loadThemeById(pres?.theme);

  title.textContent = pres.title || t('notes.speakerNotes', 'Speaker notes');

  let follow = true;
  let presenterSlideIndex =
    Number(sess.slideIndex || 0) || 0;
  let viewSlideIndex = presenterSlideIndex;
  let controlEnabled = !!sess.controlEnabled;

  const flashHint = (msg) => {
    if (!msg) return;
    presenterHint.textContent = String(msg);
    presenterHint.hidden = false;
    setTimeout(() => {
      if (!follow)
        presenterHint.textContent = t('notes.presenterOnSlide', 'Presenter is on slide {n}.', { n: presenterSlideIndex + 1 });
      else presenterHint.hidden = true;
    }, 2400);
  };

  const setFollow = (v) => {
    follow = !!v;
    presenterHint.hidden = follow;
    refollowBtn.hidden = follow;
  };

  // --- Q&A (optional) ---
  const uiLang =
    normalizeLang(pres?.i18n?.active) ||
    normalizeLang(pres?.i18n?.dominant) ||
    'nl';
  const qaCtl = createNotesQaController({
    api,
    h,
    qaWrap,
    qaBody,
    getPresentationId: () => pres?.id || '',
    getPresenterSlideIndex: () => presenterSlideIndex,
    getUiLang: () => uiLang,
    user,
    flashHint,
  });
  qaCtl.refresh().catch(() => {});
  qaCtl.connect();

  const refreshPresentation = async () => {
    pres = normalizePresentation(
      await api(`/api/presentations/${sess.presentationId}`)
    );
    theme = await loadThemeById(pres?.theme);
    title.textContent = pres.title || t('notes.speakerNotes', 'Speaker notes');
    render();
  };

  const render = () => {
    const slides = Array.isArray(pres?.slides) ? pres.slides : [];
    const idx = clamp(
      viewSlideIndex,
      0,
      Math.max(0, slides.length - 1)
    );
    viewSlideIndex = idx;
    const slide = slides[idx];

    mountSlideInto(previewWrap, slide, { theme, presentationId: pres?.id });

    // "Up next" thumbnail: the slide after the current view, or an end marker.
    const nextSlide = slides[idx + 1] || null;
    if (nextSlide) {
      mountSlideInto(nextPreviewWrap, nextSlide, {
        theme,
        presentationId: pres?.id,
      });
      nextPreviewWrap.classList.remove('is-empty');
      nextLabel.textContent = t('notes.upNextSlideOf', 'Up next · Slide {current} / {total}', {
        current: idx + 2,
        total: slides.length,
      });
    } else {
      cleanupSlideRuntimes(nextPreviewWrap);
      nextPreviewWrap.innerHTML = '';
      nextPreviewWrap.classList.add('is-empty');
      nextPreviewWrap.append(
        h('div', {
          class: 'help thumb-overlay is-muted',
          text: t('notes.endOfDeck', 'End of deck'),
        })
      );
      nextLabel.textContent = t('notes.upNext', 'Up next');
    }

    const notes = normalizeNotes(slide?.notes || '');
    const html = notes.trim()
      ? markdownToSafeHtml(notes)
      : `<p class="help">${t('notes.noNotes', 'No notes for this slide.')}</p>`;
    notesBody.innerHTML = html;

    notesTitle.textContent = t('notes.notesSlideOf', 'Notes · Slide {current} / {total}', {
      current: idx + 1,
      total: slides.length,
    });
    previewMeta.textContent = t('notes.slideOf', 'Slide {current} / {total}', { current: idx + 1, total: slides.length });

    if (!follow) {
      presenterHint.textContent = t('notes.presenterOnSlide', 'Presenter is on slide {n}.', { n: presenterSlideIndex + 1 });
      presenterHint.hidden = false;
    }
  };

  const localGo = (nextIdx, { detach } = {}) => {
    if (detach) setFollow(false);
    viewSlideIndex = nextIdx;
    render();
  };

  previewPrevBtn.onclick = () =>
    localGo(viewSlideIndex - 1, { detach: true });
  previewNextBtn.onclick = () =>
    localGo(viewSlideIndex + 1, { detach: true });

  refollowBtn.onclick = () => {
    viewSlideIndex = presenterSlideIndex;
    setFollow(true);
    render();
  };

  const controls = h('div', {
    class: 'notes-controls',
    hidden: !controlEnabled,
  });
  const prevBtn = h('button', {
    class: 'btn btn-secondary',
    text: t('notes.prev', 'Prev'),
  });
  const nextBtn = h('button', {
    class: 'btn btn-secondary',
    text: t('notes.next', 'Next'),
  });
  const gotoInput = h('input', {
    class: 'form-input notes-goto-input',
    placeholder: t('notes.gotoPlaceholder', 'Slide #'),
    inputmode: 'numeric',
  });
  const gotoBtn = h('button', {
    class: 'btn btn-secondary',
    text: t('notes.go', 'Go'),
  });

  const sendControl = async (body) => {
    await api(`/api/present-sessions/${sessionId}/control`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  };

  prevBtn.onclick = async () => {
    try {
      await sendControl({ action: 'prev' });
    } catch (e) {
      flashHint(e?.message || e);
    }
  };
  nextBtn.onclick = async () => {
    try {
      await sendControl({ action: 'next' });
    } catch (e) {
      flashHint(e?.message || e);
    }
  };
  gotoBtn.onclick = async () => {
    const n = Number(String(gotoInput.value || '').trim());
    if (!Number.isFinite(n) || n < 1) return;
    try {
      await sendControl({ action: 'goto', slideIndex: n - 1 });
    } catch (e) {
      flashHint(e?.message || e);
    }
  };
  controls.append(
    h('div', { class: 'help', text: t('notes.remoteControl', 'Remote control') }),
    h('div', { class: 'row' }, [
      prevBtn,
      nextBtn,
      gotoInput,
      gotoBtn,
    ])
  );
  notesWrap.prepend(controls);

  // Swipe navigation (local browse only; does not control desktop)
  const detachSwipe = attachSwipeNavigation(shell, {
    onPrev: () => localGo(viewSlideIndex - 1, { detach: true }),
    onNext: () => localGo(viewSlideIndex + 1, { detach: true }),
  });

  // SSE: follow presenter state + reflect controlEnabled
  const sse = createNotesSessionSse({
    sessionId,
    onState: (data) => {
      const nextIndex = Number(data?.slideIndex || 0) || 0;
      const advanced = nextIndex !== presenterSlideIndex;
      presenterSlideIndex = nextIndex;
      if (follow) {
        viewSlideIndex = presenterSlideIndex;
        render();
      } else if (advanced) {
        // Peeking ahead is temporary: when the presenter actually moves, snap
        // back to the live slide so the companion stays in sync.
        viewSlideIndex = presenterSlideIndex;
        setFollow(true);
        render();
      } else {
        presenterHint.textContent = t('notes.presenterOnSlide', 'Presenter is on slide {n}.', { n: presenterSlideIndex + 1 });
        presenterHint.hidden = false;
      }
    },
    onControlEnabled: (data) => {
      controlEnabled = !!data?.controlEnabled;
      controls.hidden = !controlEnabled;
    },
    onDeckUpdated: () => {
      refreshPresentation().catch(() => {});
    },
    onStatus: ({ kind }) => {
      if (kind === 'error' && !follow) {
        presenterHint.textContent = t('notes.connectionLost', 'Connection lost (reconnecting...)');
        presenterHint.hidden = false;
      }
    },
  });
  sse.start();

  setFollow(true);
  render();

  return () => {
    sse.stop();
    try {
      uiMode.detach?.();
    } catch {}
    cleanupSlideRuntimes(previewWrap);
    cleanupSlideRuntimes(nextPreviewWrap);
    try {
      detachThumb();
    } catch {}
    try {
      detachNextThumb();
    } catch {}
    document.documentElement.classList.remove('is-notes');
    try {
      detachSwipe?.();
    } catch {}
    qaCtl.destroy();
  };
}
