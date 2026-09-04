/**
 * Browser-side direct upload.
 *
 * The API key never reaches the browser. Two small JSON calls go to *your*
 * server — the endpoints the AssetHutch Rails engine mounts, or the equivalent
 * two routes in any other framework — and the bytes go straight to storage.
 *
 *   browser → your server (holds the key) → AssetHutch     two control-plane calls
 *   browser ────────────────────────────→ storage          the bytes
 */

export class DirectUploadError extends Error {
  readonly code: string | undefined
  readonly status: number | undefined

  constructor(message: string, options: { code?: string; status?: number } = {}) {
    super(message)
    this.name = "DirectUploadError"
    this.code = options.code
    this.status = options.status
  }
}

/** The subset of the file payload a browser has any use for. */
export interface UploadedFile {
  id: string
  filename: string
  contentType?: string
  byteSize?: number
  status: string
  url: string | null
  transforms?: Record<string, string>
  [key: string]: unknown
}

export interface DirectUploadOptions {
  /** Your app's upload endpoint. Defaults to the Rails engine's mount point. */
  url?: string
  /** Upload policy name, as defined in the AssetHutch dashboard. */
  policy: string
  /** Sent as X-CSRF-Token. Read from <meta name="csrf-token"> when omitted. */
  csrfToken?: string
  /** Called with 0-100 as the bytes go up. */
  onProgress?: (percent: number) => void
  /** Abort the upload, including the PUT in flight. */
  signal?: AbortSignal
}

const DEFAULT_URL = "/asset_hutch/uploads"

/**
 * Runs the three steps and resolves with the ready file. Framework-neutral:
 * no Stimulus, no React, no bundler requirements.
 */
export async function directUpload(file: File, options: DirectUploadOptions): Promise<UploadedFile> {
  const url = (options.url ?? DEFAULT_URL).replace(/\/+$/, "")
  if (!options?.policy) throw new DirectUploadError("directUpload needs a policy", { code: "invalid" })

  const created = await postJson(url, {
    policy: options.policy,
    filename: file.name,
    content_type: file.type || "application/octet-stream",
    byte_size: file.size,
  }, options)

  await putToStorage(created.upload, file, options)

  const completed = await postJson(`${url}/${encodeURIComponent(created.upload.id)}/complete`, {}, options)
  return completed.file
}

interface Authorization {
  id: string
  method?: string
  url: string
  headers?: Record<string, string>
}

function putToStorage(upload: Authorization, file: File, options: DirectUploadOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    // XHR rather than fetch: fetch still cannot report upload progress.
    const xhr = new XMLHttpRequest()
    const abort = () => xhr.abort()

    xhr.open(upload.method || "PUT", upload.url, true)
    for (const [name, value] of Object.entries(upload.headers ?? {})) xhr.setRequestHeader(name, value)

    if (options.onProgress) {
      xhr.upload.onprogress = (event: ProgressEvent) => {
        if (event.lengthComputable) options.onProgress!(Math.round((event.loaded / event.total) * 100))
      }
    }

    const settle = (fn: () => void) => {
      options.signal?.removeEventListener("abort", abort)
      fn()
    }

    xhr.onload = () => settle(() =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new DirectUploadError(`Storage rejected the upload (HTTP ${xhr.status})`, {
            code: "storage_rejected", status: xhr.status,
          })))

    xhr.onerror = () => settle(() =>
      reject(new DirectUploadError("Network error talking to storage (check the bucket's CORS rules)", { code: "network" })))

    xhr.onabort = () => settle(() =>
      reject(new DirectUploadError("Upload aborted", { code: "aborted" })))

    if (options.signal) {
      if (options.signal.aborted) return reject(new DirectUploadError("Upload aborted", { code: "aborted" }))
      options.signal.addEventListener("abort", abort, { once: true })
    }

    xhr.send(file)
  })
}

async function postJson(url: string, body: unknown, options: DirectUploadOptions): Promise<any> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  }
  const token = options.csrfToken ?? csrfTokenFromDocument()
  if (token) headers["X-CSRF-Token"] = token

  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      credentials: "same-origin",
      ...(options.signal ? { signal: options.signal } : {}),
    })
  } catch (cause) {
    if (options.signal?.aborted) throw new DirectUploadError("Upload aborted", { code: "aborted" })
    throw new DirectUploadError(`Could not reach ${url}`, { code: "network" })
  }

  const data = await response.json().catch(() => ({} as any))
  if (!response.ok) {
    throw new DirectUploadError(
      data?.error?.message || `Request failed (HTTP ${response.status})`,
      { code: data?.error?.code, status: response.status },
    )
  }
  return data
}

function csrfTokenFromDocument(): string | undefined {
  if (typeof document === "undefined") return undefined
  const meta = document.querySelector<HTMLMetaElement>("meta[name='csrf-token']")
  return meta?.content || undefined
}
