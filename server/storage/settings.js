import path from 'node:path';
import { safeSlug } from '../utils/slug.js';
import { readJsonIfExists, writeJsonAtomic } from './io.js';
import { dataDir } from '../config/storage-paths.js';
import { DEFAULT_AI_NAME, DEFAULT_AI_EMAIL } from '../../shared/constants/ai.js';
import { getAppName } from '../config/branding.js';
import { SUBSCRIPTION_LEVELS } from './presentation-subscriptions.js';

function settingsPath(repoRoot) {
  return path.join(dataDir(repoRoot), 'settings.json');
}

function userSettingsDir(repoRoot) {
  return path.join(dataDir(repoRoot), 'user-settings');
}

function safeEmailSlug(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return 'anonymous';
  // Preserve some uniqueness beyond the local part by mapping separators first.
  const mapped = e
    .replaceAll('@', ' at ')
    .replaceAll('.', ' dot ')
    .replaceAll('+', ' plus ');
  return safeSlug(mapped);
}

function userSettingsPath(repoRoot, email) {
  return path.join(
    userSettingsDir(repoRoot),
    `${safeEmailSlug(email)}.json`
  );
}

export function normalizeSupportedLang(v) {
  // NOTE: Foundation: keep language codes conservative for now (matches existing client i18n).
  return v === 'nl' || v === 'en-GB' ? v : null;
}

export function normalizeUiLocale(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  // Safe-ish subset of BCP-47 tags, stored lowercase.
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(s)) return null;
  return s.toLowerCase();
}

export function normalizeSupportedLangList(arr) {
  const out = [];
  for (const v of Array.isArray(arr) ? arr : []) {
    const l = normalizeSupportedLang(v);
    if (!l) continue;
    if (!out.includes(l)) out.push(l);
  }
  return out;
}

export function defaultAppSettings() {
  return {
    supportedSlideLangs: ['nl', 'en-GB'],
    webhooks: {
      presentationMovedToWorkspaceUrl: '',
      slideAddedToTeamLibraryUrl: '',
      presentationPublishedUrl: '',
      commentCreatedUrl: '',
      interactionPollClosedUrl: '',
      interactionFeedbackSubmittedUrl: '',
      interactionLikertClosedUrl: '',
      leadSubmittedUrl: '',
    },
    notifications: {
      emailEnabled: false,
    },
    // AI assistant identity (shown in comments, suggestions, etc.)
    aiAssistant: {
      name: '', // Falls back to DEFAULT_AI_NAME if empty
      email: '', // Falls back to DEFAULT_AI_EMAIL if empty
    },
    // Email sender identity (falls back to env vars if empty)
    emailSender: {
      email: '', // Falls back to BREVO_SENDER_EMAIL env var
      name: '', // Falls back to BREVO_SENDER_NAME env var
    },
    // Session duration in days (falls back to 30 if not set)
    sessionDurationDays: 30,
    // Enabled theme IDs (empty = all themes enabled)
    enabledThemes: [],
    // Engagement insights (analytics) settings
    analytics: {
      enabled: true, // Master switch for all analytics
      teamAnalytics: {
        policy: 'aggregate', // 'off' | 'aggregate' | 'opt-in-detailed'
        allowDetailedOptIn: true, // Allow presenters to request detailed team analytics
      },
      externalAnalytics: {
        enabled: true, // Track external/anonymous viewers
      },
      retention: {
        sessionDataDays: 90, // How long to keep detailed session data
        ipAnonymizationDays: 7, // How long before IP addresses are anonymized
      },
      // External analytics providers (UI-configurable, overrides env vars when set)
      externalProviders: {
        umami: {
          enabled: false,
          websiteId: '', // Website ID from Umami dashboard
          url: '', // Self-hosted URL (empty = cloud.umami.is)
        },
        plausible: {
          enabled: false,
          domain: '', // Domain to track
          url: '', // Self-hosted URL (empty = plausible.io)
        },
        matomo: {
          enabled: false,
          url: '', // Matomo server URL
          siteId: '', // Site ID
          disableCookies: true, // Privacy-friendly default
          requireConsent: false,
        },
        googleAnalytics: {
          enabled: false,
          measurementId: '', // G-XXXXXXX
        },
      },
    },
    // Stock media integrations (Unsplash, Giphy)
    stockMedia: {
      unsplash: { enabled: false },
      giphy: { enabled: false },
    },
    // Lead capture settings
    leads: {
      retentionDays: 365, // GDPR retention period (1-730 days)
    },
  };
}

function normalizeWebhookUrl(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (s.length > 2048) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.toString();
  } catch {
    return '';
  }
}

function normalizeString(v, maxLen = 255) {
  const s = String(v || '').trim();
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function normalizePositiveInt(v, fallback, min = 1, max = 365) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n) || n < min) return fallback;
  return Math.min(n, max);
}

function normalizeStringArray(arr, maxLen = 50) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((v) => normalizeString(v, 64))
    .filter(Boolean)
    .slice(0, maxLen);
}

function normalizeAnalyticsPolicy(v) {
  const allowed = ['off', 'aggregate', 'opt-in-detailed'];
  const s = String(v || '').trim().toLowerCase();
  return allowed.includes(s) ? s : 'aggregate';
}

function normalizeProviderUrl(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (s.length > 2048) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    // Return without trailing slash
    return u.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function normalizeExternalProviders(obj) {
  if (!obj || typeof obj !== 'object') return null;

  const umamiObj = obj?.umami && typeof obj.umami === 'object' ? obj.umami : {};
  const plausibleObj = obj?.plausible && typeof obj.plausible === 'object' ? obj.plausible : {};
  const matomoObj = obj?.matomo && typeof obj.matomo === 'object' ? obj.matomo : {};
  const gaObj = obj?.googleAnalytics && typeof obj.googleAnalytics === 'object' ? obj.googleAnalytics : {};

  return {
    umami: {
      enabled: umamiObj?.enabled === true,
      websiteId: normalizeString(umamiObj?.websiteId, 64),
      url: normalizeProviderUrl(umamiObj?.url),
    },
    plausible: {
      enabled: plausibleObj?.enabled === true,
      domain: normalizeString(plausibleObj?.domain, 255),
      url: normalizeProviderUrl(plausibleObj?.url),
    },
    matomo: {
      enabled: matomoObj?.enabled === true,
      url: normalizeProviderUrl(matomoObj?.url),
      siteId: normalizeString(matomoObj?.siteId, 32),
      disableCookies: matomoObj?.disableCookies !== false, // Default true
      requireConsent: matomoObj?.requireConsent === true,
    },
    googleAnalytics: {
      enabled: gaObj?.enabled === true,
      measurementId: normalizeString(gaObj?.measurementId, 32),
    },
  };
}

function normalizeDayOfWeek(v) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n) || n < 0 || n > 6) return 1; // Default to Monday
  return n;
}

export async function readAppSettings(repoRoot) {
  const raw = await readJsonIfExists(settingsPath(repoRoot));
  const obj = raw && typeof raw === 'object' ? raw : {};
  const defaults = defaultAppSettings();
  const supportedSlideLangs =
    normalizeSupportedLangList(obj.supportedSlideLangs) ||
    [];
  const wh = obj?.webhooks && typeof obj.webhooks === 'object' ? obj.webhooks : {};
  const webhooks = {
    presentationMovedToWorkspaceUrl: normalizeWebhookUrl(
      wh?.presentationMovedToWorkspaceUrl
    ),
    slideAddedToTeamLibraryUrl: normalizeWebhookUrl(wh?.slideAddedToTeamLibraryUrl),
    presentationPublishedUrl: normalizeWebhookUrl(wh?.presentationPublishedUrl),
    commentCreatedUrl: normalizeWebhookUrl(wh?.commentCreatedUrl),
    interactionPollClosedUrl: normalizeWebhookUrl(wh?.interactionPollClosedUrl),
    interactionFeedbackSubmittedUrl: normalizeWebhookUrl(wh?.interactionFeedbackSubmittedUrl),
    interactionLikertClosedUrl: normalizeWebhookUrl(wh?.interactionLikertClosedUrl),
    leadSubmittedUrl: normalizeWebhookUrl(wh?.leadSubmittedUrl),
  };
  const notif = obj?.notifications && typeof obj.notifications === 'object' ? obj.notifications : {};
  const notifications = {
    emailEnabled: notif?.emailEnabled === true,
  };

  // AI assistant identity
  const ai = obj?.aiAssistant && typeof obj.aiAssistant === 'object' ? obj.aiAssistant : {};
  const aiAssistant = {
    name: normalizeString(ai?.name, 64),
    email: normalizeString(ai?.email, 255),
  };

  // Email sender identity
  const sender = obj?.emailSender && typeof obj.emailSender === 'object' ? obj.emailSender : {};
  const emailSender = {
    email: normalizeString(sender?.email, 255),
    name: normalizeString(sender?.name, 128),
  };

  // Session duration
  const sessionDurationDays = normalizePositiveInt(
    obj?.sessionDurationDays,
    defaults.sessionDurationDays,
    1,
    365
  );

  // Enabled themes (empty = all enabled)
  const enabledThemes = normalizeStringArray(obj?.enabledThemes);

  // Analytics settings
  const analyticsObj = obj?.analytics && typeof obj.analytics === 'object' ? obj.analytics : {};
  const teamAnalyticsObj = analyticsObj?.teamAnalytics && typeof analyticsObj.teamAnalytics === 'object'
    ? analyticsObj.teamAnalytics : {};
  const externalAnalyticsObj = analyticsObj?.externalAnalytics && typeof analyticsObj.externalAnalytics === 'object'
    ? analyticsObj.externalAnalytics : {};
  const retentionObj = analyticsObj?.retention && typeof analyticsObj.retention === 'object'
    ? analyticsObj.retention : {};
  const externalProvidersObj = analyticsObj?.externalProviders && typeof analyticsObj.externalProviders === 'object'
    ? analyticsObj.externalProviders : {};

  const analytics = {
    enabled: analyticsObj?.enabled !== false,
    teamAnalytics: {
      policy: normalizeAnalyticsPolicy(teamAnalyticsObj?.policy),
      allowDetailedOptIn: teamAnalyticsObj?.allowDetailedOptIn !== false,
    },
    externalAnalytics: {
      enabled: externalAnalyticsObj?.enabled !== false,
    },
    retention: {
      sessionDataDays: normalizePositiveInt(retentionObj?.sessionDataDays, 90, 1, 365),
      ipAnonymizationDays: normalizePositiveInt(retentionObj?.ipAnonymizationDays, 7, 1, 90),
    },
    externalProviders: normalizeExternalProviders(externalProvidersObj) || defaults.analytics.externalProviders,
  };

  // Stock media settings
  const stockMediaObj = obj?.stockMedia && typeof obj.stockMedia === 'object' ? obj.stockMedia : {};
  const unsplashObj = stockMediaObj?.unsplash && typeof stockMediaObj.unsplash === 'object'
    ? stockMediaObj.unsplash : {};
  const giphyObj = stockMediaObj?.giphy && typeof stockMediaObj.giphy === 'object'
    ? stockMediaObj.giphy : {};

  const stockMedia = {
    unsplash: { enabled: unsplashObj?.enabled === true },
    giphy: { enabled: giphyObj?.enabled === true },
  };

  // Lead capture settings
  const leadsObj = obj?.leads && typeof obj.leads === 'object' ? obj.leads : {};
  const leads = {
    retentionDays: normalizePositiveInt(leadsObj?.retentionDays, 365, 1, 730),
  };

  return {
    ...defaults,
    supportedSlideLangs: supportedSlideLangs.length
      ? supportedSlideLangs
      : defaults.supportedSlideLangs,
    webhooks,
    notifications,
    aiAssistant,
    emailSender,
    sessionDurationDays,
    enabledThemes,
    analytics,
    stockMedia,
    leads,
  };
}

export async function writeAppSettings(repoRoot, next) {
  const prev = await readAppSettings(repoRoot);
  const defaults = defaultAppSettings();

  const supportedSlideLangs = normalizeSupportedLangList(
    next?.supportedSlideLangs
  );
  const nextWh =
    next?.webhooks && typeof next.webhooks === 'object' ? next.webhooks : null;
  const webhooks = nextWh
    ? {
        presentationMovedToWorkspaceUrl: normalizeWebhookUrl(
          nextWh?.presentationMovedToWorkspaceUrl
        ),
        slideAddedToTeamLibraryUrl: normalizeWebhookUrl(
          nextWh?.slideAddedToTeamLibraryUrl
        ),
        presentationPublishedUrl: normalizeWebhookUrl(
          nextWh?.presentationPublishedUrl
        ),
        commentCreatedUrl: normalizeWebhookUrl(
          nextWh?.commentCreatedUrl
        ),
        interactionPollClosedUrl: normalizeWebhookUrl(
          nextWh?.interactionPollClosedUrl
        ),
        interactionFeedbackSubmittedUrl: normalizeWebhookUrl(
          nextWh?.interactionFeedbackSubmittedUrl
        ),
        interactionLikertClosedUrl: normalizeWebhookUrl(
          nextWh?.interactionLikertClosedUrl
        ),
        leadSubmittedUrl: normalizeWebhookUrl(
          nextWh?.leadSubmittedUrl
        ),
      }
    : null;
  const nextNotif =
    next?.notifications && typeof next.notifications === 'object' ? next.notifications : null;
  const notifications = nextNotif
    ? {
        emailEnabled: nextNotif?.emailEnabled === true,
      }
    : null;

  // AI assistant identity
  const nextAi =
    next?.aiAssistant && typeof next.aiAssistant === 'object' ? next.aiAssistant : null;
  const aiAssistant = nextAi
    ? {
        name: normalizeString(nextAi?.name, 64),
        email: normalizeString(nextAi?.email, 255),
      }
    : null;

  // Email sender identity
  const nextSender =
    next?.emailSender && typeof next.emailSender === 'object' ? next.emailSender : null;
  const emailSender = nextSender
    ? {
        email: normalizeString(nextSender?.email, 255),
        name: normalizeString(nextSender?.name, 128),
      }
    : null;

  // Session duration
  const sessionDurationDays =
    next?.sessionDurationDays !== undefined
      ? normalizePositiveInt(next.sessionDurationDays, defaults.sessionDurationDays, 1, 365)
      : null;

  // Enabled themes
  const enabledThemes =
    next?.enabledThemes !== undefined
      ? normalizeStringArray(next.enabledThemes)
      : null;

  // Analytics settings
  const nextAnalytics =
    next?.analytics && typeof next.analytics === 'object' ? next.analytics : null;
  let analytics = null;
  if (nextAnalytics) {
    const nextTeamAnalytics = nextAnalytics?.teamAnalytics && typeof nextAnalytics.teamAnalytics === 'object'
      ? nextAnalytics.teamAnalytics : {};
    const nextExternalAnalytics = nextAnalytics?.externalAnalytics && typeof nextAnalytics.externalAnalytics === 'object'
      ? nextAnalytics.externalAnalytics : {};
    const nextRetention = nextAnalytics?.retention && typeof nextAnalytics.retention === 'object'
      ? nextAnalytics.retention : {};
    const nextExternalProviders = nextAnalytics?.externalProviders && typeof nextAnalytics.externalProviders === 'object'
      ? nextAnalytics.externalProviders : null;

    analytics = {
      enabled: nextAnalytics?.enabled !== false,
      teamAnalytics: {
        policy: normalizeAnalyticsPolicy(nextTeamAnalytics?.policy ?? prev.analytics?.teamAnalytics?.policy),
        allowDetailedOptIn: nextTeamAnalytics?.allowDetailedOptIn !== false,
      },
      externalAnalytics: {
        enabled: nextExternalAnalytics?.enabled !== false,
      },
      retention: {
        sessionDataDays: normalizePositiveInt(
          nextRetention?.sessionDataDays ?? prev.analytics?.retention?.sessionDataDays,
          90, 1, 365
        ),
        ipAnonymizationDays: normalizePositiveInt(
          nextRetention?.ipAnonymizationDays ?? prev.analytics?.retention?.ipAnonymizationDays,
          7, 1, 90
        ),
      },
      externalProviders: nextExternalProviders
        ? normalizeExternalProviders(nextExternalProviders)
        : prev.analytics?.externalProviders || defaults.analytics.externalProviders,
    };
  }

  // Stock media settings
  const nextStockMedia =
    next?.stockMedia && typeof next.stockMedia === 'object' ? next.stockMedia : null;
  let stockMedia = null;
  if (nextStockMedia) {
    const nextUnsplash = nextStockMedia?.unsplash && typeof nextStockMedia.unsplash === 'object'
      ? nextStockMedia.unsplash : {};
    const nextGiphy = nextStockMedia?.giphy && typeof nextStockMedia.giphy === 'object'
      ? nextStockMedia.giphy : {};

    stockMedia = {
      unsplash: { enabled: nextUnsplash?.enabled === true },
      giphy: { enabled: nextGiphy?.enabled === true },
    };
  }

  // Lead capture settings
  const nextLeads =
    next?.leads && typeof next.leads === 'object' ? next.leads : null;
  let leads = null;
  if (nextLeads) {
    leads = {
      retentionDays: normalizePositiveInt(
        nextLeads?.retentionDays ?? prev.leads?.retentionDays,
        365, 1, 730
      ),
    };
  }

  const merged = {
    ...prev,
    ...(supportedSlideLangs.length
      ? { supportedSlideLangs }
      : null),
    ...(webhooks ? { webhooks } : null),
    ...(notifications ? { notifications } : null),
    ...(aiAssistant ? { aiAssistant } : null),
    ...(emailSender ? { emailSender } : null),
    ...(sessionDurationDays !== null ? { sessionDurationDays } : null),
    ...(enabledThemes !== null ? { enabledThemes } : null),
    ...(analytics ? { analytics } : null),
    ...(stockMedia ? { stockMedia } : null),
    ...(leads ? { leads } : null),
  };
  await writeJsonAtomic(settingsPath(repoRoot), merged);
  return merged;
}

export function defaultUserSettings() {
  return {
    profile: {
      name: '',
      imageUrl: '', // URL to uploaded profile image
    },
    uiLocale: 'en', // UI language for app chrome
    uiLang: null, // 'nl' | 'en-GB' | null
    notifications: {
      emailEnabled: true, // Receive email notifications (channel master switch)
      slackEnabled: true, // Receive Slack/webhook notifications (channel master switch)
      leadEmails: true, // Receive email when leads are captured
      // Default subscription level for decks without a per-deck override
      // (watching | participating | mentions_only | mute)
      defaultLevel: 'participating',
      // Email per comment-event type (in-app notifications always follow
      // the subscription level; these only gate the email channel)
      emailByType: {
        comment_created: true,
        comment_reply: true,
        comment_mention: true,
      },
    },
    // Privacy settings for analytics
    privacy: {
      allowViewAttribution: false, // Opt-in to having your views attributed by name
      disableAllTracking: false, // Opt-out of all analytics tracking
    },
    // Weekly engagement digest settings
    digest: {
      enabled: true, // Receive weekly engagement digest
      dayOfWeek: 1, // 0=Sunday, 1=Monday, etc.
      includeTeamAnalytics: true, // Include team view statistics in digest
    },
    // Presenter highlighter / laser pointer settings
    highlighter: {
      color: '#ef4444', // Default red
      thickness: 4, // Stroke width in pixels (1-10)
      persistentDraw: false, // If true, drawings don't fade (cleared on slide change or manually)
    },
  };
}

function normalizeSubscriptionLevel(v) {
  return SUBSCRIPTION_LEVELS.includes(v) ? v : 'participating';
}

function normalizeEmailByType(v) {
  const obj = v && typeof v === 'object' ? v : {};
  return {
    comment_created: obj?.comment_created !== false,
    comment_reply: obj?.comment_reply !== false,
    comment_mention: obj?.comment_mention !== false,
  };
}

function normalizeHexColor(v) {
  const s = String(v || '').trim();
  // Allow 3 or 6 digit hex colors
  if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s.toLowerCase();
  if (/^#[0-9A-Fa-f]{3}$/.test(s)) {
    // Expand 3-digit to 6-digit
    const [, r, g, b] = s.match(/^#(.)(.)(.)$/);
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
}

function normalizeThickness(v, fallback = 4) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n) || n < 1) return fallback;
  return Math.min(n, 10);
}

export async function readUserSettings(repoRoot, email) {
  const raw = await readJsonIfExists(
    userSettingsPath(repoRoot, email)
  );
  const obj = raw && typeof raw === 'object' ? raw : {};
  const defaults = defaultUserSettings();
  const profile =
    obj.profile && typeof obj.profile === 'object' ? obj.profile : {};
  const name =
    typeof profile.name === 'string' ? profile.name : '';
  const imageUrl =
    typeof profile.imageUrl === 'string' ? profile.imageUrl : '';
  const uiLang = normalizeSupportedLang(obj.uiLang);
  const uiLocale = normalizeUiLocale(obj.uiLocale) || defaults.uiLocale;
  const notif = obj?.notifications && typeof obj.notifications === 'object' ? obj.notifications : {};
  const notifications = {
    // Default to true if not explicitly set to false
    emailEnabled: notif?.emailEnabled !== false,
    slackEnabled: notif?.slackEnabled !== false,
    leadEmails: notif?.leadEmails !== false,
    defaultLevel: normalizeSubscriptionLevel(notif?.defaultLevel),
    emailByType: normalizeEmailByType(notif?.emailByType),
  };

  // Privacy settings
  const privacyObj = obj?.privacy && typeof obj.privacy === 'object' ? obj.privacy : {};
  const privacy = {
    allowViewAttribution: privacyObj?.allowViewAttribution === true,
    disableAllTracking: privacyObj?.disableAllTracking === true,
  };

  // Digest settings
  const digestObj = obj?.digest && typeof obj.digest === 'object' ? obj.digest : {};
  const digest = {
    enabled: digestObj?.enabled !== false,
    dayOfWeek: normalizeDayOfWeek(digestObj?.dayOfWeek),
    includeTeamAnalytics: digestObj?.includeTeamAnalytics !== false,
  };

  // Highlighter settings
  const highlighterObj = obj?.highlighter && typeof obj.highlighter === 'object' ? obj.highlighter : {};
  const highlighter = {
    color: normalizeHexColor(highlighterObj?.color) || defaults.highlighter.color,
    thickness: normalizeThickness(highlighterObj?.thickness, defaults.highlighter.thickness),
    persistentDraw: highlighterObj?.persistentDraw === true,
  };

  return {
    ...defaults,
    profile: {
      name: String(name || '').trim(),
      imageUrl: String(imageUrl || '').trim(),
    },
    uiLocale,
    uiLang,
    notifications,
    privacy,
    digest,
    highlighter,
  };
}

export async function writeUserSettings(repoRoot, email, next) {
  const prev = await readUserSettings(repoRoot, email);
  const nextProfile =
    next?.profile && typeof next.profile === 'object'
      ? next.profile
      : {};
  const name =
    typeof nextProfile?.name === 'string'
      ? String(nextProfile.name).trim()
      : prev.profile.name;
  // Only update imageUrl if explicitly provided (even empty string to clear)
  const imageUrl =
    typeof nextProfile?.imageUrl === 'string'
      ? String(nextProfile.imageUrl).trim()
      : prev.profile.imageUrl;
  const uiLocale = normalizeUiLocale(next?.uiLocale) || prev.uiLocale;
  const uiLang = normalizeSupportedLang(next?.uiLang);
  const nextNotif =
    next?.notifications && typeof next.notifications === 'object'
      ? next.notifications
      : null;
  // Partial writes inherit absent keys from the stored settings, so an
  // API consumer updating one preference can't silently reset the rest.
  const notifications = nextNotif
    ? {
        emailEnabled: (nextNotif?.emailEnabled ?? prev.notifications?.emailEnabled) !== false,
        slackEnabled: (nextNotif?.slackEnabled ?? prev.notifications?.slackEnabled) !== false,
        leadEmails: (nextNotif?.leadEmails ?? prev.notifications?.leadEmails) !== false,
        defaultLevel: normalizeSubscriptionLevel(
          nextNotif?.defaultLevel ?? prev.notifications?.defaultLevel
        ),
        emailByType: normalizeEmailByType({
          ...prev.notifications?.emailByType,
          ...(nextNotif?.emailByType && typeof nextNotif.emailByType === 'object'
            ? nextNotif.emailByType
            : {}),
        }),
      }
    : prev.notifications;

  // Privacy settings
  const nextPrivacy =
    next?.privacy && typeof next.privacy === 'object'
      ? next.privacy
      : null;
  const privacy = nextPrivacy
    ? {
        allowViewAttribution: nextPrivacy?.allowViewAttribution === true,
        disableAllTracking: nextPrivacy?.disableAllTracking === true,
      }
    : prev.privacy;

  // Digest settings
  const nextDigest =
    next?.digest && typeof next.digest === 'object'
      ? next.digest
      : null;
  const digest = nextDigest
    ? {
        enabled: nextDigest?.enabled !== false,
        dayOfWeek: normalizeDayOfWeek(nextDigest?.dayOfWeek ?? prev.digest?.dayOfWeek),
        includeTeamAnalytics: nextDigest?.includeTeamAnalytics !== false,
      }
    : prev.digest;

  // Highlighter settings
  const defaults = defaultUserSettings();
  const nextHighlighter =
    next?.highlighter && typeof next.highlighter === 'object'
      ? next.highlighter
      : null;
  const highlighter = nextHighlighter
    ? {
        color: normalizeHexColor(nextHighlighter?.color) || prev.highlighter?.color || defaults.highlighter.color,
        thickness: normalizeThickness(nextHighlighter?.thickness ?? prev.highlighter?.thickness, defaults.highlighter.thickness),
        persistentDraw: nextHighlighter?.persistentDraw === true,
      }
    : prev.highlighter;

  const merged = {
    ...prev,
    profile: { name, imageUrl },
    uiLocale,
    ...(uiLang ? { uiLang } : { uiLang: null }),
    notifications,
    privacy,
    digest,
    highlighter,
  };
  await writeJsonAtomic(userSettingsPath(repoRoot, email), merged);
  return merged;
}

// ============================================================
// HELPER FUNCTIONS FOR COMMON SETTINGS
// ============================================================

/**
 * Get AI assistant identity from app settings.
 * Returns { name, email } with fallbacks to defaults.
 * @param {string} repoRoot - Repository root path
 * @returns {Promise<{ name: string, email: string }>}
 */
export async function getAiIdentity(repoRoot) {
  const settings = await readAppSettings(repoRoot);
  return {
    name: settings.aiAssistant?.name || DEFAULT_AI_NAME,
    email: settings.aiAssistant?.email || DEFAULT_AI_EMAIL,
  };
}

/**
 * Get email sender identity from app settings.
 * Returns { email, name } with fallbacks to env vars then defaults.
 * @param {string} repoRoot - Repository root path
 * @returns {Promise<{ email: string, name: string }>}
 */
export async function getEmailSender(repoRoot) {
  const settings = await readAppSettings(repoRoot);
  return {
    email:
      settings.emailSender?.email ||
      process.env.BREVO_SENDER_EMAIL ||
      'noreply@example.com',
    name:
      settings.emailSender?.name ||
      process.env.BREVO_SENDER_NAME ||
      getAppName(),
  };
}

/**
 * Get session duration in days from app settings.
 * @param {string} repoRoot - Repository root path
 * @returns {Promise<number>}
 */
export async function getSessionDurationDays(repoRoot) {
  const settings = await readAppSettings(repoRoot);
  return settings.sessionDurationDays || 30;
}