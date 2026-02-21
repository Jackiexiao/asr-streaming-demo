export async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('读取文件失败'))
        return
      }
      resolve(result)
    }
    reader.onerror = () => {
      reject(new Error('读取文件失败'))
    }
    reader.readAsDataURL(file)
  })
}

type JsonValue = Record<string, unknown>

function parseJsonObject(raw: string): JsonValue | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as JsonValue
    }
    return null
  } catch {
    return null
  }
}

async function postJson(path: string, payload: JsonValue): Promise<JsonValue | null> {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const text = await response.text()
  const data = parseJsonObject(text)

  if (!response.ok) {
    const message =
      (typeof data?.message === 'string' && data.message) || `请求失败（HTTP ${response.status}）`
    throw new Error(message)
  }

  return data
}

export function syncFileTask(payload: JsonValue) {
  return postJson('/api/file-asr/sync', payload)
}

export function submitFileTask(payload: JsonValue) {
  return postJson('/api/file-asr/submit', payload)
}

export function queryFileTask(payload: JsonValue) {
  return postJson('/api/file-asr/query', payload)
}

export function recognizeFileTask(payload: JsonValue) {
  return postJson('/api/file-asr/recognize', payload)
}
