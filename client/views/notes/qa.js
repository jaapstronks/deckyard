import { debugLog } from '../../lib/util/debug.js';
import { t } from '../../lib/ui-i18n.js';

export function createNotesQaController({
  api,
  h,
  qaWrap,
  qaBody,
  getPresentationId,
  getPresenterSlideIndex,
  user,
  flashHint,
} = {}) {
  let qaEs = null;
  let questions = [];
  const expanded = new Set();
  let qaEnabled = true;
  let qaRefreshTid = null;

  const renderQuestions = () => {
    qaBody.innerHTML = '';
    const q = Array.isArray(questions) ? questions : [];
    if (!q.length) {
      qaBody.append(h('div', { class: 'help', text: t('qa.noQuestions', 'No questions (yet).') }));
      return;
    }
    for (const item of q) {
      const qid = String(item?.id || '').trim();
      const originalText = String(item?.original?.text || item?.text || '').trim();
      const isPromoted = String(item?.status || '') === 'promoted';

      // Questions are not auto-translated (for now). Always show original text.
      const displayText = originalText;
      const authorName = String(item?.authorName || '').trim();
      const upvotes = Math.max(0, Number(item?.upvotes || 0) || 0);
      const row = h('div', { class: 'notes-qa-item' });
      const isLong = displayText.length > 140 || displayText.includes('\n');
      const isExpanded = qid && expanded.has(qid);
      const header = h('div', { class: 'row spread' });
      const metaLeft = h('div', {
        class: 'row notes-qa-meta',
      });
      const who = h('div', {
        class: 'help notes-qa-who',
        text: authorName ? authorName : t('qa.anonymous', 'Anonymous'),
      });
      const votes = h('div', {
        class: 'help notes-qa-votes',
        text: `▲ ${upvotes}`,
      });
      metaLeft.append(who, votes);
      const actions = h('div', {
        class: 'row notes-qa-actions',
      });

      const body = h('div', {
        class: isExpanded ? 'notes-qa-body' : 'notes-qa-body is-clamped',
        text: displayText,
      });
      const footer = h('div', {
        class: 'row notes-qa-footer',
      });

      if (qid && isLong) {
        const expandBtn = h('button', {
          class: 'btn btn-secondary',
          text: isExpanded
            ? t('qa.collapse', 'Collapse')
            : t('qa.expand', 'Expand'),
          onclick: () => {
            if (!qid) return;
            if (expanded.has(qid)) expanded.delete(qid);
            else expanded.add(qid);
            renderQuestions();
          },
        });
        footer.append(expandBtn);
      }

      if (user?.isAdmin) {
        const presId = getPresentationId?.() || '';
        const afterSlideIndex = Number(getPresenterSlideIndex?.() ?? 0) || 0;
        if (isPromoted) {
          footer.append(
            h('div', {
              class: 'help notes-qa-pill',
              text: t('qa.addedToDeck', 'Added to deck'),
            })
          );
        } else {
          const addNextBtn = h('button', {
            class: 'btn btn-secondary',
            text: t('qa.addNextSlide', 'Add next slide'),
            onclick: async () => {
              if (!qid) return;
              addNextBtn.disabled = true;
              try {
                await api(
                  `/api/moderate/${encodeURIComponent(
                    presId
                  )}/questions/${encodeURIComponent(qid)}/promote`,
                  {
                    method: 'POST',
                    body: JSON.stringify({
                      position: 'next',
                      afterSlideIndex,
                    }),
                  }
                );
                flashHint?.(t('qa.addedToDeck', 'Added to deck.'));
                refresh().catch((e) => debugLog('[notes][qa] refresh after promote failed', e));
              } catch (e) {
                addNextBtn.disabled = false;
                flashHint?.(t('qa.addFailed', 'Failed to add.'));
                debugLog('[notes][qa] promote-next failed', { qid, e });
              }
            },
          });
          const addEndBtn = h('button', {
            class: 'btn btn-secondary',
            text: t('qa.addToEnd', 'Add to end'),
            onclick: async () => {
              if (!qid) return;
              addEndBtn.disabled = true;
              try {
                await api(
                  `/api/moderate/${encodeURIComponent(
                    presId
                  )}/questions/${encodeURIComponent(qid)}/promote`,
                  {
                    method: 'POST',
                    body: JSON.stringify({ position: 'end' }),
                  }
                );
                flashHint?.(t('qa.addedToDeck', 'Added to deck.'));
                refresh().catch((e) => debugLog('[notes][qa] refresh after promote failed', e));
              } catch (e) {
                addEndBtn.disabled = false;
                flashHint?.(t('qa.addFailed', 'Failed to add.'));
                debugLog('[notes][qa] promote-end failed', { qid, e });
              }
            },
          });
          actions.append(addNextBtn, addEndBtn);
        }
      }

      if (user?.isAdmin) {
        const presId = getPresentationId?.() || '';
        const removeBtn = h('button', {
          class: 'btn btn-secondary',
          text: t('qa.remove', 'Remove'),
          onclick: async () => {
            if (!qid) return;
            removeBtn.disabled = true;
            try {
              await api(
                `/api/moderate/${encodeURIComponent(
                  presId
                )}/questions/${encodeURIComponent(qid)}/remove`,
                { method: 'POST', body: JSON.stringify({}) }
              );
            } catch {
              removeBtn.disabled = false;
            }
          },
        });
        if (!isPromoted) actions.append(removeBtn);
      }

      header.append(metaLeft, actions);
      row.append(header, body, footer);
      qaBody.append(row);
    }
  };

  const refresh = async () => {
    try {
      const presId = getPresentationId?.() || '';
      const resp = await api(`/api/follow/${encodeURIComponent(presId)}/questions`);
      qaEnabled = resp?.capabilities ? !!resp.capabilities.canUseQa : true;
      qaWrap.style.display = qaEnabled ? '' : 'none';
      questions =
        qaEnabled && resp?.status === 'live' && Array.isArray(resp?.questions)
          ? resp.questions
          : [];
      renderQuestions();
    } catch (e) {
      debugLog('[notes][qa] refresh failed', e);
      qaEnabled = true;
      qaWrap.style.display = '';
      questions = [];
      renderQuestions();
    }
  };

  const connect = () => {
    if (qaEs) return;
    const presId = getPresentationId?.() || '';
    qaEs = new EventSource(
      `/api/follow/${encodeURIComponent(presId)}/questions/events`
    );
    qaEs.addEventListener('questions', (ev) => {
      try {
        const data = JSON.parse(ev.data || '{}');
        questions = Array.isArray(data?.questions) ? data.questions : [];
        renderQuestions();
      } catch (e) {
        debugLog('[notes][qa] bad questions event', { data: ev?.data, e });
      }
    });
    qaEs.addEventListener('status', (ev) => {
      try {
        const data = JSON.parse(ev.data || '{}');
        if (data?.capabilities) {
          const canUseQa = !!data.capabilities.canUseQa;
          qaEnabled = canUseQa;
          qaWrap.style.display = canUseQa ? '' : 'none';
          if (!canUseQa) {
            questions = [];
            renderQuestions();
          }
        }
      } catch (e) {
        debugLog('[notes][qa] bad status event', { data: ev?.data, e });
      }
    });
    qaEs.addEventListener('close', () => {
      try {
        qaEs?.close?.();
      } catch {}
      qaEs = null;
    });
    qaEs.addEventListener('error', () => {
      // SSE connection dropped - close and retry after delay
      try {
        qaEs?.close?.();
      } catch {}
      qaEs = null;
      setTimeout(() => {
        if (!qaEs) connect();
      }, 1200);
    });

    // Start polling fallback (for robustness if SSE misses events)
    if (!qaRefreshTid) {
      qaRefreshTid = setInterval(() => {
        refresh().catch(() => {});
      }, 8000);
      qaRefreshTid.unref?.();
    }
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

  return { refresh, connect, destroy };
}
