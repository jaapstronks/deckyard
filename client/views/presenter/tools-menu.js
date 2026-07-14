import { t } from '../../lib/ui-i18n.js';

export function createPresenterToolsMenu({
  h,
  modeLang,
  getSessionId,
  getSessionPresentationId,
  copyText,
  followCodesPill,
  followCodesCopyBtn,
} = {}) {
  let detachToolsUi = () => {};
  const toolsWrap = h('div', { class: 'presenter-tools' });
  const toolsBtn = h('button', {
    class: 'btn btn-secondary presenter-tools-btn',
    text: t('presenter.tools.button', 'Tools'),
    title: t('presenter.tools.title', 'Session tools (notes / copy link / follow code)'),
    type: 'button',
  });
  const toolsPopover = h('div', {
    class: 'presenter-tools-popover',
    role: 'menu',
  });

  toolsBtn.setAttribute('aria-haspopup', 'true');
  toolsBtn.setAttribute('aria-expanded', 'false');

  const closeTools = () => {
    toolsWrap.classList.remove('is-open');
    toolsBtn.setAttribute('aria-expanded', 'false');
    toolsBtn.classList.remove('is-active');
  };

  const toggleTools = () => {
    const isOpen = toolsWrap.classList.toggle('is-open');
    toolsBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    toolsBtn.classList.toggle('is-active', isOpen);
  };

  toolsBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    toggleTools();
  });

  // Tools popover: two companion sections (convention).
  const presenterSectionTitle = h('div', {
    class: 'presenter-tools-title',
    text: t('presenter.tools.presenterCompanion', 'Presenter companion'),
  });
  const presenterSectionHint = h('div', {
    class: 'help presenter-tools-hint',
    text: t('presenter.tools.presenterHint', 'Speaker notes view (for the presenter). Share this link with yourself on another device.'),
  });
  const presenterOpenBtn = h('button', {
    class: 'btn btn-secondary presenter-tools-item',
    role: 'menuitem',
    type: 'button',
    disabled: true,
    text: t('presenter.tools.open', 'Open ↗'),
    onclick: () => {
      const sessionId = getSessionId?.() || null;
      if (!sessionId) return;
      closeTools();
      const u = new URL(`/notes/${sessionId}`, location.origin);
      window.open(u.toString(), '_blank');
    },
  });
  const presenterCopyBtn = h('button', {
    class: 'btn btn-secondary presenter-tools-item',
    role: 'menuitem',
    type: 'button',
    disabled: true,
    text: t('presenter.tools.copyLink', 'Copy link'),
    onclick: async () => {
      const sessionId = getSessionId?.() || null;
      if (!sessionId) return;
      closeTools();
      const u = new URL(`/notes/${sessionId}`, location.origin);
      await copyText?.(
        t('presenter.tools.copyPresenterPrompt', 'Copy presenter companion link:'),
        u.toString()
      );
    },
  });
  const presenterSectionActions = h('div', {
    class: 'presenter-tools-actions',
  });
  presenterSectionActions.append(presenterOpenBtn, presenterCopyBtn);

  const audienceSectionTitle = h('div', {
    class: 'presenter-tools-title',
    text: t('presenter.tools.audienceCompanion', 'Audience companion'),
  });
  const audienceSectionHint = h('div', {
    class: 'help presenter-tools-hint',
    text: t('presenter.tools.audienceHint', 'Public follow-along view (slides + Q&A + interactions). Share this link with your audience.'),
  });
  const audienceOpenBtn = h('button', {
    class: 'btn btn-secondary presenter-tools-item',
    role: 'menuitem',
    type: 'button',
    disabled: true,
    text: t('presenter.tools.open', 'Open ↗'),
    onclick: () => {
      const sessionPresId = getSessionPresentationId?.() || null;
      if (!sessionPresId) return;
      closeTools();
      const u = new URL(`/follow/${sessionPresId}`, location.origin);
      u.searchParams.set('lang', modeLang === 'en-GB' ? 'en-GB' : 'nl');
      window.open(u.toString(), '_blank');
    },
  });
  const audienceCopyBtn = h('button', {
    class: 'btn btn-secondary presenter-tools-item',
    role: 'menuitem',
    type: 'button',
    disabled: true,
    text: t('presenter.tools.copyLink', 'Copy link'),
    onclick: async () => {
      const sessionPresId = getSessionPresentationId?.() || null;
      if (!sessionPresId) return;
      closeTools();
      const u = new URL(`/follow/${sessionPresId}`, location.origin);
      u.searchParams.set('lang', modeLang === 'en-GB' ? 'en-GB' : 'nl');
      await copyText?.(
        t('presenter.tools.copyAudiencePrompt', 'Copy audience companion link:'),
        u.toString()
      );
    },
  });
  const audienceSectionActions = h('div', {
    class: 'presenter-tools-actions',
  });
  audienceSectionActions.append(audienceOpenBtn, audienceCopyBtn);

  // Keep copy buttons consistent.
  if (followCodesCopyBtn) {
    followCodesCopyBtn.textContent = t('common.copy', 'Copy');
    followCodesCopyBtn.addEventListener('click', () => closeTools(), {
      capture: true,
    });
  }

  toolsPopover.append(
    presenterSectionTitle,
    presenterSectionHint,
    presenterSectionActions,
    audienceSectionTitle,
    audienceSectionHint,
    audienceSectionActions
  );
  if (followCodesPill) toolsPopover.append(followCodesPill);
  toolsWrap.append(toolsBtn, toolsPopover);

  // Dismiss on outside click + Escape (keeps UX crisp).
  const onDocClick = (ev) => {
    if (!toolsWrap.classList.contains('is-open')) return;
    const t = ev?.target;
    if (!t) return;
    if (toolsWrap.contains(t)) return;
    closeTools();
  };
  const onDocKeyDown = (ev) => {
    if (ev?.key !== 'Escape') return;
    if (!toolsWrap.classList.contains('is-open')) return;
    closeTools();
    try {
      toolsBtn.focus();
    } catch {}
  };
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onDocKeyDown);
  detachToolsUi = () => {
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onDocKeyDown);
  };

  const syncEnabled = () => {
    presenterOpenBtn.disabled = !getSessionId?.();
    presenterCopyBtn.disabled = !getSessionId?.();
    audienceOpenBtn.disabled = !getSessionPresentationId?.();
    audienceCopyBtn.disabled = !getSessionPresentationId?.();
  };

  return {
    el: toolsWrap,
    closeTools,
    syncEnabled,
    cleanup: () => {
      try {
        detachToolsUi?.();
      } catch {}
      detachToolsUi = () => {};
    },
  };
}
