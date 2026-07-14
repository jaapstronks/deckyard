import { confirmModal } from '../../lib/modal.js';
import { t } from '../../lib/ui-i18n.js';

function isInteractionSlideType(t) {
  return (
    t === 'poll-slide' ||
    t === 'likert-slide' ||
    t === 'likert-slider-slide' ||
    t === 'feedback-slide'
  );
}

function interactionTypeFromSlideType(t) {
  if (t === 'likert-slide' || t === 'likert-slider-slide') return 'likert';
  if (t === 'feedback-slide') return 'feedback';
  if (t === 'poll-slide') return 'poll';
  return null;
}

export function createPresenterInteractionControls({
  h,
  api,
  getSessionId,
  getCurrentSlide,
  getInteractionStateBySlideId,
} = {}) {
  const interactionPill = h('div', { class: 'row', hidden: true });
  const interactionText = h('div', {
    class: 'pill',
    text: '',
    title: t('presenter.interaction.statusTitle', 'Interaction status'),
  });

  const feedbackDownloadBtn = h('button', {
    class: 'btn btn-secondary',
    text: t('presenter.interaction.download', 'Download'),
    disabled: true,
    title: t('presenter.interaction.downloadTitle', 'Download feedback (CSV) for this slide'),
    onclick: () => {
      const cur = getCurrentSlide?.() || null;
      const sessionId = getSessionId?.() || null;
      if (!sessionId || !cur || cur.type !== 'feedback-slide') return;
      try {
        const url = `/api/present-sessions/${encodeURIComponent(
          sessionId
        )}/feedback/${encodeURIComponent(cur.id)}.csv`;
        window.open(url, '_blank', 'noopener,noreferrer');
      } catch {
        // ignore
      }
    },
  });

  const pollOpenBtn = h('button', {
    class: 'btn btn-secondary',
    text: t('presenter.interaction.open', 'Open'),
    disabled: true,
    onclick: async () => {
      const cur = getCurrentSlide?.() || null;
      const sessionId = getSessionId?.() || null;
      if (!sessionId || !cur || !isInteractionSlideType(cur.type)) return;
      try {
        await api(
          `/api/present-sessions/${encodeURIComponent(
            sessionId
          )}/interactions/${encodeURIComponent(cur.id)}/open`,
          { method: 'POST', body: '{}' }
        );
      } catch {
        // ignore
      }
    },
  });

  const pollCloseBtn = h('button', {
    class: 'btn btn-secondary',
    text: t('presenter.interaction.close', 'Close'),
    disabled: true,
    onclick: async () => {
      const cur = getCurrentSlide?.() || null;
      const sessionId = getSessionId?.() || null;
      if (!sessionId || !cur || !isInteractionSlideType(cur.type)) return;
      try {
        await api(
          `/api/present-sessions/${encodeURIComponent(
            sessionId
          )}/interactions/${encodeURIComponent(cur.id)}/close`,
          { method: 'POST', body: '{}' }
        );
      } catch {
        // ignore
      }
    },
  });

  const pollResetBtn = h('button', {
    class: 'btn btn-secondary',
    text: t('presenter.interaction.reset', 'Reset'),
    disabled: true,
    onclick: async () => {
      const cur = getCurrentSlide?.() || null;
      const sessionId = getSessionId?.() || null;
      if (!sessionId || !cur || !isInteractionSlideType(cur.type)) return;
      if (!(await confirmModal(h, document.body, {
        title: t('presenter.interaction.reset', 'Reset'),
        message: t('presenter.interaction.resetConfirm', 'Reset results?'),
        confirmLabel: t('presenter.interaction.reset', 'Reset'),
        danger: true,
      }))) return;
      try {
        await api(
          `/api/present-sessions/${encodeURIComponent(
            sessionId
          )}/interactions/${encodeURIComponent(cur.id)}/reset`,
          { method: 'POST', body: '{}' }
        );
      } catch {
        // ignore
      }
    },
  });

  interactionPill.append(
    interactionText,
    feedbackDownloadBtn,
    pollOpenBtn,
    pollCloseBtn,
    pollResetBtn
  );

  const sync = () => {
    const cur = getCurrentSlide?.() || null;
    const sessionId = getSessionId?.() || null;
    const interactionType = cur ? interactionTypeFromSlideType(cur.type) : null;
    const isInteractive = !!interactionType;
    interactionPill.hidden = !(sessionId && isInteractive);
    pollOpenBtn.disabled = !(sessionId && isInteractive);
    pollCloseBtn.disabled = !(sessionId && isInteractive);
    pollResetBtn.disabled = !(sessionId && isInteractive);
    feedbackDownloadBtn.disabled = !(sessionId && interactionType === 'feedback');
    if (!sessionId || !isInteractive || !cur) {
      interactionText.textContent = '';
      return;
    }
    const st = getInteractionStateBySlideId?.(cur.id) || null;
    const open = st?.open != null ? !!st.open : String(st?.status || '') !== 'closed';
    const total = Math.max(0, Number(st?.total || 0) || 0);
    const state = open
      ? t('presenter.interaction.stateOpen', 'open')
      : t('presenter.interaction.stateClosed', 'closed');
    interactionText.textContent =
      interactionType === 'feedback'
        ? t('presenter.interaction.feedbackStatus', 'Feedback: {state} · {total} responses', {
            state,
            total,
          })
        : t('presenter.interaction.voteStatus', '{label}: {state} · {total} votes', {
            label:
              interactionType === 'likert'
                ? t('presenter.interaction.likert', 'Likert')
                : t('presenter.interaction.poll', 'Poll'),
            state,
            total,
          });
  };

  return {
    el: interactionPill,
    sync,
  };
}
