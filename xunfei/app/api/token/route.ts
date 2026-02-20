import { createHmac } from 'crypto'

export async function POST() {
  const { XUNFEI_APP_ID: appId, XUNFEI_API_KEY: apiKey } = process.env
  const ts = Math.floor(Date.now() / 1000).toString()
  const signa = createHmac('sha256', apiKey!).update(appId! + ts).digest('base64')
  const wsUrl = `wss://rtasr.xfyun.cn/v1/ws?appid=${appId}&ts=${ts}&signa=${encodeURIComponent(signa)}`
  return Response.json({ wsUrl })
}
