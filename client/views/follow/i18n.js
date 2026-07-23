// Follow-view chrome i18n.
//
// The audience-facing follow chrome (topbar, Q&A, interaction prompts,
// translating messages) is keyed by the *deck* language (nl / en-GB), which
// the audience switches live via the lang buttons. That axis is distinct from
// the global UI locale that `ui-i18n.js` `t()` drives, so this module keeps a
// small scoped loader: it reads the same modular `follow.json` files (single
// source of truth) but resolves them against the deck language instead of the
// persisted UI locale, without touching the global dictionary.
//
// Strings live in /client/i18n/<locale>/follow.json. English fallbacks are
// inline (matching the app-wide t(key, englishFallback) convention) so the
// chrome degrades gracefully if a file fails to load.

import { normalizeLang } from '../../lib/format/i18n.js';

/** @type {Map<string, Record<string, string>>} */
const dictCache = new Map();

/**
 * Map a deck language to the i18n locale directory. Decks support nl + en-GB;
 * the i18n files use `en` (not `en-GB`), and everything else defaults to nl.
 * @param {string} lang
 * @returns {string}
 */
function deckLangToLocale(lang) {
  return normalizeLang(lang) === 'en-GB' ? 'en' : 'nl';
}

async function loadDict(locale) {
  if (dictCache.has(locale)) return dictCache.get(locale);
  let data = {};
  try {
    const res = await fetch(`/client/i18n/${encodeURIComponent(locale)}/follow.json`, {
      cache: 'no-store',
    });
    if (res.ok) {
      const json = await res.json();
      if (json && typeof json === 'object') data = json;
    }
  } catch {
    // Ignore; inline English fallbacks below keep the chrome usable.
  }
  dictCache.set(locale, data);
  return data;
}

function interpolate(str, vars) {
  if (!vars) return str;
  return String(str).replace(/\{(\w+)\}/g, (m, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m
  );
}

/**
 * Build the follow-view copy object for a deck language. Returns the same shape
 * the follow controllers already consume (`copy.qaTitle`, `copy.interactionOpen`,
 * `copy.translatingWithProgress(info)`, …), sourced from the modular i18n files.
 * @param {string} lang - deck language ('nl' | 'en-GB')
 * @returns {Promise<Object>}
 */
export async function createFollowCopy(lang) {
  const dict = await loadDict(deckLangToLocale(lang));
  const tr = (key, fallback, vars) => {
    const raw = typeof dict[key] === 'string' ? dict[key] : fallback;
    return interpolate(raw, vars);
  };

  const translatingWithProgress = ({ missing, jobStatus } = {}) => {
    if (jobStatus === 'running') {
      return missing && missing > 0
        ? tr('follow.translating.runningCount', 'Translating ({count} {unit})… This page will auto-refresh.', {
            count: missing,
            unit:
              missing === 1
                ? tr('follow.translating.unitSingular', 'item')
                : tr('follow.translating.unitPlural', 'items'),
          })
        : tr('follow.translating.running', 'Translating… This page will auto-refresh.');
    }
    if (jobStatus === 'done' && missing && missing > 0) {
      return tr('follow.translating.almostReady', 'Translation almost ready… This page will auto-refresh.');
    }
    return tr('follow.translating.preparing', 'Preparing translation… Please wait, this page will auto-refresh.');
  };

  return {
    title: tr('follow.title', 'Live follow-along'),
    notStarted: tr('follow.notStarted', "The presentation hasn't started yet."),
    ended: tr('follow.ended', 'The presentation is not active (anymore).'),
    translating: tr('follow.translating', 'Translating… (this page will auto-refresh)'),
    translatingWithProgress,
    connecting: tr('follow.connecting', 'Connecting…'),
    qaTitle: tr('follow.qaTitle', 'Q&A'),
    qaCollapse: tr('follow.qaCollapse', 'Hide questions'),
    qaExpand: tr('follow.qaExpand', 'Show questions'),
    qaName: tr('follow.qaName', 'Your name (optional)'),
    qaNameUnset: tr('follow.qaNameUnset', 'Set name'),
    qaNameSet: tr('follow.qaNameSet', 'Name:'),
    qaPlaceholder: tr('follow.qaPlaceholder', 'Ask a question…'),
    qaAsk: tr('follow.qaAsk', 'Ask'),
    qaEmpty: tr('follow.qaEmpty', 'No questions yet. Ask the first one!'),
    qaPromoted: tr('follow.qaPromoted', 'Will be addressed (added to the deck)'),
    qaTranslatedFromEn: tr('follow.qaTranslatedFromEn', 'translated from English'),
    qaTranslatedFromNl: tr('follow.qaTranslatedFromNl', 'translated from Dutch'),
    qaUpvote: tr('follow.qaUpvote', 'Upvote'),
    qaCancel: tr('follow.qaCancel', 'Cancel my question'),
    qaViewOriginal: tr('follow.qaViewOriginal', 'View original'),
    qaViewTranslation: tr('follow.qaViewTranslation', 'View translation'),
    interactionTitle: tr('follow.interactionTitle', 'Participate'),
    interactionLoading: tr('follow.interactionLoading', 'Loading…'),
    interactionOpen: tr('follow.interactionOpen', 'Vote now.'),
    interactionClosed: tr('follow.interactionClosed', 'Voting is closed.'),
    interactionThanks: tr('follow.interactionThanks', 'Thanks! Your vote was saved.'),
    interactionThanksFeedback: tr('follow.interactionThanksFeedback', 'Thanks! Your feedback was saved.'),
    interactionFeedbackSending: tr('follow.interactionFeedbackSending', 'Sending…'),
    interactionFeedbackHint: tr('follow.interactionFeedbackHint', 'Write your feedback and press Send.'),
    interactionFeedbackSend: tr('follow.interactionFeedbackSend', 'Send'),
    interactionFeedbackUpdate: tr('follow.interactionFeedbackUpdate', 'Update'),
    interactionFeedbackUpdating: tr('follow.interactionFeedbackUpdating', 'Updating…'),
    interactionFeedbackPlaceholder: tr('follow.interactionFeedbackPlaceholder', 'Type your feedback…'),
    likertSliderYourScore: (n) =>
      tr('follow.likertSlider.yourScore', 'Your score: {n}', { n }),
    likertSliderChooseScore: (n) =>
      tr('follow.likertSlider.chooseScore', 'Choose a score: {n}', { n }),
    followInviteSuccess: tr(
      'follow.followInviteSuccess',
      'Follow along mode successful, this view will update automatically.'
    ),
  };
}
