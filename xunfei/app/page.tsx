'use client'
import { useRef, useState } from 'react'

export default function Page() {
  const [recording, setRecording] = useState(false)
  const [status, setStatus] = useState('就绪')
  const [interim, setInterim] = useState('')
  const [final, setFinal] = useState('')
  const ws = useRef<WebSocket | null>(null)
  const ctx = useRef<AudioContext | null>(null)
  const proc = useRef<ScriptProcessorNode | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const sentences = useRef<Record<string, Record<number, string>>>({})

  async function start() {
    setStatus('获取签名 URL...')
    const { wsUrl, error } = await fetch('/api/token', { method: 'POST' }).then(r => r.json())
    if (error) return setStatus('错误: ' + error)

    const socket = new WebSocket(wsUrl)
    ws.current = socket

    socket.onopen = async () => {
      // 发送开始帧（appId 已在签名 URL 中）
      socket.send(JSON.stringify({
        common: { app_id: '' },
        business: { language: 'zh_cn', domain: 'iat', accent: 'mandarin', vad_eos: 3000 },
        data: { status: 0, format: 'audio/L16;rate=16000', encoding: 'raw', audio: '' },
      }))
      setStatus('录音中...')
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true })
      ctx.current = new AudioContext({ sampleRate: 16000 })
      const source = ctx.current.createMediaStreamSource(stream.current)
      proc.current = ctx.current.createScriptProcessor(4096, 1, 1)
      source.connect(proc.current)
      proc.current.connect(ctx.current.destination)
      proc.current.onaudioprocess = (e) => {
        if (socket.readyState !== WebSocket.OPEN) return
        const f32 = e.inputBuffer.getChannelData(0)
        const i16 = new Int16Array(f32.length)
        for (let i = 0; i < f32.length; i++) i16[i] = Math.max(-32768, Math.min(32767, f32[i] * 32768))
        const b64 = btoa(String.fromCharCode(...new Uint8Array(i16.buffer)))
        socket.send(JSON.stringify({ data: { status: 1, format: 'audio/L16;rate=16000', encoding: 'raw', audio: b64 } }))
      }
    }

    socket.onmessage = (e) => {
      const d = JSON.parse(e.data)
      if (d.code !== 0) return setStatus(`错误 ${d.code}: ${d.message}`)
      const result = d.data?.result
      if (!result) return
      const sid = d.sid
      if (!sentences.current[sid]) sentences.current[sid] = {}
      result.ws?.forEach((w: { bg: number; cw: { w: string }[] }) => {
        sentences.current[sid][w.bg] = w.cw?.[0]?.w || ''
      })
      const text = Object.keys(sentences.current[sid])
        .sort((a, b) => Number(a) - Number(b))
        .map(k => sentences.current[sid][Number(k)]).join('')
      if (result.ls) {
        setFinal(p => p + text + '\n')
        setInterim('')
        delete sentences.current[sid]
      } else {
        setInterim(text)
      }
    }
    socket.onclose = () => setStatus('连接已关闭')
    setRecording(true)
  }

  function stop() {
    proc.current?.disconnect()
    stream.current?.getTracks().forEach(t => t.stop())
    ctx.current?.close()
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ data: { status: 2, format: 'audio/L16;rate=16000', encoding: 'raw', audio: '' } }))
    }
    setRecording(false); setStatus('已停止')
  }

  return (
    <main style={{ fontFamily: 'sans-serif', maxWidth: 700, margin: '40px auto', padding: '0 20px' }}>
      <h2>讯飞实时语音转写</h2>
      <p style={{ color: '#888', fontSize: 13 }}>
        浏览器 → <code>/api/token</code> 获取 HMAC 签名 URL → 直连讯飞 WebSocket
      </p>
      <button onClick={recording ? stop : start} style={{ padding: '10px 24px', fontSize: 16, cursor: 'pointer' }}>
        {recording ? '停止录音' : '开始录音'}
      </button>
      <p style={{ color: '#666', fontSize: 13 }}>{status}</p>
      <p style={{ color: '#aaa', minHeight: 24 }}>{interim}</p>
      <p style={{ lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{final}</p>
    </main>
  )
}
