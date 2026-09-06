import { createHash } from "node:crypto"
import { test } from "node:test"
import assert from "node:assert/strict"
import { FileHutch } from "../src/client.js"
import {
  AuthenticationError, ConfigurationError, ConnectionError, InvalidStateError, NotFoundError,
  PlanLimitError, PolicyError, RateLimitError, ServerError, TransformError, TransformsUnsupportedError,
} from "../src/errors.js"
import { BASE, FILE_ID, STORAGE, errorJson, fileJson, options, projectJson, stubFetch, transformsJson } from "./support.js"

test("requires an API key and a usable URL", () => {
  assert.throws(() => new FileHutch({ apiKey: "" }), ConfigurationError)
  assert.throws(() => new FileHutch({ apiKey: "fh_x", url: "not a url" }), ConfigurationError)
})

test("project maps storage, policies and transforms into camelCase", async () => {
  const { fetch } = stubFetch({ [`GET ${BASE}/api/v1/project`]: { body: { project: projectJson() } } })
  const project = await new FileHutch(options(fetch)).project()

  assert.equal(project.storageReady, true)
  assert.equal(project.activeStorageConnection?.mode, "managed")
  assert.deepEqual(project.uploadPolicies.map((p) => p.name), ["documents"])
  assert.deepEqual(project.transforms.map((t) => t.name), ["avatar", "thumb"])
  assert.equal(project.uploadPolicies[0]!.maximumSize, 25_000_000)
})

test("transforms lists named sizes with nulls preserved", async () => {
  const { fetch } = stubFetch({ [`GET ${BASE}/api/v1/transforms`]: { body: { transforms: transformsJson() } } })
  const transforms = await new FileHutch(options(fetch)).transforms()

  const thumb = transforms[1]!
  assert.equal(thumb.width, 400)
  assert.equal(thumb.height, null)
  assert.equal(thumb.fit, "scale_down")
  assert.equal(thumb.format, "webp")
})

test("file keeps caller-owned keys verbatim while mapping the envelope", async () => {
  const { fetch } = stubFetch({
    [`GET ${BASE}/api/v1/files/${FILE_ID}`]: {
      body: {
        file: fileJson({
          visibility: "public",
          content_type: "image/png",
          metadata: { order_id: "ord_1", customer_ref: "AB-9" },
          transforms: { avatar: "https://cdn.test/a.png", hero_wide: "https://cdn.test/h.png" },
          url: "https://cdn.test/me.png",
        }),
      },
    },
  })
  const file = await new FileHutch(options(fetch)).file(FILE_ID)

  assert.equal(file.contentType, "image/png")
  assert.equal(file.byteSize, 11)
  assert.equal(file.url, "https://cdn.test/me.png")
  // Metadata and transform names belong to the caller; snake_case stays as written.
  assert.deepEqual(file.metadata, { order_id: "ord_1", customer_ref: "AB-9" })
  assert.deepEqual(Object.keys(file.transforms), ["avatar", "hero_wide"])
})

test("rejects anything that is not an FileHutch id before sending a request", async () => {
  const { fetch, calls } = stubFetch({})
  const hutch = new FileHutch(options(fetch))

  await assert.rejects(() => hutch.file("../../etc/passwd"), ConfigurationError)
  await assert.rejects(() => hutch.file(""), ConfigurationError)
  assert.equal(calls.length, 0)
})

test("signed_url sends only what was asked for", async () => {
  const { fetch, calls } = stubFetch({
    [`POST ${BASE}/api/v1/files/${FILE_ID}/signed_url`]: {
      body: { url: `${STORAGE}/x?signed=1`, expires_at: "2026-09-04T13:00:00.000Z" },
    },
  })
  const result = await new FileHutch(options(fetch)).signedUrl(FILE_ID, { expiresIn: 120, disposition: "attachment" })

  assert.equal(result.expiresAt, "2026-09-04T13:00:00.000Z")
  assert.deepEqual(JSON.parse(calls[0]!.body!), { expires_in: 120, disposition: "attachment" })
})

test("transform_url names a transform and reports no expiry for public files", async () => {
  const { fetch, calls } = stubFetch({
    [`POST ${BASE}/api/v1/files/${FILE_ID}/transform_url`]: {
      body: { url: `${STORAGE}/cdn-cgi/image/width=200/x.png`, expires_at: null },
    },
  })
  const result = await new FileHutch(options(fetch)).transformUrl(FILE_ID, { transform: "avatar" })

  assert.equal(result.expiresAt, null)
  assert.match(result.url, /cdn-cgi\/image/)
  // The name is the whole request: no width, no format, no provider syntax.
  assert.deepEqual(JSON.parse(calls[0]!.body!), { transform: "avatar" })
})

test("upload runs the three steps and PUTs bytes straight to storage", async () => {
  const { fetch, calls } = stubFetch({
    [`POST ${BASE}/api/v1/uploads`]: {
      body: {
        upload: {
          id: FILE_ID, object: "upload", file_id: FILE_ID, method: "PUT",
          url: `${STORAGE}/${FILE_ID}?sig=1`, headers: { "Content-Type": "image/png" },
          expires_at: "2099-01-01T00:00:00.000Z",
        },
        file: fileJson({ status: "pending" }),
      },
    },
    [`PUT ${STORAGE}/${FILE_ID}?sig=1`]: { status: 200, text: "" },
    [`POST ${BASE}/api/v1/uploads/${FILE_ID}/complete`]: { body: { file: fileJson({ status: "ready" }) } },
  })

  const file = await new FileHutch(options(fetch)).upload(new Uint8Array([1, 2, 3]), {
    policy: "avatars", filename: "me.png", metadata: { order_id: "ord_1" },
  })

  assert.equal(file.status, "ready")
  assert.deepEqual(calls.map((c) => `${c.method} ${new URL(c.url).host}`), [
    "POST filehutch.test", "PUT bucket.storage.test", "POST filehutch.test",
  ])
  const created = JSON.parse(calls[0]!.body!)
  assert.equal(created.content_type, "image/png") // guessed from the filename
  assert.equal(created.byte_size, 3)
  assert.deepEqual(created.metadata, { order_id: "ord_1" })
  assert.equal(created.checksum, createHash("md5").update(new Uint8Array([1, 2, 3])).digest("hex"),
    "the MD5 has to describe the bytes actually sent")
  // The storage PUT carries the bucket's headers and no FileHutch credentials.
  assert.equal(calls[1]!.headers["Content-Type"], "image/png")
  assert.equal(calls[1]!.headers["Authorization"], undefined)
})

test("a storage rejection is an upload failure, not a control-plane one", async () => {
  const { fetch } = stubFetch({
    [`POST ${BASE}/api/v1/uploads`]: {
      body: {
        upload: { id: FILE_ID, object: "upload", file_id: FILE_ID, method: "PUT", url: `${STORAGE}/x`, headers: {}, expires_at: "2099-01-01T00:00:00.000Z" },
        file: fileJson({ status: "pending" }),
      },
    },
    [`PUT ${STORAGE}/x`]: { status: 403, text: "<Error>AccessDenied</Error>" },
  })

  await assert.rejects(
    () => new FileHutch(options(fetch)).upload("hello", { policy: "documents", filename: "a.txt" }),
    (error: any) => {
      assert.equal(error.code, "storage_rejected")
      assert.match(error.message, /AccessDenied/)
      return true
    },
  )
})

test("error codes map to typed errors, ahead of status", async () => {
  const cases: Array<[string, number, any]> = [
    ["unauthorized", 401, AuthenticationError],
    ["not_found", 404, NotFoundError],
    ["policy_violation", 422, PolicyError],
    ["not_ready", 409, InvalidStateError],
    ["transform_not_found", 422, TransformError],
    ["transforms_unsupported", 409, TransformsUnsupportedError],
    ["plan_limit", 402, PlanLimitError],
  ]

  for (const [code, status, Klass] of cases) {
    const { fetch } = stubFetch({ [`GET ${BASE}/api/v1/files/${FILE_ID}`]: { status, body: errorJson(code, "boom") } })
    await assert.rejects(() => new FileHutch(options(fetch)).file(FILE_ID), (error: any) => {
      assert.ok(error instanceof Klass, `${code} should be ${Klass.name}, got ${error.constructor.name}`)
      assert.equal(error.code, code)
      assert.equal(error.status, status)
      return true
    })
  }
})

test("unknown codes and unparseable bodies still raise a useful error", async () => {
  const { fetch } = stubFetch({ [`GET ${BASE}/api/v1/project`]: { status: 429, body: errorJson("slow_down") } })
  await assert.rejects(() => new FileHutch(options(fetch)).project(), RateLimitError)

  const broken = stubFetch({ [`GET ${BASE}/api/v1/project`]: { status: 500, text: "<html>502 Bad Gateway</html>" } })
  await assert.rejects(() => new FileHutch(options(broken.fetch)).project(), (error: any) => {
    assert.ok(error instanceof ServerError)
    assert.match(error.message, /HTTP 500/)
    return true
  })
})

test("details from the API survive onto the error", async () => {
  const { fetch } = stubFetch({
    [`GET ${BASE}/api/v1/files/${FILE_ID}`]: { status: 422, body: errorJson("invalid", "bad", { filename: ["is required"] }) },
  })
  await assert.rejects(() => new FileHutch(options(fetch)).file(FILE_ID), (error: any) => {
    assert.deepEqual(error.details, { filename: ["is required"] })
    return true
  })
})

test("a transport failure is a ConnectionError naming the host", async () => {
  const failing = (async () => {
    throw new TypeError("fetch failed")
  }) as unknown as typeof globalThis.fetch

  await assert.rejects(() => new FileHutch(options(failing)).project(), (error: any) => {
    assert.ok(error instanceof ConnectionError)
    assert.match(error.message, /filehutch\.test/)
    return true
  })
})

test("delete returns true and 204 bodies do not break parsing", async () => {
  const { fetch } = stubFetch({ [`DELETE ${BASE}/api/v1/files/${FILE_ID}`]: { status: 204, text: "" } })
  assert.equal(await new FileHutch(options(fetch)).deleteFile(FILE_ID), true)
})

test("every request carries the bearer token and the SDK user agent", async () => {
  const { fetch, calls } = stubFetch({ [`GET ${BASE}/api/v1/project`]: { body: { project: projectJson() } } })
  await new FileHutch(options(fetch, { userAgent: "acme-web/2.0" })).project()

  assert.match(calls[0]!.headers["Authorization"]!, /^Bearer fh_/)
  assert.match(calls[0]!.headers["User-Agent"]!, /^filehutch-ts\/\d+\.\d+\.\d+ acme-web\/2\.0$/)
})

test("a trailing slash on the URL does not double up in paths", async () => {
  const { fetch, calls } = stubFetch({ [`GET ${BASE}/api/v1/project`]: { body: { project: projectJson() } } })
  await new FileHutch(options(fetch, { url: `${BASE}///` })).project()
  assert.equal(calls[0]!.url, `${BASE}/api/v1/project`)
})

test("verification can be turned off, and then nothing is claimed", async () => {
  const { fetch, calls } = stubFetch({
    [`POST ${BASE}/api/v1/uploads`]: {
      body: {
        upload: {
          id: FILE_ID, object: "upload", file_id: FILE_ID, method: "PUT",
          url: `${STORAGE}/${FILE_ID}?sig=1`, headers: {}, expires_at: "2099-01-01T00:00:00.000Z",
        },
        file: fileJson({ status: "pending" }),
      },
    },
    [`PUT ${STORAGE}/${FILE_ID}?sig=1`]: { status: 200, text: "" },
    [`POST ${BASE}/api/v1/uploads/${FILE_ID}/complete`]: { body: { file: fileJson({ status: "ready" }) } },
  })

  await new FileHutch(options(fetch)).upload(new Uint8Array([1, 2, 3]), {
    policy: "avatars", filename: "me.png", verify: false,
  })

  assert.equal(JSON.parse(calls[0]!.body!).checksum, undefined)
})
