/** Every identifier FileHutch hands out is opaque. `file_…` is the only one your app stores. */
export type FileId = string

export type Visibility = "public" | "private"
export type FileStatus = "pending" | "ready" | "failed" | "deleted"

/** How a named transform resizes. The vocabulary is provider-neutral by design. */
export type Fit = "cover" | "contain" | "scale_down" | "crop" | "pad"
export type Format = "auto" | "webp" | "avif" | "jpeg" | "png"

export interface FileHutchFile {
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
  environment: string | null
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

export interface Environment {
  id: string
  name: string
}

export interface PlanLimits {
  key: string
  name: string
  storageBytes: number
  projectLimit: number | null
}

export interface Usage {
  storageBytesUsed: number
  projectsUsed: number
}

export interface Project {
  id: string
  object: "project"
  name: string
  teamId: string
  /** The environment the API key is scoped to. */
  environment: Environment | null
  environments: string[]
  storageReady: boolean
  activeStorageConnection: StorageConnection | null
  uploadPolicies: UploadPolicy[]
  transforms: Transform[]
  plan: PlanLimits | null
  usage: Usage | null
  createdAt: string
}

// -- Declarative config -------------------------------------------------------
// The file format is the API's; keys stay snake_case because people write them.

export interface UploadConfig {
  types?: string[]
  /** Bytes, or a size like "10MB". */
  max_size?: number | string
  visibility?: Visibility
}

export interface TransformConfig {
  width?: number
  height?: number
  fit?: Fit
  quality?: number
  format?: Format
}

export interface ProjectConfig {
  uploads?: Record<string, UploadConfig>
  transforms?: Record<string, TransformConfig>
  environments?: string[]
}

export type ConfigResource = "upload_policy" | "transform" | "environment"
export type ConfigAction = "create" | "update" | "delete" | "noop"

export interface ConfigChange {
  resource: ConfigResource
  name: string
  action: ConfigAction
  from?: Record<string, unknown>
  to?: Record<string, unknown>
  /** attribute → [current, desired] for updates */
  diff?: Record<string, [unknown, unknown]>
}

export interface ConfigPlan {
  prune: boolean
  changes: ConfigChange[]
  summary: { create: number; update: number; delete: number; noop: number }
}

export interface ConfigApplyLine extends ConfigChange {
  status: "applied" | "failed"
  error?: string
}

export interface ConfigApply {
  prune: boolean
  results: ConfigApplyLine[]
  summary: { applied: number; failed: number; noop: number }
}

export interface ConfigOptions {
  /** Also delete what the config leaves out. Default false. */
  prune?: boolean
}

// -- Manifest -----------------------------------------------------------------

export interface ManifestStorage {
  connectionId: string
  mode: "managed" | "byo"
  provider: string
  bucket: string | null
  endpoint: string | null
  region: string | null
  /** The object key. With the bucket and your own credentials this finds the bytes without FileHutch. */
  key: string
}

export interface ManifestEntry {
  id: FileId
  filename: string
  contentType: string
  byteSize: number
  checksum: string | null
  visibility: Visibility
  status: FileStatus
  metadata: Record<string, unknown>
  policy: string | null
  environment: string | null
  storage: ManifestStorage
  createdAt: string
}

export interface ManifestPage {
  environment: string
  generatedAt: string
  files: ManifestEntry[]
  hasMore: boolean
  nextAfter: string | null
}

export interface ManifestParams {
  after?: string
  limit?: number
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
  file: FileHutchFile
}

/** `expiresAt` is null for public files, which are delivered from a stable URL. */
export interface DeliveryUrl {
  url: string
  expiresAt: string | null
}

export interface ClientOptions {
  /** Project-scoped key from Dashboard → API keys. Server side only. */
  apiKey?: string
  /** Defaults to FILE_HUTCH_URL, then https://api.filehutch.com. */
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
  /** MD5 of the bytes. FileHutch refuses the upload if what arrives differs. */
  checksum?: string
}

export interface UploadParams {
  policy: string
  filename: string
  /** Send an MD5 so a corrupted upload fails instead of completing. Default true. */
  verify?: boolean
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
