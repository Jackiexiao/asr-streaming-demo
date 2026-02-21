function deriveDisplayFromResult(result) {
  const resultText = result?.text ?? ''
  if (resultText) {
    return { transcript: resultText, interim: '' }
  }

  const utterances = Array.isArray(result?.utterances) ? result.utterances : []
  if (utterances.length === 0) {
    return { transcript: '', interim: '' }
  }

  const definite = utterances
    .filter((u) => u && u.definite)
    .map((u) => (u.text ?? ''))
    .join('')

  let current = ''
  for (let i = utterances.length - 1; i >= 0; i--) {
    if (!utterances[i]?.definite) {
      current = utterances[i]?.text ?? ''
      break
    }
  }

  return { transcript: definite, interim: current }
}

module.exports = {
  deriveDisplayFromResult,
}
