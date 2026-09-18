import { normalizeLang } from '../../../lib/format/i18n.js';
import { t } from '../../../lib/ui-i18n.js';
import { confirmModal } from '../../../lib/dom/modal.js';
import { openDescriptionModal } from '../modals/description-modal.js';
import { DEFAULT_DECK_LANG } from '../../../../shared/i18n-utils.js';
import {
  existingVersionLangs,
  pickVersion,
} from '../../../../shared/i18n-progress.js';
import { getSlideType } from '../../../../shared/slide-types/registry.js';

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
 * that is the one the Public tab's language picker starts on.
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
 * The links of a published deck, one set per language version, the one being
 * edited first. The Share dialog's Public tab renders them; the deck must be
 * published (`pres.published.id`).
 *
 * @param {Object} pres - the deck
 * @returns {{currentLang: string, langs: PublishLangLinks[]}}
 */
export function buildPublishedLinks(pres) {
  const publishId = pres?.published?.id || '';
  const slug = pres?.published?.slug || '';

  const currentLang = normalizeLang(pres?.i18n?.active) || DEFAULT_DECK_LANG;

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

/**
 * The sentence for a publish refused because a picture has no alt text
 * (`missing_alt`, D137), in the UI language: which slide, which field (by the
 * label the form shows it under) and how many pictures there are in all.
 *
 * The server's `details` name the picture by keys and position; the labels
 * live in the slide-type definitions the editor already loaded. When the slide
 * or field cannot be found there (the deck changed since), the server's own
 * sentence is shown instead of a vaguer one.
 *
 * @param {{message?: string, details?: Object}} err - the refused request
 * @param {Object} opts
 * @param {Object} opts.pres - the deck
 * @param {Record<string, Object>} [opts.slideTypes] - the editor's registry
 * @returns {string}
 */
export function missingAltMessage(err, { pres, slideTypes } = {}) {
  const d = err?.details || {};
  const slide = pickVersion(pres, d.lang).slides?.[d.slideIndex];
  const def = slide ? getSlideType(slide.type, slideTypes) : null;
  const field = def?.fields?.find((f) => f?.key === d.field);
  const sub =
    typeof d.itemIndex === 'number'
      ? field?.itemFields?.find((f) => f?.key === d.itemField)
      : null;
  const label = (f) => t(f.labelKey || f.key, f.label || f.key);
  if (!field || (typeof d.itemIndex === 'number' && !sub)) {
    return String(err?.message || '');
  }
  const vars = {
    slide: d.slideIndex + 1,
    field: label(field),
    item: (d.itemIndex ?? 0) + 1,
    itemField: sub ? label(sub) : '',
    count: d.count,
  };
  const sentence = sub
    ? t(
        'editor.publish.missingAlt.item',
        'Slide {slide}, {field} {item}: the image "{itemField}" has no alt text.',
        vars,
      )
    : t(
        'editor.publish.missingAlt.field',
        'Slide {slide}: the image "{field}" has no alt text.',
        vars,
      );
  const fix =
    d.count > 1
      ? t(
          'editor.publish.missingAlt.fixMany',
          'Add alt text or mark the image decorative, then publish again. {count} images in this deck need it.',
          vars,
        )
      : t(
          'editor.publish.missingAlt.fixOne',
          'Add alt text or mark the image decorative, then publish again.',
          vars,
        );
  return `${sentence} ${fix}`;
}

/**
 * Publish the deck, or republish it when it already is. A first publish asks
 * for a description (when missing) and a confirmation; `null` means the author
 * backed out. The caller renders the resulting links itself
 * ({@link buildPublishedLinks}).
 *
 * @returns {Promise<Object|null>} the server's publish response
 */
export async function doPublish({
  root,
  api,
  toast,
  pres,
  id,
  requestSave,
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

  // Alt text is not checked here: the server refuses a picture without a
  // name on every publish surface (`missing_alt`, D137), and the caller shows
  // that refusal beside its Publish button ({@link missingAltMessage}).

  const pub = await api(`/api/presentations/${id}/publish`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

  // RSS feed notice (non-blocking info toast, first publish only). After the
  // publish, not before: a refused publish puts nothing in the feed.
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

  pres.published = pres.published || {};
  pres.published.id = pub.publishId;
  pres.published.slug = pub.slug;
  pres.published.ogImageUrl = pub.ogImageUrl || '';
  return pub;
}
