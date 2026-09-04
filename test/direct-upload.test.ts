import { test } from "node:test"
import assert from "node:assert/strict"
import { DirectUploadError, directUpload } from "../src/browser/direct-upload.js"
import { ENDPOINT, FILE_ID, STORAGE, browserHarness, pngFile, uploadRoutes } from "./browser-support.js"

test("runs the three steps and sends the bytes straight to storage", async () => {
  const harness = browserHarness({ routes: uploadRoutes() })
  try {
    const file = pngFile(harness.window)
    const uploaded = await directUpload(file, { policy: "avatars" })

    assert.equal(uploaded.id, FILE_ID)
    assert.equal(uploaded.status, "ready")

    // Two calls to your app, one PUT to the bucket, in that order.
    assert.deepEqual(harness.fetchCalls.map((c) => c.url), [ENDPOINT, `${ENDPOINT}/${FILE_ID}/complete`])
    assert.deepEqual(harness.xhrCalls.map((c) => `${c.method} ${c.url}`), [`PUT ${STORAGE}`])

    // The first call describes the file; the policy names what is allowed.
    assert.deepEqual(harness.fetchCalls[0]!.body, {
      policy: "avatars", filename: "me.png", content_type: "image/png", byte_size: 3,
    })
    // The bucket gets its own headers and the raw File, never a credential.
    assert.equal(harness.xhrCalls[0]!.headers["Content-Type"], "image/png")
    assert.equal(harness.xhrCalls[0]!.headers["Authorization"], undefined)
    assert.equal(harness.xhrCalls[0]!.body, file)
  } finally {
    harness.cleanup()
  }
})

test("reports progress as whole percentages", async () => {
  const harness = browserHarness({
    routes: uploadRoutes(),
    xhr: { progress: [{ loaded: 1, total: 4 }, { loaded: 3, total: 4 }, { loaded: 4, total: 4 }] },
  })
  try {
    const seen: number[] = []
    await directUpload(pngFile(harness.window), { policy: "avatars", onProgress: (p) => seen.push(p) })
    assert.deepEqual(seen, [25, 75, 100])
  } finally {
    harness.cleanup()
  }
})

test("sends the CSRF token from the page when one is not passed", async () => {
  const harness = browserHarness({ routes: uploadRoutes(), csrf: "token-from-meta" })
  try {
    await directUpload(pngFile(harness.window), { policy: "avatars" })
    assert.equal(harness.fetchCalls[0]!.headers["X-CSRF-Token"], "token-from-meta")

    await directUpload(pngFile(harness.window), { policy: "avatars", csrfToken: "explicit" })
    assert.equal(harness.fetchCalls[2]!.headers["X-CSRF-Token"], "explicit")
  } finally {
    harness.cleanup()
  }
})

test("surfaces the server's error code and message, and does not complete", async () => {
  const harness = browserHarness({
    routes: {
      [ENDPOINT]: { status: 422, body: { error: { code: "policy_violation", message: "image/png is not allowed" } } },
    },
  })
  try {
    await assert.rejects(
      () => directUpload(pngFile(harness.window), { policy: "documents" }),
      (error: DirectUploadError) => {
        assert.equal(error.code, "policy_violation")
        assert.equal(error.status, 422)
        assert.match(error.message, /not allowed/)
        return true
      },
    )
    assert.equal(harness.xhrCalls.length, 0, "nothing should reach storage")
  } finally {
    harness.cleanup()
  }
})

test("a bucket rejection is reported as such and never completed", async () => {
  const harness = browserHarness({ routes: uploadRoutes(), xhr: { status: 403 } })
  try {
    await assert.rejects(
      () => directUpload(pngFile(harness.window), { policy: "avatars" }),
      (error: DirectUploadError) => {
        assert.equal(error.code, "storage_rejected")
        assert.equal(error.status, 403)
        return true
      },
    )
    // The complete call must not run for bytes that never landed.
    assert.deepEqual(harness.fetchCalls.map((c) => c.url), [ENDPOINT])
  } finally {
    harness.cleanup()
  }
})

test("a CORS or network failure names the likely cause", async () => {
  const harness = browserHarness({ routes: uploadRoutes(), xhr: { networkError: true } })
  try {
    await assert.rejects(
      () => directUpload(pngFile(harness.window), { policy: "avatars" }),
      (error: DirectUploadError) => {
        assert.equal(error.code, "network")
        assert.match(error.message, /CORS/)
        return true
      },
    )
  } finally {
    harness.cleanup()
  }
})

test("an abort signal stops an upload in flight", async () => {
  const harness = browserHarness({ routes: uploadRoutes(), xhr: { hang: true } })
  try {
    const controller = new AbortController()
    const promise = directUpload(pngFile(harness.window), { policy: "avatars", signal: controller.signal })
    await Promise.resolve()
    controller.abort()

    await assert.rejects(promise, (error: DirectUploadError) => {
      assert.equal(error.code, "aborted")
      return true
    })
  } finally {
    harness.cleanup()
  }
})

test("a policy is required, and a custom endpoint is honoured", async () => {
  const harness = browserHarness({
    routes: {
      "/custom/uploads": uploadRoutes()[ENDPOINT]!,
      [`/custom/uploads/${FILE_ID}/complete`]: uploadRoutes()[`${ENDPOINT}/${FILE_ID}/complete`]!,
    },
  })
  try {
    await assert.rejects(
      () => directUpload(pngFile(harness.window), { policy: "" }),
      DirectUploadError,
    )

    await directUpload(pngFile(harness.window), { policy: "avatars", url: "/custom/uploads/" })
    assert.equal(harness.fetchCalls[0]!.url, "/custom/uploads")
  } finally {
    harness.cleanup()
  }
})
