'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  queryFileTask,
  readFileAsDataUrl,
  recognizeFileTask,
  submitFileTask,
  uploadAndRecognizeFileTask,
} from '@/lib/file-asr-demo-client'

type DemoStatus = 'idle' | 'submitting' | 'polling' | 'done' | 'error'
type MicStatus = 'idle' | 'recording' | 'unsupported'
type PipelineStep = 'idle' | 'recording' | 'preparing' | 'uploading' | 'recognizing' | 'done' | 'error'

type StageTimings = {
  recordMs: number | null
  prepareMs: number | null
  uploadMs: number | null
  recognizeMs: number | null
  totalMs: number | null
}

type TimelineEvent = {
  id: number
  at: string
  state: string
  code: number | null
  message: string
  text: string
}

type FileDemoForm = {
  audioUrl: string
  audioFormat: string
  enableItn: boolean
  enablePunc: boolean
  modelName: string
  pollIntervalMs: number
  timeoutMs: number
}

const DEFAULT_FORM: FileDemoForm = {
  audioUrl: '',
  audioFormat: '',
  enableItn: true,
  enablePunc: true,
  modelName: 'bigmodel',
  pollIntervalMs: 1000,
  timeoutMs: 20000,
}

const DOC_LINKS = [
  'https://www.volcengine.com/docs/6561/1354868?lang=zh',
  'https://www.volcengine.com/docs/6561/107789?lang=zh',
]

const EMPTY_STAGE_TIMINGS: StageTimings = {
  recordMs: null,
  prepareMs: null,
  uploadMs: null,
  recognizeMs: null,
  totalMs: null,
}

function statusBadgeClass(status: DemoStatus): string {
  if (status === 'submitting') return 'border-sky-400/30 bg-sky-500/15 text-sky-300'
  if (status === 'polling') return 'border-amber-400/30 bg-amber-500/15 text-amber-300'
  if (status === 'done') return 'border-emerald-400/30 bg-emerald-500/15 text-emerald-300'
  if (status === 'error') return 'border-rose-400/30 bg-rose-500/15 text-rose-300'
  return 'border-slate-400/30 bg-slate-500/15 text-slate-300'
}

function statusText(status: DemoStatus): string {
  if (status === 'submitting') return '提交中'
  if (status === 'polling') return '轮询中'
  if (status === 'done') return '完成'
  if (status === 'error') return '错误'
  return '空闲'
}

function stepBadgeClass(step: PipelineStep): string {
  if (step === 'recording') return 'border-rose-400/30 bg-rose-500/15 text-rose-200'
  if (step === 'preparing') return 'border-violet-400/30 bg-violet-500/15 text-violet-200'
  if (step === 'uploading') return 'border-sky-400/30 bg-sky-500/15 text-sky-300'
  if (step === 'recognizing') return 'border-amber-400/30 bg-amber-500/15 text-amber-300'
  if (step === 'done') return 'border-emerald-400/30 bg-emerald-500/15 text-emerald-300'
  if (step === 'error') return 'border-rose-400/30 bg-rose-500/15 text-rose-300'
  return 'border-slate-400/30 bg-slate-500/15 text-slate-300'
}

function stepText(step: PipelineStep): string {
  if (step === 'recording') return '录音中'
  if (step === 'preparing') return '准备音频'
  if (step === 'uploading') return '上传对象存储'
  if (step === 'recognizing') return '等待识别'
  if (step === 'done') return '流程完成'
  if (step === 'error') return '流程异常'
  return '未开始'
}

function parseTimingMs(value: unknown): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.round(parsed)
}

function formatDuration(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '--'
  if (value < 1000) return `${value} ms`
  return `${(value / 1000).toFixed(value >= 10_000 ? 1 : 2)} s`
}

export default function FileAsrPage() {
  const [form, setForm] = useState<FileDemoForm>(DEFAULT_FORM)
  const [localFile, setLocalFile] = useState<File | null>(null)
  const [localPreviewUrl, setLocalPreviewUrl] = useState('')
  const [micStatus, setMicStatus] = useState<MicStatus>('idle')
  const [pipelineStep, setPipelineStep] = useState<PipelineStep>('idle')
  const [stageTimings, setStageTimings] = useState<StageTimings>(EMPTY_STAGE_TIMINGS)
  const [micError, setMicError] = useState('')
  const [pipelineHint, setPipelineHint] = useState('等待录音或选择文件')
  const [recordSeconds, setRecordSeconds] = useState(0)
  const [status, setStatus] = useState<DemoStatus>('idle')
  const [taskId, setTaskId] = useState('')
  const [uploadedUrl, setUploadedUrl] = useState('')
  const [resultText, setResultText] = useState('')
  const [error, setError] = useState('')
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [latestPayload, setLatestPayload] = useState<string>('')
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const recordChunksRef = useRef<BlobPart[]>([])
  const recordTimerRef = useRef<number | null>(null)
  const recordStartedAtRef = useRef<number | null>(null)

  const canQuery = Boolean(taskId.trim())
  const isBusy = status === 'submitting' || status === 'polling'
  const playbackUrl = uploadedUrl || localPreviewUrl
  const payloadPreview = useMemo(() => {
    return JSON.stringify(
      {
        audioUrl: form.audioUrl,
        audioFormat: form.audioFormat || '(auto)',
        enableItn: form.enableItn,
        enablePunc: form.enablePunc,
        modelName: form.modelName,
        pollIntervalMs: form.pollIntervalMs,
        timeoutMs: form.timeoutMs,
      },
      null,
      2,
    )
  }, [form])

  function pushTimeline(entries: TimelineEvent[]) {
    setTimeline((prev) => [...entries, ...prev].slice(0, 40))
  }

  function buildTimelineEvent(state: string, message: string, text = '', code: number | null = null): TimelineEvent {
    return {
      id: Date.now() + Math.floor(Math.random() * 1000),
      at: new Date().toLocaleTimeString(),
      state,
      code,
      message,
      text,
    }
  }

  function stopRecordTimer() {
    if (recordTimerRef.current !== null) {
      window.clearInterval(recordTimerRef.current)
      recordTimerRef.current = null
    }
  }

  function stopMicTracks() {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    mediaStreamRef.current = null
  }

  function inferRecordedFileName(contentType: string) {
    const now = new Date().toISOString().replace(/[:.]/g, '-')
    if (contentType.includes('ogg')) return `record-${now}.ogg`
    if (contentType.includes('wav')) return `record-${now}.wav`
    if (contentType.includes('mpeg') || contentType.includes('mp3')) return `record-${now}.mp3`
    if (contentType.includes('mp4') || contentType.includes('m4a')) return `record-${now}.m4a`
    return `record-${now}.webm`
  }

  function resampleMono(input: Float32Array, fromRate: number, toRate: number): Float32Array {
    if (fromRate === toRate) return input
    const ratio = fromRate / toRate
    const newLength = Math.max(1, Math.round(input.length / ratio))
    const output = new Float32Array(newLength)
    for (let i = 0; i < newLength; i += 1) {
      const sourceIndex = i * ratio
      const indexLower = Math.floor(sourceIndex)
      const indexUpper = Math.min(input.length - 1, indexLower + 1)
      const weight = sourceIndex - indexLower
      output[i] = input[indexLower] * (1 - weight) + input[indexUpper] * weight
    }
    return output
  }

  function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
    const bytesPerSample = 2
    const blockAlign = bytesPerSample
    const byteRate = sampleRate * blockAlign
    const dataSize = samples.length * bytesPerSample
    const buffer = new ArrayBuffer(44 + dataSize)
    const view = new DataView(buffer)

    function writeString(offset: number, value: string) {
      for (let i = 0; i < value.length; i += 1) {
        view.setUint8(offset + i, value.charCodeAt(i))
      }
    }

    writeString(0, 'RIFF')
    view.setUint32(4, 36 + dataSize, true)
    writeString(8, 'WAVE')
    writeString(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, byteRate, true)
    view.setUint16(32, blockAlign, true)
    view.setUint16(34, 16, true)
    writeString(36, 'data')
    view.setUint32(40, dataSize, true)

    let offset = 44
    for (let i = 0; i < samples.length; i += 1) {
      const s = Math.max(-1, Math.min(1, samples[i]))
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      offset += 2
    }
    return buffer
  }

  async function convertBlobToWavFile(blob: Blob): Promise<File> {
    const arrayBuffer = await blob.arrayBuffer()
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext
    const ctx: AudioContext = new AudioContextCtor()
    try {
      const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0))
      const monoSource = decoded.getChannelData(0)
      const targetRate = 16000
      const mono16k = resampleMono(monoSource, decoded.sampleRate, targetRate)
      const wavBuffer = encodeWav(mono16k, targetRate)
      const now = new Date().toISOString().replace(/[:.]/g, '-')
      return new File([wavBuffer], `record-${now}.wav`, { type: 'audio/wav' })
    } finally {
      void ctx.close().catch(() => {})
    }
  }

  async function runUploadAndRecognize(file: File, opts: { resetTimeline: boolean }) {
    const runStartedAt = performance.now()
    setError('')
    setStatus('submitting')
    setPipelineStep('uploading')
    setResultText('')
    setUploadedUrl('')
    setPipelineHint('正在上传到对象存储并发起识别...')
    setStageTimings((prev) => ({
      ...prev,
      recordMs: opts.resetTimeline ? null : prev.recordMs,
      prepareMs: opts.resetTimeline ? null : prev.prepareMs,
      uploadMs: null,
      recognizeMs: null,
      totalMs: null,
    }))
    if (opts.resetTimeline) {
      setTimeline([buildTimelineEvent('uploading', `开始处理文件：${file.name}`)])
    } else {
      pushTimeline([buildTimelineEvent('uploading', `开始处理文件：${file.name}`)])
    }

    try {
      const dataUrl = await readFileAsDataUrl(file)
      const response: any = await uploadAndRecognizeFileTask({
        fileName: file.name,
        contentType: file.type || undefined,
        fileDataBase64: dataUrl,
        enableItn: form.enableItn,
        enablePunc: form.enablePunc,
        modelName: form.modelName,
        pollIntervalMs: form.pollIntervalMs,
        timeoutMs: form.timeoutMs,
      })

      setTaskId(response.taskId || '')
      setResultText(response?.final?.text || '')
      setUploadedUrl(response?.upload?.url || '')
      setLatestPayload(JSON.stringify(response, null, 2))
      setPipelineHint('上传与识别完成')
      setPipelineStep('done')

      const fallbackTotalMs = Math.round(performance.now() - runStartedAt)
      const responsePrepareMs = parseTimingMs(response?.timings?.prepareMs)
      const responseUploadMs = parseTimingMs(response?.timings?.uploadMs)
      const responseRecognizeMs = parseTimingMs(response?.timings?.recognizeMs)
      const responseTotalMs = parseTimingMs(response?.timings?.totalMs)
      setStageTimings((prev) => ({
        ...prev,
        prepareMs: responsePrepareMs ?? prev.prepareMs,
        uploadMs: responseUploadMs,
        recognizeMs: responseRecognizeMs,
        totalMs: responseTotalMs ?? fallbackTotalMs,
      }))

      const historyEvents: TimelineEvent[] = Array.isArray(response.history)
        ? response.history.map((item: any, index: number) => ({
            id: Date.now() + index,
            at: item.at ? new Date(item.at).toLocaleTimeString() : new Date().toLocaleTimeString(),
            state: item.state || 'unknown',
            code: Number(item.code || 0) || null,
            message: item.message || '',
            text: item.text || '',
          }))
        : []
      pushTimeline([
        buildTimelineEvent(
          'uploaded',
          `已上传：${response?.upload?.key || file.name}${
            responseUploadMs ? `（上传 ${formatDuration(responseUploadMs)}）` : ''
          }${responseRecognizeMs ? `，识别 ${formatDuration(responseRecognizeMs)}` : ''}`,
        ),
        ...historyEvents.reverse(),
      ])
      setStatus('done')
    } catch (err) {
      const message = err instanceof Error ? err.message : '上传并识别失败'
      setError(message)
      setPipelineHint(`流程失败：${message}`)
      pushTimeline([buildTimelineEvent('failed', message)])
      setPipelineStep('error')
      setStageTimings((prev) => ({
        ...prev,
        totalMs: Math.round(performance.now() - runStartedAt),
      }))
      setStatus('error')
    }
  }

  function setupRecorderEvents(recorder: MediaRecorder) {
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordChunksRef.current.push(event.data)
      }
    }

    recorder.onerror = (event) => {
      const message = event instanceof ErrorEvent ? event.message : '录音失败'
      setMicError(message)
      setMicStatus('idle')
      setPipelineStep('error')
      setPipelineHint(`录音失败：${message}`)
      stopRecordTimer()
      stopMicTracks()
    }

    recorder.onstop = async () => {
      stopRecordTimer()
      const recordEndedAt = Date.now()
      const contentType = recorder.mimeType || 'audio/webm'
      const blob = new Blob(recordChunksRef.current, { type: contentType })
      recordChunksRef.current = []
      mediaRecorderRef.current = null
      setMicStatus('idle')
      stopMicTracks()

      const recordedMs = Math.max(
        0,
        recordEndedAt - (recordStartedAtRef.current || recordEndedAt - (recordSeconds * 1000)),
      )
      recordStartedAtRef.current = null
      setStageTimings((prev) => ({
        ...prev,
        recordMs: recordedMs,
        prepareMs: null,
        uploadMs: null,
        recognizeMs: null,
        totalMs: null,
      }))

      if (blob.size === 0) {
        setMicError('录音内容为空，请重试（请至少录 1 秒）')
        setPipelineStep('error')
        setPipelineHint('录音内容为空')
        return
      }

      const rawFile = new File([blob], inferRecordedFileName(contentType), { type: contentType })
      setPipelineHint('录音完成，正在准备文件...')
      setPipelineStep('preparing')
      const prepareStartedAt = performance.now()
      let fileForAsr = rawFile
      if (rawFile.type !== 'audio/wav') {
        try {
          fileForAsr = await convertBlobToWavFile(blob)
        } catch (_) {
          // Fallback to original file if conversion fails.
          fileForAsr = rawFile
        }
      }
      const prepareMs = Math.round(performance.now() - prepareStartedAt)
      setStageTimings((prev) => ({
        ...prev,
        prepareMs,
      }))

      setLocalFile(fileForAsr)
      pushTimeline([buildTimelineEvent('recorded', `录音完成：${fileForAsr.name}`)])
      setPipelineHint('录音已完成，正在自动上传并识别...')
      await runUploadAndRecognize(fileForAsr, { resetTimeline: false })

      /*
       * After auto-run, the user can still click "上传本地文件并识别" to rerun.
       * Keeping localFile in state makes this explicit.
       */
      if (!fileForAsr) {
        setLocalFile(rawFile)
      }
    }
  }

  async function startRecording() {
    if (isBusy || micStatus === 'recording') return

    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setMicStatus('unsupported')
      setPipelineStep('error')
      setMicError('当前浏览器不支持 MediaRecorder 录音')
      return
    }

    setMicError('')
    setError('')
    setPipelineStep('recording')
    setStageTimings({ ...EMPTY_STAGE_TIMINGS })
    setPipelineHint('录音中...')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream
      recordChunksRef.current = []

      const preferredTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
      const mimeType = preferredTypes.find((item) => MediaRecorder.isTypeSupported(item))
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      mediaRecorderRef.current = recorder
      setupRecorderEvents(recorder)
      recorder.start(250)

      setRecordSeconds(0)
      setMicStatus('recording')
      recordStartedAtRef.current = Date.now()
      stopRecordTimer()
      recordTimerRef.current = window.setInterval(() => {
        setRecordSeconds((prev) => prev + 1)
      }, 1000)
    } catch (err) {
      stopMicTracks()
      const message = err instanceof Error ? err.message : '无法访问麦克风'
      setMicError(message)
      setPipelineStep('error')
      setPipelineHint(`无法开始录音：${message}`)
      setMicStatus('idle')
    }
  }

  function stopRecording() {
    if (micStatus !== 'recording') return
    mediaRecorderRef.current?.stop()
  }

  async function handleSubmitOnly() {
    setError('')
    setStatus('submitting')
    setPipelineStep('idle')
    setResultText('')
    try {
      const response: any = await submitFileTask(form)
      setTaskId(response.taskId || '')
      setLatestPayload(JSON.stringify(response, null, 2))
      pushTimeline([
        {
          id: Date.now(),
          at: new Date().toLocaleTimeString(),
          state: 'submitted',
          code: Number(response?.submit?.response?.resp?.code || 0) || null,
          message: response?.submit?.response?.resp?.message || 'Task submitted',
          text: '',
        },
      ])
      setStatus('idle')
    } catch (err) {
      const message = err instanceof Error ? err.message : '提交失败'
      setError(message)
      setPipelineStep('error')
      setStatus('error')
    }
  }

  async function handleQuery() {
    if (!canQuery) return
    setError('')
    setStatus('polling')
    setPipelineStep('recognizing')
    try {
      const response: any = await queryFileTask(taskId.trim())
      setResultText(response.text || '')
      setLatestPayload(JSON.stringify(response, null, 2))
      pushTimeline([
        {
          id: Date.now(),
          at: new Date().toLocaleTimeString(),
          state: response.state || 'unknown',
          code: Number(response.code || 0) || null,
          message: response.message || '',
          text: response.text || '',
        },
      ])
      setStatus(response.state === 'done' ? 'done' : 'idle')
      setPipelineStep(response.state === 'done' ? 'done' : 'recognizing')
    } catch (err) {
      const message = err instanceof Error ? err.message : '查询失败'
      setError(message)
      setPipelineStep('error')
      setStatus('error')
    }
  }

  async function handleRecognize() {
    const startedAt = performance.now()
    setError('')
    setStatus('submitting')
    setPipelineStep('recognizing')
    setPipelineHint('通过音频 URL 发起识别...')
    setResultText('')
    setTimeline([])
    setUploadedUrl('')
    setStageTimings((prev) => ({
      ...prev,
      uploadMs: null,
      recognizeMs: null,
      totalMs: null,
    }))
    try {
      const response: any = await recognizeFileTask(form)
      setTaskId(response.taskId || '')
      setResultText(response?.final?.text || '')
      setLatestPayload(JSON.stringify(response, null, 2))

      const events: TimelineEvent[] = Array.isArray(response.history)
        ? response.history.map((item: any, index: number) => ({
            id: Date.now() + index,
            at: item.at ? new Date(item.at).toLocaleTimeString() : new Date().toLocaleTimeString(),
            state: item.state || 'unknown',
            code: Number(item.code || 0) || null,
            message: item.message || '',
            text: item.text || '',
          }))
        : []
      pushTimeline(events.reverse())
      const fallbackTotalMs = Math.round(performance.now() - startedAt)
      const recognizeMs = parseTimingMs(response?.timings?.recognizeMs)
      const totalMs = parseTimingMs(response?.timings?.totalMs)
      setStageTimings((prev) => ({
        ...prev,
        recognizeMs: recognizeMs ?? fallbackTotalMs,
        totalMs: totalMs ?? fallbackTotalMs,
      }))
      setPipelineStep('done')
      setPipelineHint('URL 识别完成')
      setStatus('done')
    } catch (err) {
      const message = err instanceof Error ? err.message : '识别失败'
      setError(message)
      setPipelineHint(`URL 识别失败：${message}`)
      setPipelineStep('error')
      setStageTimings((prev) => ({
        ...prev,
        totalMs: Math.round(performance.now() - startedAt),
      }))
      setStatus('error')
    }
  }

  async function handleUploadAndRecognize() {
    if (!localFile) {
      setError('请先选择一个本地音频文件')
      return
    }
    await runUploadAndRecognize(localFile, { resetTimeline: true })
  }

  useEffect(() => {
    if (!localFile) {
      setLocalPreviewUrl('')
      return
    }

    const url = URL.createObjectURL(localFile)
    setLocalPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [localFile])

  useEffect(() => {
    return () => {
      stopRecordTimer()
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
      stopMicTracks()
      recordStartedAtRef.current = null
    }
  }, [])

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,_rgba(99,102,241,0.15),transparent_35%),radial-gradient(circle_at_90%_10%,_rgba(34,197,94,0.12),transparent_35%)]" />
      <div className="relative mx-auto w-full max-w-6xl space-y-6 px-4 py-8 md:py-12">
        <header className="rounded-2xl border border-slate-700/60 bg-slate-900/80 p-6 shadow-2xl shadow-slate-950/50 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="inline-flex rounded-full border border-indigo-400/40 bg-indigo-400/10 px-3 py-1 text-xs font-semibold tracking-wide text-indigo-200">
              Volcengine · Audio File ASR
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-3 py-1 text-xs font-medium ${statusBadgeClass(status)}`}>
                API：{statusText(status)}
              </span>
              <span className={`rounded-full border px-3 py-1 text-xs font-medium ${stepBadgeClass(pipelineStep)}`}>
                流程：{stepText(pipelineStep)}
              </span>
            </div>
          </div>

          <h1 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">录音文件识别 Demo（标准版 API）</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 md:text-base">
            这个页面演示提交音频 URL 到火山引擎标准版录音文件识别接口，并支持任务查询与一键轮询到最终文本。
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2">
              <p className="text-[11px] text-slate-400">录音</p>
              <p className="mt-1 font-mono text-xs text-slate-100">{formatDuration(stageTimings.recordMs)}</p>
            </div>
            <div className="rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2">
              <p className="text-[11px] text-slate-400">准备/转码</p>
              <p className="mt-1 font-mono text-xs text-slate-100">{formatDuration(stageTimings.prepareMs)}</p>
            </div>
            <div className="rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2">
              <p className="text-[11px] text-slate-400">上传对象存储</p>
              <p className="mt-1 font-mono text-xs text-slate-100">{formatDuration(stageTimings.uploadMs)}</p>
            </div>
            <div className="rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2">
              <p className="text-[11px] text-slate-400">等待识别结果</p>
              <p className="mt-1 font-mono text-xs text-slate-100">{formatDuration(stageTimings.recognizeMs)}</p>
            </div>
            <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2">
              <p className="text-[11px] text-emerald-200/80">总耗时</p>
              <p className="mt-1 font-mono text-xs font-semibold text-emerald-100">{formatDuration(stageTimings.totalMs)}</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-3 text-sm">
            <Link href="/" className="rounded-lg border border-slate-500 bg-slate-800 px-3 py-1.5 transition-colors hover:border-slate-300 hover:bg-slate-700">
              返回流式识别 Demo
            </Link>
            {DOC_LINKS.map((link) => (
              <a
                key={link}
                href={link}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-slate-600 bg-slate-900/70 px-3 py-1.5 font-mono text-xs text-sky-300 transition-colors hover:border-slate-400"
              >
                文档
              </a>
            ))}
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <article className="space-y-4 rounded-2xl border border-slate-700/60 bg-slate-900/80 p-4 shadow-xl shadow-slate-950/30 backdrop-blur md:p-5">
            <h2 className="text-lg font-semibold">任务输入</h2>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-100">音频 URL（公网可访问）</span>
              <input
                type="url"
                value={form.audioUrl}
                onChange={(e) => setForm((prev) => ({ ...prev, audioUrl: e.target.value }))}
                placeholder="https://example.com/demo.wav"
                className="w-full rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none ring-emerald-400/50 transition focus:ring"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-100">audio format（可留空自动推断）</span>
                <input
                  type="text"
                  value={form.audioFormat}
                  onChange={(e) => setForm((prev) => ({ ...prev, audioFormat: e.target.value }))}
                  placeholder="wav / mp3 / ..."
                  className="w-full rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none ring-emerald-400/50 transition focus:ring"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-100">model_name</span>
                <input
                  type="text"
                  value={form.modelName}
                  onChange={(e) => setForm((prev) => ({ ...prev, modelName: e.target.value }))}
                  className="w-full rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none ring-emerald-400/50 transition focus:ring"
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm">
                <span>enable_itn</span>
                <input
                  type="checkbox"
                  checked={form.enableItn}
                  onChange={(e) => setForm((prev) => ({ ...prev, enableItn: e.target.checked }))}
                  className="h-5 w-5 accent-emerald-500"
                />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm">
                <span>enable_punc</span>
                <input
                  type="checkbox"
                  checked={form.enablePunc}
                  onChange={(e) => setForm((prev) => ({ ...prev, enablePunc: e.target.checked }))}
                  className="h-5 w-5 accent-emerald-500"
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm text-slate-300">poll interval（ms）</span>
                <input
                  type="number"
                  min={300}
                  max={5000}
                  step={100}
                  value={form.pollIntervalMs}
                  onChange={(e) => setForm((prev) => ({ ...prev, pollIntervalMs: Number(e.target.value) }))}
                  className="w-full rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none ring-emerald-400/50 transition focus:ring"
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm text-slate-300">timeout（ms）</span>
                <input
                  type="number"
                  min={3000}
                  max={120000}
                  step={1000}
                  value={form.timeoutMs}
                  onChange={(e) => setForm((prev) => ({ ...prev, timeoutMs: Number(e.target.value) }))}
                  className="w-full rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none ring-emerald-400/50 transition focus:ring"
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-3 pt-1">
              <button
                onClick={handleRecognize}
                disabled={isBusy}
                className="cursor-pointer rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                一键识别（提交 + 轮询）
              </button>
              <button
                onClick={handleSubmitOnly}
                disabled={isBusy}
                className="cursor-pointer rounded-lg border border-slate-500 bg-slate-800 px-4 py-2.5 text-sm font-semibold transition-colors hover:border-slate-300 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                仅提交任务
              </button>
              <button
                onClick={handleQuery}
                disabled={isBusy || !canQuery}
                className="cursor-pointer rounded-lg border border-slate-500 bg-slate-800 px-4 py-2.5 text-sm font-semibold transition-colors hover:border-slate-300 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                查询任务
              </button>
            </div>

            <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3">
              <p className="text-sm font-medium text-slate-100">本地文件一键流程</p>
              <p className="mt-1 text-xs text-slate-400">
                选择本地音频后，服务端自动上传到对象存储（R2/S3）并使用该 URL 调用识别。
              </p>
              <p className="mt-2 rounded border border-slate-700 bg-slate-900/70 px-2 py-1 text-xs text-slate-300">
                流程状态：{pipelineHint}
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-700/80 bg-slate-950/70 px-2 py-1.5 text-[11px] text-slate-300">
                  上传对象存储：<span className="font-mono text-slate-100">{formatDuration(stageTimings.uploadMs)}</span>
                </div>
                <div className="rounded-lg border border-slate-700/80 bg-slate-950/70 px-2 py-1.5 text-[11px] text-slate-300">
                  等待识别返回：<span className="font-mono text-slate-100">{formatDuration(stageTimings.recognizeMs)}</span>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={startRecording}
                  disabled={isBusy || micStatus === 'recording'}
                  className="cursor-pointer rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  开始录音
                </button>
                <button
                  onClick={stopRecording}
                  disabled={micStatus !== 'recording'}
                  className="cursor-pointer rounded-lg border border-slate-500 bg-slate-800 px-3 py-1.5 text-xs font-semibold transition-colors hover:border-slate-300 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  停止录音
                </button>
                <span className="inline-flex items-center rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-300">
                  {micStatus === 'recording' ? `录音中 ${recordSeconds}s` : micStatus === 'unsupported' ? '浏览器不支持录音' : '录音空闲'}
                </span>
              </div>

              {micError && (
                <p className="mt-2 rounded border border-rose-400/25 bg-rose-500/10 px-2 py-1 text-xs text-rose-200">{micError}</p>
              )}

              <label className="mt-3 block space-y-2">
                <span className="text-xs text-slate-300">本地音频文件</span>
                <input
                  type="file"
                  accept="audio/*"
                  onChange={(e) => setLocalFile(e.target.files?.[0] || null)}
                  className="w-full cursor-pointer rounded-lg border border-slate-600 bg-slate-900/80 px-3 py-2 text-xs text-slate-200 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-emerald-500 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-slate-950"
                />
              </label>
              <button
                onClick={handleUploadAndRecognize}
                disabled={isBusy || !localFile}
                className="mt-3 cursor-pointer rounded-lg bg-indigo-500 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                手动上传本地文件并识别
              </button>
              {localFile && (
                <p className="mt-2 text-xs text-slate-400">
                  已选：{localFile.name}（{Math.ceil(localFile.size / 1024)} KB）
                </p>
              )}
            </div>

            {error && (
              <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>
            )}
          </article>

          <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
            <section className="rounded-2xl border border-slate-700/60 bg-slate-900/80 p-4 shadow-xl shadow-slate-950/30 backdrop-blur">
              <h3 className="text-sm font-semibold">当前 Task ID</h3>
              <p className="mt-2 break-all rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 font-mono text-xs text-slate-300">
                {taskId || '尚未提交'}
              </p>
            </section>

            <section className="rounded-2xl border border-slate-700/60 bg-slate-900/80 p-4 shadow-xl shadow-slate-950/30 backdrop-blur">
              <h3 className="text-sm font-semibold">分阶段计时</h3>
              <div className="mt-3 space-y-2 text-xs">
                <div className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2">
                  <span className="text-slate-300">录音</span>
                  <span className="font-mono text-slate-100">{formatDuration(stageTimings.recordMs)}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2">
                  <span className="text-slate-300">准备/转码</span>
                  <span className="font-mono text-slate-100">{formatDuration(stageTimings.prepareMs)}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2">
                  <span className="text-slate-300">上传对象存储</span>
                  <span className="font-mono text-slate-100">{formatDuration(stageTimings.uploadMs)}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2">
                  <span className="text-slate-300">等待识别</span>
                  <span className="font-mono text-slate-100">{formatDuration(stageTimings.recognizeMs)}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2">
                  <span className="text-emerald-200">总耗时</span>
                  <span className="font-mono font-semibold text-emerald-100">{formatDuration(stageTimings.totalMs)}</span>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-emerald-400/25 bg-emerald-500/5 p-4 text-sm text-emerald-100 shadow-xl shadow-slate-950/30">
              <h3 className="font-semibold">为什么不是浏览器直连？</h3>
              <p className="mt-2 leading-6 text-emerald-100/90">
                当前火山引擎语音接口依赖服务端密钥（App Key / Access Key）放在请求头中。为了避免泄露长期凭据，
                Demo 使用服务端 API 代理。流式识别场景里还涉及 WebSocket 自定义握手头，浏览器原生 WebSocket 无法直接设置这些头。
              </p>
            </section>
          </aside>
        </section>

        <section className="grid gap-6 md:grid-cols-2">
          <article className="rounded-2xl border border-slate-700/60 bg-slate-900/80 p-4 shadow-xl shadow-slate-950/30 backdrop-blur md:p-5">
            <h2 className="text-lg font-semibold">识别结果</h2>
            <div className="mt-3 min-h-40 rounded-xl border border-slate-700 bg-slate-950/70 p-4 text-sm leading-6 text-slate-200">
              {resultText || <span className="text-slate-500">识别文本会显示在这里。</span>}
            </div>

            <div className="mt-3 rounded-lg border border-slate-700 bg-slate-950/70 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-slate-200">音频回放</p>
                {uploadedUrl && (
                  <a
                    href={uploadedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded border border-slate-500 px-2 py-1 text-[11px] text-sky-300 transition-colors hover:border-slate-300"
                  >
                    打开上传文件 URL
                  </a>
                )}
              </div>
              {playbackUrl ? (
                <audio controls src={playbackUrl} className="mt-2 w-full" />
              ) : (
                <p className="mt-2 text-xs text-slate-500">暂无可播放音频。录音后或上传本地文件后可预览。</p>
              )}
              <p className="mt-2 text-[11px] text-slate-400">
                {uploadedUrl ? '当前播放源：对象存储 URL' : localFile ? '当前播放源：本地文件预览' : '当前播放源：--'}
              </p>
            </div>

            {uploadedUrl && (
              <div className="mt-3 rounded-lg border border-slate-700 bg-slate-950/70 p-3">
                <p className="text-xs font-medium text-slate-200">上传后的可访问 URL</p>
                <p className="mt-1 break-all font-mono text-xs text-sky-300">{uploadedUrl}</p>
              </div>
            )}
          </article>

          <article className="rounded-2xl border border-slate-700/60 bg-slate-900/80 p-4 shadow-xl shadow-slate-950/30 backdrop-blur md:p-5">
            <h2 className="text-lg font-semibold">请求参数预览</h2>
            <pre className="mt-3 max-h-56 overflow-auto rounded-xl border border-slate-700 bg-slate-950/70 p-3 text-xs text-slate-300">
              {payloadPreview}
            </pre>
          </article>

          <article className="rounded-2xl border border-slate-700/60 bg-slate-900/80 p-4 shadow-xl shadow-slate-950/30 backdrop-blur md:p-5">
            <h2 className="text-lg font-semibold">任务事件</h2>
            <div className="mt-3 max-h-72 space-y-2 overflow-auto text-xs">
              {timeline.length === 0 && <p className="text-slate-500">暂无事件</p>}
              {timeline.map((item) => (
                <div key={item.id} className="rounded-lg border border-slate-700 bg-slate-950/70 p-2 text-slate-300">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-mono text-[11px] text-slate-400">[{item.at}]</p>
                    <span className="rounded border border-slate-600 bg-slate-900/80 px-2 py-0.5 font-mono text-[11px] text-slate-200">
                      {item.state} {item.code ? `(${item.code})` : ''}
                    </span>
                  </div>
                  <p className="mt-1 text-slate-400">{item.message}</p>
                  {item.text && <p className="mt-1 break-words text-slate-200">{item.text}</p>}
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-2xl border border-slate-700/60 bg-slate-900/80 p-4 shadow-xl shadow-slate-950/30 backdrop-blur md:p-5">
            <h2 className="text-lg font-semibold">最近响应（Raw JSON）</h2>
            <pre className="mt-3 max-h-72 overflow-auto rounded-xl border border-slate-700 bg-slate-950/70 p-3 text-xs text-slate-300">
              {latestPayload || '暂无响应'}
            </pre>
          </article>
        </section>
      </div>
    </main>
  )
}
