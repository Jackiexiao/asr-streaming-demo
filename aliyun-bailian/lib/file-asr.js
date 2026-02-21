const SYNC_MODEL = 'qwen3-asr-flash'
const ASYNC_MODEL = 'qwen3-asr-flash-filetrans'

function inputError(message) {
  const error = new Error(message)
  error.code = 'INVALID_INPUT'
  return error
}

function toTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function toBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true
    if (['false', '0', 'no', 'off'].includes(normalized)) return false
  }
  return fallback
}

function normalizeFileInput(payload = {}) {
  const audioUrl = toTrimmedString(payload.audioUrl)
  const audioDataUrl = toTrimmedString(payload.audioDataUrl)
  const mode = payload.mode === 'async' ? 'async' : 'sync'

  if (!audioUrl && !audioDataUrl) {
    throw inputError('audioUrl or audioDataUrl is required')
  }

  if (mode === 'async' && !audioUrl) {
    throw inputError('audioUrl is required for async mode')
  }

  return {
    mode,
    audioUrl,
    audioDataUrl,
    audioSource: audioUrl || audioDataUrl,
    language: toTrimmedString(payload.language) || 'zh',
    enableItn: toBoolean(payload.enableItn, true),
    corpusText: toTrimmedString(payload.corpusText),
    syncModel: toTrimmedString(payload.syncModel) || SYNC_MODEL,
    asyncModel: toTrimmedString(payload.asyncModel) || ASYNC_MODEL,
    pollIntervalMs: Number.parseInt(String(payload.pollIntervalMs || ''), 10) || 1000,
    timeoutMs: Number.parseInt(String(payload.timeoutMs || ''), 10) || 30000,
  }
}

function buildSyncChatRequest({
  audioSource,
  language,
  enableItn,
  corpusText,
  model = SYNC_MODEL,
}) {
  if (!toTrimmedString(audioSource)) {
    throw inputError('audioSource is required')
  }

  const asrOptions = {
    enable_itn: Boolean(enableItn),
  }

  if (toTrimmedString(language)) {
    asrOptions.language = toTrimmedString(language)
  }

  if (toTrimmedString(corpusText)) {
    asrOptions.corpus = { text: toTrimmedString(corpusText) }
  }

  return {
    model,
    stream: false,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'input_audio',
            input_audio: {
              data: audioSource,
            },
          },
        ],
      },
    ],
    asr_options: asrOptions,
  }
}

function buildAsyncSubmitRequest({
  audioUrl,
  language,
  enableItn,
  corpusText,
  model = ASYNC_MODEL,
}) {
  const normalizedAudioUrl = toTrimmedString(audioUrl)
  if (!normalizedAudioUrl) {
    throw inputError('audioUrl is required for async mode')
  }

  const parameters = {
    enable_itn: Boolean(enableItn),
  }

  if (toTrimmedString(language)) {
    parameters.language = toTrimmedString(language)
  }

  if (toTrimmedString(corpusText)) {
    parameters.corpus = { text: toTrimmedString(corpusText) }
  }

  return {
    model,
    input: {
      file_url: normalizedAudioUrl,
    },
    parameters,
  }
}

function firstTextFromArray(items) {
  if (!Array.isArray(items)) return ''
  for (const item of items) {
    if (typeof item === 'string' && item.trim()) return item.trim()
    if (item && typeof item === 'object') {
      if (typeof item.text === 'string' && item.text.trim()) return item.text.trim()
      if (typeof item.content === 'string' && item.content.trim()) return item.content.trim()
    }
  }
  return ''
}

function extractSyncTranscript(response) {
  const choicesContent = response?.choices?.[0]?.message?.content
  if (typeof choicesContent === 'string' && choicesContent.trim()) {
    return choicesContent.trim()
  }

  const outputChoicesContent = response?.output?.choices?.[0]?.message?.content
  if (typeof outputChoicesContent === 'string' && outputChoicesContent.trim()) {
    return outputChoicesContent.trim()
  }

  const fromChoicesArray = firstTextFromArray(choicesContent)
  if (fromChoicesArray) {
    return fromChoicesArray
  }

  const fromOutputChoicesArray = firstTextFromArray(outputChoicesContent)
  if (fromOutputChoicesArray) {
    return fromOutputChoicesArray
  }

  if (typeof response?.output?.transcript === 'string' && response.output.transcript.trim()) {
    return response.output.transcript.trim()
  }

  return ''
}

function extractAsyncTaskId(response) {
  return (
    toTrimmedString(response?.output?.task_id) ||
    toTrimmedString(response?.output?.taskId) ||
    toTrimmedString(response?.task_id) ||
    toTrimmedString(response?.taskId)
  )
}

function extractAsyncStatus(response) {
  return (
    toTrimmedString(response?.output?.task_status) ||
    toTrimmedString(response?.output?.taskStatus) ||
    toTrimmedString(response?.task_status) ||
    toTrimmedString(response?.taskStatus)
  )
}

function collectText(items) {
  if (!Array.isArray(items)) return ''
  const parts = []

  for (const item of items) {
    if (typeof item === 'string') {
      if (item) parts.push(item)
      continue
    }

    if (typeof item?.text === 'string' && item.text.length > 0) {
      parts.push(item.text)
      continue
    }

    const transcript = toTrimmedString(item?.transcript)
    if (transcript) {
      parts.push(transcript)
    }
  }

  return parts.join('')
}

function extractAsyncTextFromResult(resultPayload) {
  const directText =
    toTrimmedString(resultPayload?.transcript) ||
    toTrimmedString(resultPayload?.text) ||
    toTrimmedString(resultPayload?.output?.transcript)

  if (directText) {
    return directText
  }

  const fromSegments = collectText(resultPayload?.segments)
  if (fromSegments) {
    return fromSegments
  }

  const fromResults = collectText(resultPayload?.results)
  if (fromResults) {
    return fromResults
  }

  const paragraphs = resultPayload?.paragraphs
  if (Array.isArray(paragraphs)) {
    const paragraphText = paragraphs
      .map((item) => toTrimmedString(item?.text))
      .filter(Boolean)
      .join('\n')

    if (paragraphText) {
      return paragraphText
    }
  }

  return ''
}

function isAsyncTaskTerminal(status) {
  const normalized = toTrimmedString(status).toUpperCase()
  return ['SUCCEEDED', 'FAILED', 'CANCELED'].includes(normalized)
}

module.exports = {
  ASYNC_MODEL,
  SYNC_MODEL,
  buildAsyncSubmitRequest,
  buildSyncChatRequest,
  extractAsyncStatus,
  extractAsyncTaskId,
  extractAsyncTextFromResult,
  extractSyncTranscript,
  isAsyncTaskTerminal,
  normalizeFileInput,
}
