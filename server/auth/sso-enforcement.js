import { isSsoEnforced } from '../config/sso.js';
import { jsonError } from '../utils/http.js';

/**
 * Refuse local login and recovery before credentials or tokens are processed.
 * @param {import('node:http').ServerResponse} res
 * @returns {boolean} Whether the request was answered with an SSO refusal.
 */
export function rejectIfSsoEnforced(res) {
  if (!isSsoEnforced()) return false;
  return jsonError(res, 403, 'sso_required');
}
