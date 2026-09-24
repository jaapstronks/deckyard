/**
 * Digest email templates
 * Weekly summary, team digest
 */

import { escapeHtml } from '../../../shared/slide-types/helpers.js';
import { EMAIL_STYLES, emailButton } from './helpers.js';

// ============================================================
// SHARED PHRASES
// ============================================================

function topIntroFallback(tr) {
  return tr(
    'email.digest.topPresentationsFallback',
    'Top performing presentations:',
  );
}

function presentersIntroFallback(tr) {
  return tr('email.digest.team.topPresentersIntro', 'Most active presenters:');
}

/** "12 views, 1m 30s avg" for one presentation row. */
function presentationStats(tr, p) {
  const views = tr('email.digest.row.views', '{count} views', {
    count: p.views,
  });
  return p.avgDuration
    ? tr('email.digest.row.viewsWithDuration', '{views}, {duration} avg', {
        views,
        duration: p.avgDuration,
      })
    : views;
}

/** "40 views, 3 presentations" for one presenter row. */
function presenterStats(tr, p) {
  return tr(
    'email.digest.row.presenter',
    '{views} views, {count} presentations',
    { views: p.totalViews, count: p.presentationCount },
  );
}

function teamPeriod(tr, weekStart, weekEnd) {
  return tr(
    'email.digest.team.period',
    'Team insights: {weekStart} - {weekEnd}',
    {
      weekStart,
      weekEnd,
    },
  );
}

// ============================================================
// WEEKLY DIGEST TEMPLATE
// ============================================================

/**
 * Build a weekly digest email.
 * @param {Object} options
 * @param {Function} options.tr - Translator in the digest's own locale
 * @param {Object} options.digest - Digest content from AI generation
 * @param {string} options.dashboardUrl - URL to the insights dashboard
 * @param {string} options.preferencesUrl - URL to manage email preferences
 * @returns {{ htmlContent: string, textContent: string }}
 */
export function buildWeeklyDigestEmail({
  tr,
  digest,
  dashboardUrl,
  preferencesUrl,
}) {
  const {
    greeting,
    highlights,
    topPresentationsIntro,
    topPresentations,
    insights,
    weekOverWeek,
    closing,
    weekStart,
    weekEnd,
  } = digest;

  // Build top presentations list
  let topPresentationsHtml = '';
  let topPresentationsText = '';
  if (topPresentations && topPresentations.length > 0) {
    topPresentationsHtml = `
      <p><strong>${escapeHtml(topPresentationsIntro || topIntroFallback(tr))}</strong></p>
      <table style="width: 100%; border-collapse: collapse; margin: 12px 0;">
        ${topPresentations
          .map(
            (p, i) => `
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee;">
              <strong>${i + 1}.</strong> ${escapeHtml(p.title)}
            </td>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; color: #666;">
              ${escapeHtml(presentationStats(tr, p))}
            </td>
          </tr>
        `,
          )
          .join('')}
      </table>
    `;
    topPresentationsText = `\n${topPresentationsIntro || topIntroFallback(tr)}\n${topPresentations
      .map((p, i) => `${i + 1}. ${p.title} - ${presentationStats(tr, p)}`)
      .join('\n')}\n`;
  }

  // Build insights list
  let insightsHtml = '';
  let insightsText = '';
  if (insights && insights.length > 0) {
    insightsHtml = `
      <p><strong>${escapeHtml(tr('email.digest.insights', 'Insights'))}</strong></p>
      <ul style="padding-left: 20px; margin: 12px 0;">
        ${insights.map((insight) => `<li style="margin-bottom: 8px;">${escapeHtml(insight)}</li>`).join('')}
      </ul>
    `;
    insightsText = `\n${tr('email.digest.insights', 'Insights')}\n${insights.map((insight) => `- ${insight}`).join('\n')}\n`;
  }

  // Build week over week stats
  let weekOverWeekHtml = '';
  let weekOverWeekText = '';
  if (weekOverWeek) {
    const stats = [];
    if (weekOverWeek.views)
      stats.push(
        tr('email.digest.stat.views', 'Views: {value}', {
          value: weekOverWeek.views,
        }),
      );
    if (weekOverWeek.uniqueViewers)
      stats.push(
        tr('email.digest.stat.uniqueViewers', 'Unique viewers: {value}', {
          value: weekOverWeek.uniqueViewers,
        }),
      );
    if (weekOverWeek.avgDuration)
      stats.push(
        tr('email.digest.stat.avgDuration', 'Avg duration: {value}', {
          value: weekOverWeek.avgDuration,
        }),
      );

    if (stats.length > 0) {
      weekOverWeekHtml = `
        <p style="background: #f5f5f5; padding: 12px; border-radius: 8px; margin: 16px 0;">
          <strong>${escapeHtml(tr('email.digest.weekOverWeek', 'Week over week'))}</strong><br>
          <span style="font-size: 14px; color: #666;">${stats.map(escapeHtml).join('  |  ')}</span>
        </p>
      `;
      weekOverWeekText = `\n${tr('email.digest.weekOverWeek', 'Week over week')}\n${stats.join(' | ')}\n`;
    }
  }

  const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="${EMAIL_STYLES.body}">
  <p>${escapeHtml(greeting)}</p>

  <p style="font-size: 12px; color: #888; margin-bottom: 16px;">
    ${escapeHtml(weekStart)} - ${escapeHtml(weekEnd)}
  </p>

  <p>${escapeHtml(highlights)}</p>

  ${topPresentationsHtml}

  ${insightsHtml}

  ${weekOverWeekHtml}

  ${emailButton(dashboardUrl, tr('email.digest.weekly.dashboardButton', 'View Full Dashboard'))}

  <p>${escapeHtml(closing)}</p>

  <hr style="${EMAIL_STYLES.hr}">
  <p style="${EMAIL_STYLES.muted}">
    ${escapeHtml(tr('email.digest.weekly.footer', "You're receiving this because you have engagement insights enabled."))}
    <a href="${escapeHtml(preferencesUrl)}" style="color: #666;">${escapeHtml(tr('email.digest.managePreferences', 'Manage preferences'))}</a>
  </p>
</body>
</html>`.trim();

  const textContent = `
${greeting}

${weekStart} - ${weekEnd}

${highlights}
${topPresentationsText}${insightsText}${weekOverWeekText}
${tr('email.digest.weekly.dashboardButton', 'View Full Dashboard')}: ${dashboardUrl}

${closing}

---
${tr('email.digest.weekly.footer', "You're receiving this because you have engagement insights enabled.")}
${tr('email.digest.managePreferences', 'Manage preferences')}: ${preferencesUrl}
`.trim();

  return { htmlContent, textContent };
}

// ============================================================
// TEAM DIGEST TEMPLATE
// ============================================================

/**
 * Build a team weekly digest email (for admins).
 * @param {Object} options
 * @param {Function} options.tr - Translator in the digest's own locale
 * @param {Object} options.digest - Team digest content
 * @param {string} options.dashboardUrl - URL to the insights dashboard
 * @param {string} options.preferencesUrl - URL to manage email preferences
 * @returns {{ htmlContent: string, textContent: string }}
 */
export function buildTeamDigestEmail({
  tr,
  digest,
  dashboardUrl,
  preferencesUrl,
}) {
  const {
    greeting,
    highlights,
    topPresentationsIntro,
    topPresentations,
    topPresentersIntro,
    topPresenters,
    insights,
    weekOverWeek,
    closing,
    weekStart,
    weekEnd,
    activePresenters,
    presentationCount,
  } = digest;

  // Build top presentations list
  let topPresentationsHtml = '';
  let topPresentationsText = '';
  if (topPresentations && topPresentations.length > 0) {
    topPresentationsHtml = `
      <p><strong>${escapeHtml(topPresentationsIntro || topIntroFallback(tr))}</strong></p>
      <table style="width: 100%; border-collapse: collapse; margin: 12px 0;">
        ${topPresentations
          .map(
            (p, i) => `
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee;">
              <strong>${i + 1}.</strong> ${escapeHtml(p.title)}
            </td>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; color: #666;">
              ${escapeHtml(presentationStats(tr, p))}
            </td>
          </tr>
        `,
          )
          .join('')}
      </table>
    `;
    topPresentationsText = `\n${topPresentationsIntro || topIntroFallback(tr)}\n${topPresentations
      .map((p, i) => `${i + 1}. ${p.title} - ${presentationStats(tr, p)}`)
      .join('\n')}\n`;
  }

  // Build top presenters list
  let topPresentersHtml = '';
  let topPresentersText = '';
  if (topPresenters && topPresenters.length > 0) {
    topPresentersHtml = `
      <p><strong>${escapeHtml(topPresentersIntro || presentersIntroFallback(tr))}</strong></p>
      <table style="width: 100%; border-collapse: collapse; margin: 12px 0;">
        ${topPresenters
          .map(
            (p, i) => `
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee;">
              <strong>${i + 1}.</strong> ${escapeHtml(p.name)}
            </td>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; color: #666;">
              ${escapeHtml(presenterStats(tr, p))}
            </td>
          </tr>
        `,
          )
          .join('')}
      </table>
    `;
    topPresentersText = `\n${topPresentersIntro || presentersIntroFallback(tr)}\n${topPresenters
      .map((p, i) => `${i + 1}. ${p.name} - ${presenterStats(tr, p)}`)
      .join('\n')}\n`;
  }

  // Build insights list
  let insightsHtml = '';
  let insightsText = '';
  if (insights && insights.length > 0) {
    insightsHtml = `
      <p><strong>${escapeHtml(tr('email.digest.insights', 'Insights'))}</strong></p>
      <ul style="padding-left: 20px; margin: 12px 0;">
        ${insights.map((insight) => `<li style="margin-bottom: 8px;">${escapeHtml(insight)}</li>`).join('')}
      </ul>
    `;
    insightsText = `\n${tr('email.digest.insights', 'Insights')}\n${insights.map((insight) => `- ${insight}`).join('\n')}\n`;
  }

  // Build summary stats
  let summaryHtml = '';
  let summaryText = '';
  if (weekOverWeek || activePresenters || presentationCount) {
    const stats = [];
    if (weekOverWeek?.views)
      stats.push(
        tr('email.digest.stat.views', 'Views: {value}', {
          value: weekOverWeek.views,
        }),
      );
    if (activePresenters)
      stats.push(
        tr('email.digest.stat.activePresenters', 'Active presenters: {value}', {
          value: activePresenters,
        }),
      );
    if (presentationCount)
      stats.push(
        tr(
          'email.digest.stat.totalPresentations',
          'Total presentations: {value}',
          { value: presentationCount },
        ),
      );

    if (stats.length > 0) {
      summaryHtml = `
        <p style="background: #f5f5f5; padding: 12px; border-radius: 8px; margin: 16px 0;">
          <strong>${escapeHtml(tr('email.digest.team.overview', 'Team overview'))}</strong><br>
          <span style="font-size: 14px; color: #666;">${stats.map(escapeHtml).join('  |  ')}</span>
        </p>
      `;
      summaryText = `\n${tr('email.digest.team.overview', 'Team overview')}\n${stats.join(' | ')}\n`;
    }
  }

  const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="${EMAIL_STYLES.body}">
  <p>${escapeHtml(greeting)}</p>

  <p style="font-size: 12px; color: #888; margin-bottom: 16px;">
    ${escapeHtml(teamPeriod(tr, weekStart, weekEnd))}
  </p>

  <p>${escapeHtml(highlights)}</p>

  ${topPresentationsHtml}

  ${topPresentersHtml}

  ${insightsHtml}

  ${summaryHtml}

  ${emailButton(dashboardUrl, tr('email.digest.team.dashboardButton', 'View Team Dashboard'))}

  <p>${escapeHtml(closing)}</p>

  <hr style="${EMAIL_STYLES.hr}">
  <p style="${EMAIL_STYLES.muted}">
    ${escapeHtml(tr('email.digest.team.footer', "You're receiving this as an admin with team engagement insights enabled."))}
    <a href="${escapeHtml(preferencesUrl)}" style="color: #666;">${escapeHtml(tr('email.digest.managePreferences', 'Manage preferences'))}</a>
  </p>
</body>
</html>`.trim();

  const textContent = `
${greeting}

${teamPeriod(tr, weekStart, weekEnd)}

${highlights}
${topPresentationsText}${topPresentersText}${insightsText}${summaryText}
${tr('email.digest.team.dashboardButton', 'View Team Dashboard')}: ${dashboardUrl}

${closing}

---
${tr('email.digest.team.footer', "You're receiving this as an admin with team engagement insights enabled.")}
${tr('email.digest.managePreferences', 'Manage preferences')}: ${preferencesUrl}
`.trim();

  return { htmlContent, textContent };
}
