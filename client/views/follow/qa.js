import { debugLog } from '../../lib/util/debug.js';
import { promptModal } from '../../lib/dom/modal.js';

export function createFollowQaController({
  h,
  api,
  presentationId,
  qaWrap,
  qaHint,
  qaNameBtn,
  qaInput,
  qaAskBtn,
  qaList,
  getLang,
  getCopy,
  onCapabilities,
  questionsApi,
} = {}) {
  const {
    addMyQuestionId,
    getMyQuestionIds,
    getQaName,
    hasUpvoted,
    markUpvoted,
    removeMyQuestionId,
    setQaName,
  } = questionsApi || {};

  let qaEs = null;
  let qaBusy = false;
  let qaRefreshTid = null;
  let questions = [];
  let capabilities = null;

  const getCanUseQa = () =>
    capabilities ? !!capabilities.canUseQa : true;

  const syncQaNameBtn = () => {
    const copy = getCopy?.() || {};
    const n = getQaName?.() || '';
    qaNameBtn.textContent = n
      ? `${copy.qaNameSet} ${n}`
      : copy.qaNameUnset || '';
  };

  const renderQuestions = () => {
    qaList.innerHTML = '';
    const copy = getCopy?.() || {};
    const q = Array.isArray(questions) ? [...questions] : [];
    // Ensure ranked order client-side too (in case of optimistic inserts).
    q.sort((a, b) => {
      const ap = String(a?.status || '') === 'promoted';
      const bp = String(b?.status || '') === 'promoted';
      if (ap !== bp) return ap ? -1 : 1;
      const au = Math.max(0, Number(a?.upvotes || 0) || 0);
      const bu = Math.max(0, Number(b?.upvotes || 0) || 0);
      if (bu !== au) return bu - au;
      const at = Number(a?.createdAt || 0) || 0;
      const bt = Number(b?.createdAt || 0) || 0;
      return at - bt;
    });
    qaHint.textContent = q.length ? `${q.length}` : '';
    if (!q.length) {
      qaList.append(h('div', { class: 'help', text: copy.qaEmpty }));
      return;
    }
    const myIds = new Set(getMyQuestionIds?.(presentationId) || []);
    for (const item of q) {
      const qid = String(item?.id || '');
      const originalText = String(
        item?.original?.text || item?.text || ''
      ).trim();
      // Questions are not auto-translated (for now). Always show original text.
      const displayText = originalText;
      const authorName = String(item?.authorName || '').trim();
      const isPromoted = String(item?.status || '') === 'promoted';
      const upvotes = Math.max(0, Number(item?.upvotes || 0) || 0);
      const actions = h('div', { class: 'follow-qa-actions' });
      const votes = h('div', {
        class: 'follow-qa-votes',
        text: String(upvotes),
      });
      const upvoteBtn = h('button', {
        class: 'btn btn-secondary',
        text: '▲',
        title: copy.qaUpvote || 'Upvote',
        onclick: async () => {
          if (!qid || qaBusy) return;
          if (isPromoted) return;
          if (hasUpvoted?.(presentationId, qid)) return;
          qaBusy = true;
          try {
            await api(
              `/api/follow/${encodeURIComponent(
                presentationId
              )}/questions/${encodeURIComponent(qid)}/upvote`,
              {
                method: 'POST',
                body: JSON.stringify({}),
              }
            );
            markUpvoted?.(presentationId, qid);
            renderQuestions();
          } catch (e) {
            debugLog('[follow][qa] upvote failed', { qid, e });
          } finally {
            qaBusy = false;
          }
        },
      });
      if (isPromoted || hasUpvoted?.(presentationId, qid))
        upvoteBtn.disabled = true;

      actions.append(votes, upvoteBtn);

      if (myIds.has(qid)) {
        const cancelBtn = h('button', {
          class: 'btn btn-secondary',
          text: '✕',
          title: copy.qaCancel || 'Cancel my question',
          onclick: async () => {
            if (!qid || qaBusy) return;
            if (isPromoted) return;
            qaBusy = true;
            try {
              await api(
                `/api/follow/${encodeURIComponent(
                  presentationId
                )}/questions/${encodeURIComponent(qid)}/cancel`,
                {
                  method: 'POST',
                  body: JSON.stringify({}),
                }
              );
              removeMyQuestionId?.(presentationId, qid);
            } catch (e) {
              debugLog('[follow][qa] cancel failed', { qid, e });
            } finally {
              qaBusy = false;
            }
          },
        });
        if (isPromoted) cancelBtn.disabled = true;
        actions.append(cancelBtn);
      }

      qaList.append(
        h('div', { class: 'follow-qa-item' }, [
          h('div', { class: 'follow-qa-item-top' }, [
            h('div', { class: 'follow-qa-text', text: displayText }),
            actions,
          ]),
          isPromoted
            ? h('div', {
                class: 'help follow-qa-promoted',
                text: copy.qaPromoted,
              })
            : null,
          authorName
            ? h('div', {
                class: 'help follow-qa-author',
                text: `— ${authorName}`,
              })
            : null,
        ])
      );
    }
  };

  const refreshQuestionsIfLive = async () => {
    try {
      const resp = await api(
        `/api/follow/${encodeURIComponent(presentationId)}/questions`
      );
      if (resp?.capabilities && onCapabilities)
        onCapabilities(resp.capabilities);
      if (resp?.status !== 'live') {
        questions = [];
        renderQuestions();
        return false;
      }
      questions = Array.isArray(resp?.questions) ? resp.questions : [];
      renderQuestions();
      return true;
    } catch (e) {
      debugLog('[follow][qa] refresh failed', e);
      questions = [];
      renderQuestions();
      return false;
    }
  };

  const connectQa = () => {
    if (qaEs) return;
    // If Q&A is currently disabled, don't connect (setCapabilities will reconnect when enabled).
    if (capabilities && capabilities.canUseQa === false) return;
    qaEs = new EventSource(
      `/api/follow/${encodeURIComponent(presentationId)}/questions/events`
    );
    qaEs.addEventListener('questions', (ev) => {
      try {
        const data = JSON.parse(ev.data || '{}');
        questions = Array.isArray(data?.questions) ? data.questions : [];
        renderQuestions();
      } catch (e) {
        debugLog('[follow][qa] bad questions event', { data: ev?.data, e });
      }
    });
    qaEs.addEventListener('status', (ev) => {
      try {
        const data = JSON.parse(ev.data || '{}');
        if (data?.capabilities && onCapabilities)
          onCapabilities(data.capabilities);
        if (data?.status !== 'live') {
          questions = [];
          renderQuestions();
        }
      } catch (e) {
        debugLog('[follow][qa] bad status event', { data: ev?.data, e });
      }
    });
    qaEs.addEventListener('close', () => {
      try {
        qaEs?.close?.();
      } catch {}
      qaEs = null;
    });
    qaEs.addEventListener('error', () => {
      // Some browsers/mobile contexts can silently drop SSE when backgrounded.
      // Close + retry to ensure we eventually reflect removals/promotions.
      try {
        qaEs?.close?.();
      } catch {}
      qaEs = null;
      setTimeout(() => {
        if (!qaEs) connectQa();
      }, 1200);
    });
  };

  const setCapabilities = (next) => {
    capabilities = next && typeof next === 'object' ? next : null;
    const canUseQa = getCanUseQa();

    // Hide Q&A completely when a dominant interaction is active.
    qaWrap.style.display = canUseQa ? '' : 'none';

    // When disabled, stop background activity (SSE + polling) to avoid wasted connections.
    if (!canUseQa) {
      if (qaEs) {
        try {
          qaEs.close();
        } catch {}
        qaEs = null;
      }
      if (qaRefreshTid) {
        try {
          clearInterval(qaRefreshTid);
        } catch {}
        qaRefreshTid = null;
      }
      questions = [];
      renderQuestions();
      return;
    }

    // Enabled: ensure SSE + polling are running.
    if (!qaEs) connectQa();
    if (!qaRefreshTid) {
      qaRefreshTid = setInterval(() => {
        refreshQuestionsIfLive().catch(() => {});
      }, 8000);
      qaRefreshTid.unref?.();
    }
  };

  const wireAskButton = () => {
    qaAskBtn.onclick = async () => {
      if (qaBusy) return;
      if (!getCanUseQa()) return;
      const text = String(qaInput.value || '').trim();
      if (!text) return;
      qaBusy = true;
      qaAskBtn.disabled = true;
      try {
        const authorName = getQaName?.();
        const lang = getLang?.();
        const resp = await api(
          `/api/follow/${encodeURIComponent(presentationId)}/questions`,
          {
            method: 'POST',
            body: JSON.stringify({ authorName, lang, text }),
          }
        );
        const qid = String(resp?.question?.id || '').trim();
        if (qid) addMyQuestionId?.(presentationId, qid);

        // Optimistic insert so it appears immediately above the input.
        const created =
          resp?.question && typeof resp.question === 'object'
            ? resp.question
            : null;
        if (created && String(created.id || '').trim()) {
          const exists = (Array.isArray(questions) ? questions : []).some(
            (x) => String(x?.id || '') === String(created.id || '')
          );
          if (!exists) {
            questions = Array.isArray(questions) ? questions : [];
            questions.push(created);
            renderQuestions();
            try {
              qaList.scrollTop = 0;
            } catch {}
          }
        }
        qaInput.value = '';
        try {
          qaInput.focus();
        } catch {}
        refreshQuestionsIfLive().catch(() => {});
      } catch {
        // ignore
      } finally {
        qaAskBtn.disabled = false;
        qaBusy = false;
      }
    };
  };

  const wireNameButton = () => {
    qaNameBtn.onclick = async () => {
      const copy = getCopy?.() || {};
      const current = getQaName?.() || '';
      const next = await promptModal(h, document.body, {
        title: copy.qaName,
        value: current,
      });
      if (next == null) return;
      setQaName?.(next);
      syncQaNameBtn();
      renderQuestions();
    };
    syncQaNameBtn();
  };

  const destroy = () => {
    if (qaEs) {
      try {
        qaEs.close();
      } catch {}
      qaEs = null;
    }
    if (qaRefreshTid) {
      try {
        clearInterval(qaRefreshTid);
      } catch {}
      qaRefreshTid = null;
    }
  };

  // init wiring
  wireNameButton();
  wireAskButton();

  return {
    setCapabilities,
    refreshQuestionsIfLive,
    renderQuestions,
    syncQaNameBtn,
    destroy,
    connectQa,
  };
}
