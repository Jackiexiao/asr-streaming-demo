"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"

import audioUtils from "../../lib/audio"

const { float32ToInt16 } = audioUtils

const DEFAULT_MODEL = "nova-2"
const DEFAULT_LANGUAGE = "zh-CN"

export default function StreamingPage() {
  const [isStreaming, setIsStreaming] = useState(false)
  const [status, setStatus] = useState("就绪")
  const [interimText, setInterimText] = useState("")
  const [finalText, setFinalText] = useState("")
  const [error, setError] = useState("")
  const [model, setModel] = useState(DEFAULT_MODEL)
  const [language, setLanguage] = useState(DEFAULT_LANGUAGE)

  const wsRef = useRef(null)
  const streamRef = useRef(null)
  const audioContextRef = useRef(null)
  const sourceRef = useRef(null)
  const processorRef = useRef(null)

  useEffect(() => {
    return () => {
      stopStreaming()
    }
  }, [])

  async function startStreaming() {
    setError("")
    setInterimText("")
    setFinalText("")
    setStatus("建立 WebSocket 连接中…")

    const protocol = window.location.protocol === "https:" ? "wss" : "ws"
    const query = new URLSearchParams({ model, language })
    const ws = new WebSocket(`${protocol}://${window.location.host}/api/stream?${query.toString()}`)
    wsRef.current = ws

    ws.onopen = () => {
      setStatus("已连接到本地代理，等待 Deepgram 准备…")
    }

    ws.onmessage = async (event) => {
      let payload
      try {
        payload = JSON.parse(event.data)
      } catch {
        return
      }

      if (payload.error) {
        setError(payload.error)
        setStatus("流式识别出错")
        return
      }

      if (payload.type === "connected") {
        if (payload.fallback) {
          setModel(payload.fallback.effective)
          setStatus(`已连接，模型自动从 ${payload.fallback.requested} 切换为 ${payload.fallback.effective}`)
        } else {
          setStatus("已连接，麦克风采集中…")
        }
        try {
          await setupMicrophone()
          setIsStreaming(true)
        } catch (micError) {
          setError(micError.message)
          setStatus("麦克风初始化失败")
          stopStreaming()
        }
        return
      }

      const chunk = payload.channel?.alternatives?.[0]?.transcript?.trim()
      if (!chunk) {
        return
      }

      if (payload.is_final) {
        setFinalText((prev) => (prev ? `${prev} ${chunk}` : chunk))
        setInterimText("")
      } else {
        setInterimText(chunk)
      }
    }

    ws.onerror = () => {
      setError("WebSocket 连接失败")
      setStatus("连接错误")
    }

    ws.onclose = () => {
      teardownAudio()
      setIsStreaming(false)
      setStatus("已断开连接")
    }
  }

  async function setupMicrophone() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    })

    streamRef.current = stream

    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    const audioContext = new AudioContextClass({ sampleRate: 16000 })
    audioContextRef.current = audioContext

    const source = audioContext.createMediaStreamSource(stream)
    sourceRef.current = source

    const processor = audioContext.createScriptProcessor(4096, 1, 1)
    processorRef.current = processor

    const silentGain = audioContext.createGain()
    silentGain.gain.value = 0

    processor.onaudioprocess = (event) => {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return
      }

      const floatData = event.inputBuffer.getChannelData(0)
      const pcm16 = float32ToInt16(floatData)
      ws.send(pcm16.buffer)
    }

    source.connect(processor)
    processor.connect(silentGain)
    silentGain.connect(audioContext.destination)
  }

  function teardownAudio() {
    if (processorRef.current) {
      processorRef.current.disconnect()
      processorRef.current.onaudioprocess = null
      processorRef.current = null
    }

    if (sourceRef.current) {
      sourceRef.current.disconnect()
      sourceRef.current = null
    }

    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }

  function stopStreaming() {
    teardownAudio()

    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "CloseStream" }))
      ws.close()
    } else if (ws && ws.readyState === WebSocket.CONNECTING) {
      ws.close()
    }

    wsRef.current = null
    setIsStreaming(false)
    setStatus("已停止")
  }

  return (
    <main>
      <h1>Deepgram 流式语音识别</h1>
      <p>
        浏览器音频通过 <code>/api/stream</code> 代理转发到 Deepgram，API Key 只存在服务端。
      </p>

      <section className="card">
        <div className="row">
          <label>
            模型：
            <select disabled={isStreaming} value={model} onChange={(event) => setModel(event.target.value)}>
              <option value="nova-2">nova-2（中文推荐）</option>
              <option value="nova-3">nova-3（英文更稳）</option>
            </select>
          </label>
          <label>
            语言：
            <select disabled={isStreaming} value={language} onChange={(event) => setLanguage(event.target.value)}>
              <option value="zh-CN">中文 (zh-CN)</option>
              <option value="en-US">英文 (en-US)</option>
            </select>
          </label>
          <button onClick={isStreaming ? stopStreaming : startStreaming} className={isStreaming ? "secondary" : ""}>
            {isStreaming ? "停止流式识别" : "开始流式识别"}
          </button>
        </div>

        <p className="status">{status}</p>
        {error ? <p className="error">错误：{error}</p> : null}

        <h2 style={{ marginTop: 20 }}>实时中间结果</h2>
        <div className="result" style={{ minHeight: 70, color: "#6b7280", fontStyle: "italic" }}>
          {interimText || "(等待说话…)"}
        </div>

        <h2 style={{ marginTop: 20 }}>最终结果</h2>
        <div className="result">{finalText || "(最终结果会累计在这里…)"}</div>
      </section>

      <p style={{ marginTop: 16 }}>
        <Link href="/">← 回到文件识别页面</Link>
      </p>
    </main>
  )
}
