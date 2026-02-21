const test = require('node:test')
const assert = require('node:assert/strict')

const {
  getOrCreateToken,
  readLangFromRequest,
} = require('../lib/server/token-handler.js')

test('readLangFromRequest reads lang from query first', async () => {
  const req = new Request('https://example.com/api/token?lang=%E8%8B%B1%E8%AF%AD')
  const lang = await readLangFromRequest(req)
  assert.equal(lang, '英语')
})

test('readLangFromRequest reads lang from POST body', async () => {
  const req = new Request('https://example.com/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lang: '粤语' }),
  })

  const lang = await readLangFromRequest(req)
  assert.equal(lang, '粤语')
})

test('getOrCreateToken reuses cached token when still valid', async () => {
  const tokenCacheMap = new Map([
    ['app-1', { token: 'token-cached', expireTime: Math.floor((Date.now() + 3 * 60 * 60 * 1000) / 1000) }],
  ])
  let calls = 0

  const result = await getOrCreateToken({
    appKey: 'app-1',
    accessKeyId: 'ak',
    accessKeySecret: 'sk',
    refreshAheadSeconds: 7200,
    tokenCacheMap,
    createTokenFn: async () => {
      calls += 1
      return { token: 'token-new', expireTime: 99999999 }
    },
  })

  assert.equal(calls, 0)
  assert.deepEqual(result, {
    token: 'token-cached',
    expireTime: tokenCacheMap.get('app-1').expireTime,
    source: 'cache',
  })
})

test('getOrCreateToken refreshes token when cached one is close to expire', async () => {
  const tokenCacheMap = new Map([
    ['app-1', { token: 'token-cached', expireTime: Math.floor((Date.now() + 30 * 60 * 1000) / 1000) }],
  ])

  const result = await getOrCreateToken({
    appKey: 'app-1',
    accessKeyId: 'ak',
    accessKeySecret: 'sk',
    refreshAheadSeconds: 7200,
    tokenCacheMap,
    createTokenFn: async () => ({ token: 'token-new', expireTime: 1771649104 }),
  })

  assert.deepEqual(result, {
    token: 'token-new',
    expireTime: 1771649104,
    source: 'sdk',
  })
  assert.deepEqual(tokenCacheMap.get('app-1'), {
    token: 'token-new',
    expireTime: 1771649104,
  })
})
