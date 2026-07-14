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
import { badRequest, json, methodNotAllowed, serveJson, unauthorized, forbidden } from '../../utils/http.js';
import { readUserSettings, writeUserSettings } from '../../storage/settings.js';
import { getMediaProvider, isMediaProviderInitialized } from '../../media/index.js';
import { getFeatureFlags } from '../../config/feature-flags.js';

// Profile image constraints
const MAX_PROFILE_IMAGE_SIZE = 400; // Max width/height in pixels
const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/**
 * Handle profile-related API endpoints.
 */
export async function handleProfile({ repoRoot, req, res, url, authedUser }) {
  if (!url.pathname.startsWith('/api/profile/')) return false;

  const email = String(authedUser?.email || '').trim();
  if (!email) return unauthorized(res);

  // POST /api/profile/image - Upload profile image
  if (url.pathname === '/api/profile/image' && req.method === 'POST') {
    const flags = getFeatureFlags();
    if (flags.demoMode || flags.sandboxMode) {
      return badRequest(res, 'Profile image uploads disabled in demo/sandbox mode');
    }

    if (!isMediaProviderInitialized()) {
      return badRequest(res, 'Media provider not initialized');
    }

    const body = await json(req);
    const { dataUrl } = body || {};

    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
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
      await writeUserSettings(repoRoot, email, {
        profile: { imageUrl: result.publicUrl },
      });

      serveJson(res, 200, { imageUrl: result.publicUrl });
    } catch (err) {
      console.error('[profile] Image upload failed:', err);
      const status = err.statusCode || 500;
      serveJson(res, status, { error: err.message || 'Image processing failed' });
    }
    return true;
  }

  // DELETE /api/profile/image - Remove profile image
  if (url.pathname === '/api/profile/image' && req.method === 'DELETE') {
    try {
      // Clear the image URL from user settings
      await writeUserSettings(repoRoot, email, {
        profile: { imageUrl: '' },
      });

      serveJson(res, 200, { ok: true });
    } catch (err) {
      console.error('[profile] Image removal failed:', err);
      serveJson(res, 500, { error: err.message || 'Failed to remove profile image' });
    }
    return true;
  }

  // Method not allowed for other methods on /api/profile/image
  if (url.pathname === '/api/profile/image') {
    return methodNotAllowed(res, ['POST', 'DELETE']);
  }

  // Admin endpoints: /api/profile/image/:targetEmail
  const adminMatch = url.pathname.match(/^\/api\/profile\/image\/(.+)$/);
  if (adminMatch) {
    const targetEmail = decodeURIComponent(adminMatch[1]).toLowerCase().trim();
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

      const body = await json(req);
      const { dataUrl } = body || {};

      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
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

        await writeUserSettings(repoRoot, targetEmail, {
          profile: { imageUrl: result.publicUrl },
        });

        serveJson(res, 200, { imageUrl: result.publicUrl });
      } catch (err) {
        console.error('[profile] Admin image upload failed:', err);
        serveJson(res, err.statusCode || 500, { error: err.message || 'Image processing failed' });
      }
      return true;
    }

    // DELETE /api/profile/image/:email - Admin remove profile image for user
    if (req.method === 'DELETE') {
      try {
        await writeUserSettings(repoRoot, targetEmail, {
          profile: { imageUrl: '' },
        });
        serveJson(res, 200, { ok: true });
      } catch (err) {
        console.error('[profile] Admin image removal failed:', err);
        serveJson(res, 500, { error: err.message || 'Failed to remove profile image' });
      }
      return true;
    }

    return methodNotAllowed(res, ['POST', 'DELETE']);
  }

  return false;
}