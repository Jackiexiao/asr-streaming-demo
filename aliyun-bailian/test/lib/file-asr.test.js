const test = require("node:test")
const assert = require("node:assert/strict")

const {
  buildAsyncSubmitRequest,
  buildSyncChatRequest,
  extractAsyncTaskId,
  extractAsyncTextFromResult,
  extractSyncTranscript,
  normalizeFileInput,
} = require("../../lib/file-asr")

test("normalizeFileInput rejects missing audio source", () => {
  assert.throws(() => normalizeFileInput({}), /audioUrl or audioDataUrl is required/)
})

test("normalizeFileInput rejects data-url for async mode", () => {
  assert.throws(
    () => normalizeFileInput({ mode: "async", audioDataUrl: "data:audio/wav;base64,AAA=" }),
    /audioUrl is required for async mode/,
  )
})

test("buildSyncChatRequest builds openai-compatible body", () => {
  const payload = buildSyncChatRequest({
    audioSource: "https://example.com/demo.wav",
    language: "zh",
    enableItn: true,
    corpusText: "百炼",
  })

  assert.equal(payload.model, "qwen3-asr-flash")
  assert.equal(payload.stream, false)
  assert.equal(payload.messages[0].content[0].type, "input_audio")
  assert.equal(payload.messages[0].content[0].input_audio.data, "https://example.com/demo.wav")
  assert.equal(payload.asr_options.language, "zh")
  assert.equal(payload.asr_options.enable_itn, true)
  assert.equal(payload.asr_options.corpus.text, "百炼")
})

test("buildAsyncSubmitRequest builds filetrans body", () => {
  const payload = buildAsyncSubmitRequest({
    audioUrl: "https://example.com/demo.wav",
    language: "zh",
    enableItn: true,
    corpusText: "百炼",
  })

  assert.equal(payload.model, "qwen3-asr-flash-filetrans")
  assert.equal(payload.input.file_url, "https://example.com/demo.wav")
  assert.equal(payload.parameters.language, "zh")
  assert.equal(payload.parameters.enable_itn, true)
  assert.equal(payload.parameters.corpus.text, "百炼")
})

test("extractSyncTranscript supports common OpenAI-compatible shape", () => {
  const transcript = extractSyncTranscript({
    choices: [
      {
        message: {
          content: [
            {
              type: "text",
              text: "今天天气不错",
            },
          ],
        },
      },
    ],
  })

  assert.equal(transcript, "今天天气不错")
})

test("extractAsyncTaskId reads output.task_id", () => {
  const taskId = extractAsyncTaskId({ output: { task_id: "task-123" } })
  assert.equal(taskId, "task-123")
})

test("extractAsyncTextFromResult joins segment text", () => {
  const text = extractAsyncTextFromResult({
    segments: [
      { text: "hello" },
      { text: " world" },
    ],
  })

  assert.equal(text, "hello world")
})
