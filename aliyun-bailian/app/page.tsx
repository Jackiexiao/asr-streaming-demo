'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'

type Status = 'idle' | 'connecting' | 'recording' | 'stopping' | 'error'

type RealtimeEvent = {
  type?: string
  text?: string
  stash?: string
  transcript?: string
  error?: {
    message?: string
  }
  message?: string
}

type SessionUpdateEvent = {
  event_id: string
  type: 'session.update'
  session: {
    modalities: ['text']
    input_audio_format: 'pcm'
    sample_rate: number
    input_audio_transcription: {
      language: string
      corpus?: {
        text: string
      }
    }
    turn_detection:
      | {
          type: 'server_vad'
          threshold: number
          silence_duration_ms: number
        }
      | null
  }
}

const REALTIME_MODEL = 'qwen3-asr-flash-realtime-2026-02-10'

function buildEventId() {
  return `event_${Date.now()}_${Math.floor(Math.random() * 10_000)}`
}

function toPcm16Buffer(input: Float32Array): ArrayBuffer {
  const pcm = new Int16Array(input.length)
  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]))
    pcm[i] = sample < 0 ? Math.round(sample * 0x8000) : Math.floor(sample * 0x7fff)
  }
  return pcm.buffer
}

function statusText(status: Status): string {
  if (status === 'connecting') return '连接中'
  if (status === 'recording') return '录音中'
  if (status === 'stopping') return '停止中'
  if (status === 'error') return '错误'
  return '空闲'
}

function buildSessionUpdateEvent(language: string, corpusText: string, enableServerVad: boolean) {
  const payload: SessionUpdateEvent = {
    event_id: buildEventId(),
    type: 'session.update',
    session: {
      modalities: ['text'],
      input_audio_format: 'pcm',
      sample_rate: 16000,
      input_audio_transcription: {
        language,
      },
      turn_detection: enableServerVad
        ? {
            type: 'server_vad',
            threshold: 0.2,
            silence_duration_ms: 800,
          }
        : null,
    },
  }

  if (corpusText.trim()) {
    payload.session.input_audio_transcription.corpus = { text: corpusText.trim() }
  }

  return payload
}

export default function RealtimePage() {
  const [status, setStatus] = useState<Status>('idle')
  const [language, setLanguage] = useState('zh')
  const [enableServerVad, setEnableServerVad] = useState(true)
  const [corpusText, setCorpusText] = useState('')
  const [interimText, setInterimText] = useState('')
  const [finalText, setFinalText] = useState('')
  const [error, setError] = useState('')
  const [events, setEvents] = useState<string[]>([])

  const wsRef = useRef<WebSocket | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)

  const isBusy = status === 'connecting' || status === 'recording' || status === 'stopping'

  function pushEvent(value: unknown) {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value)
    setEvents((prev) => [serialized, ...prev].slice(0, 30))
  }

  function stopAudioCapture() {
    processorRef.current?.disconnect()
    processorRef.current = null

    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null

    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }
  }

  function resetConnection() {
    stopAudioCapture()

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.close(1000, 'client-reset')
    }
    wsRef.current = null
  }

  async function startRecording() {
    if (isBusy) return

    setStatus('connecting')
    setError('')
    setEvents([])
    setInterimText('')
    setFinalText('')

    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    const socket = new WebSocket(
      `${protocol}://${location.host}/api/realtime-ws?model=${encodeURIComponent(REALTIME_MODEL)}`,
    )
    wsRef.current = socket

    socket.onmessage = async (event) => {
      let data: RealtimeEvent | Record<string, unknown>
      try {
        data = JSON.parse(String(event.data))
      } catch {
        return
      }

      pushEvent(data)

      if ((data as RealtimeEvent).type === 'connected') {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
          streamRef.current = stream

          const audioCtx = new AudioContext({ sampleRate: 16000 })
          audioCtxRef.current = audioCtx

          const source = audioCtx.createMediaStreamSource(stream)
          const processor = audioCtx.createScriptProcessor(4096, 1, 1)
          processorRef.current = processor

          socket.send(
            JSON.stringify(buildSessionUpdateEvent(language, corpusText, enableServerVad)),
          )

          processor.onaudioprocess = (audioEvent) => {
            if (socket.readyState !== WebSocket.OPEN) return
            const channelData = audioEvent.inputBuffer.getChannelData(0)
            socket.send(toPcm16Buffer(channelData))
          }

          source.connect(processor)
          processor.connect(audioCtx.destination)
          setStatus('recording')
        } catch (err) {
          const message = err instanceof Error ? err.message : '麦克风不可用'
          setError(`无法开始录音：${message}`)
          setStatus('error')
          resetConnection()
        }
        return
      }

      if ((data as RealtimeEvent).type === 'response.audio_transcript.text.delta') {
        const evt = data as RealtimeEvent
        setInterimText(`${evt.text || ''}${evt.stash || ''}`)
        return
      }

      if ((data as RealtimeEvent).type === 'response.audio_transcript.done') {
        const evt = data as RealtimeEvent
        const transcript = (evt.transcript || '').trim()
        if (transcript) {
          setFinalText((prev) => (prev ? `${prev}\n${transcript}` : transcript))
        }
        setInterimText('')
        return
      }

      if ((data as RealtimeEvent).type === 'error' || (data as RealtimeEvent).error?.message) {
        const evt = data as RealtimeEvent
        setError(evt.error?.message || evt.message || '识别失败')
        setStatus('error')
      }
    }

    socket.onerror = () => {
      setError('WebSocket 连接失败')
      setStatus('error')
    }

    socket.onclose = () => {
      stopAudioCapture()
      setStatus((prev) => (prev === 'error' ? 'error' : 'idle'))
    }
  }

  function stopRecording() {
    if (status !== 'recording') {
      return
    }

    setStatus('stopping')
    stopAudioCapture()

    const socket = wsRef.current
    if (socket && socket.readyState === WebSocket.OPEN) {
      if (!enableServerVad) {
        socket.send(
          JSON.stringify({
            event_id: buildEventId(),
            type: 'input_audio_buffer.commit',
          }),
        )
      }

      window.setTimeout(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.close(1000, 'client-stop')
        }
      }, 600)
    }
  }

  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '28px 16px 44px' }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>阿里云百炼 Qwen3 实时语音识别</h1>
      <p style={{ color: '#64748b', marginBottom: 12 }}>
        客户端只连接本地 <code>/api/realtime-ws</code>，API Key 仅在服务端读取。
      </p>
      <p style={{ marginBottom: 20 }}>
        <Link href='/file' style={{ color: '#2563eb' }}>
          去录音文件识别页面
        </Link>
      </p>

      <section style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <label>
            语言：
            <input
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              disabled={isBusy}
              style={{ marginLeft: 8, width: 80 }}
            />
          </label>
          <label>
            <input
              type='checkbox'
              checked={enableServerVad}
              onChange={(event) => setEnableServerVad(event.target.checked)}
              disabled={isBusy}
            />
            <span style={{ marginLeft: 6 }}>启用 Server VAD</span>
          </label>
        </div>
        <label style={{ display: 'block', marginBottom: 12 }}>
          语料（可选）：
          <input
            value={corpusText}
            onChange={(event) => setCorpusText(event.target.value)}
            disabled={isBusy}
            placeholder='可填行业术语，提升识别效果'
            style={{ display: 'block', width: '100%', marginTop: 6 }}
          />
        </label>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type='button'
            onClick={status === 'recording' ? stopRecording : startRecording}
            disabled={status === 'connecting' || status === 'stopping'}
            style={{ padding: '8px 18px', cursor: 'pointer' }}
          >
            {status === 'recording' ? '停止录音' : '开始录音'}
          </button>
          <span>状态：{statusText(status)}</span>
        </div>
        {error ? <p style={{ color: '#dc2626', marginTop: 8 }}>{error}</p> : null}
      </section>

      <section style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <h2 style={{ marginBottom: 8, fontSize: 18 }}>识别结果</h2>
        <p style={{ color: '#64748b', minHeight: 24 }}>{interimText || '（中间结果）'}</p>
        <pre style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{finalText || '（最终结果）'}</pre>
      </section>

      <section style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 16 }}>
        <h2 style={{ marginBottom: 8, fontSize: 18 }}>事件日志（最近 30 条）</h2>
        <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 280, overflow: 'auto' }}>
          {events.length ? events.join('\n\n') : '暂无事件'}
        </pre>
      </section>
    </main>
  )
}
