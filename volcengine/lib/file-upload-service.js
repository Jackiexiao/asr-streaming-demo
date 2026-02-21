const path = require('path')

const DEFAULT_MAX_UPLOAD_BYTES = 20 * 1024 * 1024

const KNOWN_AUDIO_FORMATS = new Set(['wav', 'mp3', 'ogg', 'm4a', 'aac', 'flac', 'amr', 'webm'])

function createError(message, code) {
  const error = new Error(message)
  error.code = code
  return error
}

function inferAudioFormat(fileName = '', contentType = '') {
  const ext = path.extname(String(fileName).trim().toLowerCase()).replace('.', '')
  if (ext && KNOWN_AUDIO_FORMATS.has(ext)) {
    return ext
  }

  const normalizedType = String(contentType).toLowerCase()
  if (normalizedType.includes('wav')) return 'wav'
  if (normalizedType.includes('mpeg') || normalizedType.includes('mp3')) return 'mp3'
  if (normalizedType.includes('ogg')) return 'ogg'
  if (normalizedType.includes('aac')) return 'aac'
  if (normalizedType.includes('flac')) return 'flac'
  if (normalizedType.includes('webm')) return 'webm'
  if (normalizedType.includes('m4a') || normalizedType.includes('mp4')) return 'm4a'

  return 'wav'
}

function extractBase64AndType(rawValue) {
  const raw = String(rawValue ?? '').trim()
  if (!raw) {
    throw createError('fileDataBase64 is required', 'INVALID_UPLOAD_PAYLOAD')
  }

  const dataUrlMatch = raw.match(/^data:([^;,]+);base64,(.+)$/i)
  if (dataUrlMatch) {
    return {
      contentTypeFromDataUrl: dataUrlMatch[1],
      base64: dataUrlMatch[2],
    }
  }

  return {
    contentTypeFromDataUrl: '',
    base64: raw,
  }
}

function parseUploadPayload(input = {}, { maxBytes = DEFAULT_MAX_UPLOAD_BYTES } = {}) {
  const fileName = String(input.fileName ?? '').trim()
  if (!fileName) {
    throw createError('fileName is required', 'INVALID_UPLOAD_PAYLOAD')
  }

  const { contentTypeFromDataUrl, base64 } = extractBase64AndType(input.fileDataBase64)
  const contentType = String(input.contentType || contentTypeFromDataUrl || 'application/octet-stream')

  let buffer
  try {
    buffer = Buffer.from(base64, 'base64')
  } catch (_) {
    throw createError('fileDataBase64 is not valid base64', 'INVALID_UPLOAD_PAYLOAD')
  }

  if (!buffer.length) {
    throw createError('fileDataBase64 decoded to empty content', 'INVALID_UPLOAD_PAYLOAD')
  }

  if (buffer.length > maxBytes) {
    throw createError(`upload size exceeds ${maxBytes} bytes`, 'UPLOAD_TOO_LARGE')
  }

  const audioFormat = inferAudioFormat(fileName, contentType)

  return {
    fileName,
    contentType,
    audioFormat,
    buffer,
    sizeBytes: buffer.length,
  }
}

module.exports = {
  DEFAULT_MAX_UPLOAD_BYTES,
  parseUploadPayload,
  inferAudioFormat,
}
