const test = require('node:test')
const assert = require('node:assert/strict')

const {
  DEFAULT_DEMO_PARAMS,
  parseDemoParams,
  buildRequestConfig,
} = require('../lib/asr-config')

test('parseDemoParams uses documented defaults for demo', () => {
  const parsed = parseDemoParams({})

  assert.deepEqual(parsed, DEFAULT_DEMO_PARAMS)
})

test('parseDemoParams reads booleans and clamps end_window_size >= 200', () => {
  const parsed = parseDemoParams({
    enable_nonstream: 'false',
    enable_itn: '0',
    enable_punc: 'no',
    show_utterances: '1',
    end_window_size: '120',
  })

  assert.equal(parsed.enable_nonstream, false)
  assert.equal(parsed.enable_itn, false)
  assert.equal(parsed.enable_punc, false)
  assert.equal(parsed.show_utterances, true)
  assert.equal(parsed.end_window_size, 200)
})

test('buildRequestConfig maps parsed params to volc request payload', () => {
  const parsed = parseDemoParams({
    enable_nonstream: 'true',
    enable_itn: 'true',
    enable_punc: 'false',
    show_utterances: 'true',
    end_window_size: '650',
  })

  const config = buildRequestConfig(parsed)

  assert.deepEqual(config.audio, {
    format: 'pcm',
    rate: 16000,
    bits: 16,
    channel: 1,
  })

  assert.deepEqual(config.request, {
    model_name: 'bigmodel',
    enable_nonstream: true,
    enable_itn: true,
    enable_punc: false,
    show_utterances: true,
    result_type: 'full',
    end_window_size: 650,
  })
})
