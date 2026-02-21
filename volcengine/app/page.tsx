'use client'

import { useEffect, useRef, useState } from 'react'
import { deriveDisplayFromResult } from '@/lib/transcript-display'

type Status = 'idle' | 'connecting' | 'recording' | 'finishing' | 'error'

type DemoParams = {
  enableNonstream: boolean
  enableItn: boolean
  enablePunc: boolean
  showUtterances: boolean
  endWindowSize: number
}

type Utterance = { text?: string; definite?: boolean }

type ResultEvent = {
  id: number
  at: string
  text: string
  utteranceCount: number
  definiteCount: number
}

const DEFAULT_PARAMS: DemoParams = {
  enableNonstream: true,
  enableItn: true,
  enablePunc: true,
  showUtterances: true,
  endWindowSize: 800,
}

function buildAsrQuery(params: DemoParams): string {
  return new URLSearchParams({
    enable_nonstream: params.enableNonstream ? '1' : '0',
    enable_itn: params.enableItn ? '1' : '0',
    enable_punc: params.enablePunc ? '1' : '0',
    show_utterances: params.showUtterances ? '1' : '0',
    end_window_size: String(params.endWindowSize),
  }).toString()
}

function statusText(status: Status): string {
  if (status === 'connecting') return '连接中'
  if (status === 'recording') return '录音中'
  if (status === 'finishing') return '等待最终修正结果'
  if (status === 'error') return '错误'
  return '空闲'
}

export default function Home() {
  const [status, setStatus] = useState<Status>('idle')
  const [transcript, setTranscript] = useState('')
  const [interim, setInterim] = useState('')
  const [error, setError] = useState('')
  const [params, setParams] = useState<DemoParams>(DEFAULT_PARAMS)
  const [events, setEvents] = useState<ResultEvent[]>([])

  const wsRef = useRef<WebSocket | null>(null)
  const mediaRef = useRef<MediaStream | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const stopTimeoutRef = useRef<number | null>(null)
  const finishingRef = useRef(false)

  function pcmEncode(input: Float32Array): ArrayBuffer {
    const buf = new ArrayBuffer(input.length * 2)
    const view = new DataView(buf)
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]))
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    }
    return buf
  }

  function stopAudioCapture() {
    processorRef.current?.disconnect()
    processorRef.current = null

    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }

    mediaRef.current?.getTracks().forEach((track) => track.stop())
    mediaRef.current = null
  }

  function clearStopTimeout() {
    if (stopTimeoutRef.current !== null) {
      window.clearTimeout(stopTimeoutRef.current)
      stopTimeoutRef.current = null
    }
  }

  async function start() {
    if (status === 'connecting' || status === 'recording' || status === 'finishing') {
      return
    }

    setError('')
    setTranscript('')
    setInterim('')
    setEvents([])
    setStatus('connecting')
    finishingRef.current = false

    const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws'
    const query = buildAsrQuery(params)
    const ws = new WebSocket(`${wsProtocol}://${location.host}/api/asr-ws?${query}`)
    wsRef.current = ws

    ws.onmessage = async (e) => {
      let msg: any
      try {
        msg = JSON.parse(e.data)
      } catch {
        return
      }

      if (msg.type === 'connected') {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
          mediaRef.current = stream

          const ctx = new AudioContext({ sampleRate: 16000 })
          audioCtxRef.current = ctx

          const source = ctx.createMediaStreamSource(stream)
          const processor = ctx.createScriptProcessor(2048, 1, 1)
          processorRef.current = processor

          processor.onaudioprocess = (ev) => {
            if (ws.readyState === WebSocket.OPEN && !finishingRef.current) {
              ws.send(pcmEncode(ev.inputBuffer.getChannelData(0)))
            }
          }

          source.connect(processor)
          processor.connect(ctx.destination)
          setStatus('recording')
        } catch (err) {
          const message = err instanceof Error ? err.message : '麦克风权限不可用'
          setError(`无法访问麦克风：${message}`)
          setStatus('error')
          ws.close()
        }
        return
      }

      if (msg.type === 'result') {
        const result = msg.data?.result
        const display = deriveDisplayFromResult(result)
        setTranscript(display.transcript)
        setInterim(display.interim)

        const utterances: Utterance[] = Array.isArray(result?.utterances) ? result.utterances : []
        setEvents((prev) => {
          const next: ResultEvent = {
            id: Date.now() + Math.floor(Math.random() * 1000),
            at: new Date().toLocaleTimeString(),
            text: result?.text ?? display.transcript,
            utteranceCount: utterances.length,
            definiteCount: utterances.filter((u) => Boolean(u?.definite)).length,
          }
          return [next, ...prev].slice(0, 20)
        })
        return
      }

      if (msg.type === 'error') {
        setError(msg.message)
        setStatus('error')
      }
    }

    ws.onerror = () => {
      setError('WebSocket connection failed')
      setStatus('error')
    }

    ws.onclose = () => {
      clearStopTimeout()
      stopAudioCapture()
      wsRef.current = null
      finishingRef.current = false
      setStatus((prev) => (prev === 'error' ? prev : 'idle'))
      setInterim('')
    }
  }

  function stop() {
    if (status !== 'recording' && status !== 'connecting') {
      return
    }

    setStatus('finishing')
    finishingRef.current = true
    stopAudioCapture()

    const ws = wsRef.current
    if (!ws) {
      setStatus('idle')
      return
    }

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'end' }))
    } else {
      ws.close()
      return
    }

    clearStopTimeout()
    stopTimeoutRef.current = window.setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close()
      }
    }, 6000)
  }

  useEffect(() => {
    return () => {
      clearStopTimeout()
      stopAudioCapture()
      wsRef.current?.close()
      finishingRef.current = false
    }
  }, [])

  const controlsDisabled = status === 'connecting' || status === 'recording' || status === 'finishing'
  const queryPreview = buildAsrQuery(params)

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 space-y-6">
        <header>
          <h1 className="text-3xl font-bold">火山引擎流式语音识别 Demo（开发者版）</h1>
          <p className="mt-2 text-sm text-gray-300">
            默认开启二遍识别（enable_nonstream），停止后会等待服务端最终修正结果返回。
          </p>
        </header>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 space-y-4">
            <h2 className="text-lg font-semibold">参数面板</h2>

            <label className="flex items-center justify-between text-sm">
              <span>enable_nonstream（二遍识别）</span>
              <input
                type="checkbox"
                checked={params.enableNonstream}
                disabled={controlsDisabled}
                onChange={(e) => setParams((prev) => ({ ...prev, enableNonstream: e.target.checked }))}
              />
            </label>

            <label className="flex items-center justify-between text-sm">
              <span>enable_itn（文本规范化）</span>
              <input
                type="checkbox"
                checked={params.enableItn}
                disabled={controlsDisabled}
                onChange={(e) => setParams((prev) => ({ ...prev, enableItn: e.target.checked }))}
              />
            </label>

            <label className="flex items-center justify-between text-sm">
              <span>enable_punc（标点）</span>
              <input
                type="checkbox"
                checked={params.enablePunc}
                disabled={controlsDisabled}
                onChange={(e) => setParams((prev) => ({ ...prev, enablePunc: e.target.checked }))}
              />
            </label>

            <label className="flex items-center justify-between text-sm">
              <span>show_utterances（分句信息）</span>
              <input
                type="checkbox"
                checked={params.showUtterances}
                disabled={controlsDisabled}
                onChange={(e) => setParams((prev) => ({ ...prev, showUtterances: e.target.checked }))}
              />
            </label>

            <label className="block text-sm space-y-2">
              <span>end_window_size（200-10000ms）：{params.endWindowSize}</span>
              <input
                type="range"
                min={200}
                max={10000}
                step={100}
                value={params.endWindowSize}
                disabled={controlsDisabled}
                onChange={(e) => setParams((prev) => ({ ...prev, endWindowSize: Number(e.target.value) }))}
                className="w-full"
              />
            </label>

            <div className="rounded border border-gray-700 bg-gray-950 p-3 text-xs text-gray-300">
              <p className="font-medium text-gray-200">WS Query 预览</p>
              <p className="mt-1 break-all font-mono">{queryPreview}</p>
            </div>
          </div>

          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 space-y-4">
            <h2 className="text-lg font-semibold">控制与状态</h2>

            <div className="flex gap-3">
              <button
                onClick={start}
                disabled={status === 'connecting' || status === 'recording' || status === 'finishing'}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg font-medium transition-colors"
              >
                {status === 'connecting' ? '连接中...' : '开始录音'}
              </button>
              <button
                onClick={stop}
                disabled={status !== 'recording' && status !== 'connecting'}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg font-medium transition-colors"
              >
                停止并等待最终结果
              </button>
            </div>

            <div className="text-sm text-gray-300">
              当前状态：
              <span className="ml-2 rounded bg-gray-800 px-2 py-1 text-gray-100">{statusText(status)}</span>
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <p className="text-xs text-gray-400">
              说明：点击“停止”后不会立刻断开，会先发送最后一包并等待服务端返回最终修正文本。
            </p>
          </div>
        </section>

        <section className="rounded-xl border border-gray-800 bg-gray-900 p-4 space-y-3">
          <h2 className="text-lg font-semibold">识别结果</h2>
          <div className="min-h-40 rounded border border-gray-800 bg-gray-950 p-4 text-lg leading-relaxed">
            <span>{transcript}</span>
            {interim && <span className="text-gray-400">{interim}</span>}
            {!transcript && !interim && <span className="text-gray-600">识别结果将显示在这里...</span>}
          </div>

          <div className="rounded border border-gray-800 bg-gray-950 p-3">
            <p className="text-sm font-medium">最近返回帧（最多 20 条）</p>
            <div className="mt-2 max-h-56 overflow-auto space-y-2 text-xs text-gray-300">
              {events.length === 0 && <p className="text-gray-500">暂无返回帧</p>}
              {events.map((event) => (
                <div key={event.id} className="rounded border border-gray-800 p-2">
                  <p>
                    [{event.at}] definite {event.definiteCount}/{event.utteranceCount}
                  </p>
                  <p className="mt-1 break-words text-gray-200">{event.text || '(empty text)'}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-gray-800 bg-gray-900 p-4 space-y-3 text-sm text-gray-200">
          <h2 className="text-lg font-semibold">原理说明（对应官方文档）</h2>
          <ol className="list-decimal pl-5 space-y-2">
            <li>浏览器采集麦克风音频，转为 16kHz PCM 16bit 单声道，通过本地 WebSocket 转发。</li>
            <li>Node 服务端按 Volcengine 二进制协议封包（full client request + audio only request）。</li>
            <li>默认开启 <code>enable_nonstream=true</code>，服务端会进行二遍修正并输出更稳的最终结果。</li>
            <li>点击停止后发送“最后一包”，等待最终结果返回，再由服务端主动关闭连接。</li>
          </ol>
        </section>

        <section className="rounded-xl border border-gray-800 bg-gray-900 p-4 space-y-3 text-sm text-gray-200">
          <h2 className="text-lg font-semibold">注意事项</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>文档建议发包时长 100~200ms；本 Demo 使用 2048 帧（约 128ms @16kHz）。</li>
            <li>
              <code>end_window_size</code> 最小 200ms；越小越容易更早输出 definite，但可能更频繁切句。
            </li>
            <li>演示默认使用 <code>result_type=full</code>，便于观察实时到最终修正的文本覆盖过程。</li>
            <li>如果你要排查线上问题，建议记录服务端返回头里的 <code>X-Tt-Logid</code>。</li>
          </ul>
        </section>
      </div>
    </main>
  )
}
