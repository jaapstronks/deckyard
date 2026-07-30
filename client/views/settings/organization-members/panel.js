/**
 * Organization members panel (organization UI, slice 3).
 *
 * In multi-workspace mode this replaces the instance-wide user list in the
 * Users tab. The old panel reads `/api/admin/users`, which lists people by
 * their `users.organization_id` — their *home* organization, which since phase 0
 * is explicitly no longer the authority on where someone works — and enriches
 * them with designer status against the hard-coded default organization. Both
 * are invisibly correct on a single-workspace instance and wrong the moment
 * there is a second organization. This panel asks the organization instead.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { renderMembersList } from './member-list.js';
import { fetchMembers } from './actions.js';

/**
 * Render the organization members panel.
 *
 * @param {Object} options
 * @param {Object} options.user - Current user, from `/api/auth/me`.
 * @param {Function} [options.load] - Override for the members fetch (tests).
 * @returns {{ el: HTMLElement, ready: Promise<void> }} The panel and its load.
 */
export function renderOrganizationMembersPanel({ user, load = fetchMembers } = {}) {
  const card = h('div', { class: 'stack editor-card admin-users-card' });

  const header = h('div', {
    class: 'row is-between is-align-start',
    style: 'margin-bottom: 12px;',
  });
  header.append(
    h('div', { class: 'stack', style: 'gap: 4px;' }, [
      h('div', {
        class: 'field-label',
        text: t('organization.members.title', 'Members'),
      }),
      h('div', {
        class: 'help',
        text: t(
          'organization.members.help',
          'Everyone with access to the organization you are currently in.'
        ),
      }),
    ])
  );

  const list = h('div', { class: 'admin-users-list' });
  list.append(h('div', { class: 'help', text: t('common.loading', 'Loading…') }));

  card.append(header, list);

  const organizationId = user?.organizationId;
  if (!organizationId) {
    // No active organization on the session means there is nothing to list. It
    // should not happen in multi-workspace mode (auth refuses a session it
    // cannot bind to a membership), so say so rather than showing an empty list
    // that looks like an organization of nobody.
    showLoadFailure();
    return { el: card, ready: Promise.resolve() };
  }

  const ready = load(organizationId)
    .then(({ members, total }) => {
      renderMembersList(list, members, user, total);
    })
    .catch((err) => {
      console.warn('[organization-members] Could not load members:', err);
      showLoadFailure();
    });

  return { el: card, ready };

  function showLoadFailure() {
    list.innerHTML = '';
    list.append(
      h('div', {
        class: 'help',
        text: t('organization.members.loadFailed', 'Could not load the member list.'),
      })
    );
  }
}
