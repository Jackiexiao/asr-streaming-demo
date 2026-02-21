const {
  createTokenWithSdk,
  parseLangMap,
  resolveAppKey,
  resolveServerConfig,
  shouldReuseToken,
  wrapTokenResponse,
} = require('./nls-token')

const globalForTokenCache = globalThis
if (!globalForTokenCache.__ALIYUN_NLS_TOKEN_CACHE__) {
  globalForTokenCache.__ALIYUN_NLS_TOKEN_CACHE__ = new Map()
}

const defaultTokenCacheMap = globalForTokenCache.__ALIYUN_NLS_TOKEN_CACHE__

function errorResponse(message, status = 400) {
  return Response.json({ c: 1, m: message, v: '' }, { status })
}

async function readLangFromRequest(req) {
  const url = new URL(req.url)
  const langFromQuery = url.searchParams.get('lang')
  if (langFromQuery) {
    return langFromQuery
  }

  if (req.method !== 'POST') {
    return ''
  }

  try {
    const body = await req.json()
    if (body && typeof body.lang === 'string') {
      return body.lang
    }
  } catch {
    return ''
  }

  return ''
}

async function getOrCreateToken({
  appKey,
  accessKeyId,
  accessKeySecret,
  refreshAheadSeconds,
  tokenCacheMap = defaultTokenCacheMap,
  createTokenFn = createTokenWithSdk,
  nowMs = Date.now(),
}) {
  const cached = tokenCacheMap.get(appKey)
  if (cached && shouldReuseToken(cached.expireTime, nowMs, refreshAheadSeconds)) {
    return {
      token: cached.token,
      expireTime: cached.expireTime,
      source: 'cache',
    }
  }

  const created = await createTokenFn({ accessKeyId, accessKeySecret })
  tokenCacheMap.set(appKey, { token: created.token, expireTime: created.expireTime })

  return {
    token: created.token,
    expireTime: created.expireTime,
    source: 'sdk',
  }
}

async function handleTokenRequest(req, env = process.env) {
  const lang = await readLangFromRequest(req)
  const { accessKeyId, accessKeySecret, defaultAppKey, langMapRaw, refreshAheadSeconds } = resolveServerConfig(env)
  const langMap = parseLangMap(langMapRaw)
  const appKey = resolveAppKey(langMap, defaultAppKey, lang)

  if (!accessKeyId || !accessKeySecret || !appKey) {
    return errorResponse('请先配置 ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET / ALIYUN_APP_KEY')
  }

  try {
    const { token, expireTime, source } = await getOrCreateToken({
      appKey,
      accessKeyId,
      accessKeySecret,
      refreshAheadSeconds,
    })

    const payload = wrapTokenResponse({ appkey: appKey, token, expireTime })

    return Response.json({
      ...payload,
      appKey,
      token,
      expireTime,
      source,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return errorResponse(`获取阿里云 Token 失败: ${message}`, 502)
  }
}

module.exports = {
  defaultTokenCacheMap,
  errorResponse,
  getOrCreateToken,
  handleTokenRequest,
  readLangFromRequest,
}
