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
const {
  parseDemoParams,
  buildRequestConfig,
} = require('./lib/asr-config')
const {
  createFileAsrClient,
} = require('./lib/file-asr-service')
const {
  parseUploadPayload,
  DEFAULT_MAX_UPLOAD_BYTES,
} = require('./lib/file-upload-service')
const {
  createStorageClient,
} = require('./lib/object-storage')

const dev = process.env.NODE_ENV !== 'production'
const server = createServer()
const app = next({ dev, httpServer: server })
const handle = app.getRequestHandler()

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

function readJsonBody(req, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0

    req.on('data', (chunk) => {
      total += chunk.length
      if (total > maxBytes) {
        reject(Object.assign(new Error('Request body too large'), { code: 'REQUEST_TOO_LARGE' }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch (_) {
        reject(Object.assign(new Error('Request body must be valid JSON'), { code: 'INVALID_JSON' }))
      }
    })

    req.on('error', reject)
  })
}

function mapHttpError(error) {
  if (error?.code === 'INVALID_INPUT' || error?.code === 'INVALID_JSON') {
    return { statusCode: 400, message: error.message }
  }

  if (error?.code === 'REQUEST_TOO_LARGE') {
    return { statusCode: 413, message: error.message }
  }

  if (error?.code === 'VOLC_QUERY_TIMEOUT') {
    return { statusCode: 504, message: error.message }
  }

  if (error?.code === 'VOLC_QUERY_FAILED' || error?.code === 'VOLC_SUBMIT_FAILED' || error?.code === 'VOLC_BAD_RESPONSE') {
    return { statusCode: 502, message: error.message }
  }

  if (error?.code === 'MISSING_CREDENTIALS' || error?.code === 'MISSING_STORAGE_CONFIG') {
    return { statusCode: 500, message: error.message }
  }

  if (error?.code === 'INVALID_UPLOAD_PAYLOAD') {
    return { statusCode: 400, message: error.message }
  }

  if (error?.code === 'UPLOAD_TOO_LARGE') {
    return { statusCode: 413, message: error.message }
  }

  if (error?.code === 'STORAGE_UPLOAD_FAILED') {
    return { statusCode: 502, message: error.message }
  }

  return { statusCode: 500, message: error?.message || 'Internal server error' }
}

app.prepare().then(() => {
  server.on('request', async (req, res) => {
    const parsedUrl = parse(req.url, true)
    const pathname = parsedUrl.pathname

    if (req.method === 'POST' && pathname && pathname.startsWith('/api/file-asr/')) {
      try {
        const isUploadFlow = pathname === '/api/file-asr/upload-and-recognize'
        const uploadBodyLimit = Number.parseInt(process.env.FILE_ASR_UPLOAD_BODY_LIMIT_BYTES || '', 10) || (30 * 1024 * 1024)
        const body = await readJsonBody(req, isUploadFlow ? uploadBodyLimit : 2 * 1024 * 1024)
        const client = createFileAsrClient()

        if (pathname === '/api/file-asr/submit') {
          const submit = await client.submitTask(body)
          sendJson(res, 200, {
            ok: true,
            mode: 'submit',
            taskId: submit.taskId,
            normalized: submit.normalized,
            submit: {
              response: submit.response,
              meta: submit.meta,
            },
          })
          return
        }

        if (pathname === '/api/file-asr/query') {
          const taskId = body.taskId || body.id
          const query = await client.queryTask(taskId)
          sendJson(res, 200, {
            ok: true,
            mode: 'query',
            taskId: query.taskId,
            state: query.state,
            code: query.code,
            message: query.message,
            text: query.text,
            query: {
              response: query.response,
              meta: query.meta,
            },
          })
          return
        }

        if (pathname === '/api/file-asr/recognize') {
          const run = await client.runTask(body)
          sendJson(res, 200, {
            ok: true,
            mode: 'recognize',
            taskId: run.taskId,
            normalized: run.normalized,
            final: {
              state: run.final.state,
              code: run.final.code,
              message: run.final.message,
              text: run.final.text,
              meta: run.final.meta,
            },
            history: run.history,
            submit: run.submit,
          })
          return
        }

        if (pathname === '/api/file-asr/upload-and-recognize') {
          const maxUploadBytes = Number.parseInt(process.env.FILE_ASR_MAX_UPLOAD_BYTES || '', 10) || DEFAULT_MAX_UPLOAD_BYTES
          const parsedUpload = parseUploadPayload(body, { maxBytes: maxUploadBytes })
          const storageClient = createStorageClient()
          const upload = await storageClient.uploadAudioBuffer({
            buffer: parsedUpload.buffer,
            fileName: parsedUpload.fileName,
            contentType: parsedUpload.contentType,
          })

          const run = await client.runTask({
            audioUrl: upload.url,
            audioFormat: parsedUpload.audioFormat,
            enableItn: body.enableItn,
            enablePunc: body.enablePunc,
            modelName: body.modelName,
            pollIntervalMs: body.pollIntervalMs,
            timeoutMs: body.timeoutMs,
          })

          sendJson(res, 200, {
            ok: true,
            mode: 'upload-and-recognize',
            upload: {
              fileName: parsedUpload.fileName,
              sizeBytes: parsedUpload.sizeBytes,
              audioFormat: parsedUpload.audioFormat,
              contentType: parsedUpload.contentType,
              ...upload,
            },
            taskId: run.taskId,
            normalized: run.normalized,
            final: {
              state: run.final.state,
              code: run.final.code,
              message: run.final.message,
              text: run.final.text,
              meta: run.final.meta,
            },
            history: run.history,
            submit: run.submit,
          })
          return
        }

        sendJson(res, 404, { ok: false, message: 'Not found' })
        return
      } catch (error) {
        const mapped = mapHttpError(error)
        sendJson(res, mapped.statusCode, {
          ok: false,
          message: mapped.message,
          code: error?.code || 'INTERNAL_ERROR',
          details: error?.details || null,
        })
        return
      }
    }

    await handle(req, res, parsedUrl)
  })

  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    if (parse(req.url).pathname === '/api/asr-ws') {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
    }
    // Next.js handles HMR upgrades via its own listener (added via httpServer option)
  })

  wss.on('connection', (clientWs, req) => {
    console.log('[ASR] Client connected')
    const demoParams = parseDemoParams(parse(req.url, true).query)
    console.log('[ASR] Demo params:', demoParams)
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
      const config = buildRequestConfig(demoParams)
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
