const test = require('node:test')
const assert = require('node:assert/strict')

const {
  parseUploadPayload,
} = require('../lib/file-upload-service')

test('parseUploadPayload parses data-url base64 and infers audio format', () => {
  const payload = parseUploadPayload({
    fileName: 'demo.wav',
    fileDataBase64: 'data:audio/wav;base64,SGVsbG8=',
  })

  assert.equal(payload.fileName, 'demo.wav')
  assert.equal(payload.contentType, 'audio/wav')
  assert.equal(payload.audioFormat, 'wav')
  assert.equal(payload.sizeBytes, 5)
  assert.equal(payload.buffer.toString('utf8'), 'Hello')
})

test('parseUploadPayload throws when payload is oversized', () => {
  assert.throws(() => {
    parseUploadPayload(
      {
        fileName: 'demo.wav',
        fileDataBase64: Buffer.from('too-large-content').toString('base64'),
      },
      { maxBytes: 2 },
    )
  }, /exceeds/)
})
