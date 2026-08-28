import { normalizeLang } from '../../../lib/format/i18n.js';
import { t } from '../../../lib/ui-i18n.js';
import { confirmModal } from '../../../lib/dom/modal.js';
import { openDescriptionModal } from '../modals/description-modal.js';
import { DEFAULT_DECK_LANG } from '../../../../shared/i18n-utils.js';
import { existingVersionLangs } from '../../../../shared/i18n-progress.js';

/**
 * The public links, embed URL and two snippets for one language version.
 *
 * @typedef {Object} PublishLangLinks
 * @property {string} lang - the deck language, in axis spelling
 * @property {string} url - the public `/p/…` link
 * @property {string} embedUrl - the `/embed/…` link
 * @property {string} iframeSnippet - a ready-to-paste `<iframe>`
 * @property {string} sdkSnippet - a ready-to-paste embed-SDK block
 */

/**
 * Build the link set for every language version this deck actually has, the
 * one being edited first.
 *
 * It used to build two — "this language" and `otherLang()`'s answer — so a deck
 * with `nl`, `de` and `fr` published three versions and offered links to two of
 * them (D72 #6). The order is deliberate: the current language leads, because
 * that is the link the modal copies to the clipboard on open.
 *
 * @param {Object} opts
 * @param {Object} opts.pres - the deck
 * @param {string} opts.currentLang - the language being edited
 * @param {string} opts.path - the public path (`/p/<publishId>-<slug>`)
 * @param {string} opts.publishId
 * @param {string} opts.slug
 * @returns {PublishLangLinks[]}
 */
function buildLangLinks({ pres, currentLang, path, publishId, slug }) {
  const others = existingVersionLangs(pres).filter((l) => l !== currentLang);
  const embedUrlBase = `${location.origin}/embed/${publishId}-${slug}`;
  return [currentLang, ...others].map((lang) => {
    const q = encodeURIComponent(lang);
    const url = `${location.origin}${path}?lang=${q}`;
    const embedUrl = `${embedUrlBase}?lang=${q}`;
    return {
      lang,
      url,
      embedUrl,
      iframeSnippet: `<iframe src="${embedUrl}&controls=1&ui=default&start=0" style="width:100%;aspect-ratio:16/9;border:0;" allowfullscreen></iframe>`,
      sdkSnippet: `<div id="deck-embed"></div>
<script src="${location.origin}/client/embed-sdk.js"></script>
<script>
  window.PresentationSystemEmbed.createDeckEmbed({
    el: document.getElementById('deck-embed'),
    publishId: '${publishId}',
    options: {
      baseUrl: '${location.origin}',
      controls: true,
      ui: 'default',
      start: 0,
      lang: '${lang}',
      allowedOrigins: [window.location.origin],
    },
  });
</script>`,
    };
  });
}

/**
 * The link set of the language being edited — the one a "copy the public link"
 * affordance means when it does not name a language.
 *
 * @param {{currentLang?: string, langs?: PublishLangLinks[]}} [data]
 * @returns {PublishLangLinks|null}
 */
export function primaryLangLinks(data) {
  const langs = Array.isArray(data?.langs) ? data.langs : [];
  return langs.find((x) => x?.lang === data?.currentLang) || langs[0] || null;
}

/**
 * Build modal data from existing published presentation data.
 * Used when opening the "manage published" modal without re-publishing.
 */
/**
 * Build modal data from existing published presentation data.
 * Used when opening the "manage published" modal without re-publishing.
 */
export function buildPublishModalData({ pres, activeLang = null } = {}) {
  const publishId = pres?.published?.id || '';
  const slug = pres?.published?.slug || '';

  const currentLang =
    activeLang || normalizeLang(pres?.i18n?.active) || DEFAULT_DECK_LANG;

  return {
    currentLang,
    langs: buildLangLinks({
      pres,
      currentLang,
      path: `/p/${publishId}-${slug}`,
      publishId,
      slug,
    }),
  };
}

export async function doPublish({
  root,
  api,
  toast,
  pres,
  id,
  requestSave,
  openPublishModal,
  activeLang = null,
} = {}) {
  // Make sure the latest edits are persisted before publishing.
  await requestSave?.();

  const alreadyPublished = !!(
    typeof pres?.published?.id === 'string' && pres.published.id
  );
  if (!alreadyPublished) {
    // Require a deck description before publishing (can be AI-generated).
    const hasDesc =
      typeof pres?.description === 'string' && pres.description.trim();
    if (!hasDesc) {
      const r = await openDescriptionModal({
        root,
        api,
        toast,
        pres,
        id,
        context: 'publish',
        requestSave,
      });
      if (!r?.ok) return null;
    }

    const ok = await confirmModal(root, {
      title: t('editor.publish.publish', 'Publish'),
      message: t(
        'editor.publish.confirm',
        'Publish?\n\nThis makes the presentation publicly accessible to anyone with the link.',
      ),
      confirmLabel: t('editor.publish.publish', 'Publish'),
    });
    if (!ok) return null;
  }

  const first = pres?.slides?.[0];
  if (!first)
    throw new Error(t('editor.publish.noSlides', 'No slides to publish'));

  // Hint about missing alt text on image-based slides (non-blocking, but recommended).
  const slides = Array.isArray(pres?.slides) ? pres.slides : [];
  const missingAlt = [];
  for (let i = 0; i < slides.length; i += 1) {
    const s = slides[i];
    if (!s || typeof s !== 'object') continue;
    if (s.type !== 'image-slide' && s.type !== 'image-text-slide') continue;
    const c = s.content && typeof s.content === 'object' ? s.content : {};
    const img = typeof c.image === 'string' ? c.image.trim() : '';
    if (!img) continue;
    const alt = typeof c.alt === 'string' ? c.alt.trim() : '';
    const altNl = typeof c.altNl === 'string' ? c.altNl.trim() : '';
    const altEn = typeof c.altEn === 'string' ? c.altEn.trim() : '';
    if (!alt && !altNl && !altEn) missingAlt.push(i + 1);
  }
  if (missingAlt.length) {
    const msg = t(
      'editor.publish.missingAltConfirm',
      'Warning: these slides contain an image without alt text (NL/EN): {slides}\n\nPublish anyway?',
      { slides: missingAlt.join(', ') },
    );
    const ok = await confirmModal(root, {
      title: t('editor.publish.missingAltTitle', 'Missing alt text'),
      message: msg,
      confirmLabel: t('editor.publish.publishAnyway', 'Publish anyway'),
    });
    if (!ok) return null;
  }

  // RSS feed notice (non-blocking info toast, first publish only)
  if (!alreadyPublished) {
    try {
      const orgResp = await api('/api/settings/organization');
      const orgSettings =
        orgResp?.settings && typeof orgResp.settings === 'object'
          ? orgResp.settings
          : {};
      const presSettings =
        pres?.settings && typeof pres.settings === 'object'
          ? pres.settings
          : {};
      if (orgSettings.rss?.enabled && !presSettings.excludeFromFeed) {
        toast.info(
          t(
            'editor.publish.rssFeedNotice',
            'This presentation will appear in your public RSS feed. You can exclude it in Deck Settings.',
          ),
          { id: 'publish-rss-notice', durationMs: 5200 },
        );
      }
    } catch {
      // Silently ignore — RSS notice is informational
    }
  }

  const pub = await api(`/api/presentations/${id}/publish`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

  const currentLang =
    activeLang || normalizeLang(pres?.i18n?.active) || DEFAULT_DECK_LANG;

  openPublishModal?.({
    currentLang,
    langs: buildLangLinks({
      pres,
      currentLang,
      path: pub.path,
      publishId: pub.publishId,
      slug: pub.slug,
    }),
  });

  pres.published = pres.published || {};
  pres.published.id = pub.publishId;
  pres.published.slug = pub.slug;
  pres.published.ogImageUrl = pub.ogImageUrl || '';
  return pub;
}
