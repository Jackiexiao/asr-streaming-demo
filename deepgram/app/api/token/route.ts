export async function POST() {
  const r = await fetch('https://api.deepgram.com/v1/auth/grant', {
    method: 'POST',
    headers: { 'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}` },
    body: JSON.stringify({ time_to_live_in_seconds: 30 }),
  })
  const data = await r.json()
  return Response.json({ key: data.key })
}
