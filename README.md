# @assethutch/sdk

TypeScript client for [AssetHutch](https://assethutch.com), file infrastructure for apps that
aren't Netflix. Your app persists an opaque file id (`file_…`). AssetHutch owns uploads, private
files, signed URLs, delivery, and named image transforms. Your storage, or AssetHutch's, sits
behind it.

```ts
import { Assethutch } from "@assethutch/sdk"

const hutch = new Assethutch({ apiKey: process.env.ASSETHUTCH_API_KEY })

const file = await hutch.upload(bytes, { policy: "avatars", filename: "me.png" })
file.id                    // => "file_8fK2…"  ← the only thing you store
file.transforms.avatar     // => a 200×200 URL, if the project defines "avatar"
```

No runtime dependencies. Node 18+ (uses the global `fetch`), and any runtime that provides one.

## Install

```sh
npm install @assethutch/sdk
```

```sh
export ASSETHUTCH_API_KEY=ah_…    # Dashboard → API keys (project-scoped)
export ASSETHUTCH_URL=https://…   # only when not using AssetHutch cloud
```

## The API key is server side

The key is scoped to a project and can upload, sign, and delete. **Never ship it to a browser.**
Browser uploads go through your own endpoints, which hold the key and call this client — the same
shape the Rails engine in the `assethutch` gem provides:

```
browser → your server (holds the key) → AssetHutch     two small control-plane calls
browser ────────────────────────────→ storage          the bytes, directly
```

## Client

```ts
const hutch = new Assethutch({ apiKey, url, timeoutMs, fetch, userAgent })

await hutch.project()                    // storage status, policies, transforms
await hutch.transforms()                 // the project's named image sizes
await hutch.file("file_…")
await hutch.signedUrl("file_…", { expiresIn: 3600, disposition: "attachment" })
await hutch.transformUrl("file_…", { transform: "avatar", expiresIn: 600 })
await hutch.deleteFile("file_…")         // true; the id then reads as status "deleted"

// One call: request, PUT to storage, complete.
await hutch.upload(source, { policy: "documents", filename: "report.pdf", metadata: { orderId: "ord_1" } })

// Or the three steps, explicit:
const { upload } = await hutch.createUpload({ policy: "avatars", filename: "me.png", contentType: "image/png", byteSize: bytes.length })
await hutch.putToStorage(upload, bytes)
const ready = await hutch.completeUpload(upload.fileId)
```

`upload` takes a `Uint8Array`, `ArrayBuffer`, `Blob`, or a string. Content type comes from the
`contentType` option, then the filename's extension.

Responses are plain typed objects in camelCase. Two things are deliberately **not** rewritten,
because the keys are yours and not ours: `metadata`, and the keys of `file.transforms`.

## Image transforms

Transforms are **named** in the AssetHutch dashboard — `avatar`, `thumb`, `hero` — and your code
only ever says the name. No width, no format, no provider URL syntax, so resizing every avatar in
your app is one dashboard edit and no deploy.

```ts
const file = await hutch.file(id)
file.transforms.avatar                                   // public images: already on the payload
await hutch.transformUrl(id, { transform: "avatar" })    // private images: signed, expires
```

Rendering is a property of the project's storage, not of this SDK. Where it cannot be done you get
a `TransformsUnsupportedError` whose message names what to set up — never a URL that 404s.

## Browser uploads

`@assethutch/sdk/browser` is the other half: it never sees the API key. Two small JSON calls go to
*your* server, which holds the key, and the bytes go straight to storage.

```
browser → your server (holds the key) → AssetHutch     two control-plane calls
browser ────────────────────────────→ storage          the bytes
```

Your server needs two routes. The [`assethutch` gem](https://github.com/assethutch/assethutch-ruby)
mounts them for Rails (`mount Assethutch::Engine => "/assethutch"`); in anything else, wire them to
`createUpload` and `completeUpload` on the server client above.

```
POST <endpoint>              {policy, filename, content_type, byte_size} → {upload, file}
POST <endpoint>/:id/complete                                             → {file}
```

### The element

A custom element, so the same tag works in React, Vue, Svelte, Hotwire, or a plain `.html` file.

```ts
import { defineUploadElement } from "@assethutch/sdk/browser"
defineUploadElement()
```

```html
<form action="/users/1" method="post">
  <assethutch-upload policy="avatars" name="user[avatar_file_id]" accept="image/*"></assethutch-upload>
  <button>Save</button>
</form>
```

It builds a file input, a hidden field, a `<progress>` and a status line **in the light DOM**, so
your own CSS styles them like any other input — no shadow-root workarounds. On success the hidden
field holds the file id, which is all your form submits: no bucket, no key, no URL.

The surrounding form's submit buttons are disabled while bytes are in flight, so a half-uploaded
form can't be posted. A failed upload clears the field rather than leaving a stale id behind.

| | |
| --- | --- |
| Attributes | `policy` (required), `name`, `endpoint` (default `/assethutch/uploads`), `accept`, `disabled` |
| Properties | `fileId`, `uploading` |
| Methods | `abort()` |
| Events | `assethutch:start`, `assethutch:progress` (`detail.percent`), `assethutch:complete` (`detail.file`), `assethutch:error` (`detail.error`) |

Events bubble and are composed, so you can listen on a container or on `document`.

### Or just the function

```ts
import { directUpload } from "@assethutch/sdk/browser"

const file = await directUpload(input.files[0], {
  policy: "avatars",
  onProgress: (percent) => (bar.value = percent),
  signal: controller.signal,
})
file.id // => "file_8fK2…"
```

Progress comes from `XMLHttpRequest`, because `fetch` still cannot report upload progress. The CSRF
token is read from `<meta name="csrf-token">` unless you pass `csrfToken`. Failures raise
`DirectUploadError` with the server's `code` and `status` — including `storage_rejected` when the
bucket refuses the PUT, and `network`, whose message points at the bucket's CORS rules, since that
is nearly always the cause.

## Errors

Everything thrown extends `AssethutchError`. API failures carry a stable `code`, the `status`, and
any `details`. Match on `code` or the class, never the message.

| Class | When |
| --- | --- |
| `ConfigurationError` | no API key, bad URL, or an id that isn't one |
| `ConnectionError` | timeout, DNS, reset, abort |
| `AuthenticationError` | 401 |
| `NotFoundError` | unknown id |
| `InvalidRequestError` → `PolicyError` | bad params; content type or size the policy refuses |
| `StorageNotReadyError` | the project has no verified storage |
| `InvalidStateError` | not ready, already deleted, not public |
| `TransformError` → `TransformsUnsupportedError` | unknown transform or non-image; storage that cannot render |
| `UploadError` | storage rejected the PUT, upload expired or incomplete, size mismatch |
| `StorageError` | AssetHutch could not reach the bucket |
| `RateLimitError`, `ServerError` | 429, 5xx |

```ts
import { PolicyError, TransformsUnsupportedError } from "@assethutch/sdk"

try {
  await hutch.upload(bytes, { policy: "avatars", filename: "huge.png" })
} catch (error) {
  if (error instanceof PolicyError) return reply(422, error.message)
  throw error
}
```

## Development

```sh
npm install
npm test        # compiles, then runs node --test against a stubbed fetch
npm run build
```
