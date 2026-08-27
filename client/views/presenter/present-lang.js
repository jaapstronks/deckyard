import { deckLangQuery, readDeckLangParam } from '../../lib/format/i18n.js';

/**
 * Deck language from the presenter/projector URL.
 *
 * A thin, presenter-shaped view of the one `?lang=` reader in
 * `client/lib/format/i18n.js`: the validity test lives there (the deck-language
 * axis, D61), this file only names what the presenter and the projector window
 * both need. It used to re-validate the param inline against `nl`/`en-GB`.
 *
 * @param {URL} [url] Defaults to the current location.
 * @returns {{ activeLang: string|null, langQs: string }}
 *   `activeLang` is the URL's deck language when it names one, and `langQs` is
 *   the `?lang=…` suffix to append to API/route URLs (or `''`).
 */
export function readDeckLangFromUrl(url = new URL(location.href)) {
  return {
    activeLang: readDeckLangParam(url),
    langQs: deckLangQuery(url),
  };
}
