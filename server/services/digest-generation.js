/**
 * AI Digest Generation Service
 * Generates natural language engagement summaries for weekly digest emails.
 */

import { getLlmConfig } from '../utils/llm/config.js';
import { requestChatCompletionContent } from '../utils/llm/index.js';
import { formatDuration } from '../storage/analytics/weekly-summary.js';

// ============================================================
// DIGEST GENERATION
// ============================================================

/**
 * Generate a weekly digest email using AI.
 * @param {Object} user - User info
 * @param {string} user.email - User's email
 * @param {string} user.name - User's display name
 * @param {Object} analytics - Weekly analytics data from getWeeklyAnalyticsForUser
 * @returns {Promise<Object>} Digest content
 */
export async function generateDigestWithAI(user, analytics) {
  // If no activity, return a simple fallback without calling AI
  if (!analytics.hasActivity) {
    return generateNoActivityDigest(user, analytics);
  }

  const { vendor, apiKey, model } = getLlmConfig({});

  // Format analytics data for the prompt
  const formattedData = formatAnalyticsForPrompt(analytics);

  const systemPrompt = buildDigestSystemPrompt();
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
    return validated(parsed, user, analytics);
  } catch (err) {
    // Fallback to template-based digest if AI fails
    console.error('[digest-generation] AI generation failed, using fallback:', err.message);
    return generateFallbackDigest(user, analytics);
  }
}

/**
 * Generate a weekly digest for team admins (organization-wide).
 * @param {Object} admin - Admin user info
 * @param {Object} teamAnalytics - Weekly analytics from getTeamWeeklyAnalytics
 * @returns {Promise<Object>} Digest content
 */
export async function generateTeamDigestWithAI(admin, teamAnalytics) {
  if (!teamAnalytics.hasActivity) {
    return generateNoActivityTeamDigest(admin, teamAnalytics);
  }

  const { vendor, apiKey, model } = getLlmConfig({});

  const systemPrompt = buildTeamDigestSystemPrompt();
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
    return validatedTeam(parsed, admin, teamAnalytics);
  } catch (err) {
    console.error('[digest-generation] Team AI generation failed, using fallback:', err.message);
    return generateFallbackTeamDigest(admin, teamAnalytics);
  }
}

// ============================================================
// PROMPT BUILDERS
// ============================================================

function buildDigestSystemPrompt() {
  return `You are writing a friendly weekly engagement summary email for a presentation author.

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

function buildTeamDigestSystemPrompt() {
  return `You are writing a weekly team-wide engagement summary email for an organization admin.

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

function validated(parsed, user, analytics) {
  const name = user.name || user.email.split('@')[0];

  // If parsing failed, use fallback
  if (!parsed || typeof parsed !== 'object') {
    return generateFallbackDigest(user, analytics);
  }

  // Ensure all required fields exist with reasonable defaults
  return {
    subject: parsed.subject || `Your weekly engagement insights - ${analytics.totalViews} views`,
    greeting: (parsed.greeting || `Hi ${name},`).replace('{name}', name),
    highlights: parsed.highlights || `Your presentations received ${analytics.totalViews} views from ${analytics.uniqueViewers} unique viewers this week.`,
    topPresentationsIntro: parsed.topPresentationsIntro || 'Here are your top performing presentations:',
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
    closing: parsed.closing || 'Keep creating great presentations!',
    weekStart: analytics.weekStart,
    weekEnd: analytics.weekEnd,
  };
}

function validatedTeam(parsed, admin, analytics) {
  const name = admin.name || admin.email.split('@')[0];

  if (!parsed || typeof parsed !== 'object') {
    return generateFallbackTeamDigest(admin, analytics);
  }

  return {
    subject: parsed.subject || `Your team's weekly engagement - ${analytics.totalViews} views`,
    greeting: (parsed.greeting || `Hi ${name},`).replace('{name}', name),
    highlights: parsed.highlights || `Your team's presentations received ${analytics.totalViews} views from ${analytics.uniqueViewers} unique viewers this week.`,
    topPresentationsIntro: parsed.topPresentationsIntro || 'Top performing presentations across your team:',
    topPresentations: analytics.topPresentations.slice(0, 5).map((p) => ({
      title: p.title,
      views: p.views,
      ownerEmail: p.ownerEmail,
    })),
    topPresentersIntro: parsed.topPresentersIntro || 'Most active presenters:',
    topPresenters: analytics.topPresenters.slice(0, 5).map((p) => ({
      name: p.name,
      totalViews: p.totalViews,
      presentationCount: p.presentationCount,
    })),
    insights: Array.isArray(parsed.insights) ? parsed.insights.slice(0, 3) : [],
    weekOverWeek: {
      views: `${analytics.weekOverWeek.views.current} (${analytics.weekOverWeek.views.direction === 'up' ? '+' : ''}${analytics.weekOverWeek.views.percentChange}%)`,
    },
    closing: parsed.closing || 'Keep your team engaged!',
    weekStart: analytics.weekStart,
    weekEnd: analytics.weekEnd,
    activePresenters: analytics.activePresenters,
    presentationCount: analytics.presentationCount,
  };
}

// ============================================================
// FALLBACK GENERATORS
// ============================================================

function generateNoActivityDigest(user, analytics) {
  const name = user.name || user.email.split('@')[0];
  return {
    subject: 'Your weekly engagement insights',
    greeting: `Hi ${name},`,
    highlights: `It was a quiet week for your presentations. No views were recorded from ${analytics.weekStart} to ${analytics.weekEnd}. This is a great time to share your content more widely!`,
    topPresentationsIntro: '',
    topPresentations: [],
    insights: [
      'Consider sharing your presentations via email or on social media',
      'Check if your share links are easily accessible',
    ],
    weekOverWeek: {
      views: '0 (—)',
      uniqueViewers: '0 (—)',
      avgDuration: '0s (—)',
    },
    closing: 'Looking forward to seeing your engagement grow!',
    weekStart: analytics.weekStart,
    weekEnd: analytics.weekEnd,
  };
}

function generateNoActivityTeamDigest(admin, analytics) {
  const name = admin.name || admin.email.split('@')[0];
  return {
    subject: "Your team's weekly engagement",
    greeting: `Hi ${name},`,
    highlights: `It was a quiet week for your team's presentations. No views were recorded from ${analytics.weekStart} to ${analytics.weekEnd}.`,
    topPresentationsIntro: '',
    topPresentations: [],
    topPresentersIntro: '',
    topPresenters: [],
    insights: [
      'Encourage your team to share their presentations more actively',
      'Consider creating new content to drive engagement',
    ],
    weekOverWeek: {
      views: '0 (—)',
    },
    closing: 'Looking forward to seeing your team thrive!',
    weekStart: analytics.weekStart,
    weekEnd: analytics.weekEnd,
    activePresenters: 0,
    presentationCount: analytics.presentationCount,
  };
}

function generateFallbackDigest(user, analytics) {
  const name = user.name || user.email.split('@')[0];
  const viewTrend = analytics.weekOverWeek.views;
  const trendText = viewTrend.direction === 'up'
    ? `up ${viewTrend.percentChange}% from last week`
    : viewTrend.direction === 'down'
    ? `down ${viewTrend.percentChange}% from last week`
    : 'similar to last week';

  const topTitle = analytics.topPresentations[0]?.title || 'your presentations';

  return {
    subject: `Your weekly engagement insights - ${analytics.totalViews} views`,
    greeting: `Hi ${name},`,
    highlights: `Your presentations received ${analytics.totalViews} views from ${analytics.uniqueViewers} unique viewers this week, ${trendText}. "${topTitle}" was your top performer.`,
    topPresentationsIntro: 'Here are your top performing presentations:',
    topPresentations: analytics.topPresentations.slice(0, 3).map((p) => ({
      title: p.title,
      views: p.views,
      avgDuration: formatDuration(p.avgDurationSeconds),
    })),
    insights: analytics.insights.map((i) => i.text).slice(0, 3),
    weekOverWeek: {
      views: `${viewTrend.current} (${viewTrend.direction === 'up' ? '+' : viewTrend.direction === 'down' ? '-' : ''}${viewTrend.percentChange}%)`,
      uniqueViewers: `${analytics.weekOverWeek.uniqueViewers.current} (${analytics.weekOverWeek.uniqueViewers.direction === 'up' ? '+' : analytics.weekOverWeek.uniqueViewers.direction === 'down' ? '-' : ''}${analytics.weekOverWeek.uniqueViewers.percentChange}%)`,
      avgDuration: `${formatDuration(analytics.weekOverWeek.avgDuration.current)} (${analytics.weekOverWeek.avgDuration.direction === 'up' ? '+' : analytics.weekOverWeek.avgDuration.direction === 'down' ? '-' : ''}${analytics.weekOverWeek.avgDuration.percentChange}%)`,
    },
    closing: 'Keep creating great presentations!',
    weekStart: analytics.weekStart,
    weekEnd: analytics.weekEnd,
  };
}

function generateFallbackTeamDigest(admin, analytics) {
  const name = admin.name || admin.email.split('@')[0];
  const viewTrend = analytics.weekOverWeek.views;
  const trendText = viewTrend.direction === 'up'
    ? `up ${viewTrend.percentChange}% from last week`
    : viewTrend.direction === 'down'
    ? `down ${viewTrend.percentChange}% from last week`
    : 'similar to last week';

  return {
    subject: `Your team's weekly engagement - ${analytics.totalViews} views`,
    greeting: `Hi ${name},`,
    highlights: `Your team's presentations received ${analytics.totalViews} views from ${analytics.uniqueViewers} unique viewers this week, ${trendText}. ${analytics.activePresenters} team members had active engagement.`,
    topPresentationsIntro: 'Top performing presentations across your team:',
    topPresentations: analytics.topPresentations.slice(0, 5).map((p) => ({
      title: p.title,
      views: p.views,
      ownerEmail: p.ownerEmail,
    })),
    topPresentersIntro: 'Most active presenters:',
    topPresenters: analytics.topPresenters.slice(0, 5).map((p) => ({
      name: p.name,
      totalViews: p.totalViews,
      presentationCount: p.presentationCount,
    })),
    insights: [],
    weekOverWeek: {
      views: `${viewTrend.current} (${viewTrend.direction === 'up' ? '+' : viewTrend.direction === 'down' ? '-' : ''}${viewTrend.percentChange}%)`,
    },
    closing: 'Keep your team engaged!',
    weekStart: analytics.weekStart,
    weekEnd: analytics.weekEnd,
    activePresenters: analytics.activePresenters,
    presentationCount: analytics.presentationCount,
  };
}
