/**
 * Shrink the images inside a rendered thumbnail so the deck list downloads
 * card-sized assets instead of full-resolution slide art.
 *
 * A thumbnail renders the slide into a 1600×900 box (then CSS-scales it down to
 * card width), so its background images and <img>s would otherwise be fetched at
 * full slide resolution. For ImageKit-hosted URLs we can ask for a narrower
 * variant via the `?tr=w-<n>` transform; everything else (local uploads, data
 * URIs, unknown hosts, already-transformed URLs) is left untouched — appending a
 * width there would either do nothing or fight an existing transform.
 *
 * This is a deck-list optimization only; the full editor/presenter/export paths
 * keep rendering images at their native resolution.
 */

/** @returns {boolean} whether `url` is an ImageKit-hosted asset we can transform. */
function isImageKitUrl(url) {
  try {
    return new URL(url, window.location.href).hostname.includes('imagekit.io');
  } catch {
    return false;
  }
}

/**
 * Request a width-capped ImageKit variant of `url`. Returns `url` unchanged for
 * non-ImageKit URLs, data URIs, or URLs that already carry a `tr=` transform.
 * @param {string} url
 * @param {number} width - target width in px
 * @returns {string}
 */
export function imagekitThumbUrl(url, width) {
  const u = String(url || '').trim();
  if (!u || u.startsWith('data:')) return u;
  if (!isImageKitUrl(u)) return u;
  if (/[?&]tr=/.test(u)) return u; // respect an author-chosen transform
  const sep = u.includes('?') ? '&' : '?';
  return `${u}${sep}tr=w-${width}`;
}

/**
 * Rewrite the images inside a rendered thumbnail subtree in place: downscale
 * ImageKit background-images and <img>s to `width`, mark <img>s lazy, and drop
 * srcset so the browser can't pick a full-res candidate over our capped src.
 * @param {Element} root - a rendered slide element (thumb mode)
 * @param {{ width?: number }} [opts]
 */
export function downscaleThumbImages(root, { width = 800 } = {}) {
  if (!root || typeof root.querySelectorAll !== 'function') return;

  // Inline background-image URLs (e.g. .slide-bg-layer).
  for (const el of root.querySelectorAll('[style*="background-image"]')) {
    const bg = el.style.backgroundImage;
    const m = /url\(\s*['"]?([^'")]+)['"]?\s*\)/.exec(bg || '');
    if (!m) continue;
    const next = imagekitThumbUrl(m[1], width);
    if (next !== m[1]) el.style.backgroundImage = `url('${next}')`;
  }

  // <img> elements.
  for (const img of root.querySelectorAll('img')) {
    if (!img.getAttribute('loading')) img.setAttribute('loading', 'lazy');
    if (img.hasAttribute('srcset')) img.removeAttribute('srcset');
    const src = img.getAttribute('src');
    if (!src) continue;
    const next = imagekitThumbUrl(src, width);
    if (next !== src) img.setAttribute('src', next);
  }
}
