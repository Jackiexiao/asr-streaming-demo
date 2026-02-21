const test = require("node:test")
const assert = require("node:assert/strict")

const { normalizeCloseCode, resolveStreamingModel } = require("../../lib/streaming")

test("normalizeCloseCode falls back when code is not a valid websocket close code", () => {
  assert.equal(normalizeCloseCode(400), 1011)
  assert.equal(normalizeCloseCode(undefined), 1011)
})

test("normalizeCloseCode keeps valid websocket close code", () => {
  assert.equal(normalizeCloseCode(1000), 1000)
  assert.equal(normalizeCloseCode(3001), 3001)
})

test("resolveStreamingModel falls back from unsupported zh + nova-3 to nova-2", () => {
  assert.equal(resolveStreamingModel({ model: "nova-3", language: "zh-CN" }), "nova-2")
})

test("resolveStreamingModel keeps supported model-language combinations", () => {
  assert.equal(resolveStreamingModel({ model: "nova-3", language: "en-US" }), "nova-3")
  assert.equal(resolveStreamingModel({ model: "nova-2", language: "zh-CN" }), "nova-2")
})
