function createTranscriptState() {
  return {
    segments: [],
    completedKeys: {},
    finalText: '',
    interimText: '',
  }
}

function toText(value) {
  return typeof value === 'string' ? value : ''
}

function applyRealtimeEvent(prevState, event) {
  const nextState = {
    segments: [...(prevState?.segments || [])],
    completedKeys: { ...(prevState?.completedKeys || {}) },
    finalText: toText(prevState?.finalText),
    interimText: toText(prevState?.interimText),
  }

  if (!event || typeof event !== 'object') {
    return nextState
  }

  if (event.type === 'response.audio_transcript.text.delta') {
    nextState.interimText = `${toText(event.text)}${toText(event.stash)}`
    return nextState
  }

  if (event.type === 'response.audio_transcript.done') {
    const transcript = toText(event.transcript).trim()
    const key = `${toText(event.item_id)}::${transcript}`

    if (transcript && !nextState.completedKeys[key]) {
      nextState.completedKeys[key] = true
      nextState.segments.push(transcript)
    }

    nextState.finalText = nextState.segments.join('\n')
    nextState.interimText = ''
    return nextState
  }

  return nextState
}

module.exports = {
  applyRealtimeEvent,
  createTranscriptState,
}
