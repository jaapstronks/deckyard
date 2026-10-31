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
 * The public link, embed URL and iframe snippet for one language version of
 * the deck's newest edition.
 *
 * @typedef {Object} PublishLangLinks
 * @property {string} lang - the deck language, in axis spelling
 * @property {string} url - the edition's `/p/{publicationId}/{version}` link
 * @property {string} embedUrl - the same edition at `/embed/…`, frameable
 * @property {string} iframeSnippet - a ready-to-paste `<iframe>`
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
 * @param {{publicationId: string, version: number}} opts.edition
 * @returns {PublishLangLinks[]}
 */
function buildLangLinks({ pres, currentLang, edition }) {
  const others = existingVersionLangs(pres).filter((l) => l !== currentLang);
  const address = `${edition.publicationId}/${edition.version}`;
  return [currentLang, ...others].map((lang) => {
    const q = encodeURIComponent(lang);
    const url = `${location.origin}/p/${address}?lang=${q}`;
    const embedUrl = `${location.origin}/embed/${address}?lang=${q}`;
    return {
      lang,
      url,
      embedUrl,
      iframeSnippet: `<iframe src="${embedUrl}" style="width:100%;aspect-ratio:16/9;border:0;" allowfullscreen></iframe>`,
    };
  });
}

/**
 * Whether the deck has a public edition (`pres.published`, read from its
 * editions by the server).
 *
 * @param {Object} pres - the deck
 * @returns {boolean}
 */
export function isPublished(pres) {
  return !!(
    typeof pres?.published?.publicationId === 'string' &&
    pres.published.publicationId &&
    Number.isInteger(pres.published.version)
  );
}

/**
 * The links of a published deck's newest edition, one set per language
 * version, the one being edited first. The Share dialog's Public tab renders
 * them; the deck must be published ({@link isPublished}).
 *
 * @param {Object} pres - the deck
 * @returns {{currentLang: string, langs: PublishLangLinks[]}}
 */
export function buildPublishedLinks(pres) {
  const currentLang = normalizeLang(pres?.i18n?.active) || DEFAULT_DECK_LANG;
  return {
    currentLang,
    langs: buildLangLinks({ pres, currentLang, edition: pres.published }),
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
  const fix = t(
    'editor.publish.missingAlt.fix',
    {
      one: 'Add alt text or mark the image decorative, then publish again.',
      many: 'Add alt text or mark the image decorative, then publish again. {count} images in this deck need it.',
    },
    vars,
  );
  return `${sentence} ${fix}`;
}

/**
 * The sentence for a publish refused because slides still have an empty
 * essential image (`incomplete_slides`, B590), in the UI language, naming the
 * slides by number. Without numbers in `details`, the server's own sentence.
 *
 * @param {{message?: string, details?: Object}} err - the refused request
 * @returns {string}
 */
export function incompleteSlidesMessage(err) {
  const slides = Array.isArray(err?.details?.slides) ? err.details.slides : [];
  if (!slides.length) return String(err?.message || '');
  return t(
    'editor.publish.incomplete',
    {
      one: 'Slide {n} still has an empty image. Choose an image or delete the slide, then publish again.',
      many: 'Slides {list} still have an empty image. Choose an image or delete those slides, then publish again.',
    },
    { n: slides[0], list: slides.join(', '), count: slides.length },
  );
}

/**
 * One idempotency key per deck revision: publishing the same revision again
 * (a double click, a retry after a dropped response) sends the same key, and
 * the server answers with the edition it already made instead of a second one.
 * @type {Map<string, string>}
 */
const publishKeys = new Map();

function publishKeyFor(id, revision) {
  const at = `${id}@${revision}`;
  if (!publishKeys.has(at)) publishKeys.set(at, crypto.randomUUID());
  return publishKeys.get(at);
}

/**
 * Publish the deck as its next edition. A first publish asks for a
 * description (when missing) and a confirmation; `null` means the author
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

  const alreadyPublished = isPublished(pres);
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

  // Alt text and incomplete slides are not checked here: the server refuses
  // both on every publish surface (`missing_alt`, D137; `incomplete_slides`,
  // B590), and the caller shows that refusal beside its Publish button
  // ({@link missingAltMessage}, {@link incompleteSlidesMessage}).

  // The edition seals the revision the author just saved; a deck that moved
  // on since is refused (`conflict`) rather than published unseen.
  const expectedRevision = Number(pres.revision);
  const pub = await api(`/api/presentations/${id}/publish`, {
    method: 'POST',
    body: {
      expectedRevision,
      idempotencyKey: publishKeyFor(id, expectedRevision),
    },
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

  const { publicationId, version, path, publishedAt } = pub.edition;
  pres.published = { publicationId, version, path, publishedAt };
  return pub;
}
