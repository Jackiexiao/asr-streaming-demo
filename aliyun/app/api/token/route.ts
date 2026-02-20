import { createHmac, randomUUID } from 'crypto'

function sign(params: Record<string, string>, secret: string) {
  const sorted = Object.keys(params).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&')
  const str = `POST&${encodeURIComponent('/')}&${encodeURIComponent(sorted)}`
  return createHmac('sha1', secret + '&').update(str).digest('base64')
}

export async function POST() {
  const { ALIYUN_ACCESS_KEY_ID: id, ALIYUN_ACCESS_KEY_SECRET: secret, ALIYUN_APP_KEY: appKey } = process.env
  const params: Record<string, string> = {
    AccessKeyId: id!,
    Action: 'CreateToken',
    Format: 'JSON',
    RegionId: 'cn-shanghai',
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: randomUUID(),
    SignatureVersion: '1.0',
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    Version: '2019-02-28',
  }
  params.Signature = sign(params, secret!)
  const r = await fetch('https://nls-meta.cn-shanghai.aliyuncs.com/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  })
  const data = await r.json()
  return Response.json({ token: data.Token?.Id, expireTime: data.Token?.ExpireTime, appKey })
}
