/**
 * Author Overlay Utility
 *
 * Generates an author overlay for OG/preview images using Sharp.
 * Displays a circular avatar (image or initials) with the author's first name
 * in a semi-transparent badge at the top-right corner.
 */

import sharp from 'sharp';
import { assertPublicHttpUrl } from './ssrf-guard.js';

// Overlay dimensions
const PILL_HEIGHT = 40;
const PILL_PADDING_H = 14;
const AVATAR_SIZE = 28;
const GAP = 10;
const CORNER_RADIUS = 20;
const MARGIN = 24;

// Colors
const TEXT_COLOR = 'white';

/**
 * Get initials from a name.
 * @param {string} name - Full name
 * @returns {string} 1-2 character initials
 */
function getInitials(name) {
  const s = String(name || '').trim();
  if (!s) return '?';
  const parts = s.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] || '?';
  const second = parts.length > 1 ? parts[1]?.[0] : '';
  return (first + second).toUpperCase();
}

/**
 * Get first name from full name.
 * @param {string} name - Full name
 * @returns {string} First name
 */
function getFirstName(name) {
  const s = String(name || '').trim();
  if (!s) return '';
  return s.split(/\s+/)[0] || s;
}

/**
 * Generate a consistent color for initials based on name.
 * @param {string} str - String to hash
 * @returns {{r: number, g: number, b: number}} RGB color
 */
function getInitialsColor(str) {
  const s = String(str || '').toLowerCase();
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = s.charCodeAt(i) + ((hash << 5) - hash);
  }
  // Use a limited set of pleasant colors
  const colors = [
    { r: 79, g: 70, b: 229 },   // Indigo
    { r: 16, g: 185, b: 129 },  // Emerald
    { r: 236, g: 72, b: 153 },  // Pink
    { r: 245, g: 158, b: 11 },  // Amber
    { r: 6, g: 182, b: 212 },   // Cyan
    { r: 139, g: 92, b: 246 },  // Violet
    { r: 34, g: 197, b: 94 },   // Green
    { r: 249, g: 115, b: 22 },  // Orange
  ];
  return colors[Math.abs(hash) % colors.length];
}

/**
 * Create a circular avatar buffer.
 * @param {Object} options
 * @param {string} [options.imageUrl] - URL to profile image (optional)
 * @param {Buffer} [options.imageBuffer] - Pre-fetched image buffer (optional)
 * @param {string} options.name - Author name (for initials fallback)
 * @param {number} [options.size=24] - Avatar size in pixels
 * @returns {Promise<Buffer>} PNG buffer of circular avatar
 */
async function createAvatarBuffer({ imageBuffer, name, size = AVATAR_SIZE }) {
  // Create circular mask
  const circle = Buffer.from(
    `<svg width="${size}" height="${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/>
    </svg>`
  );

  // If we have an image buffer, use it
  if (imageBuffer) {
    try {
      const resized = await sharp(imageBuffer)
        .resize(size, size, { fit: 'cover' })
        .composite([{
          input: circle,
          blend: 'dest-in',
        }])
        .png()
        .toBuffer();
      return resized;
    } catch {
      // Fall through to initials
    }
  }

  // Create initials avatar
  const initials = getInitials(name);
  const bgColor = getInitialsColor(name);
  const fontSize = Math.round(size * 0.4);

  const svg = Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="rgb(${bgColor.r},${bgColor.g},${bgColor.b})"/>
      <text x="50%" y="50%" dominant-baseline="central" text-anchor="middle"
            font-family="system-ui, -apple-system, sans-serif" font-size="${fontSize}"
            font-weight="600" fill="white">${initials}</text>
    </svg>`
  );

  return sharp(svg).png().toBuffer();
}

/**
 * Generate an author overlay for OG images.
 *
 * Creates a semi-transparent badge with avatar and first name
 * positioned at the top-right corner.
 *
 * @param {Object} options
 * @param {string} options.name - Author's display name
 * @param {Buffer} [options.imageBuffer] - Profile image buffer (optional)
 * @returns {Promise<{buffer: Buffer, width: number, height: number}>}
 */
export async function generateAuthorOverlay({ name, imageBuffer }) {
  const firstName = getFirstName(name);
  if (!firstName) {
    return null;
  }

  // Calculate text width (approximate - use slightly wider chars for the font)
  const charWidth = 9;
  const textWidth = Math.min(firstName.length * charWidth, 140);
  const pillWidth = PILL_PADDING_H * 2 + AVATAR_SIZE + GAP + textWidth;
  const fontSize = 14;

  // Create avatar
  const avatarBuffer = await createAvatarBuffer({ imageBuffer, name, size: AVATAR_SIZE });

  // Create the badge background with rounded corners and subtle backdrop blur effect
  // Using a gradient overlay for a more polished look
  const pillSvg = Buffer.from(
    `<svg width="${pillWidth}" height="${PILL_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="badgeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:rgba(0,0,0,0.75);stop-opacity:1" />
          <stop offset="100%" style="stop-color:rgba(0,0,0,0.55);stop-opacity:1" />
        </linearGradient>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="rgba(0,0,0,0.3)"/>
        </filter>
      </defs>
      <rect x="0" y="0" width="${pillWidth}" height="${PILL_HEIGHT}"
            rx="${CORNER_RADIUS}" ry="${CORNER_RADIUS}"
            fill="url(#badgeGradient)" filter="url(#shadow)"/>
      <rect x="0.5" y="0.5" width="${pillWidth - 1}" height="${PILL_HEIGHT - 1}"
            rx="${CORNER_RADIUS - 0.5}" ry="${CORNER_RADIUS - 0.5}"
            fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>
      <text x="${PILL_PADDING_H + AVATAR_SIZE + GAP}" y="${PILL_HEIGHT / 2 + 1}"
            dominant-baseline="central" text-anchor="start"
            font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
            font-size="${fontSize}" font-weight="500" fill="${TEXT_COLOR}"
            style="letter-spacing: 0.01em;">${escapeXml(firstName)}</text>
    </svg>`
  );

  // Composite avatar onto badge
  const avatarTop = Math.round((PILL_HEIGHT - AVATAR_SIZE) / 2);

  const overlay = await sharp(pillSvg)
    .composite([{
      input: avatarBuffer,
      left: PILL_PADDING_H,
      top: avatarTop,
    }])
    .png()
    .toBuffer();

  return {
    buffer: overlay,
    width: pillWidth,
    height: PILL_HEIGHT,
  };
}

/**
 * Escape XML special characters.
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Fetch an image from a URL and return as buffer.
 * @param {string} url - Image URL
 * @returns {Promise<Buffer|null>} Image buffer or null on error
 */
export async function fetchImageAsBuffer(url) {
  if (!url || typeof url !== 'string') return null;

  // SSRF guard: reject non-public hosts (loopback/private/link-local, incl.
  // cloud metadata) before fetching a user-controlled author image URL.
  try {
    await assertPublicHttpUrl(url);
  } catch {
    return null;
  }

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
    });
    if (!response.ok) return null;

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
}

export { MARGIN as AUTHOR_OVERLAY_MARGIN };