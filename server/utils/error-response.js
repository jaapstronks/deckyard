import {
  errorToResponse,
  isAppError,
  INTERNAL_ERROR_MESSAGE,
} from './errors.js';

/**
 * Shape the body for the server's top-level error handler.
 *
 * The outer catch sees both intentional HTTP errors we threw (which set a
 * `statusCode` and carry a safe, human-authored message like "Request body too
 * large") and unexpected runtime errors (no `statusCode`, default 500). The
 * latter's `err.message` can leak filesystem paths or SQL fragments, so it must
 * never be echoed to the client. AppErrors and errors deliberately raised with
 * an explicit sub-500 status carry messages intended for the caller.
 *
 * Emits the canonical error envelope
 * (`{ ok:false, error:'<code>', message:'<human>' }`). AppErrors preserve their
 * code and payload; deliberately raised sub-500 errors surface their message;
 * unexpected errors stay generic.
 *
 * @param {number} status - Resolved HTTP status.
 * @param {*} err - The caught error.
 * @returns {{ ok: false, error: string, message: string, details?: Object }}
 */
export function buildTopLevelErrorBody(status, err) {
  if (isAppError(err)) return errorToResponse(err);
  if (status >= 500) {
    return {
      ok: false,
      error: 'internal_error',
      message: INTERNAL_ERROR_MESSAGE,
    };
  }
  const hasExplicitStatus = typeof err?.statusCode === 'number';
  return errorToResponse({
    statusCode: status,
    message: hasExplicitStatus ? err.message || 'Bad request' : 'Request error',
  });
}
