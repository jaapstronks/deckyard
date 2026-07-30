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
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { renderMembersList } from './member-list.js';
import {
  fetchMembers,
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
 * @param {Function} [options.reload] - Override for the full page reload (tests).
 * @returns {{ el: HTMLElement, ready: Promise<void> }} The panel and its load.
 */
export function renderOrganizationMembersPanel({
  user,
  load = fetchMembers,
  reload = () => location.reload(),
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
          'Everyone with access to the organization you are currently in.'
        ),
      }),
    ])
  );

  const list = h('div', { class: 'admin-users-list' });
  list.append(h('div', { class: 'help', text: t('common.loading', 'Loading…') }));

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

  let offset = 0;
  let total = 0;
  let busy = false;

  const handlers = {
    onChangeRole: async (member, role) => {
      const ok = await changeMemberRole({ organizationId, member, role });
      if (ok) await show(offset);
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
      // A removal can empty the last page; step back rather than show nothing.
      const remaining = Math.max(0, total - 1);
      const nextOffset = offset >= remaining && offset > 0 ? offset - MEMBERS_PAGE_SIZE : offset;
      await show(Math.max(0, nextOffset));
      return true;
    },
  };

  const ready = show(0);

  return { el: card, ready };

  /**
   * Load and render one page.
   * @param {number} nextOffset - Where the page starts.
   * @returns {Promise<void>}
   */
  async function show(nextOffset) {
    if (busy) return;
    busy = true;
    try {
      const page = await load(organizationId, {
        offset: nextOffset,
        limit: MEMBERS_PAGE_SIZE,
      });
      offset = Number.isFinite(page?.offset) ? page.offset : nextOffset;
      total = Number.isFinite(page?.total) ? page.total : page.members.length;
      renderMembersList(list, page.members, user, { handlers });
      renderPager(page.members.length);
    } catch (err) {
      console.warn('[organization-members] Could not load members:', err);
      showLoadFailure();
    } finally {
      busy = false;
    }
  }

  /**
   * Render the range line and the page buttons.
   *
   * The range is always stated, not only when the page is short of the total:
   * "1–25 of 140" is what stops a page from reading like a whole organization,
   * and it has to be true on the last page too.
   *
   * @param {number} shown - How many members this page holds.
   */
  function renderPager(shown) {
    footer.innerHTML = '';
    if (!shown) return;

    const first = offset + 1;
    const last = offset + shown;

    footer.append(
      h('div', {
        class: 'help',
        text: t('organization.members.range', 'Showing {first}–{last} of {total} members.', {
          first,
          last,
          total,
        }),
      })
    );

    if (total <= shown && offset === 0) return;

    const buttons = h('div', { class: 'row', style: 'gap: 8px;' });

    const prev = h('button', {
      class: 'btn btn-sm btn-secondary',
      type: 'button',
      text: t('organization.members.previousPage', 'Previous'),
      disabled: offset === 0,
    });
    prev.onclick = () => show(Math.max(0, offset - MEMBERS_PAGE_SIZE));

    const next = h('button', {
      class: 'btn btn-sm btn-secondary',
      type: 'button',
      text: t('organization.members.nextPage', 'Next'),
      disabled: last >= total,
    });
    next.onclick = () => show(offset + MEMBERS_PAGE_SIZE);

    buttons.append(prev, next);
    footer.append(buttons);
  }

  function showLoadFailure() {
    list.innerHTML = '';
    footer.innerHTML = '';
    list.append(
      h('div', {
        class: 'help',
        text: t('organization.members.loadFailed', 'Could not load the member list.'),
      })
    );
  }
}
