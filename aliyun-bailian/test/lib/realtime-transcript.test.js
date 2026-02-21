const test = require("node:test")
const assert = require("node:assert/strict")

const {
  applyRealtimeEvent,
  createTranscriptState,
} = require("../../lib/realtime-transcript")

test("text delta updates interim transcript", () => {
  const state = createTranscriptState()
  const next = applyRealtimeEvent(state, {
    type: "response.audio_transcript.text.delta",
    item_id: "item-1",
    text: "你好",
    stash: "啊",
  })

  assert.equal(next.finalText, "")
  assert.equal(next.interimText, "你好啊")
})

test("completed event appends final transcript and clears interim", () => {
  const state = applyRealtimeEvent(createTranscriptState(), {
    type: "response.audio_transcript.text.delta",
    item_id: "item-1",
    text: "hello",
    stash: " world",
  })

  const next = applyRealtimeEvent(state, {
    type: "response.audio_transcript.done",
    item_id: "item-1",
    transcript: "hello world",
  })

  assert.equal(next.finalText, "hello world")
  assert.equal(next.interimText, "")
})

test("duplicate completed event does not duplicate final transcript", () => {
  const state = createTranscriptState()
  const first = applyRealtimeEvent(state, {
    type: "response.audio_transcript.done",
    item_id: "item-1",
    transcript: "first sentence",
  })

  const second = applyRealtimeEvent(first, {
    type: "response.audio_transcript.done",
    item_id: "item-1",
    transcript: "first sentence",
  })

  assert.equal(second.finalText, "first sentence")
  assert.equal(second.segments.length, 1)
})
