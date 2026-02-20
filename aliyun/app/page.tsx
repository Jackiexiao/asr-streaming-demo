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
  const taskId = useRef('')

  function uuid() { return crypto.randomUUID().replace(/-/g, '') }

  async function start() {
    setStatus('获取 NLS Token...')
    const { token, appKey, error } = await fetch('/api/token', { method: 'POST' }).then(r => r.json())
    if (error) return setStatus('错误: ' + error)

    taskId.current = uuid()
    const socket = new WebSocket(`wss://nls-gateway.cn-shanghai.aliyuncs.com/ws/v1?token=${token}`)
    ws.current = socket

    socket.onopen = () => {
      socket.send(JSON.stringify({
        header: {
          message_id: uuid(), task_id: taskId.current,
          namespace: 'SpeechTranscriber', name: 'StartTranscription', appkey: appKey,
        },
        payload: {
          format: 'pcm', sample_rate: 16000,
          enable_intermediate_result: true,
          enable_punctuation_prediction: true,
          enable_inverse_text_normalization: true,
        },
      }))
    }

    socket.onmessage = async (e) => {
      const d = JSON.parse(e.data)
      const name = d.header?.name
      if (name === 'TranscriptionStarted') {
        setStatus('录音中...')
        stream.current = await navigator.mediaDevices.getUserMedia({ audio: true })
        ctx.current = new AudioContext({ sampleRate: 16000 })
        const source = ctx.current.createMediaStreamSource(stream.current)
        proc.current = ctx.current.createScriptProcessor(4096, 1, 1)
        source.connect(proc.current)
        proc.current.connect(ctx.current.destination)
        proc.current.onaudioprocess = (ev) => {
          if (socket.readyState !== WebSocket.OPEN) return
          const f32 = ev.inputBuffer.getChannelData(0)
          const i16 = new Int16Array(f32.length)
          for (let i = 0; i < f32.length; i++) i16[i] = Math.max(-32768, Math.min(32767, f32[i] * 32768))
          socket.send(i16.buffer)
        }
      } else if (name === 'TranscriptionResultChanged') {
        setInterim(d.payload?.result || '')
      } else if (name === 'SentenceEnd') {
        setFinal(p => p + (d.payload?.result || '') + '\n')
        setInterim('')
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
      ws.current.send(JSON.stringify({
        header: { message_id: uuid(), task_id: taskId.current, namespace: 'SpeechTranscriber', name: 'StopTranscription' },
      }))
    }
    setRecording(false); setStatus('已停止')
  }

  return (
    <main style={{ fontFamily: 'sans-serif', maxWidth: 700, margin: '40px auto', padding: '0 20px' }}>
      <h2>阿里云 NLS 流式语音识别</h2>
      <p style={{ color: '#888', fontSize: 13 }}>
        浏览器 → <code>/api/token</code> 获取 NLS Token → 直连阿里云 WebSocket
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
