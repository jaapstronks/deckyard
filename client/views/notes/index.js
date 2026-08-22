import { api } from '../../lib/api.js';
import { h } from '../../lib/dom.js';
import { attachThumbScale } from '../../lib/slide-runtime/thumb-scale.js';
import {
  cleanupSlideRuntimes,
  mountSlideInto,
} from '../../lib/slide-runtime/slide-render.js';
import { normalizeLang } from '../../lib/format/i18n.js';
import { t } from '../../lib/ui-i18n.js';
import { loadThemeById } from '../../lib/theme/theme.js';
import { clamp, normalizePresentation } from './utils.js';
import { createNotesEditor } from './notes-editor.js';
import { createNotesQaController } from './qa.js';
import { createNotesSessionSse } from './session-sse.js';
import { buildNotesLayout } from './layout.js';
import { createNotesControls } from './controls.js';
import { attachSwipeNavigation } from '../../lib/dom/swipe-nav.js';

/**
 * Render the speaker-notes companion view: a live-following mirror of the
 * presenter's current slide with notes, an "up next" preview, optional Q&A, and
 * (when the session enables it) remote deck control.
 *
 * @param {HTMLElement} root - mount point.
 * @param {string} sessionId - live-session id to follow.
 * @param {{ user?: object }} [opts]
 * @returns {Promise<() => void>} cleanup function.
 */
export async function renderNotes(root, sessionId, { user } = {}) {
  // Lock page to avoid sideways scroll on mobile.
  document.documentElement.classList.add('is-notes');

  const ui = buildNotesLayout();
  const {
    shell,
    title,
    uiMode,
    refollowBtn,
    presenterHint,
    previewPrevBtn,
    previewNextBtn,
    previewMeta,
    previewWrap,
    nextLabel,
    nextPreviewWrap,
    notesWrap,
    notesTitle,
    qaWrap,
    qaBody,
  } = ui;
  root.append(shell);

  let detachThumb = () => {};
  detachThumb = attachThumbScale(previewWrap, {
    virtualWidth: 1600,
  });
  let detachNextThumb = () => {};
  detachNextThumb = attachThumbScale(nextPreviewWrap, {
    virtualWidth: 1600,
  });

  const sess = await api(`/api/live-sessions/${sessionId}/state`);
  // The deck comes from the session-scoped endpoint, not
  // `GET /api/presentations/:id`: the companion is authorized by the session id
  // in its join link and may have no account at all, so it must never depend on
  // deck read-auth. See routes/api/live-session-audience.js.
  const fetchDeck = () =>
    api(`/api/live-sessions/${encodeURIComponent(sessionId)}/deck`);
  let pres = normalizePresentation(await fetchDeck());
  // The session deck carries its own theme config: the companion may have no
  // account, and the login-gated theme route answers it 401 (which used to
  // render the deck unbranded).
  let theme = await loadThemeById(pres?.theme, { config: pres?.themeConfig });

  title.textContent = pres.title || t('notes.speakerNotes', 'Speaker notes');

  let follow = true;
  let presenterSlideIndex = Number(sess.slideIndex || 0) || 0;
  let viewSlideIndex = presenterSlideIndex;
  let controlEnabled = !!sess.controlEnabled;

  const flashHint = (msg) => {
    if (!msg) return;
    presenterHint.textContent = String(msg);
    presenterHint.hidden = false;
    setTimeout(() => {
      if (!follow)
        presenterHint.textContent = t(
          'notes.presenterOnSlide',
          'Presenter is on slide {n}.',
          { n: presenterSlideIndex + 1 },
        );
      else presenterHint.hidden = true;
    }, 2400);
  };

  const setFollow = (v) => {
    follow = !!v;
    presenterHint.hidden = follow;
    refollowBtn.hidden = follow;
  };

  // --- Q&A (optional) ---
  // The session deck carries the deck-level language hint rather than the whole
  // i18n block (translation jobs are none of the companion's business).
  const uiLang = normalizeLang(pres?.lang) || 'nl';
  const qaCtl = createNotesQaController({
    api,
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

  // --- Notes editing ---
  // Session-token-scoped: whoever holds this join link may edit the notes of
  // this session's deck, account or no account.
  const notesEditor = createNotesEditor({
    api,
    sessionId,
    ui,
  });

  const refreshPresentation = async () => {
    pres = normalizePresentation(await fetchDeck());
    theme = await loadThemeById(pres?.theme, { config: pres?.themeConfig });
    title.textContent = pres.title || t('notes.speakerNotes', 'Speaker notes');
    render();
  };

  const render = () => {
    const slides = Array.isArray(pres?.slides) ? pres.slides : [];
    const idx = clamp(viewSlideIndex, 0, Math.max(0, slides.length - 1));
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
      nextLabel.textContent = t(
        'notes.upNextSlideOf',
        'Up next · Slide {current} / {total}',
        {
          current: idx + 2,
          total: slides.length,
        },
      );
    } else {
      cleanupSlideRuntimes(nextPreviewWrap);
      nextPreviewWrap.innerHTML = '';
      nextPreviewWrap.classList.add('is-empty');
      nextPreviewWrap.append(
        h('div', {
          class: 'help thumb-overlay is-muted',
          text: t('notes.endOfDeck', 'End of deck'),
        }),
      );
      nextLabel.textContent = t('notes.upNext', 'Up next');
    }

    // The editor owns the notes body: it renders the markdown when idle and
    // holds the visitor's buffer when they are typing.
    notesEditor.setSlide(slide || null);

    notesTitle.textContent = t(
      'notes.notesSlideOf',
      'Notes · Slide {current} / {total}',
      {
        current: idx + 1,
        total: slides.length,
      },
    );
    previewMeta.textContent = t('notes.slideOf', 'Slide {current} / {total}', {
      current: idx + 1,
      total: slides.length,
    });

    if (!follow) {
      presenterHint.textContent = t(
        'notes.presenterOnSlide',
        'Presenter is on slide {n}.',
        { n: presenterSlideIndex + 1 },
      );
      presenterHint.hidden = false;
    }
  };

  const localGo = (nextIdx, { detach } = {}) => {
    if (detach) setFollow(false);
    viewSlideIndex = nextIdx;
    render();
  };

  previewPrevBtn.onclick = () => localGo(viewSlideIndex - 1, { detach: true });
  previewNextBtn.onclick = () => localGo(viewSlideIndex + 1, { detach: true });

  refollowBtn.onclick = () => {
    viewSlideIndex = presenterSlideIndex;
    setFollow(true);
    render();
  };

  const controls = createNotesControls({
    sessionId,
    enabled: controlEnabled,
    flashHint,
  });
  notesWrap.prepend(controls.el);

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
        presenterHint.textContent = t(
          'notes.presenterOnSlide',
          'Presenter is on slide {n}.',
          { n: presenterSlideIndex + 1 },
        );
        presenterHint.hidden = false;
      }
    },
    onControlEnabled: (data) => {
      controlEnabled = !!data?.controlEnabled;
      controls.setEnabled(controlEnabled);
    },
    onDeckUpdated: () => {
      refreshPresentation().catch(() => {});
    },
    onStatus: ({ kind }) => {
      if (kind === 'error' && !follow) {
        presenterHint.textContent = t(
          'notes.connectionLost',
          'Connection lost (reconnecting…)',
        );
        presenterHint.hidden = false;
      }
    },
  });
  sse.start();

  setFollow(true);
  render();

  return () => {
    sse.stop();
    notesEditor.destroy();
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
