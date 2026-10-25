/**
 * Organization members panel (organization UI, slices 3-4).
 *
 * In multi-workspace mode this replaces the instance-wide user list in the
 * Users tab. The old panel reads `/api/admin/users`, which lists people by
 * their `users.organization_id` — their *home* organization, which since phase 0
 * is explicitly no longer the authority on where someone works — and enriches
 * them with designer status against the hard-coded default organization. Both
 * are invisibly correct on a single-workspace instance and wrong the moment
 * there is a second organization. This panel asks the organization instead.
 *
 * Slice 4 adds the mutations and the paging that slice 3 deliberately stopped
 * short of. Two of the actions change the viewer's own standing rather than
 * someone else's — leaving the organization, and handing it over — so they end
 * in a full reload for the same reason switching organizations does
 * (briefing decision 4): every in-memory cache in the view, the admin gates
 * included, was computed for a role the viewer no longer holds.
 *
 * Slice 5 adds the way in (invite-modal.js) and, with it, the first viewers
 * who are not admins: the tab now opens to every member of the organization.
 * Nothing here gates on that. Which controls a row carries has been
 * `permissions.js`'s answer since slice 4, and for a plain member it already
 * comes out as "read the list, leave if you want to" — so the limited view is
 * the same panel, asked the same question, about a weaker role.
 */

import { h } from '../../../lib/dom/index.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/dom/toast.js';
import { renderMembersList } from './member-list.js';
import { canInvite } from './permissions.js';
import { showInviteModal } from './invite-modal.js';
import {
  fetchMembers,
  fetchMemberCount,
  changeMemberRole,
  removeMember,
  transferOwnership,
  MEMBERS_PAGE_SIZE,
} from './actions.js';

/**
 * Render the organization members panel.
 *
 * @param {Object} options
 * @param {Object} options.user - Current user, from `/api/auth/me`.
 * @param {Function} [options.load] - Override for the members fetch (tests).
 * @param {Function} [options.count] - Override for the member count (tests).
 * @param {Function} [options.reload] - Override for the full page reload (tests).
 * @param {Function} [options.openInvite] - Override for the invite dialog (tests).
 * @returns {{ el: HTMLElement, ready: Promise<void> }} The panel and its load.
 */
export function renderOrganizationMembersPanel({
  user,
  load = fetchMembers,
  count = fetchMemberCount,
  reload = () => location.reload(),
  openInvite = showInviteModal,
} = {}) {
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
          'Everyone with access to the organization you are currently in.',
        ),
      }),
    ]),
  );

  const list = h('div', { class: 'admin-users-list' });
  list.append(
    h('div', { class: 'help', text: t('common.loading', 'Loading…') }),
  );

  const footer = h('div', {
    class: 'row is-between admin-users-pager',
    style: 'margin-top: 12px;',
  });

  card.append(header, list, footer);

  const organizationId = user?.organizationId;
  if (!organizationId) {
    // No active organization on the session means there is nothing to list. It
    // should not happen in multi-workspace mode (auth refuses a session it
    // cannot bind to a membership), so say so rather than showing an empty list
    // that looks like an organization of nobody.
    showLoadFailure();
    return { el: card, ready: Promise.resolve() };
  }

  // The list is read by cursor (D358), newest member first: `members` is
  // everything loaded so far, `nextCursor` where the next page starts.
  let members = [];
  let nextCursor = null;
  let total = 0;
  let busy = false;

  if (canInvite(user)) {
    const inviteBtn = h('button', {
      class: 'btn btn-primary btn-sm',
      type: 'button',
      text: t('organization.members.invite.open', 'Invite'),
    });
    inviteBtn.onclick = () =>
      openInvite({
        organizationId,
        user,
        // Reload as much of the list as the reader had open rather than
        // folding it back to one page: the toast already said what happened,
        // and losing their place in a long organization would not help.
        onInvited: () => show(members.length),
      });
    header.append(inviteBtn);
  }

  const handlers = {
    onChangeRole: async (member, role) => {
      const ok = await changeMemberRole({ organizationId, member, role });
      if (ok) await show(members.length);
      return ok;
    },
    onTransferOwnership: async (member) => {
      const ok = await transferOwnership({ organizationId, member });
      // The viewer just became an admin. Every gate on this page was drawn for
      // an owner, so reload rather than repaint one card.
      if (ok) reload();
      return ok;
    },
    onRemove: async (member, self) => {
      const ok = await removeMember({ organizationId, member, self });
      if (!ok) return false;
      if (self) {
        // The session is still pointed at an organization the viewer is no
        // longer a member of. Reload and let auth re-resolve the active one.
        reload();
        return true;
      }
      await show(Math.max(1, members.length - 1));
      return true;
    },
  };

  const ready = show(MEMBERS_PAGE_SIZE);

  return { el: card, ready };

  /**
   * Load the list from the top, at least `depth` members deep (or to its
   * end), with the count beside it, and render both.
   * @param {number} depth - How many members the reader had open.
   * @returns {Promise<void>}
   */
  async function show(depth) {
    if (busy) return;
    busy = true;
    try {
      const [loaded, counted] = await Promise.all([
        readUntil(depth),
        count(organizationId),
      ]);
      ({ members, nextCursor } = loaded);
      total = counted;
      renderMembersList(list, members, user, { handlers });
      renderPager();
    } catch (err) {
      console.warn('[organization-members] Could not load members:', err);
      showLoadFailure();
    } finally {
      busy = false;
    }
  }

  /**
   * Read pages from the top until `depth` members are in or the list ends.
   * @param {number} depth
   * @returns {Promise<{ members: Array<Object>, nextCursor: string|null }>}
   */
  async function readUntil(depth) {
    let rows = [];
    let cursor = null;
    do {
      const page = await load(organizationId, {
        cursor,
        limit: MEMBERS_PAGE_SIZE,
      });
      rows = [...rows, ...page.members];
      cursor = page.nextCursor;
    } while (cursor && rows.length < depth);
    return { members: rows, nextCursor: cursor };
  }

  /** Read the next page and append it. */
  async function loadMore(button) {
    if (busy || !nextCursor) return;
    busy = true;
    button.disabled = true;
    button.textContent = t('common.loadingMore', 'Loading…');
    try {
      const page = await load(organizationId, {
        cursor: nextCursor,
        limit: MEMBERS_PAGE_SIZE,
      });
      members = [...members, ...page.members];
      nextCursor = page.nextCursor;
      renderMembersList(list, members, user, { handlers });
    } catch (err) {
      console.warn('[organization-members] Could not load more members:', err);
      toast.error(t('common.loadMoreError', 'Could not load more.'));
    } finally {
      busy = false;
      renderPager();
    }
  }

  /**
   * Render how many members are shown of how many there are, and the button
   * for the next page while there is one.
   *
   * The count is always stated, not only when more remain: "25 of 140" is
   * what stops a page from reading like a whole organization.
   */
  function renderPager() {
    footer.replaceChildren();
    if (!members.length) return;

    footer.append(
      h('div', {
        class: 'help',
        text: t(
          'organization.members.shown',
          'Showing {shown} of {count} members.',
          { shown: members.length, count: total },
        ),
      }),
    );
    if (!nextCursor) return;

    const more = h('button', {
      class: 'btn btn-secondary admin-users-more',
      type: 'button',
      text: t('common.loadMore', 'Load more'),
    });
    more.onclick = () => loadMore(more);
    footer.append(more);
  }

  function showLoadFailure() {
    list.replaceChildren();
    footer.replaceChildren();
    list.append(
      h('div', {
        class: 'help',
        text: t(
          'organization.members.loadFailed',
          'Could not load the member list.',
        ),
      }),
    );
  }
}
