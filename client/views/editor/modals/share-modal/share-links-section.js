/**
 * Share links section for creating and managing external guest access.
 * Allows creating shareable links with various permissions and settings.
 */

import { t } from '../../../../lib/ui-i18n.js';
import { iconUrl } from '../../../../../shared/icon-names.js';
import { createGuestManagementSection } from './guest-management.js';
import { getExpiresAt, getPermissionLabel, formatExpiration } from './utils.js';
import { openRevokeMessageModal, REVOKE_CONTEXT } from '../revoke-message-modal.js';

/**
 * Create the share links section component.
 * @param {Object} options
 * @param {Function} options.h - Hyperscript function
 * @param {Function} options.api - API call function
 * @param {string} options.presentationId - Presentation ID
 * @param {Function} options.copyToClipboard - Clipboard copy function
 * @param {Object} options.toast - Toast notification service
 * @param {HTMLElement} options.modalRoot - Root element for nested modals
 * @param {Array} [options.openOverlayClosers] - Overlay closers array
 * @returns {Object} { element, loadShareLinks }
 */
export function createShareLinksSection({ h, api, presentationId, copyToClipboard, toast, modalRoot, openOverlayClosers }) {
  let shareLinks = [];
  let isCreating = false;

  const wrapper = h('div', { class: 'share-links-wrapper' });
  const header = h('div', { class: 'share-section-title-row' });
  header.append(
    h('div', {
      class: 'share-section-title',
      text: t('share.links.sectionTitle', 'Share Links (External Guests)'),
    })
  );

  // Help text
  const helpText = h('div', {
    class: 'help share-modal-help',
    text: t(
      'share.modal.help',
      'Create shareable links to give external users access without requiring an account.'
    ),
  });

  // Create form section
  const createSection = h('div', { class: 'share-create-section' });
  const createTitle = h('div', {
    class: 'share-section-title',
    text: t('share.create.title', 'Create New Link'),
  });

  const permissionSelect = h('select', { class: 'form-input share-permission-select' });
  permissionSelect.append(
    h('option', { value: 'view', text: t('share.permission.view', 'View only') }),
    h('option', { value: 'comment', text: t('share.permission.comment', 'Can comment') })
  );

  const expirationSelect = h('select', { class: 'form-input share-expiration-select' });
  expirationSelect.append(
    h('option', { value: '', text: t('share.expiration.never', 'Never expires') }),
    h('option', { value: '1h', text: t('share.expiration.1h', '1 hour') }),
    h('option', { value: '24h', text: t('share.expiration.24h', '24 hours') }),
    h('option', { value: '7d', text: t('share.expiration.7d', '7 days') }),
    h('option', { value: '30d', text: t('share.expiration.30d', '30 days') })
  );

  const labelInput = h('input', {
    class: 'form-input share-label-input',
    placeholder: t('share.label.placeholder', 'Optional label (e.g., "For client review")'),
  });

  const passwordInput = h('input', {
    type: 'password',
    class: 'form-input share-password-input',
    placeholder: t('share.password.placeholder', 'Optional password'),
  });

  // Registration mode toggle (for comment permission links)
  const registrationModeSelect = h('select', { class: 'form-input share-registration-mode-select' });
  registrationModeSelect.append(
    h('option', { value: 'invite_only', text: t('share.registration.inviteOnly', 'Invite specific people') }),
    h('option', { value: 'open', text: t('share.registration.open', 'Anyone with the link') })
  );

  const registrationModeRow = h('div', { class: 'share-form-row share-registration-mode-row' }, [
    h('label', { class: 'share-form-label', text: t('share.registration.label', 'Access') }),
    registrationModeSelect,
  ]);
  registrationModeRow.style.display = 'none'; // Only show for comment links

  // Show/hide registration mode based on permission selection
  permissionSelect.addEventListener('change', () => {
    registrationModeRow.style.display = permissionSelect.value === 'comment' ? '' : 'none';
  });

  const createBtn = h('button', {
    class: 'btn btn-primary',
    text: t('share.create.button', 'Create Link'),
  });

  const createForm = h('div', { class: 'share-create-form' }, [
    h('div', { class: 'share-form-row' }, [
      h('label', { class: 'share-form-label', text: t('share.permission.label', 'Permission') }),
      permissionSelect,
    ]),
    registrationModeRow,
    h('div', { class: 'share-form-row' }, [
      h('label', { class: 'share-form-label', text: t('share.expiration.label', 'Expiration') }),
      expirationSelect,
    ]),
    h('div', { class: 'share-form-row' }, [
      h('label', { class: 'share-form-label', text: t('share.label.label', 'Label') }),
      labelInput,
    ]),
    h('div', { class: 'share-form-row' }, [
      h('label', { class: 'share-form-label', text: t('share.password.label', 'Password') }),
      passwordInput,
    ]),
    h('div', { class: 'share-form-actions' }, [createBtn]),
  ]);

  // Inline panel for a freshly-created link: shows the URL in a copyable field
  // so the user can see exactly what landed on their clipboard (auto-copy alone
  // left people unsure whether they had a link to paste).
  const createdLinkInput = h('input', {
    class: 'form-input share-created-link-input',
    readonly: true,
    'aria-label': t('share.create.newLinkTitle', 'New share link'),
  });
  createdLinkInput.addEventListener('focus', () => createdLinkInput.select());
  const createdLinkCopyBtn = h('button', {
    class: 'btn btn-primary btn-sm share-created-link-copy',
    text: t('common.copy', 'Copy'),
    onclick: async () => {
      const ok = await copyToClipboard(createdLinkInput.value);
      if (ok) {
        toast?.success(t('common.copied', 'Copied!'), { durationMs: 1500 });
      }
      createdLinkInput.focus();
    },
  });
  const createdLinkPanel = h('div', { class: 'share-created-link', hidden: true }, [
    h('div', {
      class: 'share-created-link-title',
      text: t('share.create.newLinkTitle', 'New share link'),
    }),
    h('div', { class: 'share-created-link-row' }, [createdLinkInput, createdLinkCopyBtn]),
  ]);

  createSection.append(createTitle, createForm, createdLinkPanel);

  // Links list section
  const linksSection = h('div', { class: 'share-links-section' });
  const linksTitle = h('div', {
    class: 'share-section-title',
    text: t('share.links.title', 'Active Links'),
  });
  const linksList = h('div', { class: 'share-links-list' });
  linksSection.append(linksTitle, linksList);

  // Create link handler
  createBtn.addEventListener('click', async () => {
    if (isCreating) return;
    isCreating = true;
    createBtn.disabled = true;
    createBtn.textContent = t('share.create.creating', 'Creating...');

    try {
      const expiresAt = getExpiresAt(expirationSelect.value);
      const permission = permissionSelect.value;
      const registrationMode = permission === 'comment' ? registrationModeSelect.value : 'open';
      const resp = await api(`/api/presentations/${presentationId}/share-links`, {
        method: 'POST',
        body: JSON.stringify({
          permission,
          label: labelInput.value.trim() || null,
          password: passwordInput.value || null,
          expiresAt,
          registrationMode,
        }),
      });

      // Surface the new link inline (and auto-copy it as a convenience).
      if (resp?.url) {
        createdLinkInput.value = resp.url;
        createdLinkPanel.hidden = false;
        const ok = await copyToClipboard(resp.url);
        if (ok) {
          toast?.success(t('share.create.copiedToClipboard', 'Link copied to clipboard!'), {
            durationMs: 2500,
          });
        }
        createdLinkInput.focus();
      }

      // Reset form
      labelInput.value = '';
      passwordInput.value = '';
      permissionSelect.value = 'view';
      expirationSelect.value = '';
      registrationModeRow.style.display = 'none';

      // Refresh list
      await loadShareLinks();
    } catch (e) {
      toast?.error(String(e?.message || e), { durationMs: 3000 });
    } finally {
      isCreating = false;
      createBtn.disabled = false;
      createBtn.textContent = t('share.create.button', 'Create Link');
    }
  });

  async function loadShareLinks() {
    try {
      const resp = await api(`/api/presentations/${presentationId}/share-links`);
      shareLinks = resp?.shareLinks || [];
      renderLinksList();
    } catch (e) {
      linksList.innerHTML = '';
      linksList.append(
        h('div', { class: 'share-links-error', text: t('share.links.loadError', 'Failed to load links') })
      );
    }
  }

  function renderLinksList() {
    linksList.innerHTML = '';

    if (shareLinks.length === 0) {
      linksList.append(
        h('div', { class: 'share-links-empty', text: t('share.links.empty', 'No active share links') })
      );
      return;
    }

    for (const link of shareLinks) {
      const item = h('div', { class: 'share-link-item' });

      const info = h('div', { class: 'share-link-info' });
      const label = h('div', {
        class: 'share-link-label',
        text: link.label || t('share.link.unlabeled', 'Unlabeled'),
      });

      const meta = h('div', { class: 'share-link-meta' });
      const permBadge = h('span', {
        class: `share-link-permission share-link-permission--${link.permission}`,
        text: getPermissionLabel(link.permission),
      });
      meta.append(permBadge);

      if (link.registrationMode === 'invite_only') {
        meta.append(h('span', { class: 'share-link-badge share-link-badge--invite', text: t('share.link.inviteOnly', 'Invite only') }));
      }
      if (link.hasPassword) {
        meta.append(h('img', { class: 'share-link-badge', src: iconUrl('lock'), alt: '', 'aria-hidden': 'true' }));
      }
      if (link.expiresAt) {
        const expDate = new Date(link.expiresAt);
        const expText = expDate < new Date()
          ? t('share.link.expired', 'Expired')
          : formatExpiration(expDate);
        meta.append(h('span', { class: 'share-link-expires', text: expText }));
      }
      if (link.useCount > 0) {
        meta.append(
          h('span', { class: 'share-link-uses', text: t('share.link.uses', '{count} uses', { count: link.useCount }) })
        );
      }

      info.append(label, meta);

      const actions = h('div', { class: 'share-link-actions' });
      const copyBtn = h('button', {
        class: 'btn btn-secondary btn-sm',
        text: t('common.copy', 'Copy'),
        onclick: async () => {
          const ok = await copyToClipboard(link.url);
          if (ok) {
            toast?.success(t('common.copied', 'Copied!'), { durationMs: 1500 });
          }
        },
      });
      const revokeBtn = h('button', {
        class: 'btn btn-danger btn-sm',
        text: t('share.link.revoke', 'Revoke'),
        onclick: async () => {
          const result = await openRevokeMessageModal({
            h,
            root: modalRoot || document.body,
            context: REVOKE_CONTEXT.SHARE_LINK,
            targetName: link.label || t('share.link.unlabeled', 'Unlabeled'),
            openOverlayClosers,
          });
          if (!result.ok) return;
          try {
            await api(`/api/presentations/${presentationId}/share-links/${link.id}`, {
              method: 'DELETE',
              body: JSON.stringify({ message: result.message }),
            });
            await loadShareLinks();
            toast?.success(t('share.link.revoked', 'Link revoked'), { durationMs: 2000 });
          } catch (e) {
            toast?.error(String(e?.message || e), { durationMs: 3000 });
          }
        },
      });
      actions.append(copyBtn, revokeBtn);

      item.append(info, actions);

      // Guest management section for invite_only links
      if (link.registrationMode === 'invite_only' && link.permission === 'comment') {
        const guestSection = createGuestManagementSection({
          h,
          api,
          presentationId,
          link,
          toast,
        });
        item.append(guestSection);
      }

      linksList.append(item);
    }
  }

  wrapper.append(header, helpText, createSection, linksSection);

  return {
    element: wrapper,
    loadShareLinks,
  };
}