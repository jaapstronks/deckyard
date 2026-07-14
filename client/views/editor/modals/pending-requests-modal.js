/**
 * Modal for displaying and managing pending lock access requests.
 * Shows when the lock holder clicks on the pending requests indicator.
 */

import { t } from '../../../lib/ui-i18n.js';
import { openModal } from '../../../lib/modal.js';

/**
 * Show a modal with pending access requests.
 * @param {Object} options - Modal options
 * @param {Function} options.h - DOM helper function
 * @param {HTMLElement} options.root - Root element to append modal to
 * @param {Object} options.toast - Toast notification handler
 * @param {Array} options.requests - Array of pending request objects
 * @param {Object} options.actions - Actions object with acceptRequest and rejectRequest methods
 */
export function showPendingRequestsModal({ h, root, toast, requests, actions }) {
  const modalApi = openModal(h, root, {
    title: t('editor.pendingRequests', 'Pending Access Requests'),
    hint: t('editor.requestsHelp', 'Accept to release your lock and let them edit.'),
    modalClass: 'modal-pending-requests',
  });

  const listEl = h('div', { class: 'lock-requests-list is-mt-16' });
  for (const req of requests) {
    // Handle "null" string from server as missing name
    const hasValidName = req.requesterName && req.requesterName !== 'null' && req.requesterName.trim();
    const displayName = hasValidName ? req.requesterName : null;

    const itemEl = h('div', {
      class: 'lock-request-item',
      style: 'padding: 12px 16px; background: var(--bg-secondary, #f5f5f5); border-radius: 8px; margin-bottom: 8px;',
    });
    itemEl.append(
      h('div', { style: 'display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;' }, [
        h('div', {}, [
          displayName
            ? h('div', { style: 'font-weight: 600;', text: displayName })
            : null,
          h('div', { style: displayName ? 'font-size: 0.9em; color: var(--text-muted);' : 'font-weight: 600;', text: req.requesterEmail }),
        ]),
        h('div', { style: 'display: flex; gap: 8px;' }, [
          h('button', {
            class: 'btn btn-primary btn-sm',
            text: t('common.accept', 'Accept'),
            onclick: async () => {
              const result = await actions?.acceptRequest?.(req.id);
              if (result?.ok) {
                modalApi.close();
                toast.success(t('editor.accessGrantedTo', 'Access granted. Reloading...'));
                // Reload after a short delay to let the requester acquire the lock
                setTimeout(() => location.reload(), 1500);
              }
            },
          }),
          h('button', {
            class: 'btn btn-secondary btn-sm',
            text: t('common.reject', 'Reject'),
            onclick: async () => {
              const result = await actions?.rejectRequest?.(req.id);
              if (result?.ok) {
                itemEl.remove();
                if (!listEl.children.length) modalApi.close();
              }
            },
          }),
        ]),
      ]),
      req.message && req.message !== 'null' ? h('div', { style: 'color: var(--text-muted); margin-top: 8px; font-style: italic;', text: `"${req.message}"` }) : null
    );
    listEl.append(itemEl);
  }

  modalApi.append(listEl);
}