const zlib = require('node:zlib')

const MESSAGE_TYPES = {
  FULL_CLIENT_REQUEST: 0x1,
  AUDIO_ONLY_CLIENT_REQUEST: 0x2,
  FULL_SERVER_RESPONSE: 0x9,
  SERVER_ERROR_RESPONSE: 0xf,
}

function hasSequence(messageFlags) {
  return messageFlags === 0x1 || messageFlags === 0x3
}

function ensureBytes(buffer, offset, size, label) {
  if (offset + size > buffer.length) {
    throw new Error(`Invalid Volcengine frame: missing ${label}`)
  }
}

function encodePayload(payload, compression) {
  if (!Buffer.isBuffer(payload)) {
    throw new TypeError('payload must be a Buffer')
  }
  if (compression === 0x0) {
    return payload
  }
  if (compression === 0x1) {
    return zlib.gzipSync(payload)
  }
  throw new Error(`Unsupported compression: ${compression}`)
}

function decodePayload(payload, compression) {
  if (compression === 0x0) {
    return payload
  }
  if (compression === 0x1) {
    return zlib.gunzipSync(payload)
  }
  throw new Error(`Unsupported compression: ${compression}`)
}

function buildClientMessage({
  messageType,
  messageFlags = 0x0,
  serialization = 0x0,
  compression = 0x0,
  payload = Buffer.alloc(0),
  sequence,
}) {
  const encodedPayload = encodePayload(payload, compression)
  const header = Buffer.from([
    0x11,
    ((messageType & 0x0f) << 4) | (messageFlags & 0x0f),
    ((serialization & 0x0f) << 4) | (compression & 0x0f),
    0x00,
  ])

  const chunks = [header]

  if (hasSequence(messageFlags)) {
    const seq = Buffer.alloc(4)
    seq.writeInt32BE(sequence ?? 1)
    chunks.push(seq)
  }

  const payloadSize = Buffer.alloc(4)
  payloadSize.writeUInt32BE(encodedPayload.length)
  chunks.push(payloadSize, encodedPayload)

  return Buffer.concat(chunks)
}

function parseServerMessage(data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data)
  if (buffer.length < 4) {
    throw new Error('Invalid Volcengine frame: header too short')
  }

  const headerSize = (buffer[0] & 0x0f) * 4
  ensureBytes(buffer, 0, headerSize, 'header')

  const messageType = (buffer[1] >> 4) & 0x0f
  const messageFlags = buffer[1] & 0x0f
  const serialization = (buffer[2] >> 4) & 0x0f
  const compression = buffer[2] & 0x0f

  let offset = headerSize
  let sequence

  if (hasSequence(messageFlags)) {
    ensureBytes(buffer, offset, 4, 'sequence')
    sequence = buffer.readInt32BE(offset)
    offset += 4
  }

  if (messageType === MESSAGE_TYPES.SERVER_ERROR_RESPONSE) {
    ensureBytes(buffer, offset, 8, 'error code and size')
    const errorCode = buffer.readUInt32BE(offset)
    offset += 4
    const errorSize = buffer.readUInt32BE(offset)
    offset += 4
    ensureBytes(buffer, offset, errorSize, 'error message')
    const errorMessage = buffer.slice(offset, offset + errorSize).toString('utf8')

    return {
      messageType,
      messageFlags,
      serialization,
      compression,
      sequence,
      errorCode,
      errorMessage,
    }
  }

  ensureBytes(buffer, offset, 4, 'payload size')
  const payloadSize = buffer.readUInt32BE(offset)
  offset += 4
  ensureBytes(buffer, offset, payloadSize, 'payload')

  const payload = buffer.slice(offset, offset + payloadSize)
  const decodedPayload = decodePayload(payload, compression)

  let json
  if (serialization === 0x1 && decodedPayload.length > 0) {
    json = JSON.parse(decodedPayload.toString('utf8'))
  }

  return {
    messageType,
    messageFlags,
    serialization,
    compression,
    sequence,
    payload: decodedPayload,
    json,
  }
}

module.exports = {
  MESSAGE_TYPES,
  buildClientMessage,
  parseServerMessage,
}
