const {
  createTokenWithSdk,
  parseLangMap,
  resolveAppKey,
  resolveServerConfig,
  shouldReuseToken,
  wrapTokenResponse,
} = require('../../../lib/nls-token')

const globalForTokenCache = globalThis as typeof globalThis & {
  __ALIYUN_NLS_TOKEN_CACHE__?: Map<string, { token: string; expireTime: number }>
}

if (!globalForTokenCache.__ALIYUN_NLS_TOKEN_CACHE__) {
  globalForTokenCache.__ALIYUN_NLS_TOKEN_CACHE__ = new Map()
}

const tokenCache = globalForTokenCache.__ALIYUN_NLS_TOKEN_CACHE__

function errorResponse(message: string, status = 400) {
  return Response.json({ c: 1, m: message, v: '' }, { status })
}

async function readLang(req: Request) {
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

async function getOrCreateToken(appKey: string, accessKeyId: string, accessKeySecret: string, refreshAheadSeconds: number) {
  const cached = tokenCache.get(appKey)
  if (cached && shouldReuseToken(cached.expireTime, Date.now(), refreshAheadSeconds)) {
    return {
      token: cached.token,
      expireTime: cached.expireTime,
      source: 'cache',
    }
  }

  const created = await createTokenWithSdk({ accessKeyId, accessKeySecret })
  tokenCache.set(appKey, { token: created.token, expireTime: created.expireTime })

  return {
    token: created.token,
    expireTime: created.expireTime,
    source: 'sdk',
  }
}

async function handler(req: Request) {
  const lang = await readLang(req)
  const { accessKeyId, accessKeySecret, defaultAppKey, langMapRaw, refreshAheadSeconds } = resolveServerConfig(process.env)
  const langMap = parseLangMap(langMapRaw)
  const appKey = resolveAppKey(langMap, defaultAppKey, lang)

  if (!accessKeyId || !accessKeySecret || !appKey) {
    return errorResponse('请先配置 ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET / ALIYUN_APP_KEY')
  }

  try {
    const { token, expireTime, source } = await getOrCreateToken(appKey, accessKeyId, accessKeySecret, refreshAheadSeconds)
    const payload = wrapTokenResponse({
      appkey: appKey,
      token,
      expireTime,
    })

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

export async function GET(req: Request) {
  return handler(req)
}

export async function POST(req: Request) {
  return handler(req)
}
