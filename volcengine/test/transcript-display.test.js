const test = require('node:test')
const assert = require('node:assert/strict')

const { deriveDisplayFromResult } = require('../lib/transcript-display')

test('uses result.text as source of truth to avoid duplicate rendering', () => {
  const result = {
    text: '你好世界',
    utterances: [
      { text: '你好', definite: true },
      { text: '世界', definite: false },
    ],
  }

  const display = deriveDisplayFromResult(result)

  assert.equal(display.transcript, '你好世界')
  assert.equal(display.interim, '')
})

test('keeps final tail text even when utterances are not fully definite', () => {
  const result = {
    text: '这是最后一句',
    utterances: [
      { text: '这是', definite: true },
      { text: '最后一句', definite: false },
    ],
  }

  const display = deriveDisplayFromResult(result)

  assert.equal(display.transcript, '这是最后一句')
  assert.equal(display.interim, '')
})

test('falls back to utterances when result.text is empty', () => {
  const result = {
    text: '',
    utterances: [
      { text: '今天天气', definite: true },
      { text: '不错', definite: false },
    ],
  }

  const display = deriveDisplayFromResult(result)

  assert.equal(display.transcript, '今天天气')
  assert.equal(display.interim, '不错')
})
