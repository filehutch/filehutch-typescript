import { test } from "node:test"
import assert from "node:assert/strict"
import { FileHutch } from "../src/client.js"
import { ConfigError, PermissionError } from "../src/errors.js"
import { BASE, errorJson, options, projectJson, stubFetch } from "./support.js"

const CONFIG = { uploads: { exports: { types: ["text/csv"], max_size: "1MB" } } }

test("config, planConfig and applyConfig pass the file through untouched", async () => {
  const { fetch, calls } = stubFetch({
    [`GET ${BASE}/api/v1/config`]: { body: { config: { uploads: { documents: { types: ["application/pdf"], max_size: 26214400, visibility: "private" } }, transforms: {}, environments: ["production"] } } },
    [`POST ${BASE}/api/v1/config/plan`]: { body: { plan: { prune: true, changes: [{ resource: "upload_policy", name: "exports", action: "create", to: {} }], summary: { create: 1, update: 0, delete: 0, noop: 0 } } } },
    [`POST ${BASE}/api/v1/config/apply`]: { body: { apply: { prune: false, results: [{ resource: "upload_policy", name: "exports", action: "create", status: "applied" }], summary: { applied: 1, failed: 0, noop: 0 } } } },
  })
  const hutch = new FileHutch(options(fetch))

  const config = await hutch.config()
  assert.equal(config.uploads?.documents?.max_size, 26214400)
  assert.deepEqual(config.environments, ["production"])

  const plan = await hutch.planConfig(CONFIG, { prune: true })
  assert.equal(plan.summary.create, 1)
  assert.equal(plan.changes[0]?.resource, "upload_policy")
  assert.deepEqual(JSON.parse(calls[1]!.body!), { config: CONFIG, prune: true })

  const apply = await hutch.applyConfig(CONFIG)
  assert.equal(apply.results[0]?.status, "applied")
  assert.deepEqual(JSON.parse(calls[2]!.body!), { config: CONFIG, prune: false })
})

test("read-only keys and bad configs are their own errors", async () => {
  const { fetch } = stubFetch({
    [`POST ${BASE}/api/v1/config/apply`]: { status: 403, body: errorJson("read_only_key", "This API key is read-only") },
    [`POST ${BASE}/api/v1/config/plan`]: { status: 422, body: errorJson("invalid_config", "uploads.docs: unknown key ttl") },
  })
  const hutch = new FileHutch(options(fetch))
  await assert.rejects(() => hutch.applyConfig(CONFIG), PermissionError)
  await assert.rejects(() => hutch.planConfig(CONFIG), ConfigError)
})

test("manifest pages by cursor and maps storage details", async () => {
  const entry = (id: string) => ({
    id, filename: "a.pdf", content_type: "application/pdf", byte_size: 11, checksum: "md5:x", visibility: "private", status: "ready",
    metadata: {}, policy: "documents", environment: "production",
    storage: { connection_id: "conn_x", mode: "byo", provider: "cloudflare_r2", bucket: "b", endpoint: "https://e", region: "auto", key: `${id}/a.pdf` },
    created_at: "2026-09-05T00:00:00.000Z",
  })
  const { fetch } = stubFetch({
    [`GET ${BASE}/api/v1/manifest?limit=1`]: { body: { object: "manifest", environment: "production", generated_at: "2026-09-05T00:00:00.000Z", files: [entry("file_1")], has_more: true, next_after: "file_1" } },
    [`GET ${BASE}/api/v1/manifest?after=file_1&limit=1`]: { body: { object: "manifest", environment: "production", generated_at: "2026-09-05T00:00:00.000Z", files: [entry("file_2")], has_more: false, next_after: null } },
  })
  const hutch = new FileHutch(options(fetch))

  const first = await hutch.manifest({ limit: 1 })
  assert.equal(first.hasMore, true)
  assert.equal(first.files[0]?.storage.key, "file_1/a.pdf")
  assert.equal(first.files[0]?.storage.connectionId, "conn_x")

  const second = await hutch.manifest({ after: first.nextAfter!, limit: 1 })
  assert.equal(second.hasMore, false)
  assert.equal(second.files[0]?.id, "file_2")
})

test("project carries environment, plan and usage when the API sends them", async () => {
  const { fetch } = stubFetch({
    [`GET ${BASE}/api/v1/project`]: { body: { project: { ...projectJson(), environment: { id: "env_x", name: "staging" }, environments: ["production", "staging"], plan: { key: "pro", name: "Pro", storage_bytes: 100, project_limit: null }, usage: { storage_bytes_used: 5, projects_used: 2 } } } },
  })
  const project = await new FileHutch(options(fetch)).project()
  assert.equal(project.environment?.name, "staging")
  assert.deepEqual(project.environments, ["production", "staging"])
  assert.equal(project.plan?.projectLimit, null)
  assert.equal(project.usage?.storageBytesUsed, 5)
})
