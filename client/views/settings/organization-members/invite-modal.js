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
 * never sent. A third ("created", but the setup mail did not go out) needs the
 * same nudge, and there the report also says *how* the person gets in, which
 * depends on the instance: an SSO-only install has no password to reset.
 *
 * A report that asks the inviter to do something is not a passing toast
 * (feedback-surfaces.md: expiring is fine only when missing it does no harm).
 * It replaces the form inside this dialog and stays until the inviter closes
 * it. Only "invited" — the mail went out, nothing to do — is a toast.
 *
 * Failures stay in the dialog rather than becoming a toast over it: every one
 * of them ("already a member", "admins can only invite members", a typo'd
 * address) is answered by editing the field that is still on screen.
 */

import { h } from '../../../lib/dom.js';
import { createInlineError } from '../../../lib/dom/inline-error.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/dom/toast.js';
import { createModal, createModalActions } from '../../../lib/dom/modal.js';
import { authConfig, ssoButtonLabel } from '../../../lib/user/auth.js';
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
 * How someone gets into this instance, from its public auth config.
 *
 * @param {{ sso?: { enabled?: boolean, enforce?: boolean } }|null} config -
 *   `GET /api/auth/config`, or null when it could not be read.
 * @returns {'sso'|'sso-or-password'|'password'|null} null when unknown, so the
 *   report can avoid guessing.
 */
export function signInMode(config) {
  const sso = config?.sso;
  if (!sso || typeof sso !== 'object') return null;
  if (!sso.enabled) return 'password';
  return sso.enforce ? 'sso' : 'sso-or-password';
}

/**
 * The sentence for a new member who got no setup mail: how they get in, in the
 * words of the login page they will land on.
 *
 * @param {string} email - Who was added.
 * @param {Object|null} config - `GET /api/auth/config`, or null when it could
 *   not be read: how this instance signs in and what its SSO button says.
 * @param {string} url - The login page to send them to.
 * @returns {string}
 */
export function createdWithoutEmailMessage(email, config, url) {
  const mode = signInMode(config);
  const vars = {
    email,
    url,
    sso: ssoButtonLabel(config),
    forgot: t('login.forgotPassword', 'Forgot password?'),
  };
  if (mode === 'sso') {
    return t(
      'organization.members.invite.createdWithoutEmailSso',
      '{email} is now a member, but no email went out. Let them know they can sign in at {url} with "{sso}".',
      vars,
    );
  }
  if (mode === 'sso-or-password') {
    return t(
      'organization.members.invite.createdWithoutEmailSsoOrPassword',
      '{email} is now a member, but no email went out. Let them know they can sign in at {url} with "{sso}", or set a password there via "{forgot}".',
      vars,
    );
  }
  if (mode === 'password') {
    return t(
      'organization.members.invite.createdWithoutEmailPassword',
      '{email} is now a member, but no email went out. Let them know they can set a password at {url} via "{forgot}".',
      vars,
    );
  }
  return t(
    'organization.members.invite.createdWithoutEmailUnknown',
    '{email} is now a member, but no email went out. Let them know yourself how to sign in at {url}.',
    vars,
  );
}

/**
 * The login page with the address filled in, for the inviter to pass on.
 * @param {string} email - The new member.
 * @returns {string}
 */
function loginUrlFor(email) {
  return `${location.origin}/login?email=${encodeURIComponent(email)}`;
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
 * @param {Function} [options.loadAuthConfig=authConfig] - Override for the
 *   sign-in config read (tests).
 * @returns {Object} The modal API, already shown.
 */
export function showInviteModal({
  organizationId,
  user,
  onInvited,
  root = document.body,
  invite = inviteMember,
  loadAuthConfig = authConfig,
} = {}) {
  const roles = invitableRoles(user);
  // Read up front so the report does not wait on it; a failed read is not an
  // error here, it only means the report cannot name the way in.
  const configRead = Promise.resolve()
    .then(() => loadAuthConfig())
    .catch(() => null);
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

  // `status` carries progress only ("Deleting…", "Saving…"). A refusal is a
  // state of this form, so it goes in the one element for that, beside the
  // action and staying until the next attempt
  // (docs/reference/feedback-surfaces.md).
  const status = h('div', { class: 'help modal-status', role: 'status' });
  const refusal = createInlineError({ callout: true });

  const actions = createModalActions({
    cancelText: t('common.cancel', 'Cancel'),
    actionText: t('organization.members.invite.submit', 'Send invitation'),
    onCancel: () => modal.requestClose(),
    onAction: () => submit(),
  });

  form.append(
    emailField,
    nameField,
    roleField,
    status,
    refusal.el,
    actions.wrap,
  );
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

    refusal.clear();
    const email = emailInput.value.trim();
    if (!email || !email.includes('@')) {
      status.textContent = '';
      refusal.show(
        t(
          'organization.members.invite.invalidEmail',
          'Enter a valid email address.',
        ),
        { control: emailInput },
      );
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
      onInvited?.(result);
      if (result.outcome === 'invited') {
        toast.success(
          t('organization.members.invite.sent', 'Invitation sent to {email}.', {
            email: result.email,
          }),
        );
        modal.close();
        return;
      }
      showOutcome(result, await configRead);
    } catch (err) {
      status.textContent = '';
      refusal.show(inviteErrorMessage(err));
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
   * Replace the form with a report that asks the inviter to act. It stays
   * until they close it: the member exists now, so there is nothing left to
   * submit, only something to pass on.
   *
   * @param {{outcome: string, email: string}} result - From `inviteMember()`.
   * @param {Object|null} config - The sign-in config, null when unreadable.
   */
  function showOutcome(result, config) {
    const url = loginUrlFor(result.email);
    const message =
      result.outcome === 'added'
        ? t(
            'organization.members.invite.added',
            '{email} already had an account here and is now a member. They were not emailed, so tell them yourself.',
            { email: result.email },
          )
        : createdWithoutEmailMessage(result.email, config, url);

    const report = h('p', {
      class: 'organization-invite-outcome',
      role: 'status',
      text: message,
    });

    const done = h('button', {
      class: 'btn btn-primary',
      type: 'button',
      text: t('common.done', 'Done'),
      onclick: () => modal.close(),
    });
    const buttons = [done];
    if (result.outcome === 'created') {
      const copy = h('button', {
        class: 'btn btn-secondary',
        type: 'button',
        text: t('organization.members.invite.copyLoginLink', 'Copy link'),
      });
      copy.onclick = async () => {
        try {
          await navigator.clipboard.writeText(url);
          toast.success(t('common.copied', 'Copied'));
        } catch (err) {
          toast.error(err);
        }
      };
      buttons.unshift(copy);
    }

    modal.setBusy(false);
    if (modal.hint) modal.hint.hidden = true;
    form.replaceChildren(
      report,
      h('div', { class: 'row is-end modal-actions' }, buttons),
    );
    done.focus();
  }
}
