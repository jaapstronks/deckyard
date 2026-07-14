/**
 * Secure token utilities for authentication flows.
 * Shared by magic-link and password-reset functionality.
 */

import crypto from 'node:crypto';

// ============================================================
// TOKEN GENERATION
// ============================================================

/**
 * Generate a cryptographically secure token.
 * Uses 32 bytes (256 bits) of randomness, URL-safe base64 encoded.
 * @returns {string} - 43-character URL-safe token
 */
export function generateSecureToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Hash a token for storage using SHA-256.
 * Never store raw tokens - only the hash.
 * @param {string} token - The raw token
 * @returns {string} - Hex-encoded SHA-256 hash
 */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ============================================================
// EMAIL VALIDATION
// ============================================================

/**
 * Basic email validation regex.
 * Validates common email formats without being overly strict.
 * Based on HTML5 email input pattern with additional checks.
 */
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

/**
 * Validate an email address format.
 * @param {string} email - The email to validate
 * @returns {{valid: boolean, reason?: string}} - Validation result
 */
export function validateEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();

  if (!normalized) {
    return { valid: false, reason: 'missing' };
  }

  if (normalized.length > 320) {
    return { valid: false, reason: 'too_long' };
  }

  if (!normalized.includes('@')) {
    return { valid: false, reason: 'missing_at' };
  }

  const [localPart, domain] = normalized.split('@');

  if (!localPart || localPart.length > 64) {
    return { valid: false, reason: 'invalid_local_part' };
  }

  if (!domain || domain.length > 255) {
    return { valid: false, reason: 'invalid_domain' };
  }

  // Check for consecutive dots
  if (normalized.includes('..')) {
    return { valid: false, reason: 'consecutive_dots' };
  }

  // Check domain has at least one dot (TLD)
  if (!domain.includes('.')) {
    return { valid: false, reason: 'missing_tld' };
  }

  // Full regex validation
  if (!EMAIL_REGEX.test(normalized)) {
    return { valid: false, reason: 'invalid_format' };
  }

  return { valid: true };
}

/**
 * Check if an email is valid (simple boolean helper).
 * @param {string} email - The email to validate
 * @returns {boolean} - True if valid
 */
export function isValidEmail(email) {
  return validateEmail(email).valid;
}