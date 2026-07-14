/**
 * Lock request UI component for the editor topbar.
 * Handles display and interaction for presentation lock states.
 */

import { showPendingRequestsModal } from '../modals/pending-requests-modal.js';
import { t } from '../../../lib/ui-i18n.js';
import { iconUrl } from '../../../../shared/icon-names.js';

/**
 * Create the lock request UI component.
 *
 * @param {object} options
 * @param {Function} options.h - DOM element factory
 * @param {HTMLElement} options.root - Root element for modals
 * @param {object} options.toast - Toast notifications
 * @param {Function} options.setLockStateCallback - Callback to register lock state handler
 * @param {Function} options.onReadOnlyChange - Callback when read-only state changes
 * @returns {object} Lock request controller
 */
export function createLockRequestUI({
  h,
  root,
  toast,
  setLockStateCallback,
  onReadOnlyChange,
} = {}) {
  let prevPendingCount = 0;
  let acquireInProgress = false;
  let wasWaitingForAccess = false;

  // Lock request UI elements
  const lockRequestEl = h('div', { class: 'topbar-lock-request' });

  const lockRequestBtn = h('button', {
    class: 'btn btn-sm btn-primary',
    type: 'button',
    text: t('editor.requestAccess', 'Request Access'),
    style: 'display: none;',
  });

  const lockRequestsIndicator = h('button', {
    class: 'btn btn-sm btn-secondary topbar-lock-requests-indicator',
    type: 'button',
    title: t('editor.pendingRequests', 'Pending access requests'),
    style: 'display: none;',
  });
  const lockRequestsIcon = h('img', { class: 'topbar-btn-icon', src: iconUrl('inbox'), alt: '', 'aria-hidden': 'true' });
  const lockRequestsCount = h('span', { text: ' 0' });
  lockRequestsIndicator.append(lockRequestsIcon, lockRequestsCount);

  lockRequestEl.append(lockRequestBtn, lockRequestsIndicator);

  // Wire up lock state changes
  if (typeof setLockStateCallback === 'function') {
    try {
      setLockStateCallback((state, actions) => {
        const { isHolder, lockInfo, myRequest, pendingRequestsCount } = state || {};

        // If we were waiting for access and now we're the holder, show success
        if (wasWaitingForAccess && isHolder) {
          wasWaitingForAccess = false;
          acquireInProgress = false;
          lockRequestBtn.style.display = 'none';
          toast.success(t('editor.accessGranted', 'Access granted!'));
          setTimeout(() => location.reload(), 1000);
          return;
        }

        // If we were waiting for access and the lock disappeared, automatically try to acquire
        if (wasWaitingForAccess && !lockInfo && !acquireInProgress) {
          acquireInProgress = true;
          lockRequestBtn.style.display = 'none';
          toast.info(t('editor.lockReleased', 'Lock released, acquiring...'));
          actions?.acquire?.();
          return;
        }

        // Reset acquire flag when we become the holder
        if (isHolder) {
          acquireInProgress = false;
          wasWaitingForAccess = false;
        }

        // Toast notification when new requests come in
        if (isHolder && pendingRequestsCount > prevPendingCount && prevPendingCount >= 0) {
          const newCount = pendingRequestsCount - prevPendingCount;
          toast.info(
            t('editor.newAccessRequest', '{n} new access request(s)', { n: newCount }),
            { id: 'lock-request-toast', durationMs: 8000 }
          );
        }
        prevPendingCount = pendingRequestsCount || 0;

        // Update read-only mode: locked out = read-only
        const isReadOnly = !isHolder && !!lockInfo;
        try {
          onReadOnlyChange?.(isReadOnly, lockInfo);
        } catch {
          // ignore
        }

        // Reset acquire flag if no longer locked out
        if (!lockInfo || isHolder) {
          acquireInProgress = false;
        }

        // Track if we're waiting for access
        if (myRequest?.status === 'pending') {
          wasWaitingForAccess = true;
        }

        // Show "Request Access" button if locked out and no pending request
        const hasPendingRequest = myRequest?.status === 'pending';
        if (!isHolder && lockInfo && !hasPendingRequest && !acquireInProgress) {
          lockRequestBtn.style.display = '';
          lockRequestBtn.onclick = async () => {
            lockRequestBtn.disabled = true;
            lockRequestBtn.textContent = t('editor.requesting', 'Requesting...');
            const result = await actions?.requestAccess?.();
            if (result?.ok) {
              wasWaitingForAccess = true;
              lockRequestBtn.style.display = 'none';
              toast.success(t('editor.requestSent', 'Access request sent'));
            } else {
              lockRequestBtn.disabled = false;
              lockRequestBtn.textContent = t('editor.requestAccess', 'Request Access');
              toast.error(t('editor.requestFailed', 'Request failed'));
            }
          };
        } else if (myRequest?.status === 'pending') {
          lockRequestBtn.style.display = '';
          lockRequestBtn.disabled = true;
          lockRequestBtn.textContent = t('editor.waitingForAccess', 'Waiting for access...');
        } else if (myRequest?.status === 'accepted' && !acquireInProgress) {
          // Access granted - try to acquire lock
          acquireInProgress = true;
          lockRequestBtn.style.display = 'none';
          toast.success(t('editor.accessGranted', 'Access granted! Acquiring lock...'));
          actions?.acquire?.();
        } else {
          lockRequestBtn.style.display = 'none';
        }

        // Show pending requests indicator for lock holder
        if (isHolder && pendingRequestsCount > 0) {
          lockRequestsIndicator.style.display = '';
          lockRequestsCount.textContent = ` ${pendingRequestsCount}`;
          lockRequestsIndicator.onclick = async () => {
            const requests = await actions?.getPendingRequests?.();
            if (!requests?.length) {
              toast.info(t('editor.noRequests', 'No pending requests'));
              return;
            }
            showPendingRequestsModal({ h, root, toast, requests, actions });
          };
        } else {
          lockRequestsIndicator.style.display = 'none';
        }
      });
    } catch {
      // ignore
    }
  }

  return {
    el: lockRequestEl,
  };
}