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
