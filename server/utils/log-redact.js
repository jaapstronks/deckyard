/**
 * Redaction helpers for logging.
 *
 * Tokens/session identifiers must not land in logs in full: log files are often
 * lower-trust than the live system and a leaked token can be replayed. Keep a
 * short prefix so entries stay correlatable during debugging without exposing
 * the usable secret.
 *
 * @param {*} value - The secret/token.
 * @param {number} [keep=4] - Leading chars to retain.
 * @returns {string}
 */
export function redactSecret(value, keep = 4) {
  const s = String(value ?? '');
  if (!s) return '';
  if (s.length <= keep) return '***';
  return `${s.slice(0, keep)}…(${s.length})`;
}
