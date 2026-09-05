// Server-side only: verifies the signature AssetHutch puts on every webhook
// delivery. Import from "@assethutch/sdk/webhooks"; it uses node:crypto.
import { createHmac, timingSafeEqual } from "node:crypto"
import { SignatureVerificationError } from "./errors.js"
import type { AssetHutchFile, StorageConnection } from "./types.js"

export { SignatureVerificationError }

export const SIGNATURE_HEADER = "AssetHutch-Signature"
export const DEFAULT_TOLERANCE = 300

export interface WebhookEvent {
  id: string
  object: "event"
  /** file.created, file.deleted, upload.created, storage_connection.verified, storage_connection.verification_failed, ping */
  type: string
  created_at: string
  project_id: string
  environment: string | null
  data: { file?: AssetHutchFile; storage_connection?: StorageConnection }
}

export interface VerifyOptions {
  /** Seconds a signature stays valid. Default 300. */
  tolerance?: number
  /** Current time in unix seconds; for tests. */
  now?: number
}

export function computeSignature(timestamp: number, payload: string, secret: string): string {
  return createHmac("sha256", secret).update(`${Math.floor(timestamp)}.${payload}`).digest("hex")
}

/** Throws SignatureVerificationError unless `payload` was signed with `secret` within the tolerance. */
export function verifySignature(payload: string, header: string | null | undefined, secret: string, options: VerifyOptions = {}): void {
  if (!secret) throw new SignatureVerificationError("webhook secret is missing")
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE
  const now = options.now ?? Date.now() / 1000

  const parts = new Map<string, string>()
  for (const part of (header ?? "").split(",")) {
    const index = part.indexOf("=")
    if (index > 0) parts.set(part.slice(0, index), part.slice(index + 1))
  }
  const timestamp = Number(parts.get("t"))
  const given = parts.get("v1") ?? ""
  if (!Number.isInteger(timestamp) || timestamp <= 0 || given === "") {
    throw new SignatureVerificationError(`missing or malformed ${SIGNATURE_HEADER} header`)
  }
  if (Math.abs(now - timestamp) > tolerance) {
    throw new SignatureVerificationError(`signature timestamp is outside the ${tolerance}s tolerance`)
  }

  const expected = Buffer.from(computeSignature(timestamp, payload, secret), "utf8")
  const actual = Buffer.from(given, "utf8")
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new SignatureVerificationError("signature does not match")
  }
}

/** Verifies and parses a delivery. `payload` must be the raw request body, not re-serialized JSON. */
export function constructEvent(payload: string, header: string | null | undefined, secret: string, options: VerifyOptions = {}): WebhookEvent {
  verifySignature(payload, header, secret, options)
  return JSON.parse(payload) as WebhookEvent
}
