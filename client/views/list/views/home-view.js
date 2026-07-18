import { t } from '../../../lib/ui-i18n.js';
import { buildSectionHeader } from './section-header.js';
import { createNoPresentationsEmptyState } from '../empty-state.js';
import { createOnboardingChecklist } from '../onboarding-checklist.js';
import { displayNameFromEmail } from '../../../lib/user-format.js';
import { createCollectionsApi } from '../../../lib/slide-collections/api.js';

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
 * @param {Function} [opts.onCreate] - Open the creation view (blank).
 * @param {Function} [opts.onComposeFrom] - Open the creation view seeded from a
 *   building block: `({ collection })` or `({ items })`.
 * @returns {object} - { el, loadActivityPreview, loadPopularPresentations, loadBuildingBlocks }
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
  onComposeFrom,
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
      loadBuildingBlocks: async () => {},
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
      onViewAll: () => setView('presentations'),
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
      // Popular is a curated top-few strip, not a full list, so a count badge
      // is meaningless — and it used to render "0 presentations" because the
      // count was fixed at build time, before the async load. Hide it.
      badge: '',
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
      title: t('list.home.activityFromOthers', 'From others'),
      count: unreadCount,
      badge: unreadCount > 0 ? t('list.home.activityNew', '{count} new', { count: unreadCount }) : '',
      onViewAll: () => setView('activity'),
    }),
    homeActivityLoading
  );

  // Building-blocks shelf — the create affordance, backed by reusable slide
  // collections + individual team slides. Replaces the theme-picker "start
  // something new" zone: on a returning Home, "start from a building block" is
  // the more useful create path now that starter kits are gone.
  const homeBlocksSection = h('div', { class: 'presentation-section', 'data-section': 'building-blocks' });
  const homeBlocksList = h('div', { class: 'home-blocks-grid' });
  const homeBlocksLoading = h('div', { class: 'help', text: t('list.home.blocks.loading', 'Loading building blocks...') });

  homeBlocksSection.append(
    buildSectionHeader({
      h,
      icon: 'blocks',
      title: t('list.home.blocks.title', 'Building blocks'),
      badge: '',
      onViewAll: () => setView('slideLibrary'),
    }),
    homeBlocksLoading
  );

  // Greeting header — a real page anchor at the top of the column, replacing
  // the old orphan "Welcome" heading that labelled nothing.
  const homeHeader = buildHomeHeader({ h, user, count: allByDate.length });

  // Assemble home view as two columns under a full-width greeting header. The
  // main column carries the returning user's top job — resume recent work —
  // plus discovery (Popular) and a de-emphasized create affordance (theme
  // picker). The right rail carries the always-visible "what did others do"
  // feed, so awareness is never buried at the bottom of a long scroll.
  if (onboardingChecklist) homeView.append(onboardingChecklist);

  const homeColumns = h('div', { class: 'home-columns' });
  const homeMain = h('div', { class: 'home-main' });
  const homeRail = h('aside', {
    class: 'home-rail',
    'aria-label': t('list.home.activityFromOthers', 'From others'),
  });

  homeMain.append(homeRecentSection, homePopularSection, homeBlocksSection);
  homeRail.append(homeActivitySection);
  homeColumns.append(homeMain, homeRail);
  homeView.append(homeHeader, homeColumns);

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

  // Activity preview loading. `excludeSelf` keeps your own comments out — on
  // Home they're redundant with the work you already see. We over-fetch (raw
  // events) then bundle consecutive same-actor/same-deck runs into one line
  // ("Heleen · 3 comments on X"), which fits far more signal in the rail.
  async function loadActivityPreview() {
    try {
      const resp = await api('/api/activity?limit=20&excludeSelf=true');
      const events = resp?.events || [];
      const bundles = bundleActivityEvents(events).slice(0, 6);
      homeActivityLoading.remove();

      if (bundles.length === 0) {
        homeActivitySection.append(
          h('div', { class: 'help', text: t('list.home.activityNoneOthers', 'Nothing new from others.') })
        );
      } else {
        for (const bundle of bundles) {
          homeActivityList.append(renderActivityPreviewItem(h, nav, bundle));
        }
        homeActivitySection.append(homeActivityList);
      }
    } catch {
      homeActivityLoading.textContent = t('list.home.activityError', 'Failed to load activity.');
    }
  }

  // Building-blocks shelf loading. Collections (team first) come first as the
  // richest reusable unit; we top up the shelf with the most recent individual
  // team slides so it never looks empty when a workspace has few collections.
  // A blank-start card is always present so Home keeps a create affordance.
  async function loadBuildingBlocks() {
    try {
      const collectionsApi = createCollectionsApi({ api });
      const [collections, teamResp, usageResp] = await Promise.all([
        collectionsApi.listAll().catch(() => ({ personal: [], team: [] })),
        api('/api/slide-library/team').catch(() => ({ items: [] })),
        api('/api/slide-library/usage').catch(() => ({ items: [] })),
      ]);
      homeBlocksLoading.remove();

      // Set of {itemType}:{itemId} the current user has already used, so team
      // building blocks they've never started from get a "new to you" badge.
      const usedSet = new Set(
        (Array.isArray(usageResp?.items) ? usageResp.items : [])
          .map((u) => `${u?.itemType}:${u?.itemId}`)
      );
      // The badge is a per-user "you haven't tried this team item yet" nudge, so
      // it only makes sense on team-scope items (you made your personal ones).
      const isNewCollection = (col) =>
        col?.scope === 'team' && !usedSet.has(`collection:${col.id}`);
      const isNewSlide = (item) => !usedSet.has(`slide:${item.id}`);

      const cols = [...(collections?.team || []), ...(collections?.personal || [])];
      const teamSlides = (Array.isArray(teamResp?.items) ? teamResp.items : [])
        .filter((it) => it?.id && !it.isTrashed && !it.trashedAt)
        .sort((a, b) => blockTimestamp(b) - blockTimestamp(a));

      const shownCols = cols.slice(0, 4);
      // Reserve most of the shelf for collections; fill the rest with slides.
      const slideBudget = Math.max(2, 6 - shownCols.length);

      homeBlocksList.append(renderBlankBlockCard(h, onCreate));
      for (const col of shownCols) {
        homeBlocksList.append(renderCollectionBlockCard(h, col, onComposeFrom, isNewCollection(col)));
      }
      for (const item of teamSlides.slice(0, slideBudget)) {
        homeBlocksList.append(renderSlideBlockCard(h, item, onComposeFrom, isNewSlide(item)));
      }
      homeBlocksSection.append(homeBlocksList);

      if (!cols.length && !teamSlides.length) {
        homeBlocksSection.append(
          h('div', {
            class: 'help',
            text: t(
              'list.home.blocks.empty',
              'Save slides to your team library or group them into a collection to reuse them here.'
            ),
          })
        );
      }
    } catch {
      homeBlocksLoading.textContent = t('list.home.blocks.error', 'Failed to load building blocks.');
    }
  }

  return {
    el: homeView,
    loadActivityPreview,
    loadPopularPresentations,
    loadBuildingBlocks,
  };
}

/**
 * Normalise a comment body preview for the activity rail: collapse whitespace,
 * trim, and hint at truncation. The server caps the preview at 100 chars, so a
 * value at that length was almost certainly cut mid-sentence.
 * @param {string} [preview]
 * @returns {string}
 */
function cleanSnippet(preview) {
  const text = String(preview || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length >= 100 ? `${text}…` : text;
}

/** Most-recent-first sort key for a library item. */
function blockTimestamp(item) {
  const raw = item?.updatedAt || item?.createdAt || 0;
  const time = new Date(raw).getTime();
  return Number.isNaN(time) ? 0 : time;
}

/**
 * Blank-start card — always present so Home keeps a visible "create" path.
 * @param {Function} h
 * @param {Function} [onCreate]
 */
function renderBlankBlockCard(h, onCreate) {
  return h('button', {
    class: 'home-block-card is-blank',
    type: 'button',
    onclick: () => onCreate?.(),
  }, [
    h('span', { class: 'home-block-kicker', text: t('list.home.blocks.blankKicker', 'New') }),
    h('span', { class: 'home-block-glyph', text: '+', 'aria-hidden': 'true' }),
    h('span', { class: 'home-block-name', text: t('list.home.blocks.blank', 'Blank presentation') }),
  ]);
}

/**
 * Collection card — clicking opens the creation view seeded from the collection.
 * @param {Function} h
 * @param {object} col - collection ({ id, scope, name, slideIds, slideCount })
 * @param {Function} [onComposeFrom]
 * @param {boolean} [isNew] - show a "new to you" badge (team item, never used).
 */
function renderCollectionBlockCard(h, col, onComposeFrom, isNew = false) {
  const count = col.slideCount ?? (Array.isArray(col.slideIds) ? col.slideIds.length : 0);
  const meta = h('span', { class: 'home-block-meta' });
  if (col.scope === 'team') {
    meta.append(h('span', { class: 'home-block-badge', text: t('slideLibrary.scope.team', 'Team') }));
  }
  meta.append(
    h('span', {
      class: 'home-block-count',
      text: t('list.creationView.library.collectionCount', '{count} slides', { count: String(count) }),
    })
  );

  const card = h('button', {
    class: 'home-block-card is-collection',
    type: 'button',
    onclick: () => onComposeFrom?.({ collection: col }),
  }, [
    h('span', { class: 'home-block-kicker', text: t('list.home.blocks.collectionKicker', 'Collection') }),
    h('span', {
      class: 'home-block-name',
      text: col.name || t('slideLibrary.preview.untitled', 'Untitled'),
    }),
    meta,
  ]);
  if (isNew) card.append(renderNewToYouBadge(h));
  return card;
}

/**
 * Reusable-slide card — clicking opens the creation view seeded with that one
 * slide (the compose tray, ready to add more or create as-is).
 * @param {Function} h
 * @param {object} item - library item ({ id, name, slideType })
 * @param {Function} [onComposeFrom]
 * @param {boolean} [isNew] - show a "new to you" badge (team item, never used).
 */
function renderSlideBlockCard(h, item, onComposeFrom, isNew = false) {
  const card = h('button', {
    class: 'home-block-card is-slide',
    type: 'button',
    onclick: () => onComposeFrom?.({ items: [item] }),
  }, [
    h('span', { class: 'home-block-kicker', text: t('list.home.blocks.slideKicker', 'Reusable slide') }),
    h('span', {
      class: 'home-block-name',
      text: item.name || item.slideType || t('slideLibrary.preview.untitled', 'Untitled'),
    }),
  ]);
  if (isNew) card.append(renderNewToYouBadge(h));
  return card;
}

/**
 * The "new to you" badge — a subtle corner flag on a team building block the
 * current user has never started a deck from.
 * @param {Function} h
 * @returns {HTMLElement}
 */
function renderNewToYouBadge(h) {
  return h('span', {
    class: 'home-block-new',
    text: t('list.home.blocks.newToYou', 'New to you'),
  });
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
 * Collapse consecutive activity events by the same actor, on the same deck,
 * of the same type into a single bundle. The feed arrives newest-first, so a
 * run of "Heleen commented / commented / commented on X" becomes one bundle
 * with `count: 3`. Non-matching events break the run.
 *
 * @param {Array<object>} events - raw activity events, newest first
 * @returns {Array<{event: object, count: number}>}
 */
function bundleActivityEvents(events) {
  const bundles = [];
  for (const event of events) {
    const last = bundles[bundles.length - 1];
    const sameRun =
      last &&
      last.event.eventType === event.eventType &&
      (last.event.actorEmail || '') === (event.actorEmail || '') &&
      (last.event.presentationId || '') === (event.presentationId || '');
    if (sameRun) {
      last.count += 1;
    } else {
      bundles.push({ event, count: 1 });
    }
  }
  return bundles;
}

/**
 * Render a single (possibly bundled) activity preview item.
 *
 * @param {Function} h
 * @param {Function} nav
 * @param {{event: object, count: number}} bundle
 */
function renderActivityPreviewItem(h, nav, { event, count }) {
  const item = h('div', {
    class: 'home-activity-item',
    onclick: () => {
      if (event.presentationId) {
        nav?.(`/app/${event.presentationId}`);
      }
    },
  });

  const rawActor = event.actorName || event.actorEmail || 'Someone';
  // Strip the domain when only an email is available, so the feed reads
  // "riley commented on…" rather than "riley@example.com commented on…".
  const actorName = rawActor.includes('@') ? rawActor.split('@')[0] : rawActor;
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
    case 'collaborator.added':
      actionText = t('activity.shared', 'shared');
      break;
    default:
      actionText = t('activity.modified', 'modified');
  }

  const targetTitle =
    event.presentation?.title ||
    event.data?.title ||
    event.data?.presentationTitle ||
    t('activity.untitled', 'Untitled');

  const content = h('div', { class: 'home-activity-content' }, [
    h('div', { class: 'home-activity-line' }, [
      h('span', { class: 'home-activity-actor', text: actorName }),
      h('span', { class: 'home-activity-action', text: ` ${actionText} ` }),
      h('span', { class: 'home-activity-target', text: `"${targetTitle}"` }),
    ]),
  ]);

  // Show the comment text under the line so the rail carries real signal, not
  // just "someone commented". The server already ships a ≤100-char preview in
  // the event data, so this needs no extra fetch. Only for new comments — a
  // resolved-comment event has no body worth echoing.
  const snippet = event.eventType === 'comment.created' ? cleanSnippet(event.data?.bodyPreview) : '';
  if (snippet) {
    content.append(h('div', { class: 'home-activity-snippet', text: snippet }));
  }

  item.append(h('div', { class: 'home-activity-avatar', text: initials }), content);

  // Count pill for a bundled run — language-neutral, with an accessible label.
  if (count > 1) {
    item.append(
      h('span', {
        class: 'home-activity-count',
        text: String(count),
        title: t('list.home.activityCount', '{count} updates', { count }),
      })
    );
  }

  return item;
}