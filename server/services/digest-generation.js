/**
 * AI Digest Generation Service
 * Generates natural language engagement summaries for weekly digest emails.
 */

import { getFeatureFlags } from '../config/flags-snapshot.js';
import { getLlmConfig } from '../utils/llm/config.js';
import { requestChatCompletionContent } from '../utils/llm/index.js';
import { formatDuration } from '../storage/analytics/index.js';
import { createTranslator, normalizeLocale } from '../i18n/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('digest-generation');

// ============================================================
// DIGEST GENERATION
// ============================================================

/**
 * Generate a weekly digest email using AI.
 *
 * The digest is written in one language from start to finish — the model's
 * prose, the template fallbacks and the server-owned phrases alike — and says
 * which one on `locale`, so the sender renders the mail around it in the same
 * language (B390).
 *
 * @param {Object} user - User info
 * @param {string} user.email - User's email
 * @param {string} user.name - User's display name
 * @param {Object} analytics - Weekly analytics data from getWeeklyAnalyticsForUser
 * @param {string} locale - The recipient's locale, from `resolveRecipientLocale()`.
 * @returns {Promise<Object>} Digest content, with `locale`.
 */
export async function generateDigestWithAI(user, analytics, locale) {
  const lang = requireLocale(locale);
  const digest = await composeDigest(user, analytics, lang);
  return { ...digest, locale: lang };
}

async function composeDigest(user, analytics, locale) {
  const tr = createTranslator(locale);

  // If no activity, return a simple fallback without calling AI
  if (!analytics.hasActivity) {
    return generateNoActivityDigest(user, analytics, tr);
  }

  // AI switched off on this instance (kill switch, demo, sandbox): the
  // template digest, never a vendor call.
  if (!getFeatureFlags().enableAi) {
    return generateFallbackDigest(user, analytics, tr, locale);
  }

  const { vendor, apiKey, model } = getLlmConfig({});

  // Format analytics data for the prompt
  const formattedData = formatAnalyticsForPrompt(analytics);

  const systemPrompt = buildDigestSystemPrompt(locale);
  const userPrompt = buildDigestUserPrompt(user, formattedData);

  try {
    const content = await requestChatCompletionContent({
      vendor,
      apiKey,
      model,
      temperature: 0.4,
      responseFormat: { type: 'json_object' },
      maxTokens: 2048,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const parsed = parseDigestResponse(content);
    return validated(parsed, user, analytics, tr, locale);
  } catch (err) {
    // Fallback to template-based digest if AI fails
    log.error('AI generation failed, using fallback:', err.message);
    return generateFallbackDigest(user, analytics, tr, locale);
  }
}

/**
 * Generate a weekly digest for team admins (organization-wide).
 * One language throughout, named on `locale`, like {@link generateDigestWithAI}.
 * @param {Object} admin - Admin user info
 * @param {Object} teamAnalytics - Weekly analytics from getTeamWeeklyAnalytics
 * @param {string} locale - The recipient's locale, from `resolveRecipientLocale()`.
 * @returns {Promise<Object>} Digest content, with `locale`.
 */
export async function generateTeamDigestWithAI(admin, teamAnalytics, locale) {
  const lang = requireLocale(locale);
  const digest = await composeTeamDigest(admin, teamAnalytics, lang);
  return { ...digest, locale: lang };
}

async function composeTeamDigest(admin, teamAnalytics, locale) {
  const tr = createTranslator(locale);

  if (!teamAnalytics.hasActivity) {
    return generateNoActivityTeamDigest(admin, teamAnalytics, tr);
  }

  if (!getFeatureFlags().enableAi) {
    return generateFallbackTeamDigest(admin, teamAnalytics, tr);
  }

  const { vendor, apiKey, model } = getLlmConfig({});

  const systemPrompt = buildTeamDigestSystemPrompt(locale);
  const userPrompt = buildTeamDigestUserPrompt(admin, teamAnalytics);

  try {
    const content = await requestChatCompletionContent({
      vendor,
      apiKey,
      model,
      temperature: 0.4,
      responseFormat: { type: 'json_object' },
      maxTokens: 2048,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const parsed = parseDigestResponse(content);
    return validatedTeam(parsed, admin, teamAnalytics, tr);
  } catch (err) {
    log.error('Team AI generation failed, using fallback:', err.message);
    return generateFallbackTeamDigest(admin, teamAnalytics, tr);
  }
}

/**
 * The locale a digest is written in, refused when it names none this install
 * has strings for. The job resolves it per recipient; a digest without one
 * would silently become English, which is the defect B390 closed.
 * @param {string} locale
 * @returns {string}
 */
function requireLocale(locale) {
  const lang = normalizeLocale(locale);
  if (!lang) {
    throw new TypeError(
      `A digest needs the recipient's locale, got ${JSON.stringify(locale)}`,
    );
  }
  return lang;
}

/**
 * The language's English name, for the model's instruction ("Dutch").
 * @param {string} locale
 * @returns {string}
 */
function languageName(locale) {
  return new Intl.DisplayNames(['en'], { type: 'language' }).of(locale);
}

// ============================================================
// PROMPT BUILDERS
// ============================================================

function buildDigestSystemPrompt(locale) {
  return `You are writing a friendly weekly engagement summary email for a presentation author.

Write every text field in ${languageName(locale)}. Keep the JSON field names in English.

Your task is to create a brief, encouraging email digest that helps the user understand how their presentations performed this week.

Output MUST be valid JSON with these exact fields:
{
  "subject": "Your weekly engagement insights - brief highlight",
  "greeting": "Hi {name},",
  "highlights": "One paragraph (2-3 sentences) summarizing the key highlight from this week's data.",
  "topPresentationsIntro": "Brief intro sentence for the top performers section.",
  "insights": ["Array of 2-3 actionable insight strings based on the data."],
  "closing": "Brief encouraging closing sentence."
}

Writing guidelines:
1. Be concise - under 200 words for the main content
2. Be professional but warm, not overly enthusiastic
3. Focus on positive trends and achievements
4. If there's a decline, frame it constructively
5. Only reference metrics that are provided - do not invent data
6. Keep subject line under 60 characters
7. Use specific numbers from the data when highlighting achievements

Avoid:
- Excessive exclamation marks
- Corporate jargon
- Making up statistics
- Being overly promotional`;
}

function buildDigestUserPrompt(user, formattedData) {
  return `Generate a weekly engagement digest email for:

USER: ${user.name || user.email.split('@')[0]}
PERIOD: ${formattedData.weekStart} to ${formattedData.weekEnd}

ANALYTICS DATA:
${JSON.stringify(formattedData, null, 2)}

Remember: Output must be valid JSON with the specified fields.`;
}

function buildTeamDigestSystemPrompt(locale) {
  return `You are writing a weekly team-wide engagement summary email for an organization admin.

Write every text field in ${languageName(locale)}. Keep the JSON field names in English.

Your task is to create a brief, informative digest showing how all presentations across the organization performed this week.

Output MUST be valid JSON with these exact fields:
{
  "subject": "Your team's weekly engagement - brief highlight",
  "greeting": "Hi {name},",
  "highlights": "One paragraph summarizing the team's overall performance this week.",
  "topPresentationsIntro": "Brief intro for top performing presentations section.",
  "topPresentersIntro": "Brief intro for most active presenters section.",
  "insights": ["Array of 2-3 organizational insights."],
  "closing": "Brief closing encouraging team engagement."
}

Writing guidelines:
1. Focus on team achievements and collective performance
2. Highlight top performers without singling anyone out negatively
3. Be concise and professional
4. Only reference actual metrics provided
5. Keep subject line under 60 characters

Avoid:
- Comparing individuals negatively
- Creating internal competition
- Making up statistics`;
}

function buildTeamDigestUserPrompt(admin, analytics) {
  return `Generate a weekly team engagement digest email for:

ADMIN: ${admin.name || admin.email.split('@')[0]}
ORGANIZATION PERIOD: ${analytics.weekStart} to ${analytics.weekEnd}

TEAM ANALYTICS:
${JSON.stringify(analytics, null, 2)}

Remember: Output must be valid JSON with the specified fields.`;
}

// ============================================================
// DATA FORMATTING
// ============================================================

function formatAnalyticsForPrompt(analytics) {
  return {
    weekStart: analytics.weekStart,
    weekEnd: analytics.weekEnd,
    summary: {
      totalViews: analytics.totalViews,
      uniqueViewers: analytics.uniqueViewers,
      avgDuration: formatDuration(analytics.avgDurationSeconds),
      presentationCount: analytics.presentationCount,
    },
    weekOverWeek: {
      views: {
        current: analytics.weekOverWeek.views.current,
        previous: analytics.weekOverWeek.views.previous,
        change: `${analytics.weekOverWeek.views.direction === 'up' ? '+' : analytics.weekOverWeek.views.direction === 'down' ? '-' : ''}${analytics.weekOverWeek.views.percentChange}%`,
        direction: analytics.weekOverWeek.views.direction,
      },
      uniqueViewers: {
        current: analytics.weekOverWeek.uniqueViewers.current,
        previous: analytics.weekOverWeek.uniqueViewers.previous,
        change: `${analytics.weekOverWeek.uniqueViewers.direction === 'up' ? '+' : analytics.weekOverWeek.uniqueViewers.direction === 'down' ? '-' : ''}${analytics.weekOverWeek.uniqueViewers.percentChange}%`,
        direction: analytics.weekOverWeek.uniqueViewers.direction,
      },
      avgDuration: {
        current: formatDuration(analytics.weekOverWeek.avgDuration.current),
        previous: formatDuration(analytics.weekOverWeek.avgDuration.previous),
        change: `${analytics.weekOverWeek.avgDuration.direction === 'up' ? '+' : analytics.weekOverWeek.avgDuration.direction === 'down' ? '-' : ''}${analytics.weekOverWeek.avgDuration.percentChange}%`,
        direction: analytics.weekOverWeek.avgDuration.direction,
      },
    },
    topPresentations: analytics.topPresentations.map((p) => ({
      title: p.title,
      views: p.views,
      avgDuration: formatDuration(p.avgDurationSeconds),
    })),
    insights: analytics.insights.map((i) => i.text),
  };
}

// ============================================================
// RESPONSE PARSING & VALIDATION
// ============================================================

function parseDigestResponse(content) {
  // Try to parse JSON from the response
  const raw = String(content || '').trim();

  // Handle markdown code fences
  let jsonStr = raw;
  if (raw.startsWith('```')) {
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) jsonStr = match[1].trim();
  }

  try {
    return JSON.parse(jsonStr);
  } catch {
    // Try to extract JSON object from the string
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function validated(parsed, user, analytics, tr, locale) {
  const name = user.name || user.email.split('@')[0];

  // If parsing failed, use fallback
  if (!parsed || typeof parsed !== 'object') {
    return generateFallbackDigest(user, analytics, tr, locale);
  }

  // Ensure all required fields exist with reasonable defaults
  return {
    subject:
      parsed.subject ||
      tr(
        'email.digest.weekly.subjectWithViews',
        'Your weekly engagement insights - {views} views',
        { views: analytics.totalViews },
      ),
    greeting: (parsed.greeting || greeting(tr, name)).replace('{name}', name),
    highlights:
      parsed.highlights ||
      tr(
        'email.digest.weekly.highlights',
        'Your presentations received {views} views from {viewers} unique viewers this week.',
        { views: analytics.totalViews, viewers: analytics.uniqueViewers },
      ),
    topPresentationsIntro:
      parsed.topPresentationsIntro ||
      tr(
        'email.digest.weekly.topPresentationsIntro',
        'Here are your top performing presentations:',
      ),
    topPresentations: analytics.topPresentations.slice(0, 3).map((p) => ({
      title: p.title,
      views: p.views,
      avgDuration: formatDuration(p.avgDurationSeconds),
    })),
    insights: Array.isArray(parsed.insights) ? parsed.insights.slice(0, 3) : [],
    weekOverWeek: {
      views: `${analytics.weekOverWeek.views.current} (${analytics.weekOverWeek.views.direction === 'up' ? '+' : ''}${analytics.weekOverWeek.views.direction === 'down' ? '-' : ''}${analytics.weekOverWeek.views.percentChange}%)`,
      uniqueViewers: `${analytics.weekOverWeek.uniqueViewers.current} (${analytics.weekOverWeek.uniqueViewers.direction === 'up' ? '+' : ''}${analytics.weekOverWeek.uniqueViewers.direction === 'down' ? '-' : ''}${analytics.weekOverWeek.uniqueViewers.percentChange}%)`,
      avgDuration: `${formatDuration(analytics.weekOverWeek.avgDuration.current)} (${analytics.weekOverWeek.avgDuration.direction === 'up' ? '+' : ''}${analytics.weekOverWeek.avgDuration.direction === 'down' ? '-' : ''}${analytics.weekOverWeek.avgDuration.percentChange}%)`,
    },
    closing:
      parsed.closing ||
      tr('email.digest.weekly.closing', 'Keep creating great presentations!'),
    weekStart: analytics.weekStart,
    weekEnd: analytics.weekEnd,
  };
}

function validatedTeam(parsed, admin, analytics, tr) {
  const name = admin.name || admin.email.split('@')[0];

  if (!parsed || typeof parsed !== 'object') {
    return generateFallbackTeamDigest(admin, analytics, tr);
  }

  return {
    subject:
      parsed.subject ||
      tr(
        'email.digest.team.subjectWithViews',
        "Your team's weekly engagement - {views} views",
        { views: analytics.totalViews },
      ),
    greeting: (parsed.greeting || greeting(tr, name)).replace('{name}', name),
    highlights:
      parsed.highlights ||
      tr(
        'email.digest.team.highlights',
        "Your team's presentations received {views} views from {viewers} unique viewers this week.",
        { views: analytics.totalViews, viewers: analytics.uniqueViewers },
      ),
    topPresentationsIntro:
      parsed.topPresentationsIntro ||
      tr(
        'email.digest.team.topPresentationsIntro',
        'Top performing presentations across your team:',
      ),
    topPresentations: analytics.topPresentations.slice(0, 5).map((p) => ({
      title: p.title,
      views: p.views,
      ownerEmail: p.ownerEmail,
    })),
    topPresentersIntro:
      parsed.topPresentersIntro ||
      tr('email.digest.team.topPresentersIntro', 'Most active presenters:'),
    topPresenters: analytics.topPresenters.slice(0, 5).map((p) => ({
      name: p.name,
      totalViews: p.totalViews,
      presentationCount: p.presentationCount,
    })),
    insights: Array.isArray(parsed.insights) ? parsed.insights.slice(0, 3) : [],
    weekOverWeek: {
      views: `${analytics.weekOverWeek.views.current} (${analytics.weekOverWeek.views.direction === 'up' ? '+' : ''}${analytics.weekOverWeek.views.percentChange}%)`,
    },
    closing:
      parsed.closing ||
      tr('email.digest.team.closing', 'Keep your team engaged!'),
    weekStart: analytics.weekStart,
    weekEnd: analytics.weekEnd,
    activePresenters: analytics.activePresenters,
    presentationCount: analytics.presentationCount,
  };
}

// ============================================================
// FALLBACK GENERATORS
// ============================================================

function greeting(tr, name) {
  return tr('email.common.greeting', 'Hi {name},', { name });
}

/**
 * The week-over-week clause of a fallback highlight ("up 12% from last week").
 * @param {Function} tr
 * @param {{direction: string, percentChange: number}} trend
 * @returns {string}
 */
function trendPhrase(tr, trend) {
  const percent = trend.percentChange;
  if (trend.direction === 'up') {
    return tr('email.digest.trend.up', 'up {percent}% from last week', {
      percent,
    });
  }
  if (trend.direction === 'down') {
    return tr('email.digest.trend.down', 'down {percent}% from last week', {
      percent,
    });
  }
  return tr('email.digest.trend.flat', 'similar to last week');
}

/**
 * The analytics insights in the digest's language, rendered from their `type`
 * and `data`. Their `text` is PostgreSQL-and-English and never reaches a
 * reader; a type without a phrase here is left out rather than sent in
 * English.
 * @param {Array<{type: string, data: Object}>} insights
 * @param {Function} tr
 * @param {string} locale
 * @returns {string[]}
 */
function localizedInsights(insights, tr, locale) {
  // 2023-01-01 was a Sunday, so day n of that week is weekday n (0 = Sunday).
  // The dates are built in UTC, so the formatter reads them in UTC too; the
  // process default would shift the day west of Greenwich.
  const weekday = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    timeZone: 'UTC',
  });
  const dayName = (dow) => weekday.format(new Date(Date.UTC(2023, 0, 1 + dow)));
  const list = new Intl.ListFormat(locale, { type: 'conjunction' });

  return insights.flatMap((insight) => {
    if (insight.type === 'peak_days') {
      const days = (insight.data?.days || []).map((d) => dayName(d.dayOfWeek));
      return [
        tr(
          'email.digest.insight.peakDays',
          '{days} saw peak engagement - consider sharing new content early in the week',
          { days: list.format(days) },
        ),
      ];
    }
    if (insight.type === 'returning_viewers') {
      return [
        tr(
          'email.digest.insight.returningViewers',
          'Viewers returned multiple times to "{title}"',
          { title: insight.data?.title },
        ),
      ];
    }
    return [];
  });
}

function generateNoActivityDigest(user, analytics, tr) {
  const name = user.name || user.email.split('@')[0];
  const period = { weekStart: analytics.weekStart, weekEnd: analytics.weekEnd };
  return {
    subject: tr(
      'email.digest.weekly.subject',
      'Your weekly engagement insights',
    ),
    greeting: greeting(tr, name),
    highlights: tr(
      'email.digest.weekly.quiet.highlights',
      'It was a quiet week for your presentations. No views were recorded from {weekStart} to {weekEnd}. This is a great time to share your content more widely!',
      period,
    ),
    topPresentationsIntro: '',
    topPresentations: [],
    insights: [
      tr(
        'email.digest.weekly.quiet.insightShare',
        'Consider sharing your presentations via email or on social media',
      ),
      tr(
        'email.digest.weekly.quiet.insightLinks',
        'Check if your share links are easily accessible',
      ),
    ],
    weekOverWeek: {
      views: '0 (—)',
      uniqueViewers: '0 (—)',
      avgDuration: '0s (—)',
    },
    closing: tr(
      'email.digest.weekly.quiet.closing',
      'Looking forward to seeing your engagement grow!',
    ),
    weekStart: analytics.weekStart,
    weekEnd: analytics.weekEnd,
  };
}

function generateNoActivityTeamDigest(admin, analytics, tr) {
  const name = admin.name || admin.email.split('@')[0];
  const period = { weekStart: analytics.weekStart, weekEnd: analytics.weekEnd };
  return {
    subject: tr('email.digest.team.subject', "Your team's weekly engagement"),
    greeting: greeting(tr, name),
    highlights: tr(
      'email.digest.team.quiet.highlights',
      "It was a quiet week for your team's presentations. No views were recorded from {weekStart} to {weekEnd}.",
      period,
    ),
    topPresentationsIntro: '',
    topPresentations: [],
    topPresentersIntro: '',
    topPresenters: [],
    insights: [
      tr(
        'email.digest.team.quiet.insightShare',
        'Encourage your team to share their presentations more actively',
      ),
      tr(
        'email.digest.team.quiet.insightContent',
        'Consider creating new content to drive engagement',
      ),
    ],
    weekOverWeek: {
      views: '0 (—)',
    },
    closing: tr(
      'email.digest.team.quiet.closing',
      'Looking forward to seeing your team thrive!',
    ),
    weekStart: analytics.weekStart,
    weekEnd: analytics.weekEnd,
    activePresenters: 0,
    presentationCount: analytics.presentationCount,
  };
}

function generateFallbackDigest(user, analytics, tr, locale) {
  const name = user.name || user.email.split('@')[0];
  const viewTrend = analytics.weekOverWeek.views;
  const topTitle =
    analytics.topPresentations[0]?.title ||
    tr('email.digest.weekly.topTitleFallback', 'your presentations');

  return {
    subject: tr(
      'email.digest.weekly.subjectWithViews',
      'Your weekly engagement insights - {views} views',
      { views: analytics.totalViews },
    ),
    greeting: greeting(tr, name),
    highlights: tr(
      'email.digest.weekly.highlightsTrend',
      'Your presentations received {views} views from {viewers} unique viewers this week, {trend}. "{topTitle}" was your top performer.',
      {
        views: analytics.totalViews,
        viewers: analytics.uniqueViewers,
        trend: trendPhrase(tr, viewTrend),
        topTitle,
      },
    ),
    topPresentationsIntro: tr(
      'email.digest.weekly.topPresentationsIntro',
      'Here are your top performing presentations:',
    ),
    topPresentations: analytics.topPresentations.slice(0, 3).map((p) => ({
      title: p.title,
      views: p.views,
      avgDuration: formatDuration(p.avgDurationSeconds),
    })),
    insights: localizedInsights(analytics.insights, tr, locale).slice(0, 3),
    weekOverWeek: {
      views: `${viewTrend.current} (${viewTrend.direction === 'up' ? '+' : viewTrend.direction === 'down' ? '-' : ''}${viewTrend.percentChange}%)`,
      uniqueViewers: `${analytics.weekOverWeek.uniqueViewers.current} (${analytics.weekOverWeek.uniqueViewers.direction === 'up' ? '+' : analytics.weekOverWeek.uniqueViewers.direction === 'down' ? '-' : ''}${analytics.weekOverWeek.uniqueViewers.percentChange}%)`,
      avgDuration: `${formatDuration(analytics.weekOverWeek.avgDuration.current)} (${analytics.weekOverWeek.avgDuration.direction === 'up' ? '+' : analytics.weekOverWeek.avgDuration.direction === 'down' ? '-' : ''}${analytics.weekOverWeek.avgDuration.percentChange}%)`,
    },
    closing: tr(
      'email.digest.weekly.closing',
      'Keep creating great presentations!',
    ),
    weekStart: analytics.weekStart,
    weekEnd: analytics.weekEnd,
  };
}

function generateFallbackTeamDigest(admin, analytics, tr) {
  const name = admin.name || admin.email.split('@')[0];
  const viewTrend = analytics.weekOverWeek.views;

  return {
    subject: tr(
      'email.digest.team.subjectWithViews',
      "Your team's weekly engagement - {views} views",
      { views: analytics.totalViews },
    ),
    greeting: greeting(tr, name),
    highlights: tr(
      'email.digest.team.highlightsTrend',
      "Your team's presentations received {views} views from {viewers} unique viewers this week, {trend}. {activePresenters} team members had active engagement.",
      {
        views: analytics.totalViews,
        viewers: analytics.uniqueViewers,
        trend: trendPhrase(tr, viewTrend),
        activePresenters: analytics.activePresenters,
      },
    ),
    topPresentationsIntro: tr(
      'email.digest.team.topPresentationsIntro',
      'Top performing presentations across your team:',
    ),
    topPresentations: analytics.topPresentations.slice(0, 5).map((p) => ({
      title: p.title,
      views: p.views,
      ownerEmail: p.ownerEmail,
    })),
    topPresentersIntro: tr(
      'email.digest.team.topPresentersIntro',
      'Most active presenters:',
    ),
    topPresenters: analytics.topPresenters.slice(0, 5).map((p) => ({
      name: p.name,
      totalViews: p.totalViews,
      presentationCount: p.presentationCount,
    })),
    insights: [],
    weekOverWeek: {
      views: `${viewTrend.current} (${viewTrend.direction === 'up' ? '+' : viewTrend.direction === 'down' ? '-' : ''}${viewTrend.percentChange}%)`,
    },
    closing: tr('email.digest.team.closing', 'Keep your team engaged!'),
    weekStart: analytics.weekStart,
    weekEnd: analytics.weekEnd,
    activePresenters: analytics.activePresenters,
    presentationCount: analytics.presentationCount,
  };
}
