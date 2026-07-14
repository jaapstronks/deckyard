/**
 * Deck language from the presenter/projector URL.
 *
 * Only `nl` and `en-GB` are valid deck languages; anything else means "use the
 * deck's own default". Shared by the presenter and the projector window so the
 * `?lang=` handling stays in one place.
 *
 * @param {URL} [url] Defaults to the current location.
 * @returns {{ lang: string|null, activeLang: string|null, langQs: string }}
 *   `lang` is the raw query value, `activeLang` is it only when valid, and
 *   `langQs` is the `?lang=…` suffix to append to API/route URLs (or `''`).
 */
export function readDeckLangFromUrl(url = new URL(location.href)) {
  const lang = url.searchParams.get('lang');
  const valid = lang === 'nl' || lang === 'en-GB';
  return {
    lang,
    activeLang: valid ? lang : null,
    langQs: valid ? `?lang=${encodeURIComponent(lang)}` : '',
  };
}
