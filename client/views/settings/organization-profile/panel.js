/**
 * Organization profile panel (organization UI, slice 6).
 *
 * The screen for the organization itself, next to the one for its people. It
 * draws exactly the three levels `server/routes/api/organizations.js` draws and
 * nothing else: every member reads it, an admin or the owner writes it, and the
 * owner alone may delete it.
 *
 * A plain member gets the same card with its inputs disabled rather than no
 * card at all. That is the slice-5 argument applied once more — the route lets
 * them read this, and "which organization am I actually in, and who runs it" is
 * a fair question for anyone in it — while the ability to change it stays where
 * the server puts it.
 *
 * Two things this panel deliberately does not do:
 *
 *   - **Ownership transfer lives in the Members tab, not here.** It needs a
 *     person to hand the organization to, and that list already exists with the
 *     confirmation and the reload around it. A second entry point would be a
 *     second implementation of the same mutation.
 *   - **The slug is shown, not edited.** `PATCH /api/organizations/:id` accepts
 *     four fields and the slug is not one of them, so it is stated as the
 *     identifier it is.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/dom/toast.js';
import {
  canEditProfile,
  canDeleteOrganization,
  isOrganizationOwner,
} from './permissions.js';
import { showDeleteOrganizationModal } from './delete-modal.js';
import {
  fetchOrganization,
  saveOrganizationProfile,
  changedFields,
  PROFILE_FIELDS,
} from './actions.js';

/**
 * Render the organization profile panel.
 *
 * @param {Object} options
 * @param {Object} options.user - Current user, from `/api/auth/me`.
 * @param {Function} [options.load] - Override for the organization fetch (tests).
 * @param {Function} [options.save] - Override for the PATCH (tests).
 * @param {Function} [options.openDelete] - Override for the delete dialog (tests).
 * @param {Function} [options.onDeleted] - Override for where a deletion lands (tests).
 * @returns {{ el: HTMLElement, ready: Promise<void> }} The panel and its load.
 */
export function renderOrganizationProfilePanel({
  user,
  load = fetchOrganization,
  save = saveOrganizationProfile,
  openDelete = showDeleteOrganizationModal,
  // The session still points at an organization that no longer exists, so this
  // is a full page load rather than a route change: auth has to re-resolve
  // which organization this person is in now, and the deck list is the honest
  // place to land.
  onDeleted = () => location.assign('/app'),
} = {}) {
  const card = h('div', {
    class: 'stack editor-card organization-profile-card',
  });
  const body = h('div', { class: 'stack' });
  card.append(body);

  const wrap = h('div', { class: 'stack' });
  wrap.append(card);

  const organizationId = user?.organizationId;
  if (!organizationId) {
    showLoadFailure();
    return { el: wrap, ready: Promise.resolve() };
  }

  const editable = canEditProfile(user);
  /** @type {Object|null} The organization as the server last confirmed it. */
  let organization = null;
  let busy = false;

  const fields = {};
  const status = h('div', {
    class: 'help organization-profile-status',
    role: 'status',
  });
  let saveBtn = null;

  body.append(
    h('div', { class: 'help', text: t('common.loading', 'Loading…') }),
  );

  const ready = show();

  return { el: wrap, ready };

  /**
   * Load the organization and draw the form.
   * @returns {Promise<void>}
   */
  async function show() {
    try {
      const result = await load(organizationId);
      if (!result?.organization) throw new Error('no organization in response');
      organization = result.organization;
      renderForm();
    } catch (err) {
      console.warn(
        '[organization-profile] Could not load the organization:',
        err,
      );
      showLoadFailure();
    }
  }

  /** Draw the profile card, and the danger zone under it when there is one. */
  function renderForm() {
    body.innerHTML = '';

    body.append(
      h('div', { class: 'stack', style: 'gap: 4px;' }, [
        h('div', {
          class: 'field-label',
          text: t('organization.profile.title', 'Organization profile'),
        }),
        h('div', {
          class: 'help',
          text: editable
            ? t(
                'organization.profile.help',
                'How this organization is named across the app, for everyone in it.',
              )
            : t(
                'organization.profile.readOnlyHelp',
                'How this organization is named across the app. Only an admin or the owner can change it.',
              ),
        }),
      ]),
    );

    body.append(
      textField('name', t('organization.profile.nameLabel', 'Name'), {
        help: t(
          'organization.profile.nameHelp',
          'The organization as it is referred to when there is no display name.',
        ),
      }),
      textField(
        'displayName',
        t('organization.profile.displayNameLabel', 'Display name'),
        {
          help: t(
            'organization.profile.displayNameHelp',
            'Shown in the organization switcher when set.',
          ),
        },
      ),
      textField(
        'description',
        t('organization.profile.descriptionLabel', 'Description'),
        {
          multiline: true,
        },
      ),
      textField('logoUrl', t('organization.profile.logoLabel', 'Logo URL'), {
        type: 'url',
        placeholder: 'https://…',
      }),
    );

    body.append(
      h('div', { class: 'help', style: 'margin-top: 4px;' }, [
        h('span', {
          text: t('organization.profile.slug', 'Identifier: {slug}', {
            slug: organization.slug || '—',
          }),
        }),
      ]),
    );

    if (editable) {
      const actions = h('div', {
        class: 'row is-between',
        style: 'margin-top: 12px;',
      });
      saveBtn = h('button', {
        class: 'btn btn-primary',
        type: 'button',
        text: t('organization.profile.save', 'Save changes'),
      });
      saveBtn.onclick = () => submit();
      actions.append(status, saveBtn);
      body.append(actions);
    }

    renderDangerZone();
  }

  /**
   * The owner's card: deleting the organization, and where transfer lives.
   *
   * Drawn for the owner only. When the owner cannot delete — the default
   * organization is refused by the route — the rule is stated in place of the
   * button, so the absence reads as a rule rather than a missing feature.
   */
  function renderDangerZone() {
    wrap.querySelector('.organization-danger-card')?.remove();
    if (!isOrganizationOwner(user)) return;

    const danger = h('div', {
      class: 'stack editor-card organization-danger-card',
    });
    danger.append(
      h('div', {
        class: 'field-label',
        text: t('organization.profile.ownerSection', 'Owner only'),
      }),
      h('div', {
        class: 'help',
        text: t(
          'organization.profile.transferHint',
          'Handing this organization to someone else is done from the Members tab, next to the person who should get it.',
        ),
      }),
    );

    if (canDeleteOrganization(user, organization)) {
      const deleteBtn = h('button', {
        class: 'btn btn-danger',
        type: 'button',
        style: 'align-self: flex-start;',
        text: t('organization.profile.delete.open', 'Delete organization'),
      });
      deleteBtn.onclick = () =>
        openDelete({
          organization,
          onDeleted: () => {
            toast.success(
              t(
                'organization.profile.delete.done',
                'The organization has been deleted.',
              ),
            );
            onDeleted();
          },
        });
      danger.append(deleteBtn);
    } else {
      danger.append(
        h('div', {
          class: 'help',
          text: t(
            'organization.profile.delete.isDefault',
            'This is the default organization of this instance, so it cannot be deleted.',
          ),
        }),
      );
    }

    wrap.append(danger);
  }

  /**
   * One labelled input, disabled when the viewer may not write.
   *
   * @param {string} key - Profile field name.
   * @param {string} label - Field label.
   * @param {Object} [options]
   * @param {string} [options.help] - Explanation under the label.
   * @param {boolean} [options.multiline] - Render a textarea.
   * @param {string} [options.type='text'] - Input type.
   * @param {string} [options.placeholder] - Input placeholder.
   * @returns {HTMLElement}
   */
  function textField(
    key,
    label,
    { help, multiline, type = 'text', placeholder } = {},
  ) {
    const field = h('label', { class: 'stack', style: 'gap: 4px;' });
    const control = multiline
      ? h('textarea', { class: 'form-input', rows: '3', name: key })
      : h('input', {
          class: 'form-input',
          type,
          name: key,
          autocomplete: 'off',
        });
    if (placeholder) control.setAttribute('placeholder', placeholder);
    control.value = organization?.[key] || '';
    control.disabled = !editable;

    field.append(h('span', { class: 'field-label', text: label }));
    if (help) field.append(h('span', { class: 'help', text: help }));
    field.append(control);

    fields[key] = control;
    return field;
  }

  /**
   * Validate, write the changed fields, and report.
   * @returns {Promise<void>}
   */
  async function submit() {
    if (busy) return;

    const draft = {};
    for (const [key, control] of Object.entries(fields))
      draft[key] = control.value;

    // The route's own minimum. Catching it here keeps the reader in the field
    // they emptied instead of bouncing a 400 off the form.
    if (draft.name.trim().length < 2) {
      status.textContent = t(
        'organization.profile.nameTooShort',
        'The name needs at least two characters.',
      );
      fields.name.focus();
      return;
    }

    const updates = changedFields(organization, draft);
    if (Object.keys(updates).length === 0) {
      status.textContent = t(
        'organization.profile.noChanges',
        'Nothing has changed yet.',
      );
      return;
    }

    setBusy(true);
    status.textContent = t('organization.profile.saving', 'Saving…');

    try {
      const saved = await save({ organizationId, updates });
      // Only the four fields this form owns are taken from the response. What
      // was learned on load and cannot change through a PATCH — `isDefault`,
      // which decides whether the Delete button exists — has to survive a
      // rename, so it is not something the merge gets to overwrite.
      const next = { ...organization };
      for (const field of PROFILE_FIELDS) {
        if (saved && field in saved) next[field] = saved[field];
      }
      organization = next;
      status.textContent = '';
      toast.success(t('organization.profile.saved', 'Organization updated.'));
      for (const [key, control] of Object.entries(fields)) {
        control.value = organization?.[key] || '';
      }
      renderDangerZone();
    } catch (err) {
      // A refusal here is the server naming a rule ("Admin or owner access
      // required"), which beats anything this form could reconstruct from a
      // status code.
      status.textContent =
        err?.message ||
        t('organization.profile.saveFailed', 'Could not save the changes.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Lock or unlock the form while a write is in flight.
   * @param {boolean} value - Whether a request is running.
   */
  function setBusy(value) {
    busy = value;
    if (saveBtn) saveBtn.disabled = value;
    for (const control of Object.values(fields))
      control.disabled = value || !editable;
  }

  function showLoadFailure() {
    body.innerHTML = '';
    body.append(
      h('div', {
        class: 'help',
        text: t(
          'organization.profile.loadFailed',
          'Could not load the organization.',
        ),
      }),
    );
  }
}
