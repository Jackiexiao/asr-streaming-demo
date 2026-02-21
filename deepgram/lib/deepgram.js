function extractTranscript(resultPayload) {
  const alternative =
    resultPayload?.results?.channels?.[0]?.alternatives?.[0] ||
    resultPayload?.channel?.alternatives?.[0]

  return {
    transcript: alternative?.transcript || "",
    words: alternative?.words || [],
  }
}

module.exports = {
  extractTranscript,
}
