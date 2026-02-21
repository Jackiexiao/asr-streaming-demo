const { randomUUID } = require('crypto')
const path = require('path')
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3')
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')

function createError(message, code) {
  const error = new Error(message)
  error.code = code
  return error
}

function parseBoolean(value, fallback) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  }
  return fallback
}

function parseIntWithBounds(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  if (parsed < min) return min
  if (parsed > max) return max
  return parsed
}

function normalizeUrl(value) {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

function readStorageConfig(env = process.env) {
  const hasTosAlias = Boolean(
    env.TOS_ACCESS_KEY ||
    env.TOS_SECRET_KEY ||
    env.TOS_BUCKET ||
    env.TOS_BUCKET_NAME ||
    env.TOS_S3_ENDPOINT ||
    env.TOS_ENDPOINT,
  )

  const provider = String(env.OBJECT_STORAGE_PROVIDER || (hasTosAlias ? 'tos' : 's3')).trim().toLowerCase()
  const bucket = String(env.OBJECT_STORAGE_BUCKET || env.TOS_BUCKET || env.TOS_BUCKET_NAME || '').trim()
  const accessKeyId = String(env.OBJECT_STORAGE_ACCESS_KEY_ID || env.TOS_ACCESS_KEY || env.AWS_ACCESS_KEY_ID || '').trim()
  const secretAccessKey = String(env.OBJECT_STORAGE_SECRET_ACCESS_KEY || env.TOS_SECRET_KEY || env.AWS_SECRET_ACCESS_KEY || '').trim()
  const region = String(
    env.OBJECT_STORAGE_REGION ||
    env.TOS_REGION ||
    (provider === 'tos' ? 'cn-shanghai' : 'auto'),
  ).trim()

  if (!bucket) throw createError('Missing OBJECT_STORAGE_BUCKET (or TOS_BUCKET)', 'MISSING_STORAGE_CONFIG')
  if (!accessKeyId) throw createError('Missing OBJECT_STORAGE_ACCESS_KEY_ID (or TOS_ACCESS_KEY)', 'MISSING_STORAGE_CONFIG')
  if (!secretAccessKey) throw createError('Missing OBJECT_STORAGE_SECRET_ACCESS_KEY (or TOS_SECRET_KEY)', 'MISSING_STORAGE_CONFIG')

  const defaultTosEndpoint = provider === 'tos' ? `https://tos-s3-${region}.volces.com` : ''
  const endpoint = normalizeUrl(env.OBJECT_STORAGE_ENDPOINT || env.TOS_S3_ENDPOINT || env.TOS_ENDPOINT || defaultTosEndpoint)
  const defaultTosPublicBaseUrl = provider === 'tos' ? `https://${bucket}.tos-${region}.volces.com` : ''
  const publicBaseUrl = normalizeUrl(env.OBJECT_STORAGE_PUBLIC_BASE_URL || env.TOS_PUBLIC_BASE_URL || defaultTosPublicBaseUrl)

  return {
    provider,
    bucket,
    region,
    endpoint,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl,
    keyPrefix: String(env.OBJECT_STORAGE_KEY_PREFIX || env.TOS_OBJECT_KEY_PREFIX || 'volcengine-file-asr').trim(),
    forcePathStyle: parseBoolean(env.OBJECT_STORAGE_FORCE_PATH_STYLE ?? env.TOS_FORCE_PATH_STYLE, false),
    signedUrlTtlSec: parseIntWithBounds(env.OBJECT_STORAGE_SIGNED_URL_TTL_SEC ?? env.TOS_SIGNED_URL_TTL_SEC, 3600, 60, 86400),
  }
}

function buildObjectKey({ prefix, fileName }, timestampFactory = null) {
  const safePrefix = String(prefix || 'volcengine-file-asr').replace(/^\/+|\/+$/g, '')
  const ext = path.extname(fileName || '').toLowerCase()
  const baseName = (path.basename(fileName || '', ext) || 'audio')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || 'audio'

  const timestamp = typeof timestampFactory === 'function'
    ? String(timestampFactory())
    : new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)

  const normalizedExt = ext && ext.length <= 8 ? ext : '.wav'
  return `${safePrefix}/${timestamp}/${baseName}-${randomUUID()}${normalizedExt}`
}

function buildPublicUrl(publicBaseUrl, objectKey) {
  const normalized = publicBaseUrl.replace(/\/+$/g, '')
  const encodedKey = objectKey
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `${normalized}/${encodedKey}`
}

function createStorageClient({ env = process.env, s3ClientFactory = null } = {}) {
  const config = readStorageConfig(env)

  const client = typeof s3ClientFactory === 'function'
    ? s3ClientFactory(config)
    : new S3Client({
        region: config.region,
        endpoint: config.endpoint || undefined,
        forcePathStyle: config.forcePathStyle,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      })

  async function uploadAudioBuffer({ buffer, fileName, contentType }) {
    if (!Buffer.isBuffer(buffer) || !buffer.length) {
      throw createError('buffer must be a non-empty Buffer', 'INVALID_UPLOAD_PAYLOAD')
    }

    const key = buildObjectKey({ prefix: config.keyPrefix, fileName })
    try {
      await client.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType || 'application/octet-stream',
      }))
    } catch (error) {
      const wrapped = createError('Failed to upload file to object storage', 'STORAGE_UPLOAD_FAILED')
      wrapped.details = { message: error?.message }
      throw wrapped
    }

    if (config.publicBaseUrl) {
      return {
        provider: config.provider,
        bucket: config.bucket,
        key,
        url: buildPublicUrl(config.publicBaseUrl, key),
        isSignedUrl: false,
      }
    }

    const signedUrl = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: config.bucket, Key: key }),
      { expiresIn: config.signedUrlTtlSec },
    )

    return {
      provider: config.provider,
      bucket: config.bucket,
      key,
      url: signedUrl,
      isSignedUrl: true,
      expiresInSec: config.signedUrlTtlSec,
    }
  }

  return {
    config,
    uploadAudioBuffer,
  }
}

module.exports = {
  readStorageConfig,
  buildObjectKey,
  buildPublicUrl,
  createStorageClient,
}
