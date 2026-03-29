const TRANSIENT_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNABORTED',
  'ENOTFOUND',
  'ESOCKETTIMEDOUT',
]);

const TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

const TRANSIENT_MESSAGE_PATTERNS = ['timeout', 'socket hang up'];

/**
 * Classify an error as transient (retryable) or non-transient (fail immediately).
 *
 * Transient: network errors (ECONNRESET, ETIMEDOUT, etc.), HTTP 5xx, 429 rate limits,
 * and errors whose message mentions timeout or socket hang up.
 *
 * Non-transient: 4xx client errors (except 429), business logic errors,
 * insufficient funds, invalid input, etc.
 */
export function isTransientError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const err = error as Record<string, unknown>;

  // Check Node.js-style error codes
  if (typeof err.code === 'string' && TRANSIENT_ERROR_CODES.has(err.code)) {
    return true;
  }

  // Check HTTP status codes (statusCode for fetch/axios, status for some libs)
  const status = typeof err.statusCode === 'number' ? err.statusCode : typeof err.status === 'number' ? err.status : undefined;
  if (status !== undefined && TRANSIENT_STATUS_CODES.has(status)) {
    return true;
  }

  // Check error message for transient patterns
  const message = typeof err.message === 'string' ? err.message.toLowerCase() : '';
  if (TRANSIENT_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern))) {
    return true;
  }

  return false;
}
