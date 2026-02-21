function float32ToInt16(float32Samples) {
  const pcm = new Int16Array(float32Samples.length)
  for (let i = 0; i < float32Samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, float32Samples[i]))
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
  }
  return pcm
}

module.exports = {
  float32ToInt16,
}
