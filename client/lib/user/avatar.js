/**
 * Reusable avatar component.
 *
 * Displays a user's profile image with fallback to initials.
 */

import { h } from '../dom.js';
import { initialsForName, displayNameFromEmail } from './user-format.js';

/**
 * Size presets for avatars
 */
const AVATAR_SIZES = {
  xs: 20,  // Extra small (16px)
  sm: 24,  // Small (24px)
  md: 32,  // Medium (32px)
  lg: 40,  // Large (40px)
  xl: 64,  // Extra large (64px)
};

/**
 * Generate a consistent color for initials based on email/name
 * @param {string} str - String to hash
 * @returns {string} HSL color string
 */
function getInitialsColor(str) {
  const s = String(str || '').toLowerCase();
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = s.charCodeAt(i) + ((hash << 5) - hash);
  }
  // Use a limited set of pleasant hues
  const hues = [210, 180, 260, 330, 15, 45, 150, 290];
  const hue = hues[Math.abs(hash) % hues.length];
  return `hsl(${hue}, 45%, 55%)`;
}

/**
 * Create an avatar element.
 *
 * @param {Object} options
 * @param {string} [options.imageUrl] - URL of the profile image
 * @param {string} [options.email] - User's email (for initials fallback)
 * @param {string} [options.name] - User's display name (for initials)
 * @param {'xs'|'sm'|'md'|'lg'|'xl'} [options.size='sm'] - Avatar size
 * @param {string} [options.className] - Additional CSS classes
 * @returns {HTMLElement} Avatar element
 */
export function createAvatar({ imageUrl, email, name, size = 'sm', className = '' } = {}) {
  const sizeClass = `avatar--${size}`;
  const displayName = name || displayNameFromEmail(email);
  const initials = initialsForName(displayName);
  const bgColor = getInitialsColor(email || name || '');

  const container = h('div', {
    class: `avatar ${sizeClass}${className ? ` ${className}` : ''}`,
    'aria-label': displayName,
    title: displayName,
  });

  // Create initials element (always present as fallback)
  const initialsEl = h('div', {
    class: 'avatar-initials',
    text: initials,
    style: `background-color: ${bgColor}`,
    'aria-hidden': 'true',
  });
  container.append(initialsEl);

  // If imageUrl is provided, create the image element
  if (imageUrl && typeof imageUrl === 'string' && imageUrl.trim()) {
    const img = h('img', {
      class: 'avatar-img',
      src: imageUrl,
      alt: '',
      loading: 'lazy',
    });

    // Handle image load errors gracefully
    img.addEventListener('error', () => {
      img.remove();
    });

    // Hide initials when image loads successfully
    img.addEventListener('load', () => {
      initialsEl.style.display = 'none';
    });

    container.append(img);
  }

  return container;
}

/**
 * Update an existing avatar element with new data.
 *
 * @param {HTMLElement} avatarEl - Existing avatar element
 * @param {Object} options
 * @param {string} [options.imageUrl] - URL of the profile image
 * @param {string} [options.name] - User's display name
 */
export function updateAvatar(avatarEl, { imageUrl, name } = {}) {
  if (!avatarEl) return;

  // Update initials if name changed
  if (name) {
    const initialsEl = avatarEl.querySelector('.avatar-initials');
    if (initialsEl) {
      initialsEl.textContent = initialsForName(name);
    }
    avatarEl.setAttribute('title', name);
    avatarEl.setAttribute('aria-label', name);
  }

  // Update image
  const existingImg = avatarEl.querySelector('.avatar-img');
  const initialsEl = avatarEl.querySelector('.avatar-initials');

  if (imageUrl && typeof imageUrl === 'string' && imageUrl.trim()) {
    if (existingImg) {
      existingImg.src = imageUrl;
    } else {
      const img = h('img', {
        class: 'avatar-img',
        src: imageUrl,
        alt: '',
        loading: 'lazy',
      });

      img.addEventListener('error', () => {
        img.remove();
        if (initialsEl) initialsEl.style.display = '';
      });

      img.addEventListener('load', () => {
        if (initialsEl) initialsEl.style.display = 'none';
      });

      avatarEl.append(img);
    }
  } else if (existingImg) {
    existingImg.remove();
    if (initialsEl) initialsEl.style.display = '';
  }
}

export { AVATAR_SIZES };