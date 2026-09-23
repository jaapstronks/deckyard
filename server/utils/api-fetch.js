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
 * @param {string} url - API endpoint URL
 * @param {string} serviceName - The service, named in the refusal (e.g. 'Giphy', 'Unsplash')
 * @param {RequestInit} [options] - Fetch options (method, headers, body, etc.)
 * @returns {Promise<Response>} - Response if ok
 * @throws {AppError} - `502 bad_gateway` "<serviceName> could not complete this request"
 */
export async function apiFetch(url, serviceName, options = {}) {
  const where = `${options.method || 'GET'} ${new URL(url).pathname}`;
  const refusal = `${serviceName} could not complete this request`;
  let resp;
  try {
    resp = await fetch(url, options);
  } catch (err) {
    logError(
      serviceName.toLowerCase(),
      `${where} did not reach ${serviceName}:`,
      err,
    );
    throw new AppError(refusal, 502);
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    logError(
      serviceName.toLowerCase(),
      `${where} answered ${resp.status}:`,
      body,
    );
    throw new AppError(refusal, 502);
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
  return () => envStr(envVarName) !== '';
}
