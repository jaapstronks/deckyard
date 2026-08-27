import { debugLog } from '../../lib/util/debug.js';
import { t } from '../../lib/ui-i18n.js';
import { h } from '../../lib/dom.js';
import { isOrganizationAdmin } from '../../../shared/organization-role.js';
import {
  createQuestionsFeed,
  promoteQuestion,
  removeQuestion,
} from '../../lib/qa/index.js';

export function createNotesQaController({
  api,
  qaWrap,
  qaBody,
  getPresentationId,
  getPresenterSlideIndex,
  user,
  flashHint,
} = {}) {
  let questions = [];
  let qaEnabled = true;
  const expanded = new Set();

  const renderQuestions = () => {
    qaBody.innerHTML = '';
    if (!questions.length) {
      qaBody.append(
        h('div', {
          class: 'help',
          text: t('qa.noQuestions', 'No questions (yet).'),
        }),
      );
      return;
    }
    for (const item of questions) {
      const qid = item.id;
      const displayText = item.text;
      const row = h('div', { class: 'notes-qa-item' });
      const isLong = displayText.length > 140 || displayText.includes('\n');
      const isExpanded = qid && expanded.has(qid);
      const header = h('div', { class: 'row spread' });
      const metaLeft = h('div', {
        class: 'row notes-qa-meta',
      });
      const who = h('div', {
        class: 'help notes-qa-who',
        text: item.authorName || t('qa.anonymous', 'Anonymous'),
      });
      const votes = h('div', {
        class: 'help notes-qa-votes',
        text: `▲ ${item.upvotes}`,
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

      if (isOrganizationAdmin(user)) {
        const presId = getPresentationId?.() || '';
        const afterSlideIndex = Number(getPresenterSlideIndex?.() ?? 0) || 0;
        if (item.isPromoted) {
          footer.append(
            h('div', {
              class: 'help notes-qa-pill',
              text: t('qa.addedToDeck', 'Added to deck'),
            }),
          );
        } else {
          /**
           * A promote button that reports through the presenter's hint line.
           * @param {string} label - Button copy
           * @param {Object} options - Passed to promoteQuestion
           * @returns {HTMLElement}
           */
          const promoteBtn = (label, options) => {
            const btn = h('button', {
              class: 'btn btn-secondary',
              text: label,
              onclick: async () => {
                if (!qid) return;
                btn.disabled = true;
                try {
                  await promoteQuestion(api, presId, qid, options);
                  flashHint?.(t('qa.addedToDeck', 'Added to deck'));
                  feed
                    .refresh()
                    .catch((e) =>
                      debugLog('[notes][qa] refresh after promote failed', e),
                    );
                } catch (e) {
                  btn.disabled = false;
                  flashHint?.(t('qa.addFailed', 'Failed to add.'));
                  debugLog('[notes][qa] promote failed', { qid, options, e });
                }
              },
            });
            return btn;
          };

          actions.append(
            promoteBtn(t('qa.addNextSlide', 'Add next slide'), {
              position: 'next',
              afterSlideIndex,
            }),
            promoteBtn(t('qa.addToEnd', 'Add to end'), { position: 'end' }),
          );
        }
      }

      if (isOrganizationAdmin(user)) {
        const presId = getPresentationId?.() || '';
        const removeBtn = h('button', {
          class: 'btn btn-secondary',
          text: t('qa.remove', 'Remove'),
          onclick: async () => {
            if (!qid) return;
            removeBtn.disabled = true;
            try {
              await removeQuestion(api, presId, qid);
            } catch {
              removeBtn.disabled = false;
            }
          },
        });
        if (!item.isPromoted) actions.append(removeBtn);
      }

      header.append(metaLeft, actions);
      row.append(header, body, footer);
      qaBody.append(row);
    }
  };

  const feed = createQuestionsFeed({
    api,
    getPresentationId,
    logTag: 'notes][qa',
    onQuestions: (next) => {
      // A disabled Q&A shows nothing even if a payload still carries questions:
      // capabilities are reported before the list, so this is the second half
      // of the same decision, not a race with it.
      questions = qaEnabled ? next : [];
      renderQuestions();
    },
    onCapabilities: (capabilities) => {
      qaEnabled = !!capabilities.canUseQa;
      qaWrap.style.display = qaEnabled ? '' : 'none';
      if (!qaEnabled) {
        questions = [];
        renderQuestions();
      }
    },
    // A failed re-read says nothing about whether Q&A is on, so the panel comes
    // back rather than staying hidden on the strength of a stale capability.
    onRefreshError: () => {
      qaEnabled = true;
      qaWrap.style.display = '';
    },
  });

  return {
    refresh: () => feed.refresh(),
    connect: () => feed.connect(),
    detach: () => feed.stop(),
  };
}
