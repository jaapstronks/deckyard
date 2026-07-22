/**
 * Standardized error classes for consistent error handling.
 */

/**
 * Default machine-code per HTTP status, for the canonical error envelope
 * (`{ ok:false, error:'<code>', message:'<human>' }`). Subclasses may override
 * by passing an explicit `code`.
 */
const STATUS_CODE_NAME = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'payload_too_large',
  422: 'unprocessable',
  423: 'locked',
  429: 'rate_limited',
  500: 'internal_error',
  503: 'service_unavailable',
};

/** @param {number} status @returns {string} */
export function codeForStatus(status) {
  return STATUS_CODE_NAME[status] || (status >= 500 ? 'internal_error' : 'error');
}

/**
 * Base application error with HTTP status code support.
 */
export class AppError extends Error {
  /**
   * @param {string} message - Error message
   * @param {number} [statusCode=500] - HTTP status code
   * @param {object} [details] - Additional error details
   * @param {string} [code] - Machine-readable snake_case code (defaults from status)
   */
  constructor(message, statusCode = 500, details = null, code = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.details = details;
    this.code = code || codeForStatus(statusCode);
    Error.captureStackTrace?.(this, this.constructor);
  }

  toJSON() {
    return {
      ok: false,
      error: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

/**
 * 400 Bad Request - Invalid input or parameters.
 */
export class ValidationError extends AppError {
  constructor(message = 'Invalid input', details = null) {
    super(message, 400, details);
  }
}

/**
 * 401 Unauthorized - Authentication required.
 */
export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', details = null) {
    super(message, 401, details);
  }
}

/**
 * 403 Forbidden - Access denied.
 */
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', details = null) {
    super(message, 403, details);
  }
}

/**
 * 404 Not Found - Resource does not exist.
 */
export class NotFoundError extends AppError {
  constructor(message = 'Not found', details = null) {
    super(message, 404, details);
  }
}

/**
 * 409 Conflict - Resource state conflict (e.g., concurrent edits).
 */
export class ConflictError extends AppError {
  constructor(message = 'Conflict', details = null) {
    super(message, 409, details);
  }
}

/**
 * 423 Locked - Resource is locked by another user.
 */
export class LockedError extends AppError {
  constructor(message = 'Resource is locked', details = null) {
    super(message, 423, details);
  }
}

/**
 * 422 Unprocessable Entity - Valid syntax but cannot process.
 */
export class UnprocessableError extends AppError {
  constructor(message = 'Cannot process request', details = null) {
    super(message, 422, details);
  }
}

/**
 * 429 Too Many Requests - Rate limit exceeded.
 */
export class RateLimitError extends AppError {
  constructor(message = 'Too many requests', details = null) {
    super(message, 429, details);
  }
}

/**
 * 500 Internal Server Error.
 */
export class InternalError extends AppError {
  constructor(message = 'Internal server error', details = null) {
    super(message, 500, details);
  }
}

/**
 * 503 Service Unavailable - External service down.
 */
export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service unavailable', details = null) {
    super(message, 503, details);
  }
}

/**
 * Check if an error is an AppError with a status code.
 * @param {Error} err
 * @returns {err is AppError}
 */
export function isAppError(err) {
  return err instanceof AppError;
}

/**
 * Get HTTP status code from any error.
 * @param {Error} err
 * @returns {number}
 */
export function getStatusCode(err) {
  if (err instanceof AppError) return err.statusCode;
  if (typeof err?.statusCode === 'number') return err.statusCode;
  return 500;
}

/**
 * Convert any error to the canonical error envelope
 * (`{ ok:false, error:'<code>', message:'<human>' }`).
 * @param {Error} err
 * @returns {{ ok: false, error: string, message: string, details?: any }}
 */
export function errorToResponse(err) {
  if (err instanceof AppError) return err.toJSON();
  const status = typeof err?.statusCode === 'number' ? err.statusCode : 500;
  return {
    ok: false,
    error: codeForStatus(status),
    message: err?.message || 'Unknown error',
  };
}