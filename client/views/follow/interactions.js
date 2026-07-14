import { debugLog } from '../../lib/debug.js';
import { createFollowInteractionStorage } from './interactions/storage.js';
import { createFollowInteractionLocalCache } from './interactions/local-cache.js';
import { renderLikertSliderUi } from './interactions/likert-slider-ui.js';

function safeObj(v) {
  return v && typeof v === 'object' ? v : null;
}

function clamp0(n) {
  return Math.max(0, Number(n || 0) || 0);
}

export function createFollowInteractionController({
  h,
  api,
  presentationId,
  mountEl,
  getLang,
  getCopy,
  onCapabilities,
} = {}) {
  let capabilities = null;
  let currentSlideId = '';
  let currentSlideType = '';
  let model = null; // { interaction, interactionState }
  let busy = false;
  // Likert slider UX: SSE updates can arrive while the user is dragging the range input.
  // Re-rendering during a drag will recreate the <input> and make the thumb feel "stuck".
  // We temporarily suppress renders while dragging, then flush once released.
  let sliderDragActive = false;
  let pendingRenderAfterDrag = false;
  // iOS UX: focusing a textarea can fail to bring up the keyboard if the DOM is replaced
  // immediately (e.g. due to SSE/refresh-triggered re-render). Suppress renders while
  // the feedback textarea is focused, then flush once it blurs/submits.
  let feedbackEditActive = false;
  let pendingRenderAfterFeedbackEdit = false;
  const storage = createFollowInteractionStorage({ presentationId });
  const { readDraftFeedback, writeDraftFeedback } = storage;
  const localCache = createFollowInteractionLocalCache(storage);
  const {
    getLocalVote,
    setLocalVote,
    getLocalFeedback,
    setLocalFeedback,
    applyLocalVoteToState,
    applyLocalFeedbackToState,
  } = localCache;

  const isActive = () => !!capabilities?.interaction;

  // Local cache helpers extracted to `./interactions/local-cache.js`

  // Throttle renders to prevent rapid re-rendering from SSE events
  let renderPending = false;
  let renderTimeoutId = null;
  const RENDER_THROTTLE_MS = 250;

  const render = () => {
    // If a render is already scheduled, just mark that we need another one
    if (renderTimeoutId) {
      renderPending = true;
      return;
    }
    // Execute render immediately
    doRender();
    // Block further renders for the throttle period
    renderTimeoutId = setTimeout(() => {
      renderTimeoutId = null;
      if (renderPending) {
        renderPending = false;
        render();
      }
    }, RENDER_THROTTLE_MS);
  };

  const doRender = () => {
    if (!mountEl) return;
    if (sliderDragActive && currentSlideType === 'likert-slider-slide') {
      pendingRenderAfterDrag = true;
      return;
    }
    if (feedbackEditActive && currentSlideType === 'feedback-slide') {
      pendingRenderAfterFeedbackEdit = true;
      return;
    }
    mountEl.innerHTML = '';
    if (!isActive()) {
      mountEl.style.display = 'none';
      return;
    }
    mountEl.style.display = '';

    const copy = getCopy?.() || {};
    const title = copy?.interactionTitle || 'Meedoen';
    const loading = copy?.interactionLoading || 'Laden…';
    const closedText = copy?.interactionClosed || 'Stemmen is gesloten.';
    const openText = copy?.interactionOpen || 'Stem nu.';
    const thanks = copy?.interactionThanks || 'Dank! Je stem is opgeslagen.';
    const feedbackThanks =
      copy?.interactionThanksFeedback || 'Thanks! Your feedback was saved.';
    const feedbackSending = copy?.interactionFeedbackSending || 'Sending…';
    const feedbackHint = copy?.interactionFeedbackHint || 'Write your feedback and press Send.';
    const feedbackSend = copy?.interactionFeedbackSend || 'Send';
    const feedbackUpdate = copy?.interactionFeedbackUpdate || 'Update';
    const feedbackUpdating = copy?.interactionFeedbackUpdating || 'Updating…';
    const feedbackPlaceholder = copy?.interactionFeedbackPlaceholder || 'Type your feedback…';

    const interaction = safeObj(model?.interaction);
    const st = safeObj(model?.interactionState);

    if (
      !interaction ||
      (interaction.type !== 'poll' &&
        interaction.type !== 'likert' &&
        interaction.type !== 'feedback')
    ) {
      mountEl.append(h('div', { class: 'help', text: loading }));
      return;
    }
    const question = String(interaction?.question || '').trim();
    const options = Array.isArray(interaction?.options) ? interaction.options : [];
    // Prefer local cached vote to avoid flip-flopping on aggregate-only refresh/SSE payloads.
    const localVote = getLocalVote(currentSlideId);
    const myVote =
      localVote != null
        ? localVote
        : st && st.myVote != null
          ? clamp0(st.myVote)
          : null;
    const open =
      st ? !!st.open : true;

    const type = String(interaction.type || '');
    const isSliderLikert =
      type === 'likert' && currentSlideType === 'likert-slider-slide';
    const isFeedback = type === 'feedback' && currentSlideType === 'feedback-slide';

    const vote = async (idx) => {
      if (busy || !open) return;
      busy = true;
      try {
        const resp = await api(
          `/api/follow/${encodeURIComponent(
            presentationId
          )}/interactions/${encodeURIComponent(
            currentSlideId
          )}/vote`,
          {
            method: 'POST',
            body: JSON.stringify({ optionIndex: idx }),
          }
        );
        if (resp?.capabilities && onCapabilities)
          onCapabilities(resp.capabilities);
        if (resp?.interactionState) {
          // Cache locally to keep UI stable even if later refreshes omit `myVote`.
          setLocalVote(currentSlideId, idx);
          model = {
            ...(model || {}),
            interactionState: applyLocalVoteToState(
              currentSlideId,
              resp.interactionState
            ),
          };
        }
      } catch (e) {
        debugLog('[follow][interactions] vote failed', e);
      } finally {
        busy = false;
        render();
      }
    };

    const submitFeedback = async (text) => {
      if (busy || !open) return;
      const t = String(text || '').trim();
      if (!t) return;
      // Important UX: update UI immediately (disable button) and avoid "stuck" feeling.
      busy = true;
      // Allow a re-render even if the textarea is focused (iOS can otherwise look like it didn't submit).
      feedbackEditActive = false;
      pendingRenderAfterFeedbackEdit = false;
      try {
        const ae = document?.activeElement;
        if (
          ae &&
          ae instanceof HTMLElement &&
          ae.tagName === 'TEXTAREA' &&
          ae.classList.contains('follow-interaction-feedback-input')
        ) {
          ae.blur();
        }
      } catch {
        // ignore
      }
      render();
      try {
        const resp = await api(
          `/api/follow/${encodeURIComponent(
            presentationId
          )}/interactions/${encodeURIComponent(
            currentSlideId
          )}/feedback`,
          {
            method: 'POST',
            body: JSON.stringify({ text: t }),
          }
        );
        if (resp?.capabilities && onCapabilities)
          onCapabilities(resp.capabilities);
        if (resp?.interactionState) {
          setLocalFeedback(currentSlideId, t);
          writeDraftFeedback(currentSlideId, '');
          model = {
            ...(model || {}),
            interactionState: applyLocalFeedbackToState(
              currentSlideId,
              resp.interactionState
            ),
          };
        }
      } catch (e) {
        debugLog('[follow][interactions] feedback submit failed', e);
      } finally {
        busy = false;
        feedbackEditActive = false;
        render();
      }
    };

    const sliderDrag = {
      start: () => {
        sliderDragActive = true;
      },
      end: () => {
        sliderDragActive = false;
        if (pendingRenderAfterDrag) {
          pendingRenderAfterDrag = false;
          render();
        }
      },
      cancel: () => {
        sliderDragActive = false;
        if (pendingRenderAfterDrag) {
          pendingRenderAfterDrag = false;
          render();
        }
      },
    };

    const sliderUi = isSliderLikert
      ? renderLikertSliderUi({
          h,
          interaction,
          myVote,
          open,
          busy,
          vote,
          clamp0,
          sliderDrag,
        })
      : null;

    const feedbackUi = isFeedback
      ? (() => {
          const submitted =
            getLocalFeedback(currentSlideId) ||
            (typeof st?.myText === 'string' ? st.myText.trim() : '');
          const draft = readDraftFeedback(currentSlideId);
          // UX: after submit we keep showing the thank-you state, but clear the input field.
          // (Users can type again and hit "Update" if they want to change their feedback.)
          const value = draft || '';
          const maxLength = Math.max(
            1,
            Number(interaction?.maxLength || 4000) || 4000
          );
          const placeholder =
            String(interaction?.placeholder || '').trim() || feedbackPlaceholder;

          const hint = h('div', {
            class: 'help',
            text: open
              ? busy
                ? feedbackSending
                : feedbackHint
              : closedText,
          });

          const ta = h('textarea', {
            class: 'form-input follow-interaction-feedback-input',
            placeholder,
          });
          ta.value = value;
          ta.maxLength = maxLength;
          ta.disabled = !open || busy;
          // Keep DOM stable while the user is editing (esp. iOS keyboard/focus).
          let focusIntentTid = null;
          const clearFocusIntentTimer = () => {
            if (!focusIntentTid) return;
            try {
              clearTimeout(focusIntentTid);
            } catch {}
            focusIntentTid = null;
          };
          const markEditingIntent = () => {
            // Start suppressing re-renders as soon as the user touches the textarea.
            // On iOS the keyboard can fail to appear if the DOM is replaced between touch and focus.
            feedbackEditActive = true;
            clearFocusIntentTimer();
            focusIntentTid = setTimeout(() => {
              focusIntentTid = null;
              // If focus never happened (e.g. tap cancelled), don't block renders forever.
              try {
                if (document?.activeElement !== ta) {
                  feedbackEditActive = false;
                  if (pendingRenderAfterFeedbackEdit) {
                    pendingRenderAfterFeedbackEdit = false;
                    render();
                  }
                }
              } catch {
                feedbackEditActive = false;
              }
            }, 900);
            focusIntentTid?.unref?.();
          };
          ta.addEventListener('pointerdown', markEditingIntent);
          ta.addEventListener('touchstart', markEditingIntent, { passive: true });
          ta.addEventListener('focus', () => {
            feedbackEditActive = true;
            clearFocusIntentTimer();
          });
          ta.addEventListener('blur', () => {
            feedbackEditActive = false;
            clearFocusIntentTimer();
            if (pendingRenderAfterFeedbackEdit) {
              pendingRenderAfterFeedbackEdit = false;
              render();
            }
          });
          ta.addEventListener('input', () => {
            writeDraftFeedback(currentSlideId, ta.value);
          });

          const btn = h('button', {
            class: 'btn btn-primary',
            text: busy
              ? submitted
                ? feedbackUpdating
                : feedbackSending
              : submitted
                ? feedbackUpdate
                : feedbackSend,
            disabled: !open || busy,
            onclick: () => submitFeedback(ta.value),
          });

          return h('div', { class: 'follow-interaction-feedback-wrap' }, [
            hint,
            ta,
            btn,
          ]);
        })()
      : null;

    const optionButtons = isSliderLikert
      ? []
      : type === 'likert'
        ? options.map((opt, i) =>
            h(
              'button',
              {
                class: `btn btn-secondary follow-interaction-option follow-interaction-option-likert ${
                  myVote === i ? 'is-active' : ''
                }`,
                disabled: !open || busy,
                onclick: () => vote(i),
              },
              [
                h('span', { class: 'follow-interaction-likert-num', text: String(i + 1) }),
                h('span', { class: 'follow-interaction-likert-text', text: String(opt || '') }),
              ]
            )
          )
        : options.map((opt, i) =>
            h('button', {
              class: `btn btn-secondary follow-interaction-option ${
                myVote === i ? 'is-active' : ''
              }`,
              text: String(opt || ''),
              disabled: !open || busy,
              onclick: () => vote(i),
            })
          );

    const hasSubmittedFeedback =
      !!(getLocalFeedback(currentSlideId) ||
        (typeof st?.myText === 'string' && st.myText.trim()));

    mountEl.append(
      h('div', { class: 'follow-interaction-card' }, [
        h('div', { class: 'follow-interaction-title', text: title }),
        question
          ? h('div', { class: 'follow-interaction-question', text: question })
          : null,
        h('div', {
          class: 'follow-interaction-status help',
          text: open ? openText : closedText,
        }),
        sliderUi ||
          feedbackUi ||
          h(
            'div',
            { class: 'follow-interaction-options' },
            optionButtons
          ),
        (isFeedback ? hasSubmittedFeedback : myVote != null)
          ? h('div', {
              class: 'help follow-interaction-thanks',
              text: isFeedback ? feedbackThanks : thanks,
            })
          : null,
      ])
    );
  };

  const refreshCurrent = async () => {
    if (!isActive()) return false;
    if (
      !currentSlideId ||
      (currentSlideType !== 'poll-slide' &&
        currentSlideType !== 'likert-slide' &&
        currentSlideType !== 'likert-slider-slide' &&
        currentSlideType !== 'feedback-slide')
    )
      return false;
    try {
      const lang = String(getLang?.() || '').trim();
      const base = `/api/follow/${encodeURIComponent(
        presentationId
      )}/interactions/current`;
      const url = lang ? `${base}?lang=${encodeURIComponent(lang)}` : base;
      const resp = await api(url);
      if (resp?.capabilities && onCapabilities)
        onCapabilities(resp.capabilities);
      if (resp?.status !== 'live') {
        model = null;
        render();
        return false;
      }
      model = {
        interaction: resp?.interaction || null,
        interactionState:
          currentSlideType === 'feedback-slide'
            ? applyLocalFeedbackToState(
                currentSlideId,
                resp?.interactionState || null
              )
            : applyLocalVoteToState(
                currentSlideId,
                resp?.interactionState || null
              ),
      };
      render();
      return true;
    } catch (e) {
      debugLog('[follow][interactions] refresh failed', e);
      model = null;
      render();
      return false;
    }
  };

  const setCapabilities = (next) => {
    const prev = capabilities;
    capabilities = safeObj(next) || null;

    // Only re-render if interaction capability actually changed
    const wasActive = !!(prev?.interaction);
    const nowActive = !!(capabilities?.interaction);
    if (wasActive === nowActive) return;

    if (!nowActive) {
      model = null;
      render();
      return;
    }
    // When an interaction becomes active, refresh its definition/state.
    refreshCurrent().catch(() => {});
  };

  const setSlideContext = ({ slideId, slideType } = {}) => {
    const sid = String(slideId || '').trim();
    const st = String(slideType || '').trim();
    const changed = sid !== currentSlideId || st !== currentSlideType;
    currentSlideId = sid;
    currentSlideType = st;
    if (changed && isActive()) refreshCurrent().catch(() => {});
  };

  const onInteractionStateEvent = (data) => {
    const slideId = String(data?.slideId || '').trim();
    if (!slideId || slideId !== currentSlideId) return;
    // SSE broadcasts aggregate-only interaction state (may omit per-device `myVote`).
    // Always apply the local vote cache to keep UI stable.
    const next =
      currentSlideType === 'feedback-slide'
        ? applyLocalFeedbackToState(slideId, safeObj(data))
        : applyLocalVoteToState(slideId, safeObj(data));

    // Only re-render if something meaningful changed (e.g., open/closed state).
    // Aggregate vote counts don't need to trigger re-renders - they just cause
    // flickering and interrupt user clicks.
    const prevOpen = model?.interactionState?.open;
    const nextOpen = next?.open;
    const openChanged = prevOpen !== nextOpen;

    model = { ...(model || {}), interactionState: next };

    // Skip render if open state didn't change - user's own vote is tracked locally
    // and aggregate counts updating isn't critical for the voting UX.
    if (!openChanged) return;

    if (sliderDragActive && currentSlideType === 'likert-slider-slide') {
      pendingRenderAfterDrag = true;
      return;
    }
    if (feedbackEditActive && currentSlideType === 'feedback-slide') {
      pendingRenderAfterFeedbackEdit = true;
      return;
    }
    render();
  };

  return {
    setCapabilities,
    setSlideContext,
    onInteractionStateEvent,
    refreshCurrent,
    destroy: () => {
      if (mountEl) mountEl.innerHTML = '';
    },
  };
}
