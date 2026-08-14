import { AppError } from '../errors.js';

/**
 * Unified error class for LLM-related errors.
 * Provides consistent error handling across all LLM providers and AI modules.
 *
 * Extends AppError so `isAppError()`/`withErrorHandler` recognize LLM failures
 * and answer with the canonical envelope. The raw provider `response` stays a
 * field on the instance (for logging) and is never part of the envelope.
 */
export class LlmError extends AppError {
  /**
   * @param {string} message - Human-readable error message
   * @param {Object} [options={}] - Error context
   * @param {number} [options.statusCode=502] - HTTP status code (502 = bad gateway for upstream LLM failures)
   * @param {string} [options.vendor] - LLM vendor (openai, claude, mistral)
   * @param {string} [options.model] - Model name used
   * @param {string} [options.response] - Raw response from LLM (truncated)
   * @param {string} [options.phase] - Processing phase (e.g., 'outline', 'refine', 'translate')
   * @param {boolean} [options.retryable=true] - Whether the operation can be retried
   * @param {Object} [options.context] - Additional context for debugging
   */
  constructor(message, {
    statusCode = 502,
    vendor = null,
    model = null,
    response = null,
    phase = null,
    retryable = true,
    context = null,
  } = {}) {
    super(message, statusCode);
    this.vendor = vendor;
    this.model = model;
    this.response = response ? String(response).slice(0, 5000) : null;
    this.phase = phase;
    this.retryable = retryable;
    this.context = context;
  }

  /**
   * Create an LlmError from a provider request failure.
   * @param {string} vendor - LLM vendor name
   * @param {number} httpStatus - HTTP status from the provider
   * @param {string} bodyText - Response body text
   * @param {string} [model] - Model name
   * @returns {LlmError}
   */
  static fromProviderFailure(vendor, httpStatus, bodyText, model = null) {
    return new LlmError(`${vendor} request failed (${httpStatus})`, {
      statusCode: 502,
      vendor,
      model,
      response: bodyText,
      retryable: httpStatus >= 500 || httpStatus === 429,
    });
  }

  /**
   * Create an LlmError for JSON parsing failures.
   * @param {string} rawResponse - The raw response that failed to parse
   * @param {string} [phase] - Processing phase
   * @param {string} [vendor] - LLM vendor
   * @param {string} [model] - Model name
   * @returns {LlmError}
   */
  static fromJsonParseFailure(rawResponse, { phase = null, vendor = null, model = null } = {}) {
    return new LlmError('Failed to parse LLM response as JSON', {
      statusCode: 502,
      vendor,
      model,
      response: rawResponse,
      phase,
      retryable: true,
    });
  }

  /**
   * Create an LlmError for unsupported vendor.
   * @param {string} vendor - The unsupported vendor name
   * @returns {LlmError}
   */
  static unsupportedVendor(vendor) {
    return new LlmError(`Unsupported LLM vendor: ${String(vendor)}`, {
      statusCode: 400,
      vendor,
      retryable: false,
    });
  }

}