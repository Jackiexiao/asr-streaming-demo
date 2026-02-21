export type FileAsrInput = {
  audioUrl: string
  audioFormat?: string
  enableItn?: boolean
  enablePunc?: boolean
  modelName?: string
  pollIntervalMs?: number
  timeoutMs?: number
}

export type UploadRecognizeInput = {
  fileName: string
  fileDataBase64: string
  contentType?: string
  enableItn?: boolean
  enablePunc?: boolean
  modelName?: string
  pollIntervalMs?: number
  timeoutMs?: number
}

type ErrorPayload = {
  ok: false
  message: string
  code?: string
  details?: unknown
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const payload = await response.json()
  if (!response.ok || payload?.ok === false) {
    const errorPayload = payload as ErrorPayload
    throw new Error(errorPayload.message || `Request failed: ${response.status}`)
  }

  return payload as T
}

export function submitFileTask(input: FileAsrInput) {
  return postJson('/api/file-asr/submit', input)
}

export function queryFileTask(taskId: string) {
  return postJson('/api/file-asr/query', { taskId })
}

export function recognizeFileTask(input: FileAsrInput) {
  return postJson('/api/file-asr/recognize', input)
}

export function uploadAndRecognizeFileTask(input: UploadRecognizeInput) {
  return postJson('/api/file-asr/upload-and-recognize', input)
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取本地文件失败'))
    reader.onload = () => resolve(String(reader.result || ''))
    reader.readAsDataURL(file)
  })
}
