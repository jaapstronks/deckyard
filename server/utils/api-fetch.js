/**
 * Shared utilities for fetching from external APIs with standardized error handling.
 */
import { envStr } from '../config/utils.js';
import { AppError } from './errors.js';
import { logError } from './logger.js';

/**
 * Fetch from a stock-media API (Giphy, Unsplash): the seam that decides what a
 * failed upstream call means (B419). Whatever the service said instead - an
 * error status with its body, or no answer at all - is logged here and never
 * reaches the client; the caller gets `502 bad_gateway` with one fixed
 * sentence per service, the same shape as the ImageKit and Notion seams.
 *
 * The log names the path only: Giphy carries its API key in the query string.
 *
 * Returns the `Response` for the binary downloads; an API call reads its JSON
 * through {@link apiFetchJson}, which extends the same refusal to the body.
 *
 * @param {string} url - API endpoint URL
 * @param {string} serviceName - The service, named in the refusal (e.g. 'Giphy', 'Unsplash')
 * @param {RequestInit} [options] - Fetch options (method, headers, body, etc.)
 * @returns {Promise<Response>} - Response if ok
 * @throws {AppError} - `502 bad_gateway` "<serviceName> could not complete this request"
 */
export async function apiFetch(url, serviceName, options = {}) {
  const refuse = refuser(url, serviceName, options);
  let resp;
  try {
    resp = await fetch(url, options);
  } catch (err) {
    refuse(`did not reach ${serviceName}:`, err);
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    refuse(`answered ${resp.status}:`, body);
  }
  return resp;
}

/**
 * Fetch JSON from a stock-media API: {@link apiFetch} plus the body (B420). A
 * 200 whose body does not parse is the same logged `502 bad_gateway` as a
 * failed status, so no caller turns it into a `500 internal_error`.
 *
 * @param {string} url - API endpoint URL
 * @param {string} serviceName - The service, named in the refusal (e.g. 'Giphy', 'Unsplash')
 * @param {RequestInit} [options] - Fetch options (method, headers, body, etc.)
 * @returns {Promise<any>} - The parsed body
 * @throws {AppError} - `502 bad_gateway` "<serviceName> could not complete this request"
 */
export async function apiFetchJson(url, serviceName, options = {}) {
  const resp = await apiFetch(url, serviceName, options);
  const text = await resp.text().catch(() => '');
  try {
    return JSON.parse(text);
  } catch {
    refuser(
      url,
      serviceName,
      options,
    )('answered 200 with an unreadable body:', text);
  }
}

/**
 * The one refusal of the stock-media seam: log what went wrong with the method
 * and path (never the query string), then throw the fixed `502`.
 *
 * @param {string} url
 * @param {string} serviceName
 * @param {RequestInit} options
 * @returns {(what: string, cause: unknown) => never}
 */
function refuser(url, serviceName, options) {
  const where = `${options.method || 'GET'} ${new URL(url).pathname}`;
  return (what, cause) => {
    logError(serviceName.toLowerCase(), `${where} ${what}`, cause);
    throw new AppError(`${serviceName} could not complete this request`, 502);
  };
}

/**
 * Create a configuration checker function for an environment variable.
 *
 * @param {string} envVarName - The environment variable name to check
 * @returns {Function} - Function that returns true if the env var is set
 */
export function createConfigChecker(envVarName) {
  return () => envStr(envVarName) !== '';
}
