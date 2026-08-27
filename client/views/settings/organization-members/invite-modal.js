/**
 * Invite someone into the organization (organization UI, slice 5).
 *
 * There is no pending-invitation state to model. `addMember()` sets
 * `joined_at` immediately, so the person is a member the moment this form
 * succeeds; the mail is an account-setup link for someone who does not exist
 * on the instance yet, not an acceptance step. The briefing calls that a
 * product choice rather than an omission — so this dialog must not borrow the
 * vocabulary of one ("pending", "awaiting acceptance", a resend button).
 *
 * What it does have to be honest about is which of two things happened, and
 * the two differ in what the other person experiences:
 *
 *   - they had no account here → created, mailed a setup link  ("invited")
 *   - they already had one     → added, and told nothing        ("added")
 *
 * Only the first is an invitation. The second needs a nudge from a human, and
 * the report says so, because otherwise the reader waits for a mail that was
 * never sent.
 *
 * Failures stay in the dialog rather than becoming a toast over it: every one
 * of them ("already a member", "admins can only invite members", a typo'd
 * address) is answered by editing the field that is still on screen.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/dom/toast.js';
import { createModal, createModalActions } from '../../../lib/dom/modal.js';
import { inviteMember } from './actions.js';
import { invitableRoles } from './permissions.js';

/**
 * Human label for a membership role.
 * @param {string} role - Membership role
 * @returns {string}
 */
function roleLabel(role) {
  if (role === 'admin')
    return t('organization.members.roleAdmin', 'Administrator');
  return t('organization.members.roleMember', 'Member');
}

/**
 * Turn a failed invite into the sentence that belongs under the form.
 *
 * A 403 here is the server naming a rule this dialog already mirrors ("admins
 * can only invite members"), so its own wording beats anything reconstructed
 * from a status code. A 400 is nearly always the one case worth translating,
 * because it is the one the reader can act on without understanding the rule.
 *
 * @param {Error & {statusCode?: number}} err - The rejection from the API.
 * @returns {string}
 */
function inviteErrorMessage(err) {
  const message = err?.message || '';
  if (/already a member/i.test(message)) {
    return t(
      'organization.members.invite.alreadyMember',
      'That person is already a member of this organization.',
    );
  }
  if (err?.statusCode === 403) {
    return (
      message ||
      t(
        'organization.members.notAllowedGeneric',
        'you do not have permission for this.',
      )
    );
  }
  return (
    message ||
    t('organization.members.invite.failed', 'Could not send the invitation.')
  );
}

/**
 * Open the invite dialog.
 *
 * @param {Object} options
 * @param {string} options.organizationId - Organization to invite into.
 * @param {Object} options.user - Current user, from `/api/auth/me`.
 * @param {Function} [options.onInvited] - Called after a successful invite.
 * @param {HTMLElement} [options.root=document.body] - Where to mount.
 * @param {Function} [options.invite=inviteMember] - Override for the call (tests).
 * @returns {Object} The modal API, already shown.
 */
export function showInviteModal({
  organizationId,
  user,
  onInvited,
  root = document.body,
  invite = inviteMember,
} = {}) {
  const roles = invitableRoles(user);
  const modal = createModal({
    title: t('organization.members.invite.title', 'Invite someone'),
    hint: t(
      'organization.members.invite.hint',
      'They join this organization right away. If they have no account here yet, they get an email with a link to set a password.',
    ),
    modalClass: 'organization-invite-modal',
  });

  const form = h('div', { class: 'stack modal-form' });

  const emailField = h('label', { class: 'stack', style: 'gap: 4px;' });
  const emailInput = h('input', {
    class: 'form-input',
    type: 'email',
    autocomplete: 'off',
    placeholder: t(
      'organization.members.invite.emailPlaceholder',
      'name@example.com',
    ),
  });
  emailField.append(
    h('span', {
      class: 'field-label',
      text: t('organization.members.invite.emailLabel', 'Email address'),
    }),
    emailInput,
  );

  const nameField = h('label', { class: 'stack', style: 'gap: 4px;' });
  const nameInput = h('input', {
    class: 'form-input',
    type: 'text',
    autocomplete: 'off',
    placeholder: t('organization.members.invite.namePlaceholder', 'Optional'),
  });
  nameField.append(
    h('span', {
      class: 'field-label',
      text: t('organization.members.invite.nameLabel', 'Name'),
    }),
    h('span', {
      class: 'help',
      text: t(
        'organization.members.invite.nameHelp',
        'Used to address them in the invitation email. Ignored if they already have an account.',
      ),
    }),
    nameInput,
  );

  // An admin's only legal choice is "member", so they get the fact instead of
  // a select with one option in it. An owner gets the choice.
  let roleSelect = null;
  const roleField = h('div', { class: 'stack', style: 'gap: 4px;' });
  roleField.append(
    h('span', {
      class: 'field-label',
      text: t('organization.members.invite.roleLabel', 'Role'),
    }),
  );
  if (roles.length > 1) {
    roleSelect = h('select', {
      class: 'form-input',
      'aria-label': t('organization.members.invite.roleLabel', 'Role'),
    });
    for (const role of roles) {
      roleSelect.append(h('option', { value: role, text: roleLabel(role) }));
    }
    roleField.append(roleSelect);
  } else {
    roleField.append(
      h('div', {
        class: 'help',
        text: t(
          'organization.members.invite.roleFixed',
          'They join as a member. Only the owner can invite admins.',
        ),
      }),
    );
  }

  const status = h('div', { class: 'help modal-status', role: 'status' });

  const actions = createModalActions({
    cancelText: t('common.cancel', 'Cancel'),
    actionText: t('organization.members.invite.submit', 'Send invitation'),
    onCancel: () => modal.requestClose(),
    onAction: () => submit(),
  });

  form.append(emailField, nameField, roleField, status, actions.wrap);
  modal.append(form);
  modal.show(root);

  requestAnimationFrame(() => {
    try {
      emailInput.focus();
    } catch {
      // ignore
    }
  });

  return modal;

  /**
   * Validate, send, and report.
   * @returns {Promise<void>}
   */
  async function submit() {
    if (modal.isBusy()) return;

    const email = emailInput.value.trim();
    if (!email || !email.includes('@')) {
      status.textContent = t(
        'organization.members.invite.invalidEmail',
        'Enter a valid email address.',
      );
      emailInput.focus();
      return;
    }

    setDisabled(true);
    status.textContent = t('organization.members.invite.sending', 'Sending…');

    try {
      const result = await invite({
        organizationId,
        email,
        name: nameInput.value.trim() || null,
        role: roleSelect ? roleSelect.value : roles[0] || 'member',
      });
      toast.success(outcomeMessage(result));
      modal.close();
      onInvited?.(result);
    } catch (err) {
      status.textContent = inviteErrorMessage(err);
      setDisabled(false);
    }
  }

  /**
   * Lock or unlock the whole form, the modal's own close paths included.
   * @param {boolean} value - Whether a request is in flight.
   */
  function setDisabled(value) {
    modal.setBusy(value);
    emailInput.disabled = value;
    nameInput.disabled = value;
    if (roleSelect) roleSelect.disabled = value;
    actions.setDisabled(value);
  }

  /**
   * The sentence for what actually happened.
   * @param {{outcome: string, email: string}} result - From `inviteMember()`.
   * @returns {string}
   */
  function outcomeMessage(result) {
    if (result.outcome === 'added') {
      return t(
        'organization.members.invite.added',
        '{email} already had an account here and is now a member. They were not emailed, so tell them yourself.',
        { email: result.email },
      );
    }
    if (result.outcome === 'created') {
      return t(
        'organization.members.invite.createdWithoutEmail',
        '{email} was added, but no invitation email went out. Send them a password-reset link.',
        { email: result.email },
      );
    }
    return t(
      'organization.members.invite.sent',
      'Invitation sent to {email}.',
      {
        email: result.email,
      },
    );
  }
}
