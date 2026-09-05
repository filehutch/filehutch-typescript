import { test } from "node:test"
import assert from "node:assert/strict"
import { computeSignature, constructEvent, SignatureVerificationError, verifySignature } from "../src/webhooks.js"
import { FileHutchError } from "../src/errors.js"

const SECRET = "whsec_test"
const BODY = '{"id":"whd_1","object":"event","type":"file.created","data":{"file":{"id":"file_1"}}}'
const NOW = 1_800_000_000

function header(body = BODY, secret = SECRET, at = NOW) {
  return `t=${at},v1=${computeSignature(at, body, secret)}`
}

test("constructEvent verifies and parses", () => {
  const event = constructEvent(BODY, header(), SECRET, { now: NOW + 60 })
  assert.equal(event.type, "file.created")
  assert.equal(event.data.file?.id, "file_1")
})

test("tampering, wrong secret and replay are refused", () => {
  assert.throws(() => constructEvent(BODY + " ", header(), SECRET, { now: NOW }), SignatureVerificationError)
  assert.throws(() => constructEvent(BODY, header(BODY, "whsec_other"), SECRET, { now: NOW }), SignatureVerificationError)
  assert.throws(() => constructEvent(BODY, header(), SECRET, { now: NOW + 301 }), SignatureVerificationError)
  assert.doesNotThrow(() => verifySignature(BODY, header(), SECRET, { now: NOW + 301, tolerance: 600 }))
})

test("malformed input fails closed", () => {
  for (const bad of [null, undefined, "", "garbage", "t=abc,v1=", "v1=deadbeef", "t=1800000000"]) {
    assert.throws(() => verifySignature(BODY, bad, SECRET, { now: NOW }), /missing or malformed/)
  }
  assert.throws(() => verifySignature(BODY, header(), "", { now: NOW }), /secret is missing/)
})

test("the error is an FileHutchError", () => {
  assert.ok(new SignatureVerificationError("x") instanceof FileHutchError)
})
