const http = require('node:http')
const { parse } = require('node:url')

const next = require('next')
require('dotenv').config({ path: '.env.local' })
const { WebSocketServer, WebSocket } = require('ws')

const {
  buildAsyncSubmitRequest,
  buildSyncChatRequest,
  extractAsyncStatus,
  extractAsyncTaskId,
  extractAsyncTextFromResult,
  extractSyncTranscript,
  isAsyncTaskTerminal,
  normalizeFileInput,
} = require('./lib/file-asr')

const dev = process.env.NODE_ENV !== 'production'
const hostname = process.env.HOST || 'localhost'
const port = Number(process.env.PORT || 3000)

const DEFAULT_REALTIME_MODEL = 'qwen3-asr-flash-realtime-2026-02-10'
const DASHSCOPE_HTTP_BASE_URL = 'https://dashscope.aliyuncs.com'

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function asText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function createError(message, code, extra = {}) {
  const error = new Error(message)
  error.code = code
  Object.assign(error, extra)
  return error
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

function readJsonBody(req, maxBytes = 35 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0

    req.on('data', (chunk) => {
      total += chunk.length
      if (total > maxBytes) {
        reject(createError('Request body too large', 'REQUEST_TOO_LARGE'))
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
      } catch {
        reject(createError('Request body must be valid JSON', 'INVALID_JSON'))
      }
    })

    req.on('error', reject)
  })
}

function mapHttpError(error) {
  if (!error) {
    return { statusCode: 500, message: 'Internal server error', code: 'INTERNAL_ERROR' }
  }

  if (error.code === 'INVALID_INPUT' || error.code === 'INVALID_JSON') {
    return { statusCode: 400, message: error.message, code: error.code }
  }

  if (error.code === 'REQUEST_TOO_LARGE') {
    return { statusCode: 413, message: error.message, code: error.code }
  }

  if (error.code === 'ASYNC_TIMEOUT') {
    return { statusCode: 504, message: error.message, code: error.code }
  }

  if (error.code === 'DASHSCOPE_AUTH_MISSING') {
    return { statusCode: 500, message: error.message, code: error.code }
  }

  if (error.code === 'DASHSCOPE_UPSTREAM') {
    const upstreamStatus = Number(error.status || 502)
    const statusCode = upstreamStatus >= 500 ? 502 : upstreamStatus
    return {
      statusCode,
      message: error.message,
      code: error.code,
      details: error.details || null,
    }
  }

  return {
    statusCode: 500,
    message: error.message || 'Internal server error',
    code: error.code || 'INTERNAL_ERROR',
  }
}

function normalizeCloseCode(code, fallback = 1011) {
  if (!Number.isInteger(code)) return fallback
  if (code < 1000 || code > 4999) return fallback
  if ([1004, 1005, 1006, 1015].includes(code)) return fallback
  return code
}

async function dashscopeJsonRequest(pathname, options = {}) {
  const apiKey = process.env.DASHSCOPE_API_KEY
  if (!apiKey) {
    throw createError('服务端未配置 DASHSCOPE_API_KEY', 'DASHSCOPE_AUTH_MISSING')
  }

  const url = pathname.startsWith('http') ? pathname : `${DASHSCOPE_HTTP_BASE_URL}${pathname}`
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    ...options.headers,
  }

  if (options.jsonBody !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  const response = await fetch(url, {
    method: options.method || (options.jsonBody === undefined ? 'GET' : 'POST'),
    headers,
    body: options.jsonBody === undefined ? undefined : JSON.stringify(options.jsonBody),
  })

  const text = await response.text()
  let json = null

  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }

  if (!response.ok) {
    const message =
      asText(json?.message) ||
      asText(json?.error?.message) ||
      asText(text) ||
      `DashScope 请求失败（HTTP ${response.status}）`

    throw createError(message, 'DASHSCOPE_UPSTREAM', {
      status: response.status,
      details: {
        url,
        status: response.status,
        body: json || text,
      },
    })
  }

  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    text,
    json,
  }
}

async function fetchTranscriptionResult(url) {
  const response = await fetch(url)
  const text = await response.text()
  let json = null

  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }

  if (!response.ok) {
    throw createError(`下载转写结果失败（HTTP ${response.status}）`, 'DASHSCOPE_UPSTREAM', {
      status: response.status,
      details: {
        url,
        status: response.status,
        body: json || text,
      },
    })
  }

  return { json, text }
}

function extractTaskMessage(taskPayload) {
  return (
    asText(taskPayload?.output?.message) ||
    asText(taskPayload?.output?.error_message) ||
    asText(taskPayload?.message)
  )
}

function extractTaskResultUrl(taskPayload) {
  const results = Array.isArray(taskPayload?.output?.task_results)
    ? taskPayload.output.task_results
    : []

  if (!results.length) {
    return ''
  }

  return (
    asText(results[0]?.transcription_url) ||
    asText(results[0]?.url) ||
    asText(results[0]?.result_url)
  )
}

async function queryAsyncTask(taskId) {
  const taskResp = await dashscopeJsonRequest(`/api/v1/tasks/${encodeURIComponent(taskId)}`, {
    method: 'GET',
  })

  const taskPayload = taskResp.json || {}
  const status = extractAsyncStatus(taskPayload) || 'UNKNOWN'
  const message = extractTaskMessage(taskPayload)
  const transcriptionUrl = extractTaskResultUrl(taskPayload)

  let resultPayload = null
  let text = ''

  if (status.toUpperCase() === 'SUCCEEDED' && transcriptionUrl) {
    const result = await fetchTranscriptionResult(transcriptionUrl)
    resultPayload = result.json || result.text
    if (result.json) {
      text = extractAsyncTextFromResult(result.json)
    }
  }

  if (!text) {
    text = extractAsyncTextFromResult(taskPayload?.output || taskPayload)
  }

  return {
    status,
    message,
    taskPayload,
    transcriptionUrl,
    resultPayload,
    text,
  }
}

function buildRealtimeUpstreamUrl(req) {
  const requestUrl = new URL(req.url || '/api/realtime-ws', `http://${req.headers.host || `${hostname}:${port}`}`)
  const requestedModel = asText(requestUrl.searchParams.get('model')) || DEFAULT_REALTIME_MODEL

  return {
    model: requestedModel,
    url: `wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=${encodeURIComponent(requestedModel)}`,
  }
}

function sendWsError(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'error', message }))
  }
}

app
  .prepare()
  .then(() => {
    const server = http.createServer(async (req, res) => {
      const parsedUrl = parse(req.url || '', true)
      const pathname = parsedUrl.pathname || ''

      if (req.method === 'POST' && pathname.startsWith('/api/file-asr/')) {
        try {
          const body = await readJsonBody(req)

          if (pathname === '/api/file-asr/sync') {
            const normalized = normalizeFileInput({ ...body, mode: 'sync' })
            const requestBody = buildSyncChatRequest({
              audioSource: normalized.audioSource,
              language: normalized.language,
              enableItn: normalized.enableItn,
              corpusText: normalized.corpusText,
              model: normalized.syncModel,
            })

            const syncResp = await dashscopeJsonRequest('/compatible-mode/v1/chat/completions', {
              method: 'POST',
              jsonBody: requestBody,
            })

            sendJson(res, 200, {
              ok: true,
              mode: 'sync',
              model: normalized.syncModel,
              text: extractSyncTranscript(syncResp.json || {}),
              response: syncResp.json,
            })
            return
          }

          if (pathname === '/api/file-asr/submit') {
            const normalized = normalizeFileInput({ ...body, mode: 'async' })
            const requestBody = buildAsyncSubmitRequest({
              audioUrl: normalized.audioUrl,
              language: normalized.language,
              enableItn: normalized.enableItn,
              corpusText: normalized.corpusText,
              model: normalized.asyncModel,
            })

            const submitResp = await dashscopeJsonRequest('/api/v1/services/audio/asr/transcription', {
              method: 'POST',
              headers: {
                'X-DashScope-Async': 'enable',
              },
              jsonBody: requestBody,
            })

            const taskId = extractAsyncTaskId(submitResp.json)
            if (!taskId) {
              throw createError('未从异步提交结果中拿到 taskId', 'DASHSCOPE_UPSTREAM', {
                status: 502,
                details: { submit: submitResp.json },
              })
            }

            sendJson(res, 200, {
              ok: true,
              mode: 'submit',
              model: normalized.asyncModel,
              taskId,
              response: submitResp.json,
            })
            return
          }

          if (pathname === '/api/file-asr/query') {
            const taskId = asText(body.taskId || body.task_id)
            if (!taskId) {
              throw createError('taskId is required', 'INVALID_INPUT')
            }

            const query = await queryAsyncTask(taskId)
            sendJson(res, 200, {
              ok: true,
              mode: 'query',
              taskId,
              status: query.status,
              message: query.message,
              text: query.text,
              transcriptionUrl: query.transcriptionUrl,
              response: query.taskPayload,
              result: query.resultPayload,
            })
            return
          }

          if (pathname === '/api/file-asr/recognize') {
            const startedAt = Date.now()
            const normalized = normalizeFileInput({ ...body, mode: 'async' })
            const requestBody = buildAsyncSubmitRequest({
              audioUrl: normalized.audioUrl,
              language: normalized.language,
              enableItn: normalized.enableItn,
              corpusText: normalized.corpusText,
              model: normalized.asyncModel,
            })

            const submitResp = await dashscopeJsonRequest('/api/v1/services/audio/asr/transcription', {
              method: 'POST',
              headers: {
                'X-DashScope-Async': 'enable',
              },
              jsonBody: requestBody,
            })

            const taskId = extractAsyncTaskId(submitResp.json)
            if (!taskId) {
              throw createError('未从异步提交结果中拿到 taskId', 'DASHSCOPE_UPSTREAM', {
                status: 502,
                details: { submit: submitResp.json },
              })
            }

            const pollIntervalMs = Math.max(300, normalized.pollIntervalMs)
            const timeoutMs = Math.max(2_000, normalized.timeoutMs)
            const history = []
            let finalQuery = null

            while (Date.now() - startedAt < timeoutMs) {
              const query = await queryAsyncTask(taskId)

              history.push({
                at: new Date().toISOString(),
                status: query.status,
                message: query.message,
                text: query.text,
              })

              if (isAsyncTaskTerminal(query.status)) {
                finalQuery = query
                break
              }

              await sleep(pollIntervalMs)
            }

            if (!finalQuery) {
              throw createError('异步识别轮询超时，请稍后用 taskId 查询', 'ASYNC_TIMEOUT', {
                details: {
                  taskId,
                  timeoutMs,
                  history,
                },
              })
            }

            const finishedAt = Date.now()

            sendJson(res, 200, {
              ok: true,
              mode: 'recognize',
              model: normalized.asyncModel,
              taskId,
              status: finalQuery.status,
              message: finalQuery.message,
              text: finalQuery.text,
              transcriptionUrl: finalQuery.transcriptionUrl,
              submit: submitResp.json,
              response: finalQuery.taskPayload,
              result: finalQuery.resultPayload,
              history,
              timings: {
                totalMs: finishedAt - startedAt,
              },
            })
            return
          }

          sendJson(res, 404, { ok: false, message: 'Not found' })
          return
        } catch (error) {
          const mapped = mapHttpError(error)
          sendJson(res, mapped.statusCode, {
            ok: false,
            code: mapped.code,
            message: mapped.message,
            details: mapped.details || error?.details || null,
          })
          return
        }
      }

      await handle(req, res, parsedUrl)
    })

    const wss = new WebSocketServer({ noServer: true })

    server.on('upgrade', (req, socket, head) => {
      const requestUrl = new URL(req.url || '/', `http://${req.headers.host || `${hostname}:${port}`}`)
      if (requestUrl.pathname !== '/api/realtime-ws') {
        socket.destroy()
        return
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req)
      })
    })

    wss.on('connection', (clientWs, req) => {
      const apiKey = process.env.DASHSCOPE_API_KEY

      if (!apiKey) {
        sendWsError(clientWs, '服务端未配置 DASHSCOPE_API_KEY')
        clientWs.close(1011)
        return
      }

      const upstreamConfig = buildRealtimeUpstreamUrl(req)
      const upstreamWs = new WebSocket(upstreamConfig.url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      })

      upstreamWs.on('open', () => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({
            type: 'connected',
            model: upstreamConfig.model,
          }))
        }
      })

      upstreamWs.on('message', (payload, isBinary) => {
        if (clientWs.readyState !== WebSocket.OPEN) {
          return
        }

        if (isBinary || Buffer.isBuffer(payload)) {
          clientWs.send(payload, { binary: true })
          return
        }

        clientWs.send(payload.toString())
      })

      upstreamWs.on('unexpected-response', (_request, response) => {
        let body = ''
        response.on('data', (chunk) => {
          body += chunk.toString()
        })
        response.on('end', () => {
          sendWsError(clientWs, `DashScope 握手失败（HTTP ${response.statusCode || 400}）：${body || 'unknown error'}`)
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.close(1011)
          }
        })
      })

      upstreamWs.on('error', (error) => {
        sendWsError(clientWs, error?.message || 'DashScope 连接失败')
      })

      upstreamWs.on('close', (code, reason) => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.close(normalizeCloseCode(code), reason ? reason.toString().slice(0, 80) : undefined)
        }
      })

      clientWs.on('message', (payload, isBinary) => {
        if (upstreamWs.readyState !== WebSocket.OPEN) {
          return
        }

        if (isBinary || Buffer.isBuffer(payload)) {
          const event = {
            event_id: `event_${Date.now()}`,
            type: 'input_audio_buffer.append',
            audio: Buffer.from(payload).toString('base64'),
          }
          upstreamWs.send(JSON.stringify(event))
          return
        }

        const raw = payload.toString()
        let parsed = null
        try {
          parsed = JSON.parse(raw)
        } catch {
          sendWsError(clientWs, '客户端消息不是合法 JSON')
          return
        }

        if (parsed?.type === 'end') {
          upstreamWs.send(JSON.stringify({
            event_id: `event_${Date.now()}`,
            type: 'input_audio_buffer.commit',
          }))
          return
        }

        upstreamWs.send(JSON.stringify(parsed))
      })

      clientWs.on('close', () => {
        if (upstreamWs.readyState === WebSocket.OPEN || upstreamWs.readyState === WebSocket.CONNECTING) {
          upstreamWs.close()
        }
      })

      clientWs.on('error', () => {
        if (upstreamWs.readyState === WebSocket.OPEN || upstreamWs.readyState === WebSocket.CONNECTING) {
          upstreamWs.close()
        }
      })
    })

    server.listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`)
    })
  })
  .catch((error) => {
    console.error('Failed to start server:', error)
    process.exit(1)
  })
