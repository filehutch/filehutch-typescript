import { ConfigurationError, ConnectionError, buildApiError } from "./errors.js"
import { toCreatedUpload, toFile, toProject, toTransform } from "./mappers.js"
import type {
  AssetHutchFile, ClientOptions, CreateUploadParams, CreatedUpload, DeliveryUrl, FileId,
  Project, SignedUrlParams, Transform, TransformUrlParams, UploadAuthorization, UploadParams,
} from "./types.js"

const VERSION = "0.1.0"
const DEFAULT_URL = "https://api.assethutch.com"
const ID_PATTERN = /^[a-z]+_[0-9A-Za-z]{20}$/

/** Bytes this SDK can PUT straight to storage. */
export type UploadSource = Uint8Array | ArrayBuffer | Blob | string

/**
 * Server-side client for the AssetHutch v1 API.
 *
 * The API key is project-scoped and must stay on your server. Browsers upload
 * through your own endpoints, which call this client — see the README.
 *
 *   const hutch = new AssetHutch({ apiKey: process.env.ASSET_HUTCH_API_KEY })
 *   const file = await hutch.upload(bytes, { policy: "avatars", filename: "me.png" })
 *   file.id // => "file_8fK2…" — the only thing you store
 */
export class AssetHutch {
  readonly url: string
  readonly timeoutMs: number
  private readonly apiKey: string
  private readonly fetchImpl: typeof globalThis.fetch
  private readonly userAgent: string

  constructor(options: ClientOptions = {}) {
    const apiKey = options.apiKey ?? envVar("ASSET_HUTCH_API_KEY")
    if (!apiKey) {
      throw new ConfigurationError("No API key. Pass apiKey, or set ASSET_HUTCH_API_KEY.")
    }
    const url = options.url ?? envVar("ASSET_HUTCH_URL") ?? DEFAULT_URL
    try {
      new URL(url)
    } catch {
      throw new ConfigurationError(`${url} is not a valid URL.`)
    }

    this.apiKey = apiKey
    this.url = url.replace(/\/+$/, "")
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.userAgent = ["asset-hutch-ts/" + VERSION, options.userAgent].filter(Boolean).join(" ")

    const impl = options.fetch ?? globalThis.fetch
    if (!impl) throw new ConfigurationError("No global fetch. Use Node 18+, or pass a fetch implementation.")
    this.fetchImpl = impl
  }

  // -- Resources -----------------------------------------------------------

  async project(): Promise<Project> {
    return toProject((await this.request("GET", "/api/v1/project")).project)
  }

  /** The project's named image sizes. Your code references them by name. */
  async transforms(): Promise<Transform[]> {
    const body = await this.request("GET", "/api/v1/transforms")
    return (body.transforms ?? []).map(toTransform)
  }

  async file(id: FileId): Promise<AssetHutchFile> {
    return toFile((await this.request("GET", `/api/v1/files/${this.pathId(id)}`)).file)
  }

  async createUpload(params: CreateUploadParams): Promise<CreatedUpload> {
    return toCreatedUpload(await this.request("POST", "/api/v1/uploads", {
      policy: params.policy,
      filename: params.filename,
      content_type: params.contentType,
      byte_size: params.byteSize,
      ...(params.metadata && Object.keys(params.metadata).length ? { metadata: params.metadata } : {}),
    }))
  }

  async completeUpload(id: FileId): Promise<AssetHutchFile> {
    return toFile((await this.request("POST", `/api/v1/uploads/${this.pathId(id)}/complete`)).file)
  }

  /** Short-lived URL that works for private and public files alike. */
  async signedUrl(id: FileId, params: SignedUrlParams = {}): Promise<DeliveryUrl> {
    const body = await this.request("POST", `/api/v1/files/${this.pathId(id)}/signed_url`, {
      ...(params.expiresIn !== undefined ? { expires_in: params.expiresIn } : {}),
      ...(params.disposition ? { disposition: params.disposition } : {}),
    })
    return { url: body.url, expiresAt: body.expires_at ?? null }
  }

  /**
   * URL for one named transform. `expiresAt` is null for public files, which are
   * delivered from a stable URL. Public images already carry their transform URLs
   * on the file payload, so prefer `file.transforms[name]` when you have the file.
   */
  async transformUrl(id: FileId, params: TransformUrlParams): Promise<DeliveryUrl> {
    const body = await this.request("POST", `/api/v1/files/${this.pathId(id)}/transform_url`, {
      transform: params.transform,
      ...(params.expiresIn !== undefined ? { expires_in: params.expiresIn } : {}),
    })
    return { url: body.url, expiresAt: body.expires_at ?? null }
  }

  /** Deletes the bytes. The id keeps resolving, with status "deleted". */
  async deleteFile(id: FileId): Promise<true> {
    await this.request("DELETE", `/api/v1/files/${this.pathId(id)}`)
    return true
  }

  // -- The whole upload flow -----------------------------------------------

  /**
   * Request an upload, PUT the bytes straight to storage, and complete it.
   * The bytes never pass through AssetHutch's control plane.
   */
  async upload(source: UploadSource, params: UploadParams): Promise<AssetHutchFile> {
    const body = await toBytes(source)
    const contentType = params.contentType ?? guessContentType(params.filename)
    const { upload } = await this.createUpload({
      policy: params.policy,
      filename: params.filename,
      contentType,
      byteSize: body.byteLength,
      ...(params.metadata ? { metadata: params.metadata } : {}),
    })
    await this.putToStorage(upload, body)
    return this.completeUpload(upload.fileId)
  }

  /** PUTs bytes to the storage URL in an authorization. Never touches an AssetHutch endpoint. */
  async putToStorage(upload: UploadAuthorization, body: Uint8Array): Promise<true> {
    let response: Response
    try {
      response = await this.fetchImpl(upload.url, {
        method: upload.method,
        headers: upload.headers,
        // Node's fetch types model the body more narrowly than the runtime,
        // which accepts a Uint8Array directly and streams it without a copy.
        body: body as unknown as NonNullable<RequestInit["body"]>,
      })
    } catch (cause) {
      throw new ConnectionError(`Could not reach storage at ${hostOf(upload.url)}: ${messageOf(cause)}`, cause)
    }
    if (!response.ok) {
      const detail = (await safeText(response)).slice(0, 500)
      throw buildApiError(response.status, {
        error: {
          code: "storage_rejected",
          message: `Storage rejected the upload: HTTP ${response.status} ${detail}`.trim(),
        },
      })
    }
    return true
  }

  // -- Transport -----------------------------------------------------------

  async request(method: string, path: string, body?: unknown): Promise<any> {
    const target = `${this.url}${path}`
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      "User-Agent": this.userAgent,
    }
    if (body !== undefined) headers["Content-Type"] = "application/json"

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    let response: Response
    try {
      response = await this.fetchImpl(target, {
        method,
        headers,
        signal: controller.signal,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
    } catch (cause) {
      const timedOut = controller.signal.aborted
      throw new ConnectionError(
        timedOut
          ? `Request to ${hostOf(target)} timed out after ${this.timeoutMs}ms`
          : `Could not reach ${hostOf(target)}: ${messageOf(cause)}`,
        cause,
      )
    } finally {
      clearTimeout(timer)
    }

    if (response.status === 204) return null
    const text = await safeText(response)
    let payload: unknown = null
    if (text.length > 0) {
      try {
        payload = JSON.parse(text)
      } catch {
        payload = null
      }
    }
    if (!response.ok) throw buildApiError(response.status, payload)
    return payload
  }

  private pathId(id: FileId): string {
    const value = typeof id === "string" ? id : String(id)
    if (!ID_PATTERN.test(value)) {
      throw new ConfigurationError(`Expected an AssetHutch id, got ${JSON.stringify(id)}`)
    }
    return encodeURIComponent(value)
  }
}

const EXTENSION_TYPES: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", svg: "image/svg+xml", heic: "image/heic", txt: "text/plain",
  csv: "text/csv", json: "application/json", zip: "application/zip", mp4: "video/mp4", webm: "video/webm",
  mp3: "audio/mpeg", doc: "application/msword", xls: "application/vnd.ms-excel",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

export function guessContentType(filename: string): string {
  const extension = filename.split(".").pop()?.toLowerCase() ?? ""
  return EXTENSION_TYPES[extension] ?? "application/octet-stream"
}

async function toBytes(source: UploadSource): Promise<Uint8Array> {
  if (source instanceof Uint8Array) return source
  if (source instanceof ArrayBuffer) return new Uint8Array(source)
  if (typeof Blob !== "undefined" && source instanceof Blob) return new Uint8Array(await source.arrayBuffer())
  if (typeof source === "string") return new TextEncoder().encode(source)
  throw new ConfigurationError("Upload source must be a Uint8Array, ArrayBuffer, Blob, or string.")
}

function envVar(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
  return env?.[name] || undefined
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ""
  }
}
