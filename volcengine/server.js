const { createServer } = require('http')
const { parse } = require('url')
const next = require('next')
const { WebSocketServer, WebSocket } = require('ws')
const crypto = require('crypto')

const dev = process.env.NODE_ENV !== 'production'
const server = createServer()
const app = next({ dev, httpServer: server })
const handle = app.getRequestHandler()

function buildMsg(type, payload, serialization) {
  const header = Buffer.from([0x11, type, serialization, 0x00])
  const size = Buffer.alloc(4)
  size.writeUInt32BE(payload.length)
  return Buffer.concat([header, size, payload])
}

app.prepare().then(() => {
  server.on('request', async (req, res) => {
    await handle(req, res, parse(req.url, true))
  })

  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    if (parse(req.url).pathname === '/api/asr-ws') {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws))
    }
    // Next.js handles HMR upgrades via its own listener (added via httpServer option)
  })

  wss.on('connection', (clientWs) => {
    console.log('[ASR] Client connected')
    const volcWs = new WebSocket('wss://openspeech.bytedance.com/api/v3/sauc/bigmodel', {
      headers: {
        'X-Api-App-Key': process.env.VOLCENGINE_APP_ID,
        'X-Api-Access-Key': process.env.VOLCENGINE_ACCESS_TOKEN,
        'X-Api-Resource-Id': process.env.VOLCENGINE_RESOURCE_ID || 'volc.bigasr.sauc.duration',
        'X-Api-Connect-Id': crypto.randomUUID(),
      },
    })

    volcWs.on('open', () => {
      console.log('[Volcengine] Connected, sending config')
      const config = {
        audio: { format: 'pcm', rate: 16000, bits: 16, channel: 1 },
        request: { model_name: 'bigmodel', enable_itn: true, enable_punc: true },
      }
      volcWs.send(buildMsg(0x10, Buffer.from(JSON.stringify(config)), 0x10))
      clientWs.send(JSON.stringify({ type: 'connected' }))
    })

    clientWs.on('message', (data, isBinary) => {
      if (!isBinary) {
        try {
          if (JSON.parse(data).type === 'end') {
            console.log('[ASR] Sending last audio packet')
            volcWs.send(buildMsg(0x22, Buffer.alloc(0), 0x00))
          }
        } catch (e) { console.error('[ASR] Control msg error:', e.message) }
        return
      }
      if (volcWs.readyState === WebSocket.OPEN) {
        volcWs.send(buildMsg(0x20, Buffer.from(data), 0x00))
      }
    })

    volcWs.on('message', (data) => {
      try {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
        console.log('[Volcengine] Response header:', buf.slice(0, 4).toString('hex'))
        const headerSize = (buf[0] & 0x0f) * 4
        const payloadSize = buf.readUInt32BE(headerSize)
        const payload = buf.slice(headerSize + 4, headerSize + 4 + payloadSize)
        const json = JSON.parse(payload.toString())
        console.log('[Volcengine] Result:', JSON.stringify(json))
        clientWs.send(JSON.stringify({ type: 'result', data: json }))
      } catch (e) {
        console.error('[Volcengine] Parse error:', e.message, 'raw:', Buffer.isBuffer(data) ? data.slice(0, 20).toString('hex') : data)
      }
    })

    volcWs.on('error', (err) => {
      console.error('[Volcengine] Error:', err.message)
      clientWs.send(JSON.stringify({ type: 'error', message: err.message }))
    })

    volcWs.on('close', (code, reason) => {
      console.log('[Volcengine] Closed:', code, reason.toString())
      clientWs.readyState === WebSocket.OPEN && clientWs.close()
    })

    clientWs.on('close', () => {
      console.log('[ASR] Client disconnected')
      volcWs.readyState === WebSocket.OPEN && volcWs.close()
    })
  })

  server.listen(3000, () => console.log('> Ready on http://localhost:3000'))
})
