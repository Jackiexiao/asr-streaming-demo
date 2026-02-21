const crypto = require('crypto')

const FILE_TASK_STATES = {
  DONE: 'done',
  PROCESSING: 'processing',
  FAILED: 'failed',
}

const FILE_TASK_CODES = {
  DONE: 20000000,
  PROCESSING: 20000001,
}

const DEFAULT_FILE_DEMO_INPUT = {
  enableItn: true,
  enablePunc: true,
  modelName: 'bigmodel',
  pollIntervalMs: 1000,
  timeoutMs: 20000,
}

const FILE_API_BASE = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel'

function parseBoolean(value, fallback) {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  }
  return fallback
}

function parseBoundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  if (parsed < min) return min
  if (parsed > max) return max
  return parsed
}

function inferAudioFormatFromUrl(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase()
    const lastSegment = pathname.split('/').filter(Boolean).pop() || ''
    const ext = lastSegment.includes('.') ? lastSegment.split('.').pop() : ''
    const allowed = new Set(['wav', 'mp3', 'ogg', 'm4a', 'aac', 'flac', 'amr', 'webm'])
    if (ext && allowed.has(ext)) {
      return ext
    }
  } catch (_) {
    // ignore parse failures and return default below
  }
  return 'wav'
}

function normalizeAudioUrl(audioUrl) {
  const normalized = String(audioUrl ?? '').trim()
  if (!normalized) {
    const err = new Error('audioUrl is required')
    err.code = 'INVALID_INPUT'
    throw err
  }

  let url
  try {
    url = new URL(normalized)
  } catch (_) {
    const err = new Error('audioUrl must be a valid URL')
    err.code = 'INVALID_INPUT'
    throw err
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    const err = new Error('audioUrl must start with http:// or https://')
    err.code = 'INVALID_INPUT'
    throw err
  }

  return url.toString()
}

function normalizeFileDemoInput(input = {}) {
  const audioUrl = normalizeAudioUrl(input.audioUrl)
  const providedFormat = String(input.audioFormat ?? '').trim().toLowerCase()

  return {
    audioUrl,
    audioFormat: providedFormat || inferAudioFormatFromUrl(audioUrl),
    enableItn: parseBoolean(input.enableItn, DEFAULT_FILE_DEMO_INPUT.enableItn),
    enablePunc: parseBoolean(input.enablePunc, DEFAULT_FILE_DEMO_INPUT.enablePunc),
    modelName: String(input.modelName ?? DEFAULT_FILE_DEMO_INPUT.modelName).trim() || DEFAULT_FILE_DEMO_INPUT.modelName,
    pollIntervalMs: parseBoundedInt(input.pollIntervalMs, DEFAULT_FILE_DEMO_INPUT.pollIntervalMs, 300, 5000),
    timeoutMs: parseBoundedInt(input.timeoutMs, DEFAULT_FILE_DEMO_INPUT.timeoutMs, 3000, 120000),
  }
}

function buildFileSubmitPayload(normalizedInput) {
  return {
    user: { uid: 'demo-user' },
    audio: {
      url: normalizedInput.audioUrl,
      format: normalizedInput.audioFormat,
    },
    request: {
      model_name: normalizedInput.modelName,
      enable_itn: normalizedInput.enableItn,
      enable_punc: normalizedInput.enablePunc,
    },
  }
}

function getCredentialHeaders(env = process.env) {
  const appId = env.VOLCENGINE_APP_ID
  const accessToken = env.VOLCENGINE_ACCESS_TOKEN
  if (!appId || !accessToken) {
    const err = new Error('Missing VOLCENGINE_APP_ID or VOLCENGINE_ACCESS_TOKEN')
    err.code = 'MISSING_CREDENTIALS'
    throw err
  }

  return {
    'X-Api-App-Key': appId,
    'X-Api-Access-Key': accessToken,
    'X-Api-Resource-Id': env.VOLCENGINE_FILE_RESOURCE_ID || 'volc.bigasr.auc',
  }
}

function parseHeaderMeta(headers, httpStatus) {
  const apiStatusCode = Number.parseInt(headers.get('X-Api-Status-Code') || '', 10)
  return {
    httpStatus,
    apiStatusCode: Number.isFinite(apiStatusCode) ? apiStatusCode : null,
    apiMessage: headers.get('X-Api-Message') || '',
    logId: headers.get('X-Tt-Logid') || '',
    requestId: headers.get('X-Api-Request-Id') || '',
  }
}

function extractResultText(body = {}) {
  const directText = body?.result?.text
  if (typeof directText === 'string') {
    return directText
  }

  if (Array.isArray(body?.result)) {
    for (const item of body.result) {
      if (item && typeof item.text === 'string') {
        return item.text
      }
    }
  }

  return ''
}

function deriveFileTaskState(body = {}, meta = {}) {
  const headerCode = Number.parseInt(String(meta?.apiStatusCode ?? ''), 10)
  const bodyCode = Number.parseInt(String(body?.resp?.code ?? ''), 10)
  const code = Number.isFinite(headerCode) ? headerCode : bodyCode
  const message = String(meta?.apiMessage || body?.resp?.message || '')
  const text = String(extractResultText(body))

  if (code === FILE_TASK_CODES.DONE || (!!text && code === 1000)) {
    return { state: FILE_TASK_STATES.DONE, code, message, text }
  }

  if (code === FILE_TASK_CODES.PROCESSING || code === 2001) {
    return { state: FILE_TASK_STATES.PROCESSING, code, message, text }
  }

  if (Number.isFinite(code) && code >= 40000000) {
    return { state: FILE_TASK_STATES.FAILED, code, message, text }
  }

  if (code === 1000 && !text) {
    return { state: FILE_TASK_STATES.PROCESSING, code, message, text }
  }

  if (text) {
    return { state: FILE_TASK_STATES.DONE, code, message, text }
  }

  return { state: FILE_TASK_STATES.FAILED, code, message, text }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function pollFileTaskUntilDone({ taskId, queryTask, sleep: sleepImpl = sleep, pollIntervalMs, timeoutMs }) {
  const startedAt = Date.now()
  const history = []

  while (true) {
    const next = await queryTask(taskId)
    history.push({
      at: new Date().toISOString(),
      state: next.state,
      code: next.code,
      message: next.message,
      text: next.text,
    })

    if (next.state === FILE_TASK_STATES.DONE) {
      return { taskId, result: next, history }
    }

    if (next.state === FILE_TASK_STATES.FAILED) {
      const err = new Error(next.message || 'File ASR query failed')
      err.code = 'VOLC_QUERY_FAILED'
      err.details = next
      throw err
    }

    if (Date.now() - startedAt >= timeoutMs) {
      const err = new Error('File ASR query timed out')
      err.code = 'VOLC_QUERY_TIMEOUT'
      err.details = { taskId, history }
      throw err
    }

    await sleepImpl(pollIntervalMs)
  }
}

async function parseJsonResponse(response, endpoint) {
  const bodyText = await response.text()
  let body
  try {
    body = bodyText ? JSON.parse(bodyText) : {}
  } catch (_) {
    const err = new Error(`Volcengine ${endpoint} returned non-JSON response`)
    err.code = 'VOLC_BAD_RESPONSE'
    err.details = { bodyText }
    throw err
  }

  return body
}

function createFileAsrClient({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is not available')
  }

  const credentialHeaders = getCredentialHeaders(env)

  async function requestFileApi(endpoint, body, options = {}) {
    const requestId = String(options.requestId || crypto.randomUUID())
    const response = await fetchImpl(`${FILE_API_BASE}/${endpoint}`, {
      method: 'POST',
      headers: {
        ...credentialHeaders,
        'X-Api-Request-Id': requestId,
        'X-Api-Sequence': '-1',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const json = await parseJsonResponse(response, endpoint)
    const meta = parseHeaderMeta(response.headers, response.status)
    return { json, meta, requestId }
  }

  async function submitTask(input) {
    const normalized = normalizeFileDemoInput(input)
    const payload = buildFileSubmitPayload(normalized)
    const { json, meta, requestId } = await requestFileApi('submit', payload)
    const submitCode = Number.parseInt(String(meta.apiStatusCode ?? ''), 10)
    const bodyCode = Number.parseInt(String(json?.resp?.code ?? ''), 10)
    const effectiveCode = Number.isFinite(submitCode) ? submitCode : bodyCode
    const taskId = String(json?.resp?.id ?? requestId).trim()

    if (Number.isFinite(effectiveCode) && effectiveCode !== FILE_TASK_CODES.DONE && effectiveCode !== 1000) {
      const err = new Error(meta.apiMessage || json?.resp?.message || 'Submit task failed')
      err.code = 'VOLC_SUBMIT_FAILED'
      err.details = { response: json, meta }
      throw err
    }

    if (!taskId) {
      const err = new Error(meta.apiMessage || json?.resp?.message || 'Submit task failed')
      err.code = 'VOLC_SUBMIT_FAILED'
      err.details = { response: json, meta }
      throw err
    }

    return { taskId, normalized, response: json, meta }
  }

  async function queryTask(taskId) {
    const normalizedTaskId = String(taskId ?? '').trim()
    if (!normalizedTaskId) {
      const err = new Error('taskId is required')
      err.code = 'INVALID_INPUT'
      throw err
    }

    const { json, meta } = await requestFileApi('query', {}, { requestId: normalizedTaskId })
    const derived = deriveFileTaskState(json, meta)
    return { taskId: normalizedTaskId, ...derived, response: json, meta }
  }

  async function runTask(input) {
    const submit = await submitTask(input)
    const polled = await pollFileTaskUntilDone({
      taskId: submit.taskId,
      queryTask,
      pollIntervalMs: submit.normalized.pollIntervalMs,
      timeoutMs: submit.normalized.timeoutMs,
    })

    return {
      taskId: submit.taskId,
      normalized: submit.normalized,
      submit: { response: submit.response, meta: submit.meta },
      final: polled.result,
      history: polled.history,
    }
  }

  return {
    submitTask,
    queryTask,
    runTask,
  }
}

module.exports = {
  FILE_TASK_STATES,
  FILE_TASK_CODES,
  DEFAULT_FILE_DEMO_INPUT,
  normalizeFileDemoInput,
  buildFileSubmitPayload,
  deriveFileTaskState,
  pollFileTaskUntilDone,
  createFileAsrClient,
}
