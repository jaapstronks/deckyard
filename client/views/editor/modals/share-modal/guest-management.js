/**
 * Guest management section for invite-only share links.
 * Allows inviting specific guests by email and managing their access.
 */

import { t } from '../../../../lib/ui-i18n.js';
import { confirmModal } from '../../../../lib/dom/modal.js';

/**
 * Create a guest management section for a share link.
 * @param {Object} options
 * @param {Function} options.h - Hyperscript function
 * @param {Function} options.api - API call function
 * @param {string} options.presentationId - Presentation ID
 * @param {Object} options.link - Share link object
 * @param {Object} options.toast - Toast notification service
 * @returns {HTMLElement} Guest management section element
 */
export function createGuestManagementSection({ h, api, presentationId, link, toast }) {
  const section = h('div', { class: 'share-guest-section' });
  let isExpanded = false;
  let guests = [];

  const toggleBtn = h('button', {
    class: 'btn btn-secondary btn-xs share-guest-toggle',
    text: t('share.guests.manage', 'Manage Guests'),
  });

  const content = h('div', { class: 'share-guest-content' });
  content.style.display = 'none';

  // Add guest form
  const addForm = h('div', { class: 'share-guest-add-form' });
  const emailInput = h('input', {
    type: 'email',
    class: 'form-input share-guest-email',
    placeholder: t('share.guests.emailPlaceholder', 'Email address'),
  });
  const nameInput = h('input', {
    type: 'text',
    class: 'form-input share-guest-name',
    placeholder: t('share.guests.namePlaceholder', 'Name (optional)'),
  });
  const addBtn = h('button', {
    class: 'btn btn-primary btn-sm',
    text: t('share.guests.add', 'Invite'),
  });
  addForm.append(emailInput, nameInput, addBtn);

  const guestList = h('div', { class: 'share-guest-list' });

  content.append(addForm, guestList);
  section.append(toggleBtn, content);

  async function loadGuests() {
    try {
      const resp = await api(`/api/presentations/${presentationId}/share-links/${link.id}/guests`);
      guests = resp?.guests || [];
      renderGuests();
    } catch (e) {
      guestList.innerHTML = '';
      guestList.append(h('div', { class: 'share-guest-error', text: t('share.guests.loadError', 'Failed to load guests') }));
    }
  }

  function renderGuests() {
    guestList.innerHTML = '';

    if (guests.length === 0) {
      guestList.append(h('div', { class: 'share-guest-empty', text: t('share.guests.empty', 'No guests invited yet') }));
      return;
    }

    for (const guest of guests) {
      const row = h('div', { class: 'share-guest-row' });

      const guestInfo = h('div', { class: 'share-guest-info' });
      const guestEmail = h('span', { class: 'share-guest-email-display', text: guest.email });
      const guestName = guest.name ? h('span', { class: 'share-guest-name-display', text: guest.name }) : null;
      guestInfo.append(guestEmail);
      if (guestName) guestInfo.append(guestName);

      const statusBadge = h('span', {
        class: `share-guest-status share-guest-status--${guest.verifiedAt ? 'verified' : 'pending'}`,
        text: guest.verifiedAt ? t('share.guests.verified', 'Verified') : t('share.guests.pending', 'Pending'),
      });

      const guestActions = h('div', { class: 'share-guest-actions' });

      if (!guest.verifiedAt) {
        const resendBtn = h('button', {
          class: 'btn btn-secondary btn-xs',
          text: t('share.guests.resend', 'Resend'),
          onclick: async () => {
            try {
              resendBtn.disabled = true;
              await api(`/api/presentations/${presentationId}/share-links/${link.id}/guests/${guest.id}/resend`, {
                method: 'POST',
              });
              toast?.success(t('share.guests.resent', 'Invitation resent'), { durationMs: 2000 });
            } catch (e) {
              toast?.error(String(e?.message || e), { durationMs: 3000 });
            } finally {
              resendBtn.disabled = false;
            }
          },
        });
        guestActions.append(resendBtn);
      }

      const removeBtn = h('button', {
        class: 'btn btn-danger btn-xs',
        text: t('share.guests.remove', 'Remove'),
        onclick: async () => {
          const ok = await confirmModal(h, document.body, {
            title: t('share.guests.remove', 'Remove'),
            message: t('share.guests.removeConfirm', 'Remove this guest?'),
            confirmLabel: t('share.guests.remove', 'Remove'),
            danger: true,
          });
          if (!ok) return;
          try {
            await api(`/api/presentations/${presentationId}/share-links/${link.id}/guests/${guest.id}`, {
              method: 'DELETE',
            });
            await loadGuests();
            toast?.success(t('share.guests.removed', 'Guest removed'), { durationMs: 2000 });
          } catch (e) {
            toast?.error(String(e?.message || e), { durationMs: 3000 });
          }
        },
      });
      guestActions.append(removeBtn);

      row.append(guestInfo, statusBadge, guestActions);
      guestList.append(row);
    }
  }

  toggleBtn.addEventListener('click', () => {
    isExpanded = !isExpanded;
    content.style.display = isExpanded ? '' : 'none';
    toggleBtn.textContent = isExpanded
      ? t('share.guests.hide', 'Hide Guests')
      : t('share.guests.manage', 'Manage Guests');
    if (isExpanded && guests.length === 0) {
      loadGuests();
    }
  });

  addBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    const name = nameInput.value.trim();
    if (!email) {
      toast?.error(t('share.guests.emailRequired', 'Email is required'), { durationMs: 2000 });
      return;
    }

    try {
      addBtn.disabled = true;
      await api(`/api/presentations/${presentationId}/share-links/${link.id}/guests`, {
        method: 'POST',
        body: JSON.stringify({ email, name: name || null }),
      });
      emailInput.value = '';
      nameInput.value = '';
      await loadGuests();
      toast?.success(t('share.guests.invited', 'Guest invited'), { durationMs: 2000 });
    } catch (e) {
      toast?.error(String(e?.message || e), { durationMs: 3000 });
    } finally {
      addBtn.disabled = false;
    }
  });

  return section;
}