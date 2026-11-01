/**
 * The thread on a shared library item (B906, D369): someone who uses a
 * colleague's slide and sees a mistake leaves a comment, and the maker and
 * everyone who commented before get a notification. One flat thread per
 * organization-shelf item, oldest first.
 *
 * Two places open it: the library lightbox (inline, under the description
 * and tags) and the deck editor's library bar on a locked slide
 * ({@link openLibraryItemThread}, a modal). Who may read, write and delete is
 * the server's verdict (`server/services/library-item-comments.js`): a
 * message carries `canDelete`, and a refusal is shown beside the composer.
 */

import { h } from '../../lib/dom/index.js';
import { icon } from '../../lib/dom/icons.js';
import { confirmModal, createModal } from '../../lib/dom/modal.js';
import { createInlineError } from '../../lib/dom/inline-error.js';
import { serverSentence } from '../../lib/api.js';
import { t } from '../../lib/ui-i18n.js';
import { formatRelativeTime } from '../../lib/format/format-time.js';
import {
  commentAuthorName,
  renderCommentBodyNodes,
} from '../comments/index.js';

/**
 * @param {{id: string}} item
 * @returns {string}
 */
function threadPath(item) {
  return `/api/slide-library/organization/${encodeURIComponent(item.id)}/comments`;
}

/**
 * The thread of one organization-shelf item, with its composer.
 *
 * @param {Object} opts
 * @param {Function} opts.api - API client
 * @param {{id: string, name?: string, trashedAt?: string|null}} opts.item
 * @returns {{ el: HTMLElement, load: () => Promise<void>, detach: () => void }}
 */
export function createLibraryItemThread({ api, item }) {
  let detached = false;
  /** @type {Array<Object>} */
  let messages = [];

  const list = h('ol', { class: 'ps-lib-thread-list' });
  const empty = h('div', {
    class: 'empty-note',
    text: t('slideLibrary.thread.empty', 'No comments yet.'),
    hidden: true,
  });
  const loadError = createInlineError({ live: 'polite' });

  const inputId = `ps-lib-thread-input-${item.id}`;
  const input = h('textarea', {
    class: 'form-input ps-lib-thread-input',
    id: inputId,
    rows: 2,
    placeholder: t(
      'slideLibrary.thread.placeholder',
      'Spotted something? Tell the maker…',
    ),
  });
  const postBtn = h('button', {
    type: 'button',
    class: 'btn btn-primary btn-sm',
    text: t('slideLibrary.thread.post', 'Post'),
    onclick: () => post(),
  });
  const postError = createInlineError();
  const composer = h('div', { class: 'stack ps-lib-thread-composer' }, [
    input,
    h('div', { class: 'row is-end' }, [postBtn]),
    postError.el,
  ]);
  // A trashed item keeps its thread readable and takes no new comment.
  composer.hidden = !!item.trashedAt;

  const el = h('section', { class: 'field ps-lib-thread' }, [
    h('label', {
      class: 'field-label',
      for: inputId,
      text: t('slideLibrary.thread.title', 'Comments'),
    }),
    h('p', {
      class: 'help',
      text: t(
        'slideLibrary.thread.hint',
        'Comments reach the maker of this slide and everyone who commented here.',
      ),
    }),
    loadError.el,
    list,
    empty,
    composer,
  ]);

  function messageEl(message) {
    const header = h('div', { class: 'comment-item-header' }, [
      h('span', { class: 'comment-author', text: commentAuthorName(message) }),
      h('span', {
        class: 'comment-time',
        text: formatRelativeTime(message.createdAt),
      }),
    ]);
    if (message.canDelete) {
      header.append(
        h(
          'button',
          {
            type: 'button',
            class: 'btn is-icon-only ps-lib-thread-delete',
            'aria-label': t('slideLibrary.thread.delete', 'Delete comment'),
            title: t('slideLibrary.thread.delete', 'Delete comment'),
            onclick: () => remove(message),
          },
          [icon('trash-2', { size: 14 })],
        ),
      );
    }
    return h('li', { class: 'comment-item' }, [
      header,
      h('div', { class: 'comment-body' }, renderCommentBodyNodes(message.body)),
    ]);
  }

  function render() {
    list.replaceChildren(...messages.map(messageEl));
    empty.hidden = messages.length > 0;
  }

  async function load() {
    try {
      const res = await api(threadPath(item));
      if (detached) return;
      messages = Array.isArray(res?.items) ? res.items : [];
      loadError.clear();
      render();
    } catch {
      if (detached) return;
      loadError.show(
        t('slideLibrary.thread.loadError', 'Comments could not be loaded.'),
        { focus: false },
      );
    }
  }

  async function post() {
    const body = String(input.value || '').trim();
    if (!body) {
      postError.show(
        t('slideLibrary.thread.required', 'Write a comment first.'),
        { control: input },
      );
      return;
    }
    postError.clear();
    postBtn.disabled = true;
    try {
      const message = await api(threadPath(item), {
        method: 'POST',
        body: { body },
      });
      if (detached) return;
      messages = [...messages, message];
      input.value = '';
      render();
    } catch (err) {
      if (detached) return;
      postError.show(
        String(
          serverSentence(err) ??
            t('slideLibrary.thread.postError', 'Your comment was not saved.'),
        ),
        { control: input },
      );
    } finally {
      postBtn.disabled = false;
    }
  }

  async function remove(message) {
    const ok = await confirmModal(document.body, {
      title: t('slideLibrary.thread.deleteTitle', 'Delete this comment?'),
      message: t(
        'slideLibrary.thread.deleteMessage',
        'The comment is removed for everyone.',
      ),
      confirmLabel: t('common.delete', 'Delete'),
      danger: true,
    });
    if (!ok || detached) return;
    try {
      await api(`${threadPath(item)}/${encodeURIComponent(message.id)}`, {
        method: 'DELETE',
      });
      if (detached) return;
      messages = messages.filter((m) => m.id !== message.id);
      render();
    } catch (err) {
      if (detached) return;
      loadError.show(
        String(
          serverSentence(err) ??
            t(
              'slideLibrary.thread.deleteError',
              'The comment could not be deleted.',
            ),
        ),
        { focus: false },
      );
    }
  }

  return {
    el,
    load,
    detach: () => {
      detached = true;
      el.remove();
    },
  };
}

/**
 * Open an item's thread in a modal: the deck editor's way to the maker of a
 * locked library slide.
 *
 * @param {Object} opts
 * @param {Function} opts.api - API client
 * @param {{id: string, name?: string}} opts.item
 * @returns {void}
 */
export function openLibraryItemThread({ api, item }) {
  const thread = createLibraryItemThread({ api, item });
  const modal = createModal({
    title: item?.name || t('slideLibrary.thread.modalTitle', 'Library slide'),
    modalClass: 'ps-lib-thread-modal',
    onClose: () => thread.detach(),
  });
  modal.content.append(thread.el);
  modal.show(document.body);
  thread.load();
}
