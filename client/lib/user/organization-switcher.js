/**
 * Organization switcher section for the user menu (multi-organization mode).
 *
 * Lists the organizations the signed-in user is a member of and switches the
 * session to one of them. Two deliberate behaviours:
 *
 * - **Nothing renders, and nothing is fetched, unless `features.multiOrganization`
 *   is on.** The whole `/api/organizations` surface is behind the same flag on
 *   the server (403 otherwise), so a single-organization instance must not even ask.
 * - **A successful switch does a full `location.reload()`**, not a targeted
 *   cache invalidation. The session cookie now points at a different
 *   organization and every in-memory cache in the view still holds the previous
 *   one; a missed cache here is not slowness but a cross-organization leak in
 *   the UI.
 */

import { h } from '../dom.js';
import { api } from '../api.js';
import { toast } from '../dom/toast.js';
import { t } from '../ui-i18n.js';
import { getFeatures } from '../state/features.js';

/**
 * Fetch the organizations the signed-in user belongs to.
 *
 * @returns {Promise<Array<{ id: string, name: string, displayName?: string|null }>>}
 */
export async function loadOrganizations() {
  const res = await api('/api/organizations');
  return Array.isArray(res?.organizations) ? res.organizations : [];
}

/**
 * Switch the session to another organization.
 *
 * @param {string} organizationId
 * @returns {Promise<void>}
 */
export async function switchOrganization(organizationId) {
  await api(`/api/organizations/${encodeURIComponent(organizationId)}/switch`, {
    method: 'POST',
  });
}

/**
 * Human label for an organization row.
 *
 * @param {{ name?: string, displayName?: string|null, id?: string }} org
 * @returns {string}
 */
function organizationLabel(org) {
  const display =
    typeof org?.displayName === 'string' ? org.displayName.trim() : '';
  if (display) return display;
  const name = typeof org?.name === 'string' ? org.name.trim() : '';
  return name || String(org?.id || '');
}

/**
 * Create the organization section for the user menu.
 *
 * Returns `null` when multi-organization is disabled — the caller then renders no
 * section at all and no request is made. When enabled, the returned element
 * starts empty and fills itself once the list arrives; it stays empty when the
 * user belongs to fewer than two organizations, since a switcher only carries
 * meaning from the second organization onwards.
 *
 * @param {Object} [options]
 * @param {string} [options.activeOrganizationId] - Currently active organization.
 * @param {Function} [options.onBeforeSwitch] - Called before the switch request
 *   (used to close the dropdown).
 * @param {Function} [options.load] - Override for the list fetch (tests).
 * @param {Function} [options.switchTo] - Override for the switch request (tests).
 * @param {Function} [options.reload] - Override for the page reload (tests).
 * @returns {{ el: HTMLElement, ready: Promise<void> }|null}
 */
export function createOrganizationSection({
  activeOrganizationId = null,
  onBeforeSwitch,
  load = loadOrganizations,
  switchTo = switchOrganization,
  reload = () => location.reload(),
} = {}) {
  if (!getFeatures()?.multiOrganization) return null;

  // `radiogroup` + `radio`, the same pairing `ui-mode-switcher.js` uses for
  // "pick exactly one of these". Deliberately *not* `menuitemradio`: that role
  // must be owned by a `menu`, and this dropdown has none — its other entries
  // are plain buttons. An orphan menu role promises arrow-key navigation that
  // nothing here implements.
  const el = h('div', {
    class: 'user-menu-orgs',
    role: 'radiogroup',
    'aria-label': t('common.organization', 'Organization'),
  });

  const ready = load()
    .then((organizations) => {
      // One organization is not a choice — render nothing at all.
      if (!Array.isArray(organizations) || organizations.length < 2) return;
      el.append(
        h('div', {
          class: 'dropdown-help',
          text: t('common.organization', 'Organization'),
        }),
        ...organizations.map((org) => renderRow(org)),
        h('div', { class: 'dropdown-sep' }),
      );
    })
    .catch((err) => {
      // Deliberately silent: the section simply does not appear. A failed list
      // load happens on page render, where a toast would be noise the user can
      // do nothing about — unlike a failed switch, which they asked for.
      console.warn('[organizations] Could not load organization list:', err);
    });

  /**
   * @param {{ id: string, name?: string, displayName?: string|null }} org
   * @returns {HTMLElement}
   */
  function renderRow(org) {
    const isActive = !!activeOrganizationId && org.id === activeOrganizationId;
    const label = organizationLabel(org);
    const row = h(
      'button',
      {
        class: 'dropdown-item user-menu-org',
        type: 'button',
        role: 'radio',
        'aria-checked': isActive ? 'true' : 'false',
        'data-organization-id': org.id,
        title: isActive
          ? t('common.organizationCurrent', 'Current organization')
          : t('common.organizationSwitchTo', 'Switch to {name}', {
              name: label,
            }),
        // Deliberately not `disabled`: the check mark already says "you are
        // here", and dimming the active row would make the organization you
        // are in look like the one you are not.
        onclick: () => {
          if (isActive) return;
          switchToOrganization(org.id);
        },
      },
      [
        // Fixed-width slot so active and inactive labels line up.
        h('span', {
          class: 'user-menu-org-check',
          'aria-hidden': 'true',
          text: isActive ? '✓' : '',
        }),
        h('span', { text: label }),
      ],
    );
    return row;
  }

  /**
   * @param {string} organizationId
   */
  async function switchToOrganization(organizationId) {
    onBeforeSwitch?.();
    try {
      await switchTo(organizationId);
    } catch (err) {
      const message =
        err?.statusCode === 403
          ? t(
              'common.organizationSwitchForbidden',
              'You cannot switch to this organization.',
            )
          : t(
              'common.organizationSwitchFailed',
              'Could not switch organization.',
            );
      toast.error(message);
      return;
    }
    reload();
  }

  return { el, ready };
}
