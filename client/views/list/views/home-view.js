import { t } from '../../../lib/ui-i18n.js';
import { buildSectionHeader } from './section-header.js';
import { createNoPresentationsEmptyState } from '../empty-state.js';
import { createOnboardingChecklist } from '../onboarding-checklist.js';
import { displayNameFromEmail } from '../../../lib/user-format.js';

/**
 * Create the home view with recent presentations and activity preview
 *
 * @param {object} opts
 * @param {Function} opts.h - DOM helper
 * @param {Function} opts.api - API client
 * @param {Function} opts.nav - Navigation function
 * @param {Function} opts.renderCard - Card renderer function
 * @param {Function} opts.setView - View switcher function
 * @param {Array} opts.allByDate - All presentations sorted by date
 * @param {object} opts.themePicker - Theme picker component
 * @param {number} opts.unreadCount - Initial unread count
 * @param {object} [opts.user] - Current user (for the greeting header)
 * @returns {object} - { el, loadActivityPreview }
 */
export function createHomeView({
  h,
  api,
  nav,
  renderCard,
  setView,
  allByDate,
  themePicker,
  unreadCount,
  user,
  onCreate,
}) {
  const homeView = h('div', { class: 'sidebar-view', 'data-view': 'home' });

  // First-run onboarding checklist (create deck / connect an AI agent). Returns
  // null for existing or dismissed users; persists progress so it survives the
  // jump from empty Home to populated Home.
  const onboardingChecklist = createOnboardingChecklist({
    h,
    nav,
    allByDate,
    onCreate,
  });

  // First run: a brand-new user with nothing yet. Foreground the theme picker
  // and one clear create CTA instead of a wall of empty Recent/Popular/Activity
  // sections, which read as "broken" rather than "new".
  const isFirstRun = allByDate.length === 0;
  if (isFirstRun && typeof onCreate === 'function') {
    homeView.append(
      themePicker.el,
      createNoPresentationsEmptyState({
        h,
        title: t('list.home.firstRunTitle', 'Welcome — let’s make your first deck'),
        onCreate,
      })
    );
    if (onboardingChecklist) homeView.append(onboardingChecklist);

    // Activity/popular loaders are no-ops here (their sections aren't mounted),
    // but keep the same return shape so the caller doesn't branch.
    return {
      el: homeView,
      loadActivityPreview: async () => {},
      loadPopularPresentations: async () => {},
    };
  }

  // Recent presentations section
  const homeRecentSection = h('div', { class: 'presentation-section', 'data-section': 'recent' });
  const homeRecentList = h('div', { class: 'list presentation-grid' });

  homeRecentSection.append(
    buildSectionHeader({
      h,
      icon: 'clock',
      title: t('list.home.recent', 'Recent'),
      count: allByDate.length,
      onViewAll: () => setView('recent'),
    }),
    allByDate.length
      ? homeRecentList
      : h('div', { class: 'help', text: t('list.home.recentEmpty', 'No presentations yet.') })
  );

  for (const p of allByDate.slice(0, 4)) {
    homeRecentList.append(renderCard(p, {
      isWorkspace: p.scope === 'workspace',
      isSharedWithMe: p.isSharedWithMe,
      sharedBy: p.sharedBy,
      permission: p.permission,
    }));
  }

  // Popular presentations section
  const homePopularSection = h('div', { class: 'presentation-section', 'data-section': 'popular' });
  const homePopularList = h('div', { class: 'list presentation-grid' });
  const homePopularLoading = h('div', { class: 'help', text: t('list.home.popularLoading', 'Loading popular...') });

  homePopularSection.append(
    buildSectionHeader({
      h,
      icon: 'flame',
      title: t('list.home.popular', 'Popular'),
      count: 0,
      hideViewAll: true,
    }),
    homePopularLoading
  );

  // Activity preview section
  const homeActivitySection = h('div', { class: 'presentation-section', 'data-section': 'activity' });
  const homeActivityList = h('div', { class: 'home-activity-preview' });
  const homeActivityLoading = h('div', { class: 'help', text: t('list.home.activityLoading', 'Loading activity...') });

  homeActivitySection.append(
    buildSectionHeader({
      h,
      icon: 'bell',
      title: t('list.home.activity', 'Recent activity'),
      count: unreadCount,
      onViewAll: () => setView('activity'),
    }),
    homeActivityLoading
  );

  // Greeting header — a real page anchor at the top of the column, replacing
  // the old orphan "Welcome" heading that labelled nothing.
  const homeHeader = buildHomeHeader({ h, user, count: allByDate.length });

  // Assemble home view. Content-first order for a returning user: their work
  // (Recent) leads, then the theme picker as a create affordance, then
  // discovery (Popular) and finally what's happening (Activity).
  if (onboardingChecklist) homeView.append(onboardingChecklist);
  homeView.append(homeHeader, homeRecentSection, themePicker.el);
  homeView.append(homePopularSection, homeActivitySection);

  // Popular presentations loading
  async function loadPopularPresentations() {
    try {
      const presentations = await api('/api/presentations/popular');
      homePopularLoading.remove();

      if (!presentations || presentations.length === 0) {
        homePopularSection.append(
          h('div', { class: 'help', text: t('list.home.popularEmpty', 'No popular presentations yet.') })
        );
      } else {
        for (const p of presentations.slice(0, 4)) {
          homePopularList.append(renderCard(p, {
            isWorkspace: p.scope === 'workspace',
          }));
        }
        homePopularSection.append(homePopularList);
      }
    } catch {
      homePopularLoading.textContent = t('list.home.popularError', 'Failed to load popular.');
    }
  }

  // Activity preview loading
  async function loadActivityPreview() {
    try {
      const resp = await api('/api/activity?limit=5');
      const events = resp?.events || [];
      homeActivityLoading.remove();

      if (events.length === 0) {
        homeActivitySection.append(
          h('div', { class: 'help', text: t('list.home.activityEmpty', 'No recent activity.') })
        );
      } else {
        for (const event of events) {
          homeActivityList.append(renderActivityPreviewItem(h, nav, event));
        }
        homeActivitySection.append(homeActivityList);
      }
    } catch {
      homeActivityLoading.textContent = t('list.home.activityError', 'Failed to load activity.');
    }
  }

  return {
    el: homeView,
    loadActivityPreview,
    loadPopularPresentations,
  };
}

/**
 * Build the home greeting header: "Welcome back, {firstName}" plus a subtitle
 * with today's date and the deck count. Falls back to a name-less greeting for
 * guests or when the user record has no name/email.
 *
 * @param {object} opts
 * @param {Function} opts.h - DOM helper
 * @param {object} [opts.user] - Current user
 * @param {number} opts.count - Total presentation count
 * @returns {HTMLElement}
 */
function buildHomeHeader({ h, user, count }) {
  const rawName = user?.name || displayNameFromEmail(user?.email || '') || '';
  const firstName = rawName.trim().split(/\s+/)[0] || '';

  const greeting = firstName
    ? t('list.home.greeting', 'Welcome back, {name}', { name: firstName })
    : t('list.home.greetingGuest', 'Welcome back');

  let dateLabel = '';
  try {
    dateLabel = new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(new Date());
  } catch {
    dateLabel = '';
  }

  const countLabel = t('list.home.greetingCount', '{count} presentations', { count });
  const subtitleText = dateLabel ? `${dateLabel} · ${countLabel}` : countLabel;

  return h('header', { class: 'home-header' }, [
    h('h1', { class: 'home-header-title', text: greeting }),
    h('p', { class: 'home-header-subtitle', text: subtitleText }),
  ]);
}

/**
 * Render a single activity preview item
 */
function renderActivityPreviewItem(h, nav, event) {
  const item = h('div', {
    class: 'home-activity-item',
    onclick: () => {
      if (event.presentationId) {
        nav?.(`/app/${event.presentationId}`);
      }
    },
  });

  const actorName = event.actorName || event.actorEmail?.split('@')[0] || 'Someone';
  const initials = actorName.slice(0, 2).toUpperCase();

  let actionText = '';
  switch (event.eventType) {
    case 'presentation.created':
      actionText = t('activity.created', 'created');
      break;
    case 'presentation.updated':
      actionText = t('activity.updated', 'updated');
      break;
    case 'comment.created':
      actionText = t('activity.commented', 'commented on');
      break;
    case 'comment.resolved':
      actionText = t('activity.resolved', 'resolved a comment on');
      break;
    default:
      actionText = t('activity.modified', 'modified');
  }

  const targetTitle =
    event.presentation?.title ||
    event.data?.title ||
    event.data?.presentationTitle ||
    t('activity.untitled', 'Untitled');

  item.append(
    h('div', { class: 'home-activity-avatar', text: initials }),
    h('div', { class: 'home-activity-content' }, [
      h('span', { class: 'home-activity-actor', text: actorName }),
      h('span', { class: 'home-activity-action', text: ` ${actionText} ` }),
      h('span', { class: 'home-activity-target', text: `"${targetTitle}"` }),
    ])
  );

  return item;
}