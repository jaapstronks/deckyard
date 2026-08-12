/**
 * API routes for user profile management.
 *
 * Authenticated endpoints:
 *   POST /api/profile/image - Upload profile image (own)
 *   DELETE /api/profile/image - Remove profile image (own)
 *   POST /api/profile/image/:email - Upload profile image for user (admin only)
 *   DELETE /api/profile/image/:email - Remove profile image for user (admin only)
 */

import sharp from 'sharp';
import { badRequest, methodNotAllowed, serveJson, unauthorized, forbidden, jsonError, serverError, requireJsonBody } from '../../utils/http.js';
import { writeUserSettings } from '../../storage/settings.js';
import { getMediaProvider, isMediaProviderInitialized } from '../../media/index.js';
import { getFeatureFlags } from '../../config/feature-flags.js';
import { getDataUrl } from '../../utils/request-validators.js';
import { createLogger } from '../../utils/logger.js';
import { dispatchRoutes } from '../../utils/router.js';
const log = createLogger('profile');

// Profile image constraints
const MAX_PROFILE_IMAGE_SIZE = 400; // Max width/height in pixels
const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);


// POST /api/profile/image - Upload own profile image
async function handleProfileImageUpload({ repoRoot, storageScope, req, res, authedUser }) {
  const email = String(authedUser?.email || '').trim();

  const flags = getFeatureFlags();
  if (flags.demoMode || flags.sandboxMode) {
    return badRequest(res, 'Profile image uploads disabled in demo/sandbox mode');
  }

  if (!isMediaProviderInitialized()) {
    return badRequest(res, 'Media provider not initialized');
  }

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const dataUrl = getDataUrl(body, 'dataUrl');

  if (!dataUrl) {
    return badRequest(res, 'Expected { dataUrl: "data:<mime>;base64,..." }');
  }

  // Parse data URL
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    return badRequest(res, 'Invalid data URL format');
  }

  const [, mimeType, base64Data] = match;
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return badRequest(res, 'Invalid image type. Allowed: PNG, JPEG, WebP');
  }

  try {
    const inputBuffer = Buffer.from(base64Data, 'base64');

    // Resize and optimize with Sharp
    const outputBuffer = await sharp(inputBuffer)
      .resize(MAX_PROFILE_IMAGE_SIZE, MAX_PROFILE_IMAGE_SIZE, {
        fit: 'cover',
        position: 'center',
      })
      .png({ quality: 90 })
      .toBuffer();

    // Generate unique filename for profile image
    const emailSlug = email
      .toLowerCase()
      .replaceAll('@', '-at-')
      .replaceAll('.', '-')
      .replaceAll('+', '-plus-')
      .replace(/[^a-z0-9-]/g, '');
    const timestamp = Date.now();
    const filename = `profile-${emailSlug}-${timestamp}.png`;

    // Upload to media provider
    const provider = getMediaProvider();
    const result = await provider.uploadBuffer({
      buffer: outputBuffer,
      filename,
      contentType: 'image/png',
    });

    // Update user settings with new image URL
    await writeUserSettings(storageScope, email, {
      profile: { imageUrl: result.publicUrl },
    });

    serveJson(res, 200, { imageUrl: result.publicUrl });
  } catch (err) {
    log.error('[profile] Image upload failed:', err);
    const status = err.statusCode || 500;
    jsonError(res, status, 'image_processing_failed', err.message || 'Image processing failed');
  }
  return true;
}

// DELETE /api/profile/image - Remove own profile image
async function handleProfileImageDelete({ repoRoot, storageScope, res, authedUser }) {
  const email = String(authedUser?.email || '').trim();

  try {
    // Clear the image URL from user settings
    await writeUserSettings(storageScope, email, {
      profile: { imageUrl: '' },
    });

    serveJson(res, 200, { ok: true });
  } catch (err) {
    log.error('[profile] Image removal failed:', err);
    serverError(res, 'Failed to remove profile image');
  }
  return true;
}

// POST or DELETE /api/profile/image/:email - Admin manages another account image.
// Email validation and the admin check run before the method dispatch, so this
// stays a single no-method handler (see route-dispatch.md, the Form B guard note).
async function handleProfileImageAdmin({ repoRoot, storageScope, req, res, authedUser }, rawTargetEmail) {
  const targetEmail = decodeURIComponent(rawTargetEmail).toLowerCase().trim();
  if (!targetEmail || !targetEmail.includes('@')) {
    return badRequest(res, 'Invalid email address');
  }

  // Check admin permission
  if (!authedUser?.isAdmin) {
    return forbidden(res, 'Admin access required');
  }

  // POST /api/profile/image/:email - Admin upload profile image for user
  if (req.method === 'POST') {
    const flags = getFeatureFlags();
    if (flags.demoMode || flags.sandboxMode) {
      return badRequest(res, 'Profile image uploads disabled in demo/sandbox mode');
    }

    if (!isMediaProviderInitialized()) {
      return badRequest(res, 'Media provider not initialized');
    }

    const parsed = await requireJsonBody(req, res);
    if (!parsed.ok) return true;
    const body = parsed.body;
    const dataUrl = getDataUrl(body, 'dataUrl');

    if (!dataUrl) {
      return badRequest(res, 'Expected { dataUrl: "data:<mime>;base64,..." }');
    }

    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      return badRequest(res, 'Invalid data URL format');
    }

    const [, mimeType, base64Data] = match;
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return badRequest(res, 'Invalid image type. Allowed: PNG, JPEG, WebP');
    }

    try {
      const inputBuffer = Buffer.from(base64Data, 'base64');

      const outputBuffer = await sharp(inputBuffer)
        .resize(MAX_PROFILE_IMAGE_SIZE, MAX_PROFILE_IMAGE_SIZE, {
          fit: 'cover',
          position: 'center',
        })
        .png({ quality: 90 })
        .toBuffer();

      const emailSlug = targetEmail
        .replaceAll('@', '-at-')
        .replaceAll('.', '-')
        .replaceAll('+', '-plus-')
        .replace(/[^a-z0-9-]/g, '');
      const timestamp = Date.now();
      const filename = `profile-${emailSlug}-${timestamp}.png`;

      const provider = getMediaProvider();
      const result = await provider.uploadBuffer({
        buffer: outputBuffer,
        filename,
        contentType: 'image/png',
      });

      await writeUserSettings(storageScope, targetEmail, {
        profile: { imageUrl: result.publicUrl },
      });

      serveJson(res, 200, { imageUrl: result.publicUrl });
    } catch (err) {
      log.error('[profile] Admin image upload failed:', err);
      jsonError(res, err.statusCode || 500, 'image_processing_failed', err.message || 'Image processing failed');
    }
    return true;
  }

  // DELETE /api/profile/image/:email - Admin remove profile image for user
  if (req.method === 'DELETE') {
    try {
      await writeUserSettings(storageScope, targetEmail, {
        profile: { imageUrl: '' },
      });
      serveJson(res, 200, { ok: true });
    } catch (err) {
      log.error('[profile] Admin image removal failed:', err);
      serverError(res, 'Failed to remove profile image');
    }
    return true;
  }

  return methodNotAllowed(res, ['POST', 'DELETE']);
}

/**
 * Declarative route table for `/api/profile/image*` (A7.19 C8). Order matches
 * the previous if-chain: own-image POST/DELETE with the explicit 405 kept as a
 * catch-all row, then the admin `/:email` handler (its guards precede the method
 * check, so it keeps its internal method dispatch).
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  { method: 'POST', pattern: '/api/profile/image', handler: handleProfileImageUpload },
  { method: 'DELETE', pattern: '/api/profile/image', handler: handleProfileImageDelete },
  { pattern: '/api/profile/image', handler: ({ res }) => methodNotAllowed(res, ['POST', 'DELETE']) },
  { pattern: /^\/api\/profile\/image\/(.+)$/, handler: handleProfileImageAdmin },
];

/**
 * Handle profile-related API endpoints. The module-wide guards (prefix + a valid
 * email) run before dispatch, exactly as the original chain did.
 *
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export function handleProfile(ctx) {
  if (!ctx.url.pathname.startsWith('/api/profile/')) return false;
  const email = String(ctx.authedUser?.email || '').trim();
  if (!email) return unauthorized(ctx.res);
  return dispatchRoutes(ROUTES, ctx);
}
