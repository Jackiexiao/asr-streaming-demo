const test = require("node:test")
const assert = require("node:assert/strict")

const { extractTranscript } = require("../../lib/deepgram")

test("extractTranscript returns transcript and words from prerecorded payload", () => {
  const payload = {
    results: {
      channels: [
        {
          alternatives: [
            {
              transcript: "hello world",
              words: [{ word: "hello" }, { word: "world" }],
            },
          ],
        },
      ],
    },
  }

  assert.deepEqual(extractTranscript(payload), {
    transcript: "hello world",
    words: [{ word: "hello" }, { word: "world" }],
  })
})

test("extractTranscript falls back to empty response safely", () => {
  assert.deepEqual(extractTranscript(null), { transcript: "", words: [] })
})
