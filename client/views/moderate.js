import { api } from '../lib/api.js';
import { h } from '../lib/dom.js';
import { t } from '../lib/ui-i18n.js';

export async function renderModerate(root, presentationId, { user } = {}) {
  const pid = String(presentationId || '').trim();
  if (!pid) throw new Error(t('moderate.missingId', 'Missing presentationId'));
  if (!user?.isAdmin) throw new Error(t('moderate.adminRequired', 'Moderator access requires admin login'));

  const shell = h('div', { class: 'app-shell' });
  const panel = h('div', { class: 'panel moderate-panel' });
  shell.append(panel);
  root.append(shell);

  const title = h('h2', { text: t('moderate.title', 'Q&A moderator') });
  const help = h('div', {
    class: 'help',
    text: t(
      'moderate.help',
      'Remove questions that have been answered or are inappropriate. The list is live and sorted by upvotes.'
    ),
  });
  const status = h('div', { class: 'help', text: '' });
  const list = h('div', { class: 'stack moderate-list' });

  panel.append(title, help, status, list);

  let questions = [];
  let es = null;

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
                qid
              )}/remove`,
              { method: 'POST', body: JSON.stringify({}) }
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
          })
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
    if (es) return;
    es = new EventSource(`/api/follow/${encodeURIComponent(pid)}/questions/events`);
    es.addEventListener('questions', (ev) => {
      try {
        const data = JSON.parse(ev.data || '{}');
        questions = Array.isArray(data?.questions) ? data.questions : [];
        render();
      } catch {
        // ignore
      }
    });
    es.addEventListener('status', (ev) => {
      try {
        const data = JSON.parse(ev.data || '{}');
        if (data?.status !== 'live') {
          questions = [];
          render();
        }
      } catch {
        // ignore
      }
    });
    es.addEventListener('close', () => {
      try {
        es?.close?.();
      } catch {}
      es = null;
    });
  };

  connect();

  return () => {
    if (es) {
      try {
        es.close();
      } catch {}
      es = null;
    }
  };
}
