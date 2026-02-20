import express from 'express'
import cors from 'cors'
import { createHmac, randomUUID } from 'crypto'
import 'dotenv/config'

const app = express()
app.use(cors())
app.use(express.json())

// ─── Deepgram ────────────────────────────────────────────────────────────────
// 文档: https://developers.deepgram.com/docs/temporary-api-keys
app.post('/token/deepgram', async (req, res) => {
  const apiKey = process.env.DEEPGRAM_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'DEEPGRAM_API_KEY not set' })
  try {
    const r = await fetch('https://api.deepgram.com/v1/auth/grant', {
      method: 'POST',
      headers: { 'Authorization': `Token ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ time_to_live_in_seconds: 30 }),
    })
    const data = await r.json()
    res.json({ key: data.key })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── 阿里云 ───────────────────────────────────────────────────────────────────
// 文档: https://help.aliyun.com/zh/isi/developer-reference/obtain-a-token
function aliyunSign(params, secret) {
  const sorted = Object.keys(params).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&')
  const str = `POST&${encodeURIComponent('/')}&${encodeURIComponent(sorted)}`
  return createHmac('sha1', secret + '&').update(str).digest('base64')
}

app.post('/token/aliyun', async (req, res) => {
  const { ALIYUN_ACCESS_KEY_ID: id, ALIYUN_ACCESS_KEY_SECRET: secret, ALIYUN_APP_KEY: appKey } = process.env
  if (!id || !secret) return res.status(500).json({ error: 'ALIYUN_ACCESS_KEY_ID / SECRET not set' })
  try {
    const params = {
      AccessKeyId: id,
      Action: 'CreateToken',
      Format: 'JSON',
      RegionId: 'cn-shanghai',
      SignatureMethod: 'HMAC-SHA1',
      SignatureNonce: randomUUID(),
      SignatureVersion: '1.0',
      Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      Version: '2019-02-28',
    }
    params.Signature = aliyunSign(params, secret)
    const r = await fetch('https://nls-meta.cn-shanghai.aliyuncs.com/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    })
    const data = await r.json()
    res.json({ token: data.Token?.Id, expireTime: data.Token?.ExpireTime, appKey })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── 讯飞 ─────────────────────────────────────────────────────────────────────
// 文档: https://www.xfyun.cn/doc/asr/rtasr/API.html
app.post('/token/xunfei', (req, res) => {
  const { XUNFEI_APP_ID: appId, XUNFEI_API_KEY: apiKey } = process.env
  if (!appId || !apiKey) return res.status(500).json({ error: 'XUNFEI_APP_ID / API_KEY not set' })
  const ts = Math.floor(Date.now() / 1000).toString()
  const signa = createHmac('sha256', apiKey).update(appId + ts).digest('base64')
  const wsUrl = `wss://rtasr.xfyun.cn/v1/ws?appid=${appId}&ts=${ts}&signa=${encodeURIComponent(signa)}`
  res.json({ wsUrl, appId })
})

app.listen(3000, () => console.log('Token server → http://localhost:3000'))
