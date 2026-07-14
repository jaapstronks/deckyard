import { hasLangVersion, normalizeLang, otherLang } from '../../../lib/i18n.js';
import { t } from '../../../lib/ui-i18n.js';
import { confirmModal } from '../../../lib/modal.js';
import { openDescriptionModal } from '../modals/description-modal.js';

/**
 * Build modal data from existing published presentation data.
 * Used when opening the "manage published" modal without re-publishing.
 */
export function buildPublishModalData({ pres, activeLang = null } = {}) {
  const publishId = pres?.published?.id || '';
  const slug = pres?.published?.slug || '';

  const currentLang = activeLang || normalizeLang(pres?.i18n?.active) || 'nl';
  const other = otherLang(currentLang);
  const hasOther = hasLangVersion(pres, other);

  const path = `/p/${publishId}-${slug}`;
  const url = `${location.origin}${path}?lang=${encodeURIComponent(currentLang)}`;
  const urlOther = hasOther
    ? `${location.origin}${path}?lang=${encodeURIComponent(other)}`
    : '';

  const embedUrlBase = `${location.origin}/embed/${publishId}-${slug}`;
  const embedUrl = `${embedUrlBase}?lang=${encodeURIComponent(currentLang)}`;
  const embedUrlOther = hasOther
    ? `${embedUrlBase}?lang=${encodeURIComponent(other)}`
    : '';

  const iframeSnippet = `<iframe src="${embedUrl}&controls=1&ui=default&start=0" style="width:100%;aspect-ratio:16/9;border:0;" allowfullscreen></iframe>`;
  const iframeSnippetOther = embedUrlOther
    ? `<iframe src="${embedUrlOther}&controls=1&ui=default&start=0" style="width:100%;aspect-ratio:16/9;border:0;" allowfullscreen></iframe>`
    : '';
  const sdkSnippet = `<div id="deck-embed"></div>
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
      lang: '${currentLang}',
      allowedOrigins: [window.location.origin],
    },
  });
</script>`;

  const sdkSnippetOther = hasOther
    ? `<div id="deck-embed"></div>
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
      lang: '${other}',
      allowedOrigins: [window.location.origin],
    },
  });
</script>`
    : '';

  return {
    currentLang,
    otherLang: other,
    url,
    urlOther,
    embedUrl,
    embedUrlOther,
    iframeSnippet,
    iframeSnippetOther,
    sdkSnippet,
    sdkSnippetOther,
  };
}

export async function doPublish({
  h,
  root,
  api,
  toast,
  pres,
  id,
  requestSave,
  openPublishModal,
  openOverlayClosers,
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
        h,
        root,
        api,
        toast,
        pres,
        id,
        context: 'publish',
        openOverlayClosers,
        requestSave,
      });
      if (!r?.ok) return null;
    }

    const ok = await confirmModal(h, root, {
      title: t('editor.publish.publish', 'Publish'),
      message: t(
        'editor.publish.confirm',
        'Publish?\n\nThis makes the presentation publicly accessible to anyone with the link.'
      ),
      confirmLabel: t('editor.publish.publish', 'Publish'),
    });
    if (!ok) return null;
  }

  const first = pres?.slides?.[0];
  if (!first)
    throw new Error(
      t('editor.publish.noSlides', 'No slides to publish')
    );

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
      'Warning: these slides contain an image without alt text: {slides}\n\nPublish anyway?',
      { slides: missingAlt.join(', ') }
    );
    const ok = await confirmModal(h, root, {
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
            'This presentation will appear in your public RSS feed. You can exclude it in Deck Settings.'
          ),
          { id: 'publish-rss-notice', durationMs: 5200 }
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
    activeLang || normalizeLang(pres?.i18n?.active) || 'nl';
  const other = otherLang(currentLang);
  const hasOther = hasLangVersion(pres, other);

  const url = `${location.origin}${pub.path}?lang=${encodeURIComponent(
    currentLang
  )}`;
  const urlOther = hasOther
    ? `${location.origin}${pub.path}?lang=${encodeURIComponent(other)}`
    : '';

  const embedUrlBase = `${location.origin}/embed/${pub.publishId}-${pub.slug}`;
  const embedUrl = `${embedUrlBase}?lang=${encodeURIComponent(currentLang)}`;
  const embedUrlOther = hasOther
    ? `${embedUrlBase}?lang=${encodeURIComponent(other)}`
    : '';

  const iframeSnippet = `<iframe src="${embedUrl}&controls=1&ui=default&start=0" style="width:100%;aspect-ratio:16/9;border:0;" allowfullscreen></iframe>`;
  const iframeSnippetOther = embedUrlOther
    ? `<iframe src="${embedUrlOther}&controls=1&ui=default&start=0" style="width:100%;aspect-ratio:16/9;border:0;" allowfullscreen></iframe>`
    : '';
  const sdkSnippet = `<div id="deck-embed"></div>
<script src="${location.origin}/client/embed-sdk.js"></script>
<script>
  window.PresentationSystemEmbed.createDeckEmbed({
    el: document.getElementById('deck-embed'),
    publishId: '${pub.publishId}',
    options: {
      baseUrl: '${location.origin}',
      controls: true,
      ui: 'default',
      start: 0,
      lang: '${currentLang}',
      allowedOrigins: [window.location.origin],
    },
  });
</script>`;

  const sdkSnippetOther = hasOther
    ? `<div id="deck-embed"></div>
<script src="${location.origin}/client/embed-sdk.js"></script>
<script>
  window.PresentationSystemEmbed.createDeckEmbed({
    el: document.getElementById('deck-embed'),
    publishId: '${pub.publishId}',
    options: {
      baseUrl: '${location.origin}',
      controls: true,
      ui: 'default',
      start: 0,
      lang: '${other}',
      allowedOrigins: [window.location.origin],
    },
  });
</script>`
    : '';

  openPublishModal?.({
    currentLang,
    otherLang: other,
    url,
    urlOther,
    embedUrl,
    embedUrlOther,
    iframeSnippet,
    iframeSnippetOther,
    sdkSnippet,
    sdkSnippetOther,
  });

  pres.published = pres.published || {};
  pres.published.id = pub.publishId;
  pres.published.slug = pub.slug;
  pres.published.ogImageUrl = pub.ogImageUrl || '';
  return pub;
}
