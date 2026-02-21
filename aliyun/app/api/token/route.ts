const {
  createTokenRequestParams,
  parseLangMap,
  resolveAppKey,
  signParams,
  wrapTokenResponse,
} = require('../../../lib/nls-token')

const TOKEN_ENDPOINT = 'https://nls-meta.cn-shanghai.aliyuncs.com/'

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

async function handler(req: Request) {
  const {
    ALIYUN_ACCESS_KEY_ID: accessKeyId,
    ALIYUN_ACCESS_KEY_SECRET: accessKeySecret,
    ALIYUN_APP_KEY: defaultAppKey,
    ALIYUN_APP_KEYS_JSON: langMapRaw,
  } = process.env
  const lang = await readLang(req)
  const langMap = parseLangMap(langMapRaw)
  const appKey = resolveAppKey(langMap, defaultAppKey, lang)

  if (!accessKeyId || !accessKeySecret || !appKey) {
    return errorResponse('请先配置 ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET / ALIYUN_APP_KEY')
  }

  const params: Record<string, string> = createTokenRequestParams({ accessKeyId })
  params.Signature = signParams(params, accessKeySecret)

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
    cache: 'no-store',
  })
  const data = await response.json()
  const token = data?.Token?.Id
  const expireTime = data?.Token?.ExpireTime

  if (!response.ok || !token) {
    return errorResponse(`获取阿里云 Token 失败: ${data?.Message || 'unknown error'}`, 502)
  }

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
  })
}

export async function GET(req: Request) {
  return handler(req)
}

export async function POST(req: Request) {
  return handler(req)
}
