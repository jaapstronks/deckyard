/**
 * Digest email templates
 * Weekly summary, team digest
 */

import { escapeHtml } from '../../../shared/slide-types/helpers.js';
import { EMAIL_STYLES, emailButton } from './helpers.js';

// ============================================================
// WEEKLY DIGEST TEMPLATE
// ============================================================

/**
 * Build a weekly digest email.
 * @param {Object} options
 * @param {Object} options.digest - Digest content from AI generation
 * @param {string} options.dashboardUrl - URL to the insights dashboard
 * @param {string} options.preferencesUrl - URL to manage email preferences
 * @returns {{ htmlContent: string, textContent: string }}
 */
export function buildWeeklyDigestEmail({
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
      <p><strong>${escapeHtml(topPresentationsIntro || 'Top performing presentations:')}</strong></p>
      <table style="width: 100%; border-collapse: collapse; margin: 12px 0;">
        ${topPresentations.map((p, i) => `
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee;">
              <strong>${i + 1}.</strong> ${escapeHtml(p.title)}
            </td>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; color: #666;">
              ${escapeHtml(String(p.views))} views${p.avgDuration ? `, ${escapeHtml(p.avgDuration)} avg` : ''}
            </td>
          </tr>
        `).join('')}
      </table>
    `;
    topPresentationsText = `\n${topPresentationsIntro || 'Top performing presentations:'}\n${topPresentations.map((p, i) =>
      `${i + 1}. ${p.title} - ${p.views} views${p.avgDuration ? `, ${p.avgDuration} avg` : ''}`
    ).join('\n')}\n`;
  }

  // Build insights list
  let insightsHtml = '';
  let insightsText = '';
  if (insights && insights.length > 0) {
    insightsHtml = `
      <p><strong>Insights</strong></p>
      <ul style="padding-left: 20px; margin: 12px 0;">
        ${insights.map((insight) => `<li style="margin-bottom: 8px;">${escapeHtml(insight)}</li>`).join('')}
      </ul>
    `;
    insightsText = `\nInsights\n${insights.map((insight) => `- ${insight}`).join('\n')}\n`;
  }

  // Build week over week stats
  let weekOverWeekHtml = '';
  let weekOverWeekText = '';
  if (weekOverWeek) {
    const stats = [];
    if (weekOverWeek.views) stats.push(`Views: ${weekOverWeek.views}`);
    if (weekOverWeek.uniqueViewers) stats.push(`Unique viewers: ${weekOverWeek.uniqueViewers}`);
    if (weekOverWeek.avgDuration) stats.push(`Avg duration: ${weekOverWeek.avgDuration}`);

    if (stats.length > 0) {
      weekOverWeekHtml = `
        <p style="background: #f5f5f5; padding: 12px; border-radius: 8px; margin: 16px 0;">
          <strong>Week over week</strong><br>
          <span style="font-size: 14px; color: #666;">${stats.map(escapeHtml).join('  |  ')}</span>
        </p>
      `;
      weekOverWeekText = `\nWeek over week\n${stats.join(' | ')}\n`;
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

  ${emailButton(dashboardUrl, 'View Full Dashboard')}

  <p>${escapeHtml(closing)}</p>

  <hr style="${EMAIL_STYLES.hr}">
  <p style="${EMAIL_STYLES.muted}">
    You're receiving this because you have engagement insights enabled.
    <a href="${escapeHtml(preferencesUrl)}" style="color: #666;">Manage preferences</a>
  </p>
</body>
</html>`.trim();

  const textContent = `
${greeting}

${weekStart} - ${weekEnd}

${highlights}
${topPresentationsText}${insightsText}${weekOverWeekText}
View Full Dashboard: ${dashboardUrl}

${closing}

---
You're receiving this because you have engagement insights enabled.
Manage preferences: ${preferencesUrl}
`.trim();

  return { htmlContent, textContent };
}

// ============================================================
// TEAM DIGEST TEMPLATE
// ============================================================

/**
 * Build a team weekly digest email (for admins).
 * @param {Object} options
 * @param {Object} options.digest - Team digest content
 * @param {string} options.dashboardUrl - URL to the insights dashboard
 * @param {string} options.preferencesUrl - URL to manage email preferences
 * @returns {{ htmlContent: string, textContent: string }}
 */
export function buildTeamDigestEmail({
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
      <p><strong>${escapeHtml(topPresentationsIntro || 'Top performing presentations:')}</strong></p>
      <table style="width: 100%; border-collapse: collapse; margin: 12px 0;">
        ${topPresentations.map((p, i) => `
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee;">
              <strong>${i + 1}.</strong> ${escapeHtml(p.title)}
            </td>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; color: #666;">
              ${escapeHtml(String(p.views))} views
            </td>
          </tr>
        `).join('')}
      </table>
    `;
    topPresentationsText = `\n${topPresentationsIntro || 'Top performing presentations:'}\n${topPresentations.map((p, i) =>
      `${i + 1}. ${p.title} - ${p.views} views`
    ).join('\n')}\n`;
  }

  // Build top presenters list
  let topPresentersHtml = '';
  let topPresentersText = '';
  if (topPresenters && topPresenters.length > 0) {
    topPresentersHtml = `
      <p><strong>${escapeHtml(topPresentersIntro || 'Most active presenters:')}</strong></p>
      <table style="width: 100%; border-collapse: collapse; margin: 12px 0;">
        ${topPresenters.map((p, i) => `
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee;">
              <strong>${i + 1}.</strong> ${escapeHtml(p.name)}
            </td>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; color: #666;">
              ${escapeHtml(String(p.totalViews))} views, ${escapeHtml(String(p.presentationCount))} presentations
            </td>
          </tr>
        `).join('')}
      </table>
    `;
    topPresentersText = `\n${topPresentersIntro || 'Most active presenters:'}\n${topPresenters.map((p, i) =>
      `${i + 1}. ${p.name} - ${p.totalViews} views, ${p.presentationCount} presentations`
    ).join('\n')}\n`;
  }

  // Build insights list
  let insightsHtml = '';
  let insightsText = '';
  if (insights && insights.length > 0) {
    insightsHtml = `
      <p><strong>Insights</strong></p>
      <ul style="padding-left: 20px; margin: 12px 0;">
        ${insights.map((insight) => `<li style="margin-bottom: 8px;">${escapeHtml(insight)}</li>`).join('')}
      </ul>
    `;
    insightsText = `\nInsights\n${insights.map((insight) => `- ${insight}`).join('\n')}\n`;
  }

  // Build summary stats
  let summaryHtml = '';
  let summaryText = '';
  if (weekOverWeek || activePresenters || presentationCount) {
    const stats = [];
    if (weekOverWeek?.views) stats.push(`Views: ${weekOverWeek.views}`);
    if (activePresenters) stats.push(`Active presenters: ${activePresenters}`);
    if (presentationCount) stats.push(`Total presentations: ${presentationCount}`);

    if (stats.length > 0) {
      summaryHtml = `
        <p style="background: #f5f5f5; padding: 12px; border-radius: 8px; margin: 16px 0;">
          <strong>Team overview</strong><br>
          <span style="font-size: 14px; color: #666;">${stats.map(escapeHtml).join('  |  ')}</span>
        </p>
      `;
      summaryText = `\nTeam overview\n${stats.join(' | ')}\n`;
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
    Team insights: ${escapeHtml(weekStart)} - ${escapeHtml(weekEnd)}
  </p>

  <p>${escapeHtml(highlights)}</p>

  ${topPresentationsHtml}

  ${topPresentersHtml}

  ${insightsHtml}

  ${summaryHtml}

  ${emailButton(dashboardUrl, 'View Team Dashboard')}

  <p>${escapeHtml(closing)}</p>

  <hr style="${EMAIL_STYLES.hr}">
  <p style="${EMAIL_STYLES.muted}">
    You're receiving this as an admin with team engagement insights enabled.
    <a href="${escapeHtml(preferencesUrl)}" style="color: #666;">Manage preferences</a>
  </p>
</body>
</html>`.trim();

  const textContent = `
${greeting}

Team insights: ${weekStart} - ${weekEnd}

${highlights}
${topPresentationsText}${topPresentersText}${insightsText}${summaryText}
View Team Dashboard: ${dashboardUrl}

${closing}

---
You're receiving this as an admin with team engagement insights enabled.
Manage preferences: ${preferencesUrl}
`.trim();

  return { htmlContent, textContent };
}
