import type { ClientOptions } from "../src/types.js"

export const BASE = "https://asset-hutch.test"
export const STORAGE = "https://bucket.storage.test"
export const FILE_ID = "file_abcdefghij0123456789"
export const API_KEY = "ah_testTESTtestTESTtestTESTtestTESTtestTEST"

export interface Recorded {
  url: string
  method: string
  headers: Record<string, string>
  body: string | null
}

export interface StubbedResponse {
  status?: number
  body?: unknown
  /** Raw body, for testing malformed payloads. */
  text?: string
}

/** A fetch that answers from a route table and records every call. */
export function stubFetch(routes: Record<string, StubbedResponse | StubbedResponse[]>) {
  const calls: Recorded[] = []
  const remaining = new Map<string, StubbedResponse[]>(
    Object.entries(routes).map(([key, value]) => [key, Array.isArray(value) ? [...value] : [value]]),
  )

  const impl = async (input: any, init: any = {}): Promise<Response> => {
    const url = typeof input === "string" ? input : input.url
    const method = (init.method ?? "GET").toUpperCase()
    const headers = normalizeHeaders(init.headers)
    const body = typeof init.body === "string" ? init.body : init.body ? "<binary>" : null
    calls.push({ url, method, headers, body })

    const key = `${method} ${url}`
    const queue = remaining.get(key)
    if (!queue || queue.length === 0) throw new Error(`Unstubbed request: ${key}`)
    const stub = queue.length > 1 ? queue.shift()! : queue[0]!

    const status = stub.status ?? 200
    const payload = stub.text ?? (stub.body === undefined ? "" : JSON.stringify(stub.body))
    // 204/205/304 must carry a null body or the Response constructor throws.
    const nullBody = status === 204 || status === 205 || status === 304
    return new Response(nullBody ? null : payload, {
      status,
      headers: { "Content-Type": "application/json" },
    })
  }

  return { fetch: impl as unknown as typeof globalThis.fetch, calls }
}

export function options(fetchImpl: typeof globalThis.fetch, extra: ClientOptions = {}): ClientOptions {
  return { apiKey: API_KEY, url: BASE, fetch: fetchImpl, ...extra }
}

export function fileJson(overrides: Record<string, unknown> = {}) {
  return {
    id: FILE_ID, object: "file", filename: "report.pdf", content_type: "application/pdf",
    byte_size: 11, checksum: "md5:abc", visibility: "private", status: "ready",
    metadata: {}, policy: "documents", storage_connection_id: "conn_x", url: null, transforms: {},
    created_at: "2026-09-04T12:00:00.000Z", updated_at: "2026-09-04T12:00:01.000Z",
    ...overrides,
  }
}

export function transformsJson() {
  return [
    { id: "trn_avatar", object: "transform", name: "avatar", width: 200, height: 200, fit: "cover", quality: null, format: "auto", created_at: "2026-09-01T00:00:00.000Z" },
    { id: "trn_thumb", object: "transform", name: "thumb", width: 400, height: null, fit: "scale_down", quality: 80, format: "webp", created_at: "2026-09-01T00:00:00.000Z" },
  ]
}

export function projectJson() {
  return {
    id: "proj_x", object: "project", name: "Demo", team_id: "team_x", storage_ready: true,
    active_storage_connection: { id: "conn_x", object: "storage_connection", name: "Managed", mode: "managed", provider: "cloudflare_r2", status: "verified" },
    upload_policies: [
      { id: "pol_docs", object: "upload_policy", name: "documents", allowed_content_types: ["application/pdf"], maximum_size: 25_000_000, visibility: "private", created_at: "2026-09-01T00:00:00.000Z" },
    ],
    transforms: transformsJson(),
    created_at: "2026-09-01T00:00:00.000Z",
  }
}

export function errorJson(code: string, message = "nope", details?: unknown) {
  return { error: { code, message, ...(details !== undefined ? { details } : {}) } }
}

function normalizeHeaders(headers: unknown): Record<string, string> {
  if (!headers) return {}
  if (headers instanceof Headers) return Object.fromEntries(headers.entries())
  return Object.fromEntries(Object.entries(headers as Record<string, string>))
}
