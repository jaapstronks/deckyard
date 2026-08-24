import { api } from '../lib/api.js';
import { h } from '../lib/dom.js';
import { t } from '../lib/ui-i18n.js';
import {
  createSSEConnection,
  LONG_LIVED_STREAM,
} from '../lib/net/sse-connection.js';
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
  let connection = null;

  const render = () => {
    list.innerHTML = '';
    const q = Array.isArray(questions) ? questions : [];
    status.textContent = q.length
      ? t('moderate.count', '{n} questions', { n: q.length })
      : t('moderate.none', 'No questions.');
    for (const item of q) {
      const qid = String(item?.id || '').trim();
      const text = String(item?.text || '').trim();
      const upvotes = Math.max(0, Number(item?.upvotes || 0) || 0);
      const authorName = String(item?.authorName || '').trim();
      const isPromoted = String(item?.status || '') === 'promoted';
      const row = h('div', {
        class: 'moderate-question',
      });
      const top = h('div', { class: 'row spread is-start' });
      const body = h('div', { class: 'moderate-question-text', text });
      const actions = h('div', { class: 'row' });
      const votes = h('div', {
        class: 'help',
        text: authorName ? `▲ ${upvotes} · ${authorName}` : `▲ ${upvotes}`,
      });
      const removeBtn = h('button', {
        class: 'btn btn-secondary',
        text: t('common.delete', 'Delete'),
        onclick: async () => {
          if (!qid) return;
          removeBtn.disabled = true;
          try {
            await api(
              `/api/moderate/${encodeURIComponent(pid)}/questions/${encodeURIComponent(
                qid,
              )}/remove`,
              { method: 'POST', body: JSON.stringify({}) },
            );
          } catch (e) {
            removeBtn.disabled = false;
            throw e;
          }
        },
      });
      actions.append(votes);
      if (isPromoted) {
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

  const refresh = async () => {
    const resp = await api(`/api/follow/${encodeURIComponent(pid)}/questions`);
    if (resp?.status !== 'live') {
      questions = [];
      status.textContent = t('moderate.noLive', 'No live session.');
      render();
      return;
    }
    questions = Array.isArray(resp?.questions) ? resp.questions : [];
    render();
  };

  await refresh();

  const connect = () => {
    if (connection) return;
    connection = createSSEConnection({
      url: `/api/follow/${encodeURIComponent(pid)}/questions/events`,
      events: ['questions', 'status', 'close'],
      onEvent: (ev) => {
        switch (ev.type) {
          case 'questions': {
            try {
              const data = JSON.parse(ev.data || '{}');
              questions = Array.isArray(data?.questions) ? data.questions : [];
              render();
            } catch {
              // ignore
            }
            break;
          }
          case 'status': {
            try {
              const data = JSON.parse(ev.data || '{}');
              if (data?.status !== 'live') {
                questions = [];
                render();
              }
            } catch {
              // ignore
            }
            break;
          }
          case 'close':
            // Session ended server-side: close for good, don't reopen.
            connection.disconnect();
            break;
        }
      },
      ...LONG_LIVED_STREAM,
    });
    connection.connect();
  };

  connect();

  return () => {
    connection?.stop();
    connection = null;
  };
}
