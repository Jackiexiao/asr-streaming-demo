'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
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

const DOC_LINKS = [
  {
    title: '鉴权文档（豆包语音）',
    href: 'https://www.volcengine.com/docs/6561/107789?lang=zh',
    desc: '鉴权字段、请求头与接入前准备。',
  },
  {
    title: '大模型流式语音识别 API',
    href: 'https://www.volcengine.com/docs/6561/1354869?lang=zh',
    desc: 'WebSocket 协议、参数语义、返回字段与示例。',
  },
  {
    title: '火山引擎语音产品入口',
    href: 'https://www.volcengine.com/',
    desc: '控制台与产品说明总览。',
  },
]

const PARAM_EXPLANATIONS = [
  {
    name: 'enable_nonstream',
    value: 'true',
    detail: '开启二遍识别，停止后返回更稳定的最终修正文本。',
  },
  {
    name: 'end_window_size',
    value: '200-10000',
    detail: '尾句判停窗口（ms），更小更快出句，更大更稳。',
  },
  {
    name: 'result_type',
    value: 'full',
    detail: '返回全量文本，便于开发者观察覆盖与修正过程。',
  },
  {
    name: 'show_utterances',
    value: 'true',
    detail: '携带分句信息，可观察 definite 句段比例。',
  },
]

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
  if (status === 'finishing') return '等待最终修正'
  if (status === 'error') return '错误'
  return '空闲'
}

function statusChipClass(status: Status): string {
  if (status === 'recording') return 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30'
  if (status === 'connecting') return 'bg-sky-500/15 text-sky-300 border-sky-400/30'
  if (status === 'finishing') return 'bg-amber-500/15 text-amber-300 border-amber-400/30'
  if (status === 'error') return 'bg-rose-500/15 text-rose-300 border-rose-400/30'
  return 'bg-slate-500/15 text-slate-300 border-slate-400/30'
}

type ToggleFieldProps = {
  id: string
  label: string
  hint: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}

function ToggleField({ id, label, hint, checked, disabled, onChange }: ToggleFieldProps) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-slate-700/70 bg-slate-900/70 px-3 py-3 transition-colors hover:border-slate-500"
    >
      <span className="space-y-1">
        <span className="block text-sm font-medium text-slate-100">{label}</span>
        <span className="block text-xs text-slate-400">{hint}</span>
      </span>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-5 w-5 cursor-pointer accent-emerald-500 disabled:cursor-not-allowed"
      />
    </label>
  )
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

  const queryPreview = useMemo(() => buildAsrQuery(params), [params])
  const controlsDisabled = status === 'connecting' || status === 'recording' || status === 'finishing'

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
    if (controlsDisabled) {
      return
    }

    setError('')
    setTranscript('')
    setInterim('')
    setEvents([])
    setStatus('connecting')
    finishingRef.current = false

    const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${wsProtocol}://${location.host}/api/asr-ws?${queryPreview}`)
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

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.14),transparent_40%),radial-gradient(circle_at_80%_20%,_rgba(56,189,248,0.16),transparent_45%)]" />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-slate-100 focus:px-3 focus:py-2 focus:text-slate-900"
      >
        跳到主要内容
      </a>

      <div className="relative mx-auto w-full max-w-6xl space-y-6 px-4 py-8 md:py-12">
        <header className="rounded-2xl border border-slate-700/60 bg-slate-900/80 p-6 shadow-2xl shadow-slate-950/50 backdrop-blur">
          <p className="inline-flex rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3 py-1 text-xs font-semibold tracking-wide text-emerald-200">
            Volcengine · Streaming ASR Developer Demo
          </p>
          <h1 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">火山引擎流式语音识别 Demo</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 md:text-base">
            默认开启二遍识别（enable_nonstream），停止后会进入 finishing 状态并等待最终修正结果。
            页面同时展示参数、协议返回帧与开发者文档索引，方便做接入演示。
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-slate-600 bg-slate-800/80 px-3 py-1 text-slate-200">16kHz PCM 单声道</span>
            <span className="rounded-full border border-slate-600 bg-slate-800/80 px-3 py-1 text-slate-200">2048 帧 ≈ 128ms 发包</span>
            <span className="rounded-full border border-slate-600 bg-slate-800/80 px-3 py-1 text-slate-200">服务端代理，不暴露密钥</span>
          </div>
          <div className="mt-4">
            <Link
              href="/file"
              className="inline-flex cursor-pointer rounded-lg border border-slate-500 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-100 transition-colors duration-200 hover:border-slate-300 hover:bg-slate-700"
            >
              查看录音文件识别 Demo →
            </Link>
          </div>
        </header>

        <section id="main-content" className="grid gap-6 lg:grid-cols-[1.35fr_0.95fr]">
          <article className="space-y-6 rounded-2xl border border-slate-700/60 bg-slate-900/80 p-4 shadow-xl shadow-slate-950/30 backdrop-blur md:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">实时识别面板</h2>
              <span className={`rounded-full border px-3 py-1 text-xs font-medium ${statusChipClass(status)}`}>
                {statusText(status)}
              </span>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={start}
                disabled={controlsDisabled}
                className="cursor-pointer rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors duration-200 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {status === 'connecting' ? '连接中...' : '开始录音'}
              </button>
              <button
                onClick={stop}
                disabled={status !== 'recording' && status !== 'connecting'}
                className="cursor-pointer rounded-lg border border-slate-500 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-100 transition-colors duration-200 hover:border-slate-300 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                停止并等待最终结果
              </button>
            </div>

            {error && (
              <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>
            )}

            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-200">识别结果</p>
              <div className="min-h-48 rounded-xl border border-slate-700 bg-slate-950/70 p-4 text-lg leading-relaxed text-slate-100">
                <span>{transcript}</span>
                {interim && <span className="text-slate-400">{interim}</span>}
                {!transcript && !interim && <span className="text-slate-500">识别结果将显示在这里...</span>}
              </div>
            </div>

            <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3">
              <p className="text-sm font-medium text-slate-200">最近返回帧（最多 20 条）</p>
              <div className="mt-2 max-h-64 space-y-2 overflow-auto text-xs text-slate-300">
                {events.length === 0 && <p className="text-slate-500">暂无返回帧</p>}
                {events.map((event) => (
                  <div key={event.id} className="rounded-lg border border-slate-700/80 bg-slate-900/70 p-2">
                    <p className="text-slate-400">
                      [{event.at}] definite {event.definiteCount}/{event.utteranceCount}
                    </p>
                    <p className="mt-1 break-words text-slate-100">{event.text || '(empty text)'}</p>
                  </div>
                ))}
              </div>
            </div>
          </article>

          <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
            <section className="rounded-2xl border border-slate-700/60 bg-slate-900/80 p-4 shadow-xl shadow-slate-950/30 backdrop-blur md:p-5">
              <h2 className="text-lg font-semibold">参数实验台</h2>
              <p className="mt-1 text-xs text-slate-400">录音中将锁定参数，停止后可继续调整。</p>
              <div className="mt-4 space-y-3">
                <ToggleField
                  id="enable_nonstream"
                  label="enable_nonstream（二遍识别）"
                  hint="推荐保持开启，获得最终修正。"
                  checked={params.enableNonstream}
                  disabled={controlsDisabled}
                  onChange={(checked) => setParams((prev) => ({ ...prev, enableNonstream: checked }))}
                />
                <ToggleField
                  id="enable_itn"
                  label="enable_itn（文本规范化）"
                  hint="将口语数字/时间转成更可读格式。"
                  checked={params.enableItn}
                  disabled={controlsDisabled}
                  onChange={(checked) => setParams((prev) => ({ ...prev, enableItn: checked }))}
                />
                <ToggleField
                  id="enable_punc"
                  label="enable_punc（自动标点）"
                  hint="自动补标点，提升可读性。"
                  checked={params.enablePunc}
                  disabled={controlsDisabled}
                  onChange={(checked) => setParams((prev) => ({ ...prev, enablePunc: checked }))}
                />
                <ToggleField
                  id="show_utterances"
                  label="show_utterances（分句信息）"
                  hint="展示 definite 句段，便于调试。"
                  checked={params.showUtterances}
                  disabled={controlsDisabled}
                  onChange={(checked) => setParams((prev) => ({ ...prev, showUtterances: checked }))}
                />

                <label htmlFor="end_window_size" className="block space-y-2 rounded-xl border border-slate-700/70 bg-slate-900/70 px-3 py-3">
                  <span className="block text-sm font-medium text-slate-100">end_window_size（{params.endWindowSize}ms）</span>
                  <span className="block text-xs text-slate-400">范围 200-10000ms，越小出句越快。</span>
                  <input
                    id="end_window_size"
                    type="range"
                    min={200}
                    max={10000}
                    step={100}
                    value={params.endWindowSize}
                    disabled={controlsDisabled}
                    onChange={(e) => setParams((prev) => ({ ...prev, endWindowSize: Number(e.target.value) }))}
                    className="h-2 w-full cursor-pointer accent-emerald-500 disabled:cursor-not-allowed"
                  />
                </label>
              </div>

              <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950/70 p-3">
                <p className="text-xs font-medium text-slate-200">WS Query 预览</p>
                <p className="mt-2 break-all font-mono text-xs text-slate-300">{queryPreview}</p>
              </div>
            </section>

            <section className="rounded-2xl border border-emerald-400/25 bg-emerald-500/5 p-4 text-sm text-emerald-100 shadow-xl shadow-slate-950/30 md:p-5">
              <h3 className="font-semibold">安全说明</h3>
              <p className="mt-2 leading-6 text-emerald-100/90">
                当前 Demo 采用服务端代理模式：浏览器只连接 <code>/api/asr-ws</code>，
                <code>VOLCENGINE_ACCESS_TOKEN</code> 仅在 <code>server.js</code> 中读取并用于服务端到火山引擎的连接头，不会下发到客户端。
              </p>
              <p className="mt-2 leading-6 text-emerald-100/90">
                之所以不是浏览器直接连火山引擎，是因为流式接口依赖自定义握手请求头（如 <code>X-Api-App-Key</code>、
                <code>X-Api-Access-Key</code>），浏览器原生 WebSocket 无法直接设置这些头。
              </p>
            </section>
          </aside>
        </section>

        <section className="grid gap-6 md:grid-cols-2">
          <article className="rounded-2xl border border-slate-700/60 bg-slate-900/80 p-4 shadow-xl shadow-slate-950/30 backdrop-blur md:p-5">
            <h2 className="text-lg font-semibold">开发者文档索引</h2>
            <div className="mt-4 space-y-3">
              {DOC_LINKS.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  target="_blank"
                  rel="noreferrer"
                  className="block cursor-pointer rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-3 transition-colors duration-200 hover:border-slate-500"
                >
                  <p className="text-sm font-medium text-slate-100">{item.title}</p>
                  <p className="mt-1 text-xs text-slate-400">{item.desc}</p>
                  <p className="mt-2 break-all font-mono text-[11px] text-sky-300">{item.href}</p>
                </a>
              ))}
            </div>
          </article>

          <article className="rounded-2xl border border-slate-700/60 bg-slate-900/80 p-4 text-sm text-slate-200 shadow-xl shadow-slate-950/30 backdrop-blur md:p-5">
            <h2 className="text-lg font-semibold">协议与流程</h2>
            <ol className="mt-3 list-decimal space-y-2 pl-5 leading-6 text-slate-300">
              <li>浏览器采集麦克风音频，转换为 16kHz PCM16 单声道帧。</li>
              <li>本地 Node 服务按官方二进制协议封包并转发到火山引擎 WebSocket。</li>
              <li>服务端解析返回帧，优先使用 <code>result.text</code> 展示实时/最终文本。</li>
              <li>停止时发送最后一包并进入 finishing，等待最终修正后再断开。</li>
            </ol>
          </article>

          <article className="rounded-2xl border border-slate-700/60 bg-slate-900/80 p-4 text-sm text-slate-200 shadow-xl shadow-slate-950/30 backdrop-blur md:p-5">
            <h2 className="text-lg font-semibold">关键参数说明</h2>
            <div className="mt-3 space-y-2">
              {PARAM_EXPLANATIONS.map((item) => (
                <div key={item.name} className="rounded-xl border border-slate-700 bg-slate-950/70 p-3">
                  <p className="font-mono text-xs text-sky-300">
                    {item.name} = {item.value}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-300">{item.detail}</p>
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-2xl border border-slate-700/60 bg-slate-900/80 p-4 text-sm text-slate-200 shadow-xl shadow-slate-950/30 backdrop-blur md:p-5">
            <h2 className="text-lg font-semibold">注意事项</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 leading-6 text-slate-300">
              <li>官方建议单包时长约 100-200ms，本 Demo 约 128ms。</li>
              <li>
                <code>end_window_size</code> 最小值为 200ms，过小可能导致切句更频繁。
              </li>
              <li>识别中间态准确率会波动，最终展示应以 nonstream 修正结果为准。</li>
              <li>
                定位线上问题时建议记录日志中的 <code>X-Tt-Logid</code>。
              </li>
            </ul>
          </article>
        </section>
      </div>
    </main>
  )
}
