/** Every identifier AssetHutch hands out is opaque. `file_…` is the only one your app stores. */
export type FileId = string

export type Visibility = "public" | "private"
export type FileStatus = "pending" | "ready" | "failed" | "deleted"

/** How a named transform resizes. The vocabulary is provider-neutral by design. */
export type Fit = "cover" | "contain" | "scale_down" | "crop" | "pad"
export type Format = "auto" | "webp" | "avif" | "jpeg" | "png"

export interface AssethutchFile {
  id: FileId
  object: "file"
  filename: string
  contentType: string
  byteSize: number
  checksum: string | null
  visibility: Visibility
  status: FileStatus
  metadata: Record<string, unknown>
  policy: string | null
  storageConnectionId: string
  /** Stable delivery URL. Present only for ready public files. */
  url: string | null
  /** Named transform URLs keyed by name. Filled for ready public images on storage that can render. */
  transforms: Record<string, string>
  createdAt: string
  updatedAt: string
}

export interface UploadPolicy {
  id: string
  object: "upload_policy"
  name: string
  allowedContentTypes: string[]
  maximumSize: number
  visibility: Visibility
  createdAt: string
}

export interface Transform {
  id: string
  object: "transform"
  name: string
  width: number | null
  height: number | null
  fit: Fit
  quality: number | null
  format: Format | null
  createdAt: string
}

export interface StorageConnection {
  id: string
  object: "storage_connection"
  name: string
  mode: "managed" | "byo"
  provider: string
  status: "unverified" | "verified" | "failed"
}

export interface Project {
  id: string
  object: "project"
  name: string
  teamId: string
  storageReady: boolean
  activeStorageConnection: StorageConnection | null
  uploadPolicies: UploadPolicy[]
  transforms: Transform[]
  createdAt: string
}

/** Everything the client needs to PUT bytes straight to storage. */
export interface UploadAuthorization {
  id: FileId
  object: "upload"
  fileId: FileId
  method: string
  url: string
  headers: Record<string, string>
  expiresAt: string
}

export interface CreatedUpload {
  upload: UploadAuthorization
  file: AssethutchFile
}

/** `expiresAt` is null for public files, which are delivered from a stable URL. */
export interface DeliveryUrl {
  url: string
  expiresAt: string | null
}

export interface ClientOptions {
  /** Project-scoped key from Dashboard → API keys. Server side only. */
  apiKey?: string
  /** Defaults to ASSETHUTCH_URL, then https://api.assethutch.com. */
  url?: string
  /** Per-request timeout in milliseconds. Default 30000. */
  timeoutMs?: number
  /** Swap in a custom fetch (tests, proxies, instrumentation). */
  fetch?: typeof globalThis.fetch
  /** Appended to the SDK's own User-Agent. */
  userAgent?: string
}

export interface CreateUploadParams {
  policy: string
  filename: string
  contentType: string
  byteSize: number
  metadata?: Record<string, unknown>
}

export interface UploadParams {
  policy: string
  filename: string
  contentType?: string
  metadata?: Record<string, unknown>
}

export interface SignedUrlParams {
  expiresIn?: number
  disposition?: "inline" | "attachment"
}

export interface TransformUrlParams {
  transform: string
  expiresIn?: number
}
