# Changelog

## 0.1.0 — unreleased

First release.

### Server

- `AssetHutch`: project, transforms, file, uploads (create, complete, and a one-call `upload` that
  PUTs straight to storage), signed URLs, transform URLs, delete.
- No runtime dependencies — the global `fetch` on Node 18+.
- The API's error codes map to classes ahead of status, so callers match on a class or a code
  rather than a message.
- Responses are plain typed objects in camelCase, except `metadata` and the keys of
  `file.transforms`, which belong to the caller and are passed through exactly as written.

### Browser

- `@assethutch/sdk/browser` never sees the API key: two small JSON calls go to your own server,
  and the bytes go straight to storage.
- `<asset-hutch-upload>`, a custom element, so the same tag works in React, Vue, Svelte, Hotwire,
  or a plain `.html` file. Light DOM, so host CSS styles it like any other input.
- Submit buttons in the surrounding form are disabled while bytes are in flight, and a failed
  upload clears the hidden field rather than leaving a stale id behind.
- `directUpload(file, { policy, onProgress, signal })` for use without the element.
