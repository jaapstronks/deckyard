/**
 * Re-hosting a remote image through the configured media provider.
 *
 * Two flows need the same three steps — SSRF-guarded fetch, content-type
 * repair, `uploadBuffer` through whichever provider is active — and they used
 * to have two copies of them: the Notion importer (`utils/convert-notion.js`)
 * and, since B327, the ImageKit "use this image" path. The difference between
 * the two is only what they do when it fails (Notion falls back to the
 * expiring URL, the picker refuses without touching the slide), so the shared
 * part throws and lets the caller decide.
 *
 * It lives under `server/media/` rather than `server/utils/` because it is a
 * provider concern: everything it touches is the media seam.
 */
import { getMediaProvider, isMediaProviderInitialized } from './index.js';
import { safeFetchRemoteImage } from '../utils/ssrf-guard.js';

/**
 * The ceiling both re-host callers use. Stock-media import already allows this
 * much (GIFs are large), and a DAM asset is the same kind of thing.
 */
export const REHOST_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Fetch a remote image and store it through the active media provider.
 *
 * The fetch is SSRF-guarded: `safeFetchRemoteImage` refuses non-public
 * addresses, refuses redirects (which could hop into private space after the
 * check), times out, and caps the body. It never throws — a `null` return is
 * every kind of refusal at once, so this throws on the caller's behalf.
 *
 * @param {Object} args
 * @param {string} args.url - remote image URL to copy
 * @param {string} args.filename - base name for the stored object (no extension)
 * @param {number} [args.maxBytes] - byte ceiling, default {@link REHOST_MAX_BYTES}
 * @returns {Promise<{publicUrl: string, key: string, contentType: string, size: number}>}
 * @throws {Error} when no provider is initialized, the fetch is blocked or
 *   fails, or the provider refuses the bytes (type/size).
 */
export async function rehostRemoteImage({
  url,
  filename,
  maxBytes = REHOST_MAX_BYTES,
}) {
  if (!isMediaProviderInitialized()) {
    throw new Error('Media provider not initialized');
  }

  const fetched = await safeFetchRemoteImage(url, { maxBytes });
  if (!fetched) {
    throw new Error('Blocked or failed to fetch image');
  }

  // A provider that serves images without a usable content-type lands on the
  // generic octet-stream; every media provider rejects that, and a DAM/Notion
  // asset is in practice a JPEG. Repairing here keeps both callers identical.
  const contentType =
    fetched.contentType === 'application/octet-stream'
      ? 'image/jpeg'
      : fetched.contentType;

  const result = await getMediaProvider().uploadBuffer({
    buffer: fetched.buffer,
    filename,
    contentType,
    maxBytes,
  });

  return {
    publicUrl: result.publicUrl,
    key: result.key,
    contentType: result.contentType || contentType,
    size: result.size,
  };
}
