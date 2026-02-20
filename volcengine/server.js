const { createServer } = require('http')
const { parse } = require('url')
const next = require('next')
const { WebSocketServer, WebSocket } = require('ws')
const crypto = require('crypto')
const {
  MESSAGE_TYPES,
  buildClientMessage,
  parseServerMessage,
} = require('./lib/volc-protocol')

const dev = process.env.NODE_ENV !== 'production'
const server = createServer()
const app = next({ dev, httpServer: server })
const handle = app.getRequestHandler()

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
    const appId = process.env.VOLCENGINE_APP_ID
    const accessToken = process.env.VOLCENGINE_ACCESS_TOKEN
    if (!appId || !accessToken) {
      clientWs.send(JSON.stringify({ type: 'error', message: 'Missing VOLCENGINE_APP_ID or VOLCENGINE_ACCESS_TOKEN' }))
      clientWs.close()
      return
    }

    const volcWs = new WebSocket('wss://openspeech.bytedance.com/api/v3/sauc/bigmodel', {
      headers: {
        'X-Api-App-Key': appId,
        'X-Api-Access-Key': accessToken,
        'X-Api-Resource-Id': process.env.VOLCENGINE_RESOURCE_ID || 'volc.bigasr.sauc.duration',
        'X-Api-Connect-Id': crypto.randomUUID(),
      },
    })

    volcWs.on('open', () => {
      console.log('[Volcengine] Connected, sending config')
      const config = {
        audio: { format: 'pcm', rate: 16000, bits: 16, channel: 1 },
        request: { model_name: 'bigmodel', enable_itn: true, enable_punc: true, show_utterances: true },
      }
      volcWs.send(buildClientMessage({
        messageType: MESSAGE_TYPES.FULL_CLIENT_REQUEST,
        messageFlags: 0x0,
        serialization: 0x1,
        compression: 0x0,
        payload: Buffer.from(JSON.stringify(config)),
      }))
      clientWs.send(JSON.stringify({ type: 'connected' }))
    })

    clientWs.on('message', (data, isBinary) => {
      if (!isBinary) {
        try {
          if (JSON.parse(data).type === 'end') {
            console.log('[ASR] Sending last audio packet')
            volcWs.send(buildClientMessage({
              messageType: MESSAGE_TYPES.AUDIO_ONLY_CLIENT_REQUEST,
              messageFlags: 0x2,
              serialization: 0x0,
              compression: 0x0,
              payload: Buffer.alloc(0),
            }))
          }
        } catch (e) { console.error('[ASR] Control msg error:', e.message) }
        return
      }
      if (volcWs.readyState === WebSocket.OPEN) {
        volcWs.send(buildClientMessage({
          messageType: MESSAGE_TYPES.AUDIO_ONLY_CLIENT_REQUEST,
          messageFlags: 0x0,
          serialization: 0x0,
          compression: 0x0,
          payload: Buffer.from(data),
        }))
      }
    })

    volcWs.on('message', (data) => {
      try {
        const parsed = parseServerMessage(data)

        if (parsed.messageType === MESSAGE_TYPES.SERVER_ERROR_RESPONSE) {
          console.error('[Volcengine] Server error:', parsed.errorCode, parsed.errorMessage)
          clientWs.send(JSON.stringify({
            type: 'error',
            message: parsed.errorMessage || `ASR error: ${parsed.errorCode}`,
          }))
          return
        }

        clientWs.send(JSON.stringify({ type: 'result', data: parsed.json ?? {} }))
      } catch (e) {
        console.error('[Volcengine] Parse error:', e.message)
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
