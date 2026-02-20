require('dotenv').config()
const express = require('express')
const cors = require('cors')
const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const multer = require('multer')
const { createClient } = require('@deepgram/sdk')

const app = express()
const upload = multer({ storage: multer.memoryStorage() })
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex')
const deepgram = createClient(process.env.DEEPGRAM_API_KEY)

app.use(cors())
app.use(express.static('public'))

// Step 1: 客户端先拿 JWT session token
app.get('/api/session', (req, res) => {
  res.json({ token: jwt.sign({}, SESSION_SECRET, { expiresIn: '1h' }) })
})

function requireSession(req, res, next) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' })
  try { jwt.verify(auth.slice(7), SESSION_SECRET); next() }
  catch { res.status(401).json({ error: 'Invalid token' }) }
}

// Step 2: 用 JWT 调用转写接口（文件上传 or URL）
app.post('/api/transcription', requireSession, upload.single('file'), async (req, res) => {
  try {
    const { url, model = 'nova-3' } = req.body
    const result = url
      ? await deepgram.listen.prerecorded.transcribeUrl({ url }, { model })
      : await deepgram.listen.prerecorded.transcribeFile(req.file.buffer, { model, mimetype: req.file.mimetype })
    const alt = result.result?.results?.channels?.[0]?.alternatives?.[0]
    res.json({ transcript: alt?.transcript || '', words: alt?.words || [] })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.listen(8081, () => console.log('→ http://localhost:8081'))
