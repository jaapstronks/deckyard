/**
 * Organization member list rendering (organization UI, slices 3-4).
 *
 * Slice 3 put the members of the *active* organization in the Users tab and
 * left the rows read-only. Slice 4 gives them their actions: change a role,
 * remove someone, leave, hand the organization over.
 *
 * Which buttons a row carries is decided by `permissions.js`, a mirror of the
 * route's own checks, so a control that is certain to be refused is never
 * drawn. The mirror is a courtesy and not the authority: the server decides,
 * and `actions.js` treats its refusals as ordinary outcomes.
 *
 * Reuses the `.admin-user-*` classes rather than minting a parallel set: this
 * is the same tab, showing the same kind of row, in a different mode.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { confirmModal } from '../../../lib/dom/modal.js';
import {
  canChangeRole,
  canRemove,
  canTransferOwnership,
  isOwnerBlockedFromLeaving,
  isSelf,
} from './permissions.js';

/**
 * Human label for a membership role.
 * @param {string} role - Membership role (`owner` / `admin` / `member`)
 * @returns {string}
 */
function roleLabel(role) {
  if (role === 'owner') return t('organization.members.roleOwner', 'Owner');
  if (role === 'admin') return t('organization.members.roleAdmin', 'Admin');
  return t('organization.members.roleMember', 'Member');
}

/**
 * The name to use when talking *about* someone in a confirmation.
 * @param {Object} member - Member row
 * @returns {string}
 */
function memberName(member) {
  return member?.user?.name || member?.user?.email || '';
}

/**
 * Build the role control for a row: a select between member and admin.
 *
 * The change fires immediately — it is a reversible, non-destructive edit, and
 * a confirmation on every step would make routine role hygiene tedious. What
 * it does need is honesty when it fails: the select snaps back to the role the
 * member actually still has, so the screen never claims a change the server
 * refused.
 *
 * @param {Object} member - Member row
 * @param {Object} handlers - Action handlers from the panel
 * @returns {HTMLElement}
 */
function renderRoleControl(member, handlers) {
  const select = h('select', {
    class: 'form-input admin-user-role-select',
    'aria-label': t('organization.members.changeRoleFor', 'Role for {name}', {
      name: memberName(member),
    }),
  });
  for (const role of ['member', 'admin']) {
    select.append(
      h('option', {
        value: role,
        text: roleLabel(role),
        selected: member.role === role,
      }),
    );
  }

  select.onchange = async () => {
    const next = select.value;
    if (next === member.role) return;
    select.disabled = true;
    const ok = await handlers.onChangeRole(member, next);
    // On failure the list is not reloaded, so put the control back where the
    // data still is.
    if (!ok) {
      select.value = member.role;
      select.disabled = false;
    }
  };

  return select;
}

/**
 * The actions column for one member row.
 * @param {Object} member - Member row
 * @param {Object} currentUser - Current logged-in user
 * @param {Object} handlers - Action handlers from the panel
 * @returns {HTMLElement|null}
 */
function renderMemberActions(member, currentUser, handlers) {
  const wrap = h('div', { class: 'admin-user-actions' });
  let any = false;

  if (canChangeRole(member, currentUser)) {
    wrap.append(renderRoleControl(member, handlers));
    any = true;
  }

  if (canTransferOwnership(member, currentUser)) {
    const btn = h('button', {
      class: 'btn btn-sm btn-ghost',
      type: 'button',
      text: t('organization.members.transferOwnership', 'Make owner'),
    });
    btn.onclick = async () => {
      const confirmed = await confirmModal(document.body, {
        title: t('organization.members.transferOwnership', 'Make owner'),
        message: t(
          'organization.members.transferOwnershipConfirm',
          'Hand this organization over to {name}? They become the owner and you become an admin. Only they can hand it back.',
          { name: memberName(member) },
        ),
        confirmLabel: t('organization.members.transferOwnership', 'Make owner'),
        danger: true,
      });
      if (!confirmed) return;
      btn.disabled = true;
      const ok = await handlers.onTransferOwnership(member);
      if (!ok) btn.disabled = false;
    };
    wrap.append(btn);
    any = true;
  }

  if (canRemove(member, currentUser)) {
    const self = isSelf(member, currentUser);
    const btn = h('button', {
      class: 'btn btn-sm btn-ghost btn-danger',
      type: 'button',
      text: self
        ? t('organization.members.leave', 'Leave')
        : t('organization.members.remove', 'Remove'),
    });
    btn.onclick = async () => {
      const confirmed = await confirmModal(document.body, {
        title: self
          ? t('organization.members.leaveTitle', 'Leave organization')
          : t('organization.members.removeTitle', 'Remove member'),
        message: self
          ? t(
              'organization.members.leaveConfirm',
              'Leave this organization? You lose access to everything in it until someone invites you back.',
            )
          : t(
              'organization.members.removeConfirm',
              'Remove {name} from this organization? They lose access to everything in it. Their account and their other organizations are untouched.',
              { name: memberName(member) },
            ),
        confirmLabel: self
          ? t('organization.members.leave', 'Leave')
          : t('organization.members.remove', 'Remove'),
        danger: true,
      });
      if (!confirmed) return;
      btn.disabled = true;
      const ok = await handlers.onRemove(member, self);
      if (!ok) btn.disabled = false;
    };
    wrap.append(btn);
    any = true;
  }

  if (isOwnerBlockedFromLeaving(member, currentUser)) {
    // Say why there is no Leave button here. Silence would read as a missing
    // feature; this is a rule, and it names its own way out.
    wrap.append(
      h('div', {
        class: 'help admin-user-action-note',
        text: t(
          'organization.members.ownerCannotLeave',
          'Hand the organization over to someone else before you can leave it.',
        ),
      }),
    );
    any = true;
  }

  return any ? wrap : null;
}

/**
 * Render a single member card.
 * @param {Object} member - Member from `GET /api/organizations/:id/members`
 * @param {Object} currentUser - Current logged-in user
 * @param {Object|null} handlers - Action handlers, or null for a read-only list
 * @returns {HTMLElement}
 */
function renderMemberCard(member, currentUser, handlers) {
  const person = member?.user || {};
  const card = h('div', { class: 'admin-user-card' });
  const mainRow = h('div', { class: 'admin-user-main' });
  const info = h('div', { class: 'admin-user-info' });

  const emailRow = h('div', { class: 'admin-user-email-row' });
  emailRow.append(
    h('span', { class: 'admin-user-email', text: person.email || '' }),
  );

  // Owner and admin share the elevated badge treatment; the label is what
  // separates them.
  emailRow.append(
    h('span', {
      class: `admin-user-role-badge ${member.role === 'member' ? '' : 'is-admin'}`,
      text: roleLabel(member.role),
    }),
  );

  // The explicit `is_designer` flag only. Owners, and admins on an organization
  // that leaves `adminsAreDesigners` on, hold the capability through their role
  // instead — badging them here would read as a flag that is not set.
  if (member.isDesigner) {
    emailRow.append(
      h('span', {
        class: 'admin-user-role-badge is-designer',
        text: t('organization.members.roleDesigner', 'Designer'),
      }),
    );
  }

  if (isSelf(member, currentUser)) {
    emailRow.append(
      h('span', {
        class: 'admin-user-role-badge',
        text: t('organization.members.you', 'You'),
      }),
    );
  }

  info.append(emailRow);

  if (person.name) {
    info.append(h('div', { class: 'admin-user-name', text: person.name }));
  }

  info.append(
    h('div', {
      class: 'admin-user-last-login',
      text: member.joinedAt
        ? t('organization.members.memberSince', 'Member since {date}', {
            date: new Date(member.joinedAt).toLocaleDateString(),
          })
        : t(
            'organization.members.memberSinceUnknown',
            'Membership date unknown',
          ),
    }),
  );

  mainRow.append(info);

  const actions = handlers
    ? renderMemberActions(member, currentUser, handlers)
    : null;
  if (actions) mainRow.append(actions);

  card.append(mainRow);
  return card;
}

/**
 * Render the member list into a container.
 *
 * @param {HTMLElement} container - Container element (cleared first)
 * @param {Array<Object>} members - Members to render
 * @param {Object} currentUser - Current logged-in user
 * @param {Object} [options]
 * @param {Object} [options.handlers] - Action handlers; omit for a read-only list
 */
export function renderMembersList(
  container,
  members,
  currentUser,
  options = {},
) {
  container.innerHTML = '';

  if (!members.length) {
    container.append(
      h('div', {
        class: 'help',
        text: t('organization.members.empty', 'No members found.'),
      }),
    );
    return;
  }

  const list = h('div', { class: 'admin-users-grid' });
  for (const member of members) {
    list.append(
      renderMemberCard(member, currentUser, options.handlers || null),
    );
  }
  container.append(list);
}
