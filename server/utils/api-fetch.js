/**
 * Shared utilities for fetching from external APIs with standardized error handling.
 */

/**
 * Fetch from an external API with standardized error handling.
 *
 * @param {string} url - API endpoint URL
 * @param {string} serviceName - Service name for error messages (e.g., 'Giphy', 'Unsplash')
 * @param {Object} [options] - Fetch options (method, headers, body, etc.)
 * @returns {Promise<Response>} - Response if ok
 * @throws {Error} - If response is not ok, throws with service name and status
 */
export async function apiFetch(url, serviceName, options = {}) {
  const resp = await fetch(url, options);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`${serviceName} API error: ${resp.status} ${text}`);
  }
  return resp;
}

/**
 * Create a configuration checker function for an environment variable.
 *
 * @param {string} envVarName - The environment variable name to check
 * @returns {Function} - Function that returns true if the env var is set
 */
export function createConfigChecker(envVarName) {
  return () => !!process.env[envVarName];
}
