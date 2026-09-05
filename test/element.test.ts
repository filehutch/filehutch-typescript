import { test } from "node:test"
import assert from "node:assert/strict"
import { ENDPOINT, FILE_ID, browserHarness, pngFile, uploadRoutes } from "./browser-support.js"

// The element class closes over the HTMLElement of whichever window was current
// when its module first ran, and a class built against one window never upgrades
// in another. Each test gets a fresh jsdom window, so each needs a fresh module.
let generation = 0
async function loadElementModule(): Promise<any> {
  return import(`../src/browser/element.js?generation=${generation++}`)
}

// The element registers against whatever globals are installed, so it has to be
// imported after the harness has put jsdom's in place.
async function mount(harness: any, html: string) {
  const { defineUploadElement } = await loadElementModule()
  defineUploadElement()
  harness.window.document.body.innerHTML = html
  return harness.window.document.querySelector("filehutch-upload") as any
}

/** Picks a file and waits for the upload to settle. */
async function choose(element: any, file: File) {
  const input = element.querySelector("input[type=file]") as any
  Object.defineProperty(input, "files", { value: [file], configurable: true })
  input.dispatchEvent(new element.ownerDocument.defaultView.Event("change"))
  await new Promise((resolve) => setTimeout(resolve, 10))
}

test("builds its controls in the light DOM so host CSS applies", async () => {
  const harness = browserHarness({ routes: uploadRoutes() })
  try {
    const element = await mount(harness, `<filehutch-upload policy="avatars" name="user[avatar_file_id]" accept="image/*"></filehutch-upload>`)

    assert.equal(element.shadowRoot, null)
    assert.equal(element.querySelector("input[type=file]").accept, "image/*")
    assert.equal(element.querySelector("input[type=hidden]").name, "user[avatar_file_id]")
    assert.equal(element.querySelector("progress").hidden, true)
    assert.equal(element.querySelector("[role=status]").textContent, "")
  } finally {
    harness.cleanup()
  }
})

test("uploading puts the file id in the hidden field the form submits", async () => {
  const harness = browserHarness({ routes: uploadRoutes() })
  try {
    const element = await mount(harness, `<filehutch-upload policy="avatars" name="user[avatar_file_id]"></filehutch-upload>`)
    await choose(element, pngFile(harness.window))

    assert.equal(element.fileId, FILE_ID)
    assert.equal(element.querySelector("input[type=hidden]").value, FILE_ID)
    assert.match(element.querySelector("[role=status]").textContent, /uploaded/)
    // The id is all the form carries — no bucket, no key, no URL.
    assert.equal(element.querySelector("input[type=hidden]").value, FILE_ID)
  } finally {
    harness.cleanup()
  }
})

test("emits the documented events in order", async () => {
  const harness = browserHarness({
    routes: uploadRoutes(),
    xhr: { progress: [{ loaded: 1, total: 2 }, { loaded: 2, total: 2 }] },
  })
  try {
    const element = await mount(harness, `<filehutch-upload policy="avatars"></filehutch-upload>`)
    const seen: string[] = []
    const percents: number[] = []
    for (const name of ["start", "progress", "complete", "error"]) {
      // Listening on document proves the events bubble out of the element.
      harness.window.document.addEventListener(`filehutch:${name}`, (event: any) => {
        seen.push(name)
        if (name === "progress") percents.push(event.detail.percent)
      })
    }

    await choose(element, pngFile(harness.window))

    assert.deepEqual(seen, ["start", "progress", "progress", "complete"])
    assert.deepEqual(percents, [50, 100])
  } finally {
    harness.cleanup()
  }
})

test("the surrounding form cannot be submitted mid-upload", async () => {
  const harness = browserHarness({ routes: uploadRoutes(), xhr: { hang: true } })
  try {
    const element = await mount(harness, `
      <form><filehutch-upload policy="avatars"></filehutch-upload><button type="submit">Save</button></form>
    `)
    const button = harness.window.document.querySelector("button")!

    assert.equal(button.disabled, false)
    await choose(element, pngFile(harness.window))

    assert.equal(button.disabled, true, "submit stays disabled while bytes are in flight")
    assert.equal(element.uploading, true)
    assert.equal(element.querySelector("progress").hidden, false)

    element.abort()
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(button.disabled, false, "and is released once the upload settles")
    assert.equal(element.uploading, false)
  } finally {
    harness.cleanup()
  }
})

test("a failed upload clears the id, reports why, and re-enables the form", async () => {
  const harness = browserHarness({
    routes: { [ENDPOINT]: { status: 422, body: { error: { code: "policy_violation", message: "too large" } } } },
  })
  try {
    const element = await mount(harness, `
      <form><filehutch-upload policy="avatars" name="user[avatar_file_id]"></filehutch-upload><button type="submit">Save</button></form>
    `)
    element.fileId = "file_stalestalestale0000"

    const errors: any[] = []
    harness.window.document.addEventListener("filehutch:error", (event: any) => errors.push(event.detail.error))
    await choose(element, pngFile(harness.window))

    assert.equal(element.fileId, "", "a stale id must not survive a failed replacement")
    assert.equal(errors[0].code, "policy_violation")
    assert.match(element.querySelector("[role=status]").textContent, /too large/)
    assert.equal(element.querySelector("[role=status]").dataset.filehutchState, "error")
    assert.equal(harness.window.document.querySelector("button").disabled, false)
  } finally {
    harness.cleanup()
  }
})

test("a missing policy fails loudly instead of uploading somewhere unintended", async () => {
  const harness = browserHarness({ routes: uploadRoutes() })
  try {
    const element = await mount(harness, `<filehutch-upload></filehutch-upload>`)
    const errors: any[] = []
    harness.window.document.addEventListener("filehutch:error", (event: any) => errors.push(event.detail.error))

    await choose(element, pngFile(harness.window))

    assert.match(errors[0].message, /needs a policy/)
    assert.equal(harness.fetchCalls.length, 0)
  } finally {
    harness.cleanup()
  }
})

test("registering twice is harmless", async () => {
  const harness = browserHarness({})
  try {
    const { defineUploadElement, FileHutchUploadElement } = await loadElementModule()
    defineUploadElement()
    defineUploadElement()
    assert.equal(harness.window.customElements.get("filehutch-upload"), FileHutchUploadElement)
  } finally {
    harness.cleanup()
  }
})
