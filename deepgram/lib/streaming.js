function isValidCloseCode(code) {
  return (
    (code >= 1000 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006) ||
    (code >= 3000 && code <= 4999)
  )
}

function normalizeCloseCode(code, fallback = 1011) {
  if (!Number.isInteger(code) || !isValidCloseCode(code)) {
    return fallback
  }
  return code
}

function resolveStreamingModel({ model, language }) {
  const normalizedModel = (model || "nova-2").trim()
  const normalizedLanguage = (language || "zh-CN").trim().toLowerCase()

  if (normalizedModel === "nova-3" && normalizedLanguage.startsWith("zh")) {
    return "nova-2"
  }

  return normalizedModel
}

module.exports = {
  normalizeCloseCode,
  resolveStreamingModel,
}
