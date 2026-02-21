"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"

const DEFAULT_MODEL = "nova-3"
const DEFAULT_LANGUAGE = "zh-CN"

function pickRecorderMimeType() {
  if (typeof MediaRecorder === "undefined") {
    return ""
  }

  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ]

  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || ""
}

export default function HomePage() {
  const [file, setFile] = useState(null)
  const [recordedBlob, setRecordedBlob] = useState(null)
  const [recordedUrl, setRecordedUrl] = useState("")
  const [isRecording, setIsRecording] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [model, setModel] = useState(DEFAULT_MODEL)
  const [language, setLanguage] = useState(DEFAULT_LANGUAGE)
  const [status, setStatus] = useState("就绪")
  const [error, setError] = useState("")
  const [transcript, setTranscript] = useState("结果会显示在这里…")
  const [wordCount, setWordCount] = useState(0)

  const mediaRecorderRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])

  useEffect(() => {
    return () => {
      if (recordedUrl) {
        URL.revokeObjectURL(recordedUrl)
      }
      stopMediaTracks()
    }
  }, [recordedUrl])

  function stopMediaTracks() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }

  async function startRecording() {
    setError("")
    setStatus("请求麦克风权限中…")

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const mimeType = pickRecorderMimeType()
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)

      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      recorder.onstop = () => {
        const finalType = recorder.mimeType || "audio/webm"
        const blob = new Blob(chunksRef.current, { type: finalType })
        chunksRef.current = []

        if (recordedUrl) {
          URL.revokeObjectURL(recordedUrl)
        }

        setRecordedBlob(blob)
        setRecordedUrl(URL.createObjectURL(blob))
        setStatus("录音已停止，可直接转写")
        setIsRecording(false)
        stopMediaTracks()
      }

      recorder.start(300)
      mediaRecorderRef.current = recorder
      setFile(null)
      setRecordedBlob(null)
      setTranscript("结果会显示在这里…")
      setWordCount(0)
      setStatus("录音中…")
      setIsRecording(true)
    } catch (recordError) {
      setError(recordError.message)
      setStatus("无法开始录音")
      stopMediaTracks()
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop()
    }
  }

  async function submitTranscription() {
    setError("")

    let sourceFile = file
    if (!sourceFile && recordedBlob) {
      sourceFile = new File([recordedBlob], `recording-${Date.now()}.webm`, {
        type: recordedBlob.type || "audio/webm",
      })
    }

    if (!sourceFile) {
      setError("请先录音，或者选择一个音频文件")
      return
    }

    const formData = new FormData()
    formData.append("file", sourceFile)
    formData.append("model", model)
    formData.append("language", language)

    setIsSubmitting(true)
    setStatus("上传并识别中…")
    setTranscript("")
    setWordCount(0)

    try {
      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: formData,
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "识别失败")
      }

      const text = payload.transcript || "(未识别到有效文本)"
      setTranscript(text)
      setWordCount(payload.words?.length || 0)
      setStatus("识别完成")
    } catch (submitError) {
      setError(submitError.message)
      setStatus("识别失败")
    } finally {
      setIsSubmitting(false)
    }
  }

  const activeFileLabel =
    file?.name || (recordedBlob ? `录音片段 (${Math.round(recordedBlob.size / 1024)} KB)` : "未选择")

  return (
    <main>
      <h1>Deepgram 语音识别（Next.js）</h1>
      <p>
        支持两种预录音来源：<strong>本地文件</strong> 或 <strong>浏览器录音</strong>。
        想看实时流式识别，请前往 <Link href="/streaming">流式页面</Link>。
      </p>

      <section className="card">
        <h2>1) 选择文件或先录一段音频</h2>
        <div className="row">
          <input
            type="file"
            accept="audio/*,video/*"
            onChange={(event) => {
              const selected = event.target.files?.[0] || null
              setFile(selected)
              if (selected) {
                setRecordedBlob(null)
                if (recordedUrl) {
                  URL.revokeObjectURL(recordedUrl)
                  setRecordedUrl("")
                }
              }
            }}
          />
          <button onClick={isRecording ? stopRecording : startRecording} className={isRecording ? "secondary" : ""}>
            {isRecording ? "停止录音" : "开始录音"}
          </button>
        </div>

        <p className="status">当前音频来源：{activeFileLabel}</p>
        {recordedUrl ? <audio controls src={recordedUrl} style={{ width: "100%" }} /> : null}
      </section>

      <section className="card">
        <h2>2) 选择识别参数并提交</h2>
        <div className="row">
          <label>
            模型：
            <select value={model} onChange={(event) => setModel(event.target.value)}>
              <option value="nova-3">nova-3</option>
              <option value="nova-2">nova-2</option>
              <option value="base">base</option>
            </select>
          </label>
          <label>
            语言：
            <select value={language} onChange={(event) => setLanguage(event.target.value)}>
              <option value="zh-CN">中文 (zh-CN)</option>
              <option value="en-US">英文 (en-US)</option>
            </select>
          </label>
          <button disabled={isSubmitting || isRecording} onClick={submitTranscription}>
            {isSubmitting ? "识别中…" : "开始识别"}
          </button>
        </div>

        <p className="status">{status}</p>
        {error ? <p className="error">错误：{error}</p> : null}
        <div className="result">{transcript}</div>
        <p className="status">词数：{wordCount}</p>
      </section>
    </main>
  )
}
