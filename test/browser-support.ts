import { JSDOM } from "jsdom"

export const ENDPOINT = "/assethutch/uploads"
export const STORAGE = "https://bucket.storage.test/put"
export const FILE_ID = "file_abcdefghij0123456789"

export interface XhrCall {
  method: string
  url: string
  headers: Record<string, string>
  body: unknown
}

export interface FetchCall {
  url: string
  method: string
  headers: Record<string, string>
  body: any
}

/** How the stubbed storage PUT should behave. */
export interface XhrBehaviour {
  status?: number
  /** Emit progress events before finishing. */
  progress?: Array<{ loaded: number; total: number }>
  /** Fire onerror instead of onload. */
  networkError?: boolean
  /** Hold the request open so a test can abort it. */
  hang?: boolean
}

export interface Harness {
  window: any
  fetchCalls: FetchCall[]
  xhrCalls: XhrCall[]
  cleanup: () => void
}

/**
 * A jsdom window with fetch and XMLHttpRequest stubbed, installed as globals so
 * the browser code under test runs exactly as it would in a page.
 */
export function browserHarness(options: {
  routes?: Record<string, { status?: number; body?: unknown }>
  xhr?: XhrBehaviour
  html?: string
  csrf?: string
} = {}): Harness {
  const dom = new JSDOM(options.html ?? "<!doctype html><html><body></body></html>", { url: "https://app.test/" })
  const window = dom.window as any
  const fetchCalls: FetchCall[] = []
  const xhrCalls: XhrCall[] = []

  if (options.csrf) {
    const meta = window.document.createElement("meta")
    meta.name = "csrf-token"
    meta.content = options.csrf
    window.document.head.appendChild(meta)
  }

  const routes = options.routes ?? {}
  window.fetch = async (url: string, init: any = {}) => {
    const headers = { ...(init.headers ?? {}) } as Record<string, string>
    const body = init.body ? JSON.parse(init.body) : null
    fetchCalls.push({ url, method: init.method ?? "GET", headers, body })
    if (init.signal?.aborted) throw new Error("aborted")

    const route = routes[url]
    if (!route) throw new Error(`Unstubbed request: ${url}`)
    return {
      ok: (route.status ?? 200) < 400,
      status: route.status ?? 200,
      json: async () => route.body ?? {},
    }
  }

  const behaviour = options.xhr ?? {}
  class StubXhr {
    status = 0
    upload: { onprogress?: (event: any) => void } = {}
    onload?: () => void
    onerror?: () => void
    onabort?: () => void
    private method = ""
    private url = ""
    private headers: Record<string, string> = {}

    open(method: string, url: string) {
      this.method = method
      this.url = url
    }

    setRequestHeader(name: string, value: string) {
      this.headers[name] = value
    }

    send(body: unknown) {
      xhrCalls.push({ method: this.method, url: this.url, headers: { ...this.headers }, body })
      if (behaviour.hang) return
      queueMicrotask(() => {
        for (const tick of behaviour.progress ?? []) {
          this.upload.onprogress?.({ lengthComputable: true, ...tick })
        }
        if (behaviour.networkError) return this.onerror?.()
        this.status = behaviour.status ?? 200
        this.onload?.()
      })
    }

    abort() {
      this.onabort?.()
    }
  }
  window.XMLHttpRequest = StubXhr

  const globals = ["window", "document", "fetch", "XMLHttpRequest", "HTMLElement", "customElements", "CustomEvent", "File", "AbortController", "ProgressEvent"]
  const saved = new Map<string, any>()
  for (const name of globals) {
    saved.set(name, (globalThis as any)[name])
    ;(globalThis as any)[name] = name === "window" ? window : window[name]
  }

  return {
    window,
    fetchCalls,
    xhrCalls,
    cleanup() {
      for (const [name, value] of saved) {
        if (value === undefined) delete (globalThis as any)[name]
        else (globalThis as any)[name] = value
      }
      dom.window.close()
    },
  }
}

export function uploadRoutes(overrides: { created?: any; completed?: any; createdStatus?: number } = {}) {
  return {
    [ENDPOINT]: {
      status: overrides.createdStatus ?? 200,
      body: overrides.created ?? {
        upload: { id: FILE_ID, method: "PUT", url: STORAGE, headers: { "Content-Type": "image/png" } },
        file: { id: FILE_ID, filename: "me.png", status: "pending", url: null },
      },
    },
    [`${ENDPOINT}/${FILE_ID}/complete`]: {
      status: 200,
      body: overrides.completed ?? {
        file: { id: FILE_ID, filename: "me.png", status: "ready", url: "https://cdn.test/me.png", transforms: { avatar: "https://cdn.test/a.png" } },
      },
    },
  }
}

export function pngFile(window: any, name = "me.png"): File {
  return new window.File([new Uint8Array([1, 2, 3])], name, { type: "image/png" })
}
