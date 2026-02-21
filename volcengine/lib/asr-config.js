const DEFAULT_DEMO_PARAMS = {
  enable_nonstream: true,
  enable_itn: true,
  enable_punc: true,
  show_utterances: true,
  end_window_size: 800,
}

function normalizeSingle(value) {
  if (Array.isArray(value)) {
    return value[0]
  }
  return value
}

function parseBoolean(value, fallback) {
  const normalized = String(normalizeSingle(value) ?? '').trim().toLowerCase()
  if (!normalized) {
    return fallback
  }

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false
  }

  return fallback
}

function parseWindowSize(value, fallback) {
  const normalized = normalizeSingle(value)
  const parsed = Number.parseInt(String(normalized ?? ''), 10)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  if (parsed < 200) {
    return 200
  }
  if (parsed > 10000) {
    return 10000
  }
  return parsed
}

function parseDemoParams(query = {}) {
  return {
    enable_nonstream: parseBoolean(query.enable_nonstream, DEFAULT_DEMO_PARAMS.enable_nonstream),
    enable_itn: parseBoolean(query.enable_itn, DEFAULT_DEMO_PARAMS.enable_itn),
    enable_punc: parseBoolean(query.enable_punc, DEFAULT_DEMO_PARAMS.enable_punc),
    show_utterances: parseBoolean(query.show_utterances, DEFAULT_DEMO_PARAMS.show_utterances),
    end_window_size: parseWindowSize(query.end_window_size, DEFAULT_DEMO_PARAMS.end_window_size),
  }
}

function buildRequestConfig(params) {
  return {
    audio: { format: 'pcm', rate: 16000, bits: 16, channel: 1 },
    request: {
      model_name: 'bigmodel',
      enable_nonstream: params.enable_nonstream,
      enable_itn: params.enable_itn,
      enable_punc: params.enable_punc,
      show_utterances: params.show_utterances,
      result_type: 'full',
      end_window_size: params.end_window_size,
    },
  }
}

module.exports = {
  DEFAULT_DEMO_PARAMS,
  parseDemoParams,
  buildRequestConfig,
}
