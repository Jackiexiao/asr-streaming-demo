const test = require('node:test')
const assert = require('node:assert/strict')

const {
  normalizeFileDemoInput,
  buildFileSubmitPayload,
  deriveFileTaskState,
  pollFileTaskUntilDone,
  FILE_TASK_STATES,
  createFileAsrClient,
} = require('../lib/file-asr-service')

test('normalizeFileDemoInput applies defaults and bounds', () => {
  const normalized = normalizeFileDemoInput({
    audioUrl: ' https://example.com/demo.wav ',
    enableItn: false,
    pollIntervalMs: 99,
    timeoutMs: 999999,
  })

  assert.deepEqual(normalized, {
    audioUrl: 'https://example.com/demo.wav',
    audioFormat: 'wav',
    enableItn: false,
    enablePunc: true,
    modelName: 'bigmodel',
    pollIntervalMs: 300,
    timeoutMs: 120000,
  })
})

test('buildFileSubmitPayload creates volcengine-compatible body', () => {
  const payload = buildFileSubmitPayload({
    audioUrl: 'https://example.com/demo.mp3',
    audioFormat: 'mp3',
    enableItn: true,
    enablePunc: false,
    modelName: 'bigmodel',
  })

  assert.deepEqual(payload, {
    user: { uid: 'demo-user' },
    audio: { url: 'https://example.com/demo.mp3', format: 'mp3' },
    request: { model_name: 'bigmodel', enable_itn: true, enable_punc: false },
  })
})

test('deriveFileTaskState parses done/processing/error', () => {
  const done = deriveFileTaskState({
    resp: { code: 20000000, message: 'Success' },
    result: { text: '你好，世界。' },
  })
  assert.equal(done.state, FILE_TASK_STATES.DONE)
  assert.equal(done.text, '你好，世界。')

  const processing = deriveFileTaskState({
    resp: { code: 20000001, message: 'Processing' },
  })
  assert.equal(processing.state, FILE_TASK_STATES.PROCESSING)

  const failed = deriveFileTaskState({
    resp: { code: 45000000, message: 'InvalidParams' },
  })
  assert.equal(failed.state, FILE_TASK_STATES.FAILED)
})

test('deriveFileTaskState supports header-based status code', () => {
  const done = deriveFileTaskState(
    { result: { text: '最终文本' } },
    { apiStatusCode: 20000000, apiMessage: 'OK' },
  )
  assert.equal(done.state, FILE_TASK_STATES.DONE)
  assert.equal(done.code, 20000000)
  assert.equal(done.message, 'OK')
  assert.equal(done.text, '最终文本')

  const processing = deriveFileTaskState(
    { result: { text: '' } },
    { apiStatusCode: 20000001, apiMessage: 'Processing' },
  )
  assert.equal(processing.state, FILE_TASK_STATES.PROCESSING)
  assert.equal(processing.code, 20000001)
})

test('pollFileTaskUntilDone waits until final result', async () => {
  const queryResults = [
    { state: FILE_TASK_STATES.PROCESSING, code: 20000001, message: 'Processing', text: '' },
    { state: FILE_TASK_STATES.DONE, code: 20000000, message: 'Success', text: '最终文本' },
  ]
  let callCount = 0

  const result = await pollFileTaskUntilDone({
    taskId: 'task-demo',
    queryTask: async () => {
      const next = queryResults[Math.min(callCount, queryResults.length - 1)]
      callCount += 1
      return next
    },
    sleep: async () => {},
    pollIntervalMs: 300,
    timeoutMs: 3000,
  })

  assert.equal(result.taskId, 'task-demo')
  assert.equal(result.result.text, '最终文本')
  assert.equal(result.history.length, 2)
})

test('submitTask uses request id as task id when submit body is empty', async () => {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    return new Response('{}', {
      status: 200,
      headers: {
        'X-Api-Status-Code': '20000000',
        'X-Api-Message': 'OK',
      },
    })
  }

  const client = createFileAsrClient({
    env: {
      VOLCENGINE_APP_ID: 'app',
      VOLCENGINE_ACCESS_TOKEN: 'token',
      VOLCENGINE_FILE_RESOURCE_ID: 'volc.bigasr.auc',
    },
    fetchImpl,
  })

  const submit = await client.submitTask({
    audioUrl: 'https://example.com/demo.wav',
  })

  assert.equal(calls.length, 1)
  assert.match(submit.taskId, /^[0-9a-f-]{36}$/i)
  assert.equal(calls[0].options.headers['X-Api-Request-Id'], submit.taskId)
})

test('queryTask sends empty JSON body and uses task id in request header', async () => {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    return new Response(
      JSON.stringify({ result: { text: '' } }),
      {
        status: 200,
        headers: {
          'X-Api-Status-Code': '20000001',
          'X-Api-Message': '[Processing in progress] Handle response: Start Processing',
        },
      },
    )
  }

  const client = createFileAsrClient({
    env: {
      VOLCENGINE_APP_ID: 'app',
      VOLCENGINE_ACCESS_TOKEN: 'token',
      VOLCENGINE_FILE_RESOURCE_ID: 'volc.bigasr.auc',
    },
    fetchImpl,
  })

  const result = await client.queryTask('task-id-demo')

  assert.equal(calls.length, 1)
  assert.ok(calls[0].url.endsWith('/query'))
  assert.equal(calls[0].options.headers['X-Api-Request-Id'], 'task-id-demo')
  assert.equal(calls[0].options.body, '{}')
  assert.equal(result.state, FILE_TASK_STATES.PROCESSING)
  assert.equal(result.code, 20000001)
})
