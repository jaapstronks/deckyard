import { debugLog } from '../../lib/util/debug.js';
import { promptModal } from '../../lib/dom/modal.js';
import { h } from '../../lib/dom.js';
import {
  askQuestion,
  cancelQuestion,
  createQuestionsFeed,
  normalizeQuestion,
  rankQuestions,
  upvoteQuestion,
} from '../../lib/qa/index.js';

export function createFollowQaController({
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

  let qaBusy = false;
  let questions = [];
  let capabilities = null;

  const getCanUseQa = () => (capabilities ? !!capabilities.canUseQa : true);

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
    qaHint.textContent = questions.length ? `${questions.length}` : '';
    if (!questions.length) {
      qaList.append(h('div', { class: 'help', text: copy.qaEmpty }));
      return;
    }
    const myIds = new Set(getMyQuestionIds?.(presentationId) || []);
    for (const item of questions) {
      const qid = item.id;
      const actions = h('div', { class: 'follow-qa-actions' });
      const votes = h('div', {
        class: 'follow-qa-votes',
        text: String(item.upvotes),
      });
      const upvoteBtn = h('button', {
        class: 'btn btn-secondary',
        text: '▲',
        title: copy.qaUpvote || 'Upvote',
        onclick: async () => {
          if (!qid || qaBusy) return;
          if (item.isPromoted) return;
          if (hasUpvoted?.(presentationId, qid)) return;
          qaBusy = true;
          try {
            await upvoteQuestion(api, presentationId, qid);
            markUpvoted?.(presentationId, qid);
            renderQuestions();
          } catch (e) {
            debugLog('[follow][qa] upvote failed', { qid, e });
          } finally {
            qaBusy = false;
          }
        },
      });
      if (item.isPromoted || hasUpvoted?.(presentationId, qid))
        upvoteBtn.disabled = true;

      actions.append(votes, upvoteBtn);

      if (myIds.has(qid)) {
        const cancelBtn = h('button', {
          class: 'btn btn-secondary',
          text: '✕',
          title: copy.qaCancel || 'Cancel my question',
          onclick: async () => {
            if (!qid || qaBusy) return;
            if (item.isPromoted) return;
            qaBusy = true;
            try {
              await cancelQuestion(api, presentationId, qid);
              removeMyQuestionId?.(presentationId, qid);
            } catch (e) {
              debugLog('[follow][qa] cancel failed', { qid, e });
            } finally {
              qaBusy = false;
            }
          },
        });
        if (item.isPromoted) cancelBtn.disabled = true;
        actions.append(cancelBtn);
      }

      qaList.append(
        h('div', { class: 'follow-qa-item' }, [
          h('div', { class: 'follow-qa-item-top' }, [
            // Questions are not auto-translated (for now). Always show the
            // original text — which is what questionText() resolves to.
            h('div', { class: 'follow-qa-text', text: item.text }),
            actions,
          ]),
          item.isPromoted
            ? h('div', {
                class: 'help follow-qa-promoted',
                text: copy.qaPromoted,
              })
            : null,
          item.authorName
            ? h('div', {
                class: 'help follow-qa-author',
                text: `— ${item.authorName}`,
              })
            : null,
        ]),
      );
    }
  };

  const feed = createQuestionsFeed({
    api,
    getPresentationId: () => presentationId,
    logTag: 'follow][qa',
    onQuestions: (next) => {
      questions = next;
      renderQuestions();
    },
    onCapabilities: (next) => onCapabilities?.(next),
  });

  const refreshQuestionsIfLive = async () => {
    const { live } = await feed.refresh();
    return live;
  };

  const connectQa = () => {
    // If Q&A is currently disabled, don't connect (setCapabilities will reconnect when enabled).
    if (capabilities && capabilities.canUseQa === false) return;
    feed.connect();
  };

  const setCapabilities = (next) => {
    capabilities = next && typeof next === 'object' ? next : null;
    const canUseQa = getCanUseQa();

    // Hide Q&A completely when a dominant interaction is active.
    qaWrap.style.display = canUseQa ? '' : 'none';

    // When disabled, stop background activity (SSE + polling) to avoid wasted connections.
    if (!canUseQa) {
      feed.stop();
      questions = [];
      renderQuestions();
      return;
    }

    // Enabled: ensure SSE + polling are running.
    connectQa();
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
        const resp = await askQuestion(api, presentationId, {
          authorName: getQaName?.(),
          lang: getLang?.(),
          text,
        });
        const created = normalizeQuestion(resp?.question);
        if (created.id) {
          addMyQuestionId?.(presentationId, created.id);

          // Optimistic insert so it appears immediately above the input.
          if (!questions.some((x) => x.id === created.id)) {
            questions = rankQuestions([...questions, created]);
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
      const next = await promptModal(document.body, {
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
    feed.stop();
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
