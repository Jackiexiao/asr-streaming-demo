const test = require('node:test')
const assert = require('node:assert/strict')

const {
  readStorageConfig,
  buildObjectKey,
} = require('../lib/object-storage')

test('readStorageConfig validates required env vars', () => {
  assert.throws(() => readStorageConfig({}), /OBJECT_STORAGE_BUCKET/)
})

test('buildObjectKey keeps file extension and prefix', () => {
  const key = buildObjectKey({ prefix: 'volc/asr', fileName: 'speech-demo.webm' }, () => '20260221T030000')
  assert.match(key, /^volc\/asr\/20260221T030000\/speech-demo-[a-f0-9-]+\.webm$/)
})

test('readStorageConfig supports TOS env aliases and normalizes endpoint', () => {
  const config = readStorageConfig({
    TOS_ACCESS_KEY: 'ak-demo',
    TOS_SECRET_KEY: 'sk-demo',
    TOS_BUCKET: '01mvp-public',
    TOS_REGION: 'cn-shanghai',
    TOS_S3_ENDPOINT: 'tos-s3-cn-shanghai.volces.com',
  })

  assert.equal(config.bucket, '01mvp-public')
  assert.equal(config.accessKeyId, 'ak-demo')
  assert.equal(config.secretAccessKey, 'sk-demo')
  assert.equal(config.endpoint, 'https://tos-s3-cn-shanghai.volces.com')
  assert.equal(config.publicBaseUrl, 'https://01mvp-public.tos-cn-shanghai.volces.com')
})
