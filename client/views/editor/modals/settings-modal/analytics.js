import { t } from '../../../../lib/ui-i18n.js';

/**
 * Engagement Insights: how team-view analytics are collected and displayed.
 * @param {object} ctx - { h, pres, markDirty, requestSave }
 * @returns {{ el: HTMLElement }}
 */
export function buildAnalyticsSection({ h, pres, markDirty, requestSave }) {
  pres.settings.analyticsOptions =
    pres.settings.analyticsOptions &&
    typeof pres.settings.analyticsOptions === 'object'
      ? pres.settings.analyticsOptions
      : {};
  pres.settings.analyticsOptions.trackTeamViews =
    pres.settings.analyticsOptions.trackTeamViews !== false;
  pres.settings.analyticsOptions.showDetailedTeamAnalytics =
    !!pres.settings.analyticsOptions.showDetailedTeamAnalytics;

  const wrap = h('div', { class: 'stack editor-callout' });
  const label = h('div', {
    class: 'field-label',
    text: t('editor.deckSettings.analytics.title', 'Engagement Insights'),
  });
  const help = h('div', {
    class: 'help',
    text: t(
      'editor.deckSettings.analytics.help',
      'Control how engagement data is collected and displayed for this presentation.'
    ),
  });

  // Track team views checkbox
  const trackTeamCb = h('input', { type: 'checkbox' });
  trackTeamCb.checked = pres.settings.analyticsOptions.trackTeamViews;
  const trackTeamLabel = h(
    'label',
    {
      class: 'row is-start is-gap-xs',
      style: 'margin-top: var(--ps-space-2);',
    },
    [
      trackTeamCb,
      h('span', {
        text: t(
          'editor.deckSettings.analytics.trackTeam',
          'Include team member views in analytics'
        ),
      }),
    ]
  );
  trackTeamCb.addEventListener('change', () => {
    pres.settings.analyticsOptions.trackTeamViews = !!trackTeamCb.checked;
    markDirty?.();
    requestSave?.();
  });

  // Show detailed team analytics checkbox
  const detailedTeamCb = h('input', { type: 'checkbox' });
  detailedTeamCb.checked =
    pres.settings.analyticsOptions.showDetailedTeamAnalytics;
  const detailedTeamLabel = h(
    'label',
    { class: 'row is-start is-gap-xs' },
    [
      detailedTeamCb,
      h('span', {
        text: t(
          'editor.deckSettings.analytics.showDetailed',
          'Show attributed team viewer names'
        ),
      }),
    ]
  );
  const detailedTeamHelp = h('div', {
    class: 'help',
    style: 'margin-left: var(--ps-space-5);',
    text: t(
      'editor.deckSettings.analytics.showDetailedHelp',
      'Only shows names of team members who have opted in to attribution.'
    ),
  });
  detailedTeamCb.addEventListener('change', () => {
    pres.settings.analyticsOptions.showDetailedTeamAnalytics =
      !!detailedTeamCb.checked;
    markDirty?.();
    requestSave?.();
  });

  wrap.append(
    label,
    help,
    trackTeamLabel,
    detailedTeamLabel,
    detailedTeamHelp
  );
  return { el: wrap };
}
