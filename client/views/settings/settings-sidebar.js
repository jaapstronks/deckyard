/**
 * Settings Sidebar Component
 *
 * A labelled navigation of real links, one per reachable section, grouped by
 * scope (B805). Each link is `#<key>`, so a section is an address: it opens in
 * a new browser tab, Back and Forward walk through the sections, and reload
 * keeps the one on screen. The page decides what a click does (it may ask
 * about unsaved changes first); this component only draws and reports.
 *
 * Wide screens show the groups as a column. Narrow screens show one opener
 * naming the current section, which expands the same groups vertically: the
 * same links, never a second hidden set.
 */

import { h } from '../../lib/dom/index.js';
import { t } from '../../lib/ui-i18n.js';
import { icon } from '../../lib/dom/icons.js';
import { getFeatures } from '../../lib/state/features.js';
import { sidebarSections } from './tab-registry.js';
import { fetchOrganization } from './organization-profile/actions.js';
import { debugLog } from '../../lib/state/debug.js';
import { takeEscape } from '../../lib/dom/escape.js';

/**
 * Whether a click should be left to the browser: a modified or non-primary
 * click opens the link elsewhere and does not change this page.
 * @param {MouseEvent} event
 * @returns {boolean}
 */
function isNativeOpen(event) {
  return (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

/**
 * Create the settings sidebar component.
 * @param {Object} options
 * @param {boolean} options.isAdmin - Admin of the active organization
 * @param {boolean} options.isInstanceAdmin - Installation administrator
 * @param {boolean} options.isDesigner - Whether user has designer capability
 * @param {boolean} [options.canSeeMembers] - Whether the members tab is reachable
 * @param {boolean} [options.canSeeOrganization] - Whether the organization tab is reachable
 * @param {string} [options.organizationId] - Active organization for the scope heading
 * @param {string} options.activeTab - Currently active section key
 * @param {(key: string) => void} options.onNavigate - A link to a section was
 *   followed; the page performs (or refuses) the switch
 * @returns {{el: HTMLElement, setActiveTab: (key: string) => void, close: () => void, detach: () => void}}
 */
export function createSettingsSidebar({
  isAdmin,
  isInstanceAdmin,
  isDesigner,
  canSeeMembers = isAdmin,
  canSeeOrganization = false,
  organizationId = null,
  activeTab,
  onNavigate,
}) {
  const sidebar = h('nav', {
    class: 'settings-sidebar',
    'aria-label': t('settings.tabs.ariaLabel', 'Settings navigation'),
  });

  const listId = 'settings-sidebar-sections';
  const currentLabel = h('span', { class: 'settings-sidebar-toggle-current' });
  const toggle = h(
    'button',
    {
      class: 'settings-sidebar-toggle',
      type: 'button',
      'aria-expanded': 'false',
      'aria-controls': listId,
    },
    [
      h('span', { class: 'settings-sidebar-toggle-text' }, [
        h('span', {
          class: 'settings-sidebar-toggle-caption',
          text: t('settings.tabs.sectionCaption', 'Section'),
        }),
        currentLabel,
      ]),
      icon('chevron-down', { className: 'settings-sidebar-toggle-caret' }),
    ],
  );
  const list = h('div', { class: 'settings-sidebar-sections', id: listId });
  sidebar.append(toggle, list);

  /** @type {Record<string, HTMLAnchorElement>} */
  const links = {};
  /** @type {Record<string, string>} */
  const labels = {};

  const createLink = (tab) => {
    const renamed =
      tab.multiOrganizationLabelKey && getFeatures()?.multiOrganization;
    const text = renamed
      ? t(tab.multiOrganizationLabelKey, tab.multiOrganizationLabel)
      : t(tab.labelKey, tab.label);
    const link = h('a', {
      class: 'settings-sidebar-tab',
      href: `#${tab.key}`,
      'data-tab': tab.key,
      onclick: (event) => {
        if (isNativeOpen(event)) return;
        event.preventDefault();
        onNavigate?.(tab.key);
      },
    });
    link.append(h('span', { class: 'settings-sidebar-tab-label', text }));
    links[tab.key] = link;
    labels[tab.key] = text;
    return h('li', {}, [link]);
  };

  let groupSeq = 0;
  /**
   * One scope group: a caption and the list it names.
   * @param {Array<Object>} tabs
   * @param {string|null} caption - `null` for the personal group, which leads
   *   the column without a caption
   * @returns {HTMLElement|null} The caption element, for a late rename
   */
  const appendGroup = (tabs, caption) => {
    if (!tabs.length) return null;
    const groupId = `settings-sidebar-group-${++groupSeq}`;
    const captionEl = caption
      ? h('span', {
          class: 'settings-sidebar-divider-label',
          id: groupId,
          text: caption,
        })
      : null;
    const group = h('div', { class: 'settings-sidebar-group' }, [
      captionEl
        ? h('div', { class: 'settings-sidebar-divider' }, [captionEl])
        : null,
      h(
        'ul',
        {
          class: 'settings-sidebar-list',
          ...(captionEl ? { 'aria-labelledby': groupId } : {}),
        },
        tabs.map(createLink),
      ),
    ]);
    list.append(group);
    return captionEl;
  };

  const sections = sidebarSections({
    isAdmin,
    isInstanceAdmin,
    isDesigner,
    canSeeMembers,
    canSeeOrganization,
  });

  // Personal settings stay personal regardless of the active organization.
  appendGroup(sections.personal, null);

  const organizationCaption = appendGroup(
    sections.organization,
    t('settings.tabs.organizationSection', 'Organization'),
  );
  if (
    organizationCaption &&
    getFeatures()?.multiOrganization &&
    organizationId
  ) {
    fetchOrganization(organizationId)
      .then(({ organization }) => {
        if (organization)
          organizationCaption.textContent =
            organization.displayName || organization.name;
      })
      .catch((err) => debugLog('Active organization name unavailable', err));
  }

  appendGroup(sections.designer, t('settings.tabs.designerSection', 'Design'));
  appendGroup(
    sections.instance,
    t('settings.tabs.adminSection', 'Installation'),
  );

  const isOpen = () => sidebar.classList.contains('is-open');
  const setOpen = (open) => {
    sidebar.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  /** Collapse the narrow-screen list; a no-op where it is a column. */
  const close = () => setOpen(false);

  toggle.addEventListener('click', () => setOpen(!isOpen()));
  sidebar.addEventListener('keydown', (event) => {
    if (!isOpen() || !takeEscape(event)) return;
    close();
    toggle.focus();
  });
  // A click outside the open list folds it away, as any disclosure does.
  const onDocumentClick = (event) => {
    if (isOpen() && !sidebar.contains(event.target)) close();
  };
  document.addEventListener('click', onDocumentClick);

  const setActiveTab = (tabKey) => {
    for (const [key, link] of Object.entries(links)) {
      const isActive = key === tabKey;
      link.classList.toggle('is-active', isActive);
      if (isActive) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    currentLabel.textContent = labels[tabKey] || '';
  };
  setActiveTab(activeTab);

  return {
    el: sidebar,
    setActiveTab,
    close,
    detach: () => document.removeEventListener('click', onDocumentClick),
  };
}
