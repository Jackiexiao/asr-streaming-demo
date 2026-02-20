'use client'

import { useRef, useState } from 'react'

type Utterance = { text: string; definite: boolean }

export default function Home() {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'recording' | 'error'>('idle')
  const [transcript, setTranscript] = useState('')
  const [interim, setInterim] = useState('')
  const [error, setError] = useState('')

  const wsRef = useRef<WebSocket | null>(null)
  const mediaRef = useRef<MediaStream | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)

  function pcmEncode(input: Float32Array): ArrayBuffer {
    const buf = new ArrayBuffer(input.length * 2)
    const view = new DataView(buf)
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]))
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    }
    return buf
  }

  async function start() {
    setError('')
    setTranscript('')
    setInterim('')
    setStatus('connecting')

    const ws = new WebSocket(`ws://${location.host}/api/asr-ws`)
    wsRef.current = ws

    ws.onmessage = async (e) => {
      const msg = JSON.parse(e.data)
      if (msg.type === 'connected') {
        setStatus('recording')
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        mediaRef.current = stream
        const ctx = new AudioContext({ sampleRate: 16000 })
        audioCtxRef.current = ctx
        const source = ctx.createMediaStreamSource(stream)
        const processor = ctx.createScriptProcessor(4096, 1, 1)
        processorRef.current = processor
        processor.onaudioprocess = (ev) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(pcmEncode(ev.inputBuffer.getChannelData(0)))
          }
        }
        source.connect(processor)
        processor.connect(ctx.destination)
      } else if (msg.type === 'result') {
        const utterances: Utterance[] = msg.data?.result?.utterances ?? []
        const definite = utterances.filter((u) => u.definite).map((u) => u.text).join('')
        const current = utterances.find((u) => !u.definite)?.text ?? ''
        if (definite) setTranscript((t) => t + definite)
        setInterim(current)
      } else if (msg.type === 'error') {
        setError(msg.message)
        setStatus('error')
      }
    }

    ws.onerror = () => {
      setError('WebSocket connection failed')
      setStatus('error')
    }
  }

  function stop() {
    wsRef.current?.send(JSON.stringify({ type: 'end' }))
    processorRef.current?.disconnect()
    audioCtxRef.current?.close()
    mediaRef.current?.getTracks().forEach((t) => t.stop())
    wsRef.current?.close()
    setStatus('idle')
    setInterim('')
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-8">
      <h1 className="text-3xl font-bold mb-2">火山引擎 流式语音识别</h1>
      <p className="text-gray-400 mb-8 text-sm">Volcengine Streaming ASR Demo</p>

      <div className="flex gap-4 mb-6">
        <button
          onClick={start}
          disabled={status === 'recording' || status === 'connecting'}
          className="px-6 py-3 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg font-medium transition-colors"
        >
          {status === 'connecting' ? '连接中...' : '开始录音'}
        </button>
        <button
          onClick={stop}
          disabled={status !== 'recording'}
          className="px-6 py-3 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg font-medium transition-colors"
        >
          停止
        </button>
      </div>

      {status === 'recording' && (
        <div className="flex items-center gap-2 mb-4 text-red-400 text-sm">
          <span className="w-2 h-2 bg-red-400 rounded-full animate-pulse" />
          录音中...
        </div>
      )}

      {error && <p className="text-red-400 mb-4 text-sm">{error}</p>}

      <div className="w-full max-w-2xl bg-gray-900 rounded-xl p-6 min-h-40 text-lg leading-relaxed">
        <span>{transcript}</span>
        {interim && <span className="text-gray-400">{interim}</span>}
        {!transcript && !interim && (
          <span className="text-gray-600">识别结果将显示在这里...</span>
        )}
      </div>
    </main>
  )
}
