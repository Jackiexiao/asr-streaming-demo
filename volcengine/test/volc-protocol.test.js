const test = require('node:test')
const assert = require('node:assert/strict')
const zlib = require('node:zlib')

const { parseServerMessage } = require('../lib/volc-protocol')

function buildResponseFrame({
  flags = 0x1,
  serialization = 0x1,
  compression = 0x0,
  sequence = 1,
  payload,
}) {
  const header = Buffer.from([0x11, (0x9 << 4) | flags, (serialization << 4) | compression, 0x00])
  const seq = Buffer.alloc(4)
  seq.writeInt32BE(sequence)
  const size = Buffer.alloc(4)
  size.writeUInt32BE(payload.length)
  return Buffer.concat([header, seq, size, payload])
}

test('parseServerMessage parses sequence-prefixed full server response', () => {
  const body = { result: { text: 'hello' } }
  const payload = Buffer.from(JSON.stringify(body))
  const frame = buildResponseFrame({ payload })

  const parsed = parseServerMessage(frame)

  assert.equal(parsed.messageType, 0x9)
  assert.equal(parsed.sequence, 1)
  assert.deepEqual(parsed.json, body)
})

test('parseServerMessage decompresses gzip payload when compression=1', () => {
  const body = { result: { text: 'gzip hello' } }
  const payload = zlib.gzipSync(Buffer.from(JSON.stringify(body)))
  const frame = buildResponseFrame({ compression: 0x1, payload })

  const parsed = parseServerMessage(frame)

  assert.deepEqual(parsed.json, body)
})

test('parseServerMessage parses server error frame', () => {
  const errorText = 'bad request'
  const errorBytes = Buffer.from(errorText, 'utf8')
  const header = Buffer.from([0x11, 0xf0, 0x10, 0x00])
  const code = Buffer.alloc(4)
  code.writeUInt32BE(40000001)
  const size = Buffer.alloc(4)
  size.writeUInt32BE(errorBytes.length)
  const frame = Buffer.concat([header, code, size, errorBytes])

  const parsed = parseServerMessage(frame)

  assert.equal(parsed.messageType, 0xf)
  assert.equal(parsed.errorCode, 40000001)
  assert.equal(parsed.errorMessage, errorText)
})
