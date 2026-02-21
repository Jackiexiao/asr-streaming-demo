const test = require("node:test")
const assert = require("node:assert/strict")

const { float32ToInt16 } = require("../../lib/audio")

test("float32ToInt16 converts common normalized values", () => {
  const pcm = float32ToInt16(Float32Array.from([-1, -0.5, 0, 0.5, 1]))
  assert.deepEqual(Array.from(pcm), [-32768, -16384, 0, 16383, 32767])
})

test("float32ToInt16 clamps out-of-range samples", () => {
  const pcm = float32ToInt16(Float32Array.from([-2, 2]))
  assert.deepEqual(Array.from(pcm), [-32768, 32767])
})
