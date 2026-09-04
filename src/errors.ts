/** Base for everything this SDK throws. */
export class AssetHutchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

/** No API key, or a URL that isn't one. Thrown before any request goes out. */
export class ConfigurationError extends AssetHutchError {}

/** The request never got an answer: DNS, timeout, reset, abort. */
export class ConnectionError extends AssetHutchError {
  readonly cause?: unknown
  constructor(message: string, cause?: unknown) {
    super(message)
    this.cause = cause
  }
}

/** AssetHutch answered with an error. `code` is stable; match on it, not the message. */
export class ApiError extends AssetHutchError {
  readonly code: string
  readonly status: number
  readonly details?: unknown

  constructor(message: string, code: string, status: number, details?: unknown) {
    super(message)
    this.code = code
    this.status = status
    this.details = details
  }
}

export class AuthenticationError extends ApiError {}
export class NotFoundError extends ApiError {}
export class InvalidRequestError extends ApiError {}
/** Content type or size the policy refuses, or a policy that doesn't exist. */
export class PolicyError extends InvalidRequestError {}
export class StorageNotReadyError extends ApiError {}
/** Not ready, already deleted, not public. */
export class InvalidStateError extends ApiError {}
/** Unknown transform name, or a file that isn't an image. */
export class TransformError extends InvalidRequestError {}
/** The project's storage cannot render transforms. The message says what to set up. */
export class TransformsUnsupportedError extends TransformError {}
export class UploadError extends ApiError {}
/** AssetHutch could not reach the bucket. */
export class StorageError extends ApiError {}
export class RateLimitError extends ApiError {}
export class ServerError extends ApiError {}

type ApiErrorClass = new (message: string, code: string, status: number, details?: unknown) => ApiError

/** The API's error codes are the contract; status is only the fallback. */
const BY_CODE: Record<string, ApiErrorClass> = {
  unauthorized: AuthenticationError,
  not_found: NotFoundError,
  invalid: InvalidRequestError,
  policy_violation: PolicyError,
  policy_not_found: PolicyError,
  storage_not_ready: StorageNotReadyError,
  invalid_state: InvalidStateError,
  not_ready: InvalidStateError,
  already_deleted: InvalidStateError,
  not_public: InvalidStateError,
  no_public_base_url: InvalidStateError,
  transform_not_found: TransformError,
  not_transformable: TransformError,
  transforms_unsupported: TransformsUnsupportedError,
  upload_expired: UploadError,
  upload_incomplete: UploadError,
  size_mismatch: UploadError,
  storage_error: StorageError,
  verification_failed: StorageError,
}

const BY_STATUS: Record<number, ApiErrorClass> = {
  401: AuthenticationError,
  403: AuthenticationError,
  404: NotFoundError,
  409: InvalidStateError,
  410: InvalidStateError,
  422: InvalidRequestError,
  429: RateLimitError,
  502: StorageError,
}

/** Picks the most specific class for an error payload. */
export function buildApiError(status: number, body: unknown): ApiError {
  const error = (body as { error?: { code?: string; message?: string; details?: unknown } })?.error
  const code = error?.code ?? (status >= 500 ? "server_error" : "error")
  const message = error?.message ?? `AssetHutch returned HTTP ${status}`
  const Klass = BY_CODE[code] ?? BY_STATUS[status] ?? (status >= 500 ? ServerError : ApiError)
  return new Klass(message, code, status, error?.details)
}
