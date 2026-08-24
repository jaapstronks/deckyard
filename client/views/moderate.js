import { api } from '../lib/api.js';
import { h } from '../lib/dom.js';
import { t } from '../lib/ui-i18n.js';
import { createQuestionsFeed, removeQuestion } from '../lib/qa/index.js';
import { isOrganizationAdmin } from '../lib/user/organization-role.js';

/**
 * The screen a non-moderator gets instead of the live question list.
 * @returns {HTMLElement} The app shell to append.
 */
function renderAccessDenied() {
  const shell = h('div', { class: 'app-shell' });
  const panel = h('div', { class: 'panel moderate-panel' });
  panel.append(
    h('h2', { text: t('moderate.title', 'Q&A moderator') }),
    h('div', {
      class: 'help',
      text: t(
        'moderate.adminRequired',
        'Moderator access requires admin login',
      ),
    }),
  );
  shell.append(panel);
  return shell;
}

export async function renderModerate(root, presentationId, { user } = {}) {
  const pid = String(presentationId || '').trim();
  if (!pid) throw new Error(t('moderate.missingId', 'Missing presentationId'));
  // Not a throw: app.js turns one into renderFatal(), which shows a stack trace
  // under a "Something went wrong" heading. Being in the wrong workspace is not
  // a crash, so it gets a plain refusal instead.
  if (!isOrganizationAdmin(user)) {
    root.append(renderAccessDenied());
    return () => {};
  }

  const shell = h('div', { class: 'app-shell' });
  const panel = h('div', { class: 'panel moderate-panel' });
  shell.append(panel);
  root.append(shell);

  const title = h('h2', { text: t('moderate.title', 'Q&A moderator') });
  const help = h('div', {
    class: 'help',
    text: t(
      'moderate.help',
      'Remove questions that have been answered or are inappropriate. The list is live and sorted by upvotes.',
    ),
  });
  const status = h('div', { class: 'help', text: '' });
  const list = h('div', { class: 'stack moderate-list' });

  panel.append(title, help, status, list);

  let questions = [];
  let live = true;

  const render = () => {
    list.innerHTML = '';
    if (!live) {
      status.textContent = t('moderate.noLive', 'No live session.');
    } else {
      status.textContent = questions.length
        ? t('moderate.count', '{n} questions', { n: questions.length })
        : t('moderate.none', 'No questions.');
    }
    for (const item of questions) {
      const row = h('div', {
        class: 'moderate-question',
      });
      const top = h('div', { class: 'row spread is-start' });
      const body = h('div', {
        class: 'moderate-question-text',
        text: item.text,
      });
      const actions = h('div', { class: 'row' });
      const votes = h('div', {
        class: 'help',
        text: item.authorName
          ? `▲ ${item.upvotes} · ${item.authorName}`
          : `▲ ${item.upvotes}`,
      });
      const removeBtn = h('button', {
        class: 'btn btn-secondary',
        text: t('common.delete', 'Delete'),
        onclick: async () => {
          if (!item.id) return;
          removeBtn.disabled = true;
          try {
            await removeQuestion(api, pid, item.id);
          } catch (e) {
            removeBtn.disabled = false;
            throw e;
          }
        },
      });
      actions.append(votes);
      if (item.isPromoted) {
        actions.append(
          h('div', {
            class: 'help moderate-badge',
            text: t('moderate.addedToDeck', 'Added to deck'),
          }),
        );
      } else {
        actions.append(removeBtn);
      }
      top.append(body, actions);
      row.append(top);
      list.append(row);
    }
  };

  // The moderator route is a desktop screen a coworker keeps open next to the
  // talk, so it takes the stream without the mobile polling fallback the
  // audience views need.
  const feed = createQuestionsFeed({
    api,
    getPresentationId: () => pid,
    pollMs: 0,
    logTag: 'moderate][qa',
    onQuestions: (next, meta) => {
      questions = next;
      live = meta.live;
      render();
    },
  });

  await feed.refresh();
  feed.connect();

  return () => {
    feed.stop();
  };
}
