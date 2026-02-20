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

  async function start() {
    setStatus('获取临时 key...')
    const { key } = await fetch('/api/token', { method: 'POST' }).then(r => r.json())
    const params = new URLSearchParams({
      encoding: 'linear16', sample_rate: '16000',
      language: 'zh-CN', punctuate: 'true', interim_results: 'true',
    })
    const socket = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, ['token', key])
    ws.current = socket

    socket.onopen = async () => {
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
        socket.send(i16.buffer)
      }
    }
    socket.onmessage = (e) => {
      const d = JSON.parse(e.data)
      const t = d.channel?.alternatives?.[0]?.transcript
      if (!t) return
      if (d.is_final) { setFinal(p => p + t + ' '); setInterim('') }
      else setInterim(t)
    }
    socket.onclose = () => setStatus('连接已关闭')
    setRecording(true)
  }

  function stop() {
    proc.current?.disconnect()
    stream.current?.getTracks().forEach(t => t.stop())
    ctx.current?.close()
    ws.current?.close()
    setRecording(false); setStatus('已停止')
  }

  return (
    <main style={{ fontFamily: 'sans-serif', maxWidth: 700, margin: '40px auto', padding: '0 20px' }}>
      <h2>Deepgram 流式语音识别</h2>
      <p style={{ color: '#888', fontSize: 13 }}>
        浏览器 → <code>/api/token</code> 获取临时 key（30s）→ 直连 Deepgram WebSocket
      </p>
      <button onClick={recording ? stop : start} style={{ padding: '10px 24px', fontSize: 16, cursor: 'pointer' }}>
        {recording ? '停止录音' : '开始录音'}
      </button>
      <p style={{ color: '#666', fontSize: 13 }}>{status}</p>
      <p style={{ color: '#aaa', minHeight: 24 }}>{interim}</p>
      <p style={{ lineHeight: 1.8 }}>{final}</p>
    </main>
  )
}
