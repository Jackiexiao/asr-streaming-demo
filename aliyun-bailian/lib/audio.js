function float32ToInt16(input) {
  const pcm = new Int16Array(input.length)

  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]))
    pcm[i] = sample < 0 ? Math.round(sample * 0x8000) : Math.floor(sample * 0x7fff)
  }

  return pcm
}

module.exports = {
  float32ToInt16,
}
