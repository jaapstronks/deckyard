/**
 * Font Families API routes.
 *
 * GET    /api/font-families                         - List all (org-scoped)
 * GET    /api/font-families/:id                     - Get one with variants
 * POST   /api/font-families                         - Create (designer only)
 * PUT    /api/font-families/:id                     - Update (designer only)
 * DELETE /api/font-families/:id                     - Delete (designer only)
 * POST   /api/font-families/:id/upload-variant      - Upload font file (designer only)
 * DELETE /api/font-families/:id/variants/:vid       - Remove variant (designer only)
 * POST   /api/font-families/discover-adobe          - Discover Adobe Fonts (designer only)
 * POST   /api/font-families/import-adobe-family     - Import Adobe family (designer only)
 */

import {
  badRequest,
  json,
  methodNotAllowed,
  serveJson,
  unauthorized,
} from '../../utils/http.js';
import { getTrimmedString } from '../../utils/request-validators.js';
import { createRouteContext } from '../../utils/context.js';
import { clearCustomThemeCache } from '../../utils/themes.js';
import {
  listAllFontFamiliesWithVariants,
  getFontFamily,
  createFontFamily,
  updateFontFamily,
  deleteFontFamily,
  addFontVariant,
  removeFontVariant,
} from '../../storage/font-families.js';
import { getMediaProvider } from '../../media/index.js';
import { canManage } from '../../utils/route-middleware.js';

const ERROR_MESSAGES = {
  invalid_name: 'Invalid font family name.',
  invalid_slug: 'Invalid font family slug.',
  invalid_source: 'Invalid font source. Must be upload, adobe, monotype, or google.',
  invalid_category: 'Invalid font category.',
  invalid_weight: 'Invalid font weight. Must be 100-900 in increments of 100.',
  invalid_style: 'Invalid font style. Must be normal or italic.',
  invalid_format: 'Invalid font format. Must be woff2 or woff.',
  slug_exists: 'A font family with this slug already exists.',
  variant_exists: 'A variant with this weight and style already exists.',
  not_found: 'Font family not found.',
  unavailable: 'Database unavailable.',
  invalid_id: 'Invalid font family ID.',
};

// Max upload size: 5MB
const MAX_UPLOAD_SIZE = 5 * 1024 * 1024;

// WOFF2 magic bytes: wOF2
const WOFF2_MAGIC = [0x77, 0x4f, 0x46, 0x32];
// WOFF magic bytes: wOFF
const WOFF_MAGIC = [0x77, 0x4f, 0x46, 0x46];

export async function handleFontFamilies({ req, res, url, authedUser }) {
  const pathname = url.pathname;

  // ─── LIST ─────────────────────────────────────────────────
  if (pathname === '/api/font-families' && req.method === 'GET') {
    if (!authedUser) return unauthorized(res);
    const ctx = createRouteContext(authedUser);
    const families = await listAllFontFamiliesWithVariants(ctx);
    serveJson(res, 200, { fontFamilies: families });
    return true;
  }

  // ─── CREATE ───────────────────────────────────────────────
  if (pathname === '/api/font-families' && req.method === 'POST') {
    if (!canManage(authedUser)) return unauthorized(res);
    const body = await json(req);
    if (!body || typeof body !== 'object') return badRequest(res, 'Missing JSON body.');

    const ctx = createRouteContext(authedUser);
    const result = await createFontFamily(body, ctx);

    if (!result.ok) {
      return badRequest(res, ERROR_MESSAGES[result.reason] || 'Failed to create font family.');
    }
    serveJson(res, 201, result.fontFamily);
    return true;
  }

  if (pathname === '/api/font-families') {
    return methodNotAllowed(res, ['GET', 'POST']);
  }

  // ─── DISCOVER ADOBE FONTS ────────────────────────────────
  if (pathname === '/api/font-families/discover-adobe' && req.method === 'POST') {
    if (!canManage(authedUser)) return unauthorized(res);
    const body = await json(req);
    if (!body?.projectId) return badRequest(res, 'Missing projectId.');

    const projectId = String(body.projectId).trim();
    if (!/^[a-z0-9]{3,12}$/i.test(projectId)) {
      return badRequest(res, 'Invalid Adobe Fonts project ID format.');
    }

    try {
      const cssUrl = `https://use.typekit.net/${projectId}.css`;
      const resp = await fetch(cssUrl);
      if (!resp.ok) {
        return badRequest(res, `Could not fetch Adobe Fonts CSS (HTTP ${resp.status}).`);
      }
      const cssText = await resp.text();
      const families = parseAdobeFontsCss(cssText);

      serveJson(res, 200, { projectId, families });
    } catch (err) {
      return badRequest(res, 'Failed to fetch Adobe Fonts CSS.');
    }
    return true;
  }

  // ─── IMPORT ADOBE FAMILY ─────────────────────────────────
  if (pathname === '/api/font-families/import-adobe-family' && req.method === 'POST') {
    if (!canManage(authedUser)) return unauthorized(res);
    const body = await json(req);
    if (!body?.projectId || !body?.familyName) {
      return badRequest(res, 'Missing projectId or familyName.');
    }

    const ctx = createRouteContext(authedUser);
    const familyName = String(body.familyName).trim();
    const category = getTrimmedString(body, 'category') || 'sans-serif';

    // Create the font family
    const result = await createFontFamily(
      {
        name: familyName,
        source: 'adobe',
        category,
        sourceConfig: { projectId: body.projectId },
      },
      ctx
    );

    if (!result.ok) {
      return badRequest(res, ERROR_MESSAGES[result.reason] || 'Failed to import font family.');
    }

    // Add variants if provided
    if (Array.isArray(body.variants)) {
      for (const v of body.variants) {
        await addFontVariant(
          result.fontFamily.id,
          {
            weight: v.weight || 400,
            style: v.style || 'normal',
            format: 'woff2',
          },
          ctx
        );
      }
    }

    // Re-fetch with variants
    const family = await getFontFamily(result.fontFamily.id, ctx);
    serveJson(res, 201, family);
    return true;
  }

  // ─── UPLOAD VARIANT ───────────────────────────────────────
  const uploadMatch = pathname.match(/^\/api\/font-families\/([a-f0-9-]+)\/upload-variant$/);
  if (uploadMatch && req.method === 'POST') {
    if (!canManage(authedUser)) return unauthorized(res);

    const familyId = uploadMatch[1];
    const ctx = createRouteContext(authedUser);

    // Verify family exists
    const family = await getFontFamily(familyId, ctx);
    if (!family) {
      serveJson(res, 404, { error: 'Font family not found.' });
      return true;
    }

    const body = await json(req);
    if (!body?.dataUrl) return badRequest(res, 'Missing dataUrl.');

    const weight = Number(body.weight) || 400;
    const style = getTrimmedString(body, 'style') || 'normal';
    const format = getTrimmedString(body, 'format') || 'woff2';

    // Decode base64 data URL
    const dataUrlMatch = String(body.dataUrl).match(/^data:[^;]+;base64,(.+)$/);
    if (!dataUrlMatch) return badRequest(res, 'Invalid dataUrl format.');

    const buf = Buffer.from(dataUrlMatch[1], 'base64');

    // Check size
    if (buf.length > MAX_UPLOAD_SIZE) {
      return badRequest(res, 'Font file too large. Maximum is 5MB.');
    }

    // Validate magic bytes
    if (format === 'woff2' && !checkMagicBytes(buf, WOFF2_MAGIC)) {
      return badRequest(res, 'Invalid WOFF2 file (bad magic bytes).');
    }
    if (format === 'woff' && !checkMagicBytes(buf, WOFF_MAGIC)) {
      return badRequest(res, 'Invalid WOFF file (bad magic bytes).');
    }

    // Upload via media provider
    const contentType = format === 'woff' ? 'font/woff' : 'font/woff2';
    const displayName = `${family.slug}-${weight}-${style}`;

    let uploadResult;
    try {
      const mediaProvider = getMediaProvider();
      uploadResult = await mediaProvider.uploadBuffer({
        buffer: buf,
        filename: displayName,
        contentType,
      });
    } catch (err) {
      return badRequest(res, 'Failed to upload font file.');
    }

    // Create variant record — store the storage key in filename for cleanup
    const result = await addFontVariant(
      familyId,
      {
        weight,
        style,
        filename: uploadResult.key,
        url: uploadResult.publicUrl,
        fileSize: buf.length,
        format,
      },
      ctx
    );

    if (!result.ok) {
      return badRequest(res, ERROR_MESSAGES[result.reason] || 'Failed to add variant.');
    }

    // Variant changes affect themes that embed this font family
    clearCustomThemeCache();
    serveJson(res, 201, result.variant);
    return true;
  }

  // ─── DELETE VARIANT ───────────────────────────────────────
  const variantMatch = pathname.match(
    /^\/api\/font-families\/([a-f0-9-]+)\/variants\/([a-f0-9-]+)$/
  );
  if (variantMatch && req.method === 'DELETE') {
    if (!canManage(authedUser)) return unauthorized(res);

    const variantId = variantMatch[2];
    const ctx = createRouteContext(authedUser);

    const result = await removeFontVariant(variantId, ctx);

    if (!result.ok) {
      if (result.reason === 'not_found') {
        serveJson(res, 404, { error: 'Variant not found.' });
        return true;
      }
      return badRequest(res, ERROR_MESSAGES[result.reason] || 'Failed to remove variant.');
    }

    // Clean up uploaded file from media provider using storage key
    if (result.storageKey) {
      try {
        const mediaProvider = getMediaProvider();
        await mediaProvider.deleteFile(result.storageKey);
      } catch {
        // Non-critical: file cleanup failure doesn't affect the operation
      }
    }

    // Variant changes affect themes that embed this font family
    clearCustomThemeCache();
    serveJson(res, 200, { ok: true });
    return true;
  }

  // ─── GET / UPDATE / DELETE by ID ──────────────────────────
  const idMatch = pathname.match(/^\/api\/font-families\/([a-f0-9-]+)$/);
  if (idMatch) {
    const familyId = idMatch[1];
    const ctx = createRouteContext(authedUser);

    if (req.method === 'GET') {
      if (!authedUser) return unauthorized(res);
      const family = await getFontFamily(familyId, ctx);
      if (!family) {
        serveJson(res, 404, { error: 'Font family not found.' });
        return true;
      }
      serveJson(res, 200, family);
      return true;
    }

    if (req.method === 'PUT') {
      if (!canManage(authedUser)) return unauthorized(res);
      const body = await json(req);
      if (!body || typeof body !== 'object') return badRequest(res, 'Missing JSON body.');

      const result = await updateFontFamily(familyId, body, ctx);
      if (!result.ok) {
        if (result.reason === 'not_found') {
          serveJson(res, 404, { error: 'Font family not found.' });
          return true;
        }
        return badRequest(res, ERROR_MESSAGES[result.reason] || 'Failed to update font family.');
      }
      // Font changes can affect any theme referencing this font family
      clearCustomThemeCache();
      serveJson(res, 200, result.fontFamily);
      return true;
    }

    if (req.method === 'DELETE') {
      if (!canManage(authedUser)) return unauthorized(res);
      const result = await deleteFontFamily(familyId, ctx);
      if (!result.ok) {
        if (result.reason === 'not_found') {
          serveJson(res, 404, { error: 'Font family not found.' });
          return true;
        }
        return badRequest(res, ERROR_MESSAGES[result.reason] || 'Failed to delete font family.');
      }

      // Clean up uploaded files from media provider using storage keys
      if (Array.isArray(result.storageKeys) && result.storageKeys.length > 0) {
        const mediaProvider = getMediaProvider();
        for (const key of result.storageKeys) {
          try {
            await mediaProvider.deleteFile(key);
          } catch {
            // Non-critical: file cleanup failure doesn't affect the operation
          }
        }
      }

      // Font deletion can affect any theme referencing this font family
      clearCustomThemeCache();
      serveJson(res, 200, { ok: true });
      return true;
    }

    return methodNotAllowed(res, ['GET', 'PUT', 'DELETE']);
  }

  return false;
}

// ============================================================
// HELPERS
// ============================================================

function checkMagicBytes(buf, expected) {
  if (buf.length < expected.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (buf[i] !== expected[i]) return false;
  }
  return true;
}

/**
 * Parse Adobe Fonts (Typekit) CSS to extract font families and their variants.
 */
function parseAdobeFontsCss(cssText) {
  const familyMap = {};
  const fontFaceRegex = /@font-face\s*\{([^}]+)\}/g;
  let match;

  while ((match = fontFaceRegex.exec(cssText)) !== null) {
    const block = match[1];

    const familyMatch = block.match(/font-family\s*:\s*["']?([^"';]+)["']?/);
    const weightMatch = block.match(/font-weight\s*:\s*(\d+)/);
    const styleMatch = block.match(/font-style\s*:\s*(normal|italic)/);

    if (!familyMatch) continue;

    const family = familyMatch[1].trim();
    const weight = weightMatch ? parseInt(weightMatch[1], 10) : 400;
    const style = styleMatch ? styleMatch[1] : 'normal';

    if (!familyMap[family]) {
      familyMap[family] = { name: family, variants: [] };
    }

    // Avoid duplicates
    const exists = familyMap[family].variants.some(
      (v) => v.weight === weight && v.style === style
    );
    if (!exists) {
      familyMap[family].variants.push({ weight, style });
    }
  }

  return Object.values(familyMap);
}
