'use client'

import Script from 'next/script'
import { useEffect, useRef, useState } from 'react'
import {
  createBlobToTextAsr,
  createRecorderInstance,
  createRealtimeAsr,
  openRecorder,
  startAsr,
} from '@/lib/client/aliyun-recorder'
import { LANGUAGE_OPTIONS, RECORDER_SCRIPTS } from '@/lib/client/constants'
import type { AliyunAsrInstance, RecorderInstance } from '@/lib/client/types'
import styles from './page.module.css'

export default function Page() {
  const [isRecording, setIsRecording] = useState(false)
  const [scriptLoaded, setScriptLoaded] = useState(0)
  const [status, setStatus] = useState('就绪')
  const [lang, setLang] = useState(LANGUAGE_OPTIONS[0])
  const [liveText, setLiveText] = useState('')
  const [finalText, setFinalText] = useState('')
  const [blobText, setBlobText] = useState('')

  const recorderRef = useRef<RecorderInstance | null>(null)
  const asrRef = useRef<AliyunAsrInstance | null>(null)
  const recorderOpenedRef = useRef(false)
  const startPendingRef = useRef(false)
  const lastBlobRef = useRef<Blob | null>(null)

  const scriptsReady = scriptLoaded === RECORDER_SCRIPTS.length

  useEffect(() => {
    return () => {
      recorderRef.current?.close?.()
    }
  }, [])

  function ensureRecorder() {
    if (recorderRef.current) {
      return recorderRef.current
    }

    const instance = createRecorderInstance(asrRef)
    recorderRef.current = instance
    return instance
  }

  function createAsr() {
    return createRealtimeAsr({
      lang,
      onLiveText: setLiveText,
      onStatus: setStatus,
    })
  }

  async function start() {
    if (isRecording || startPendingRef.current) {
      return
    }
    if (!scriptsReady) {
      setStatus('脚本加载中，请稍候...')
      return
    }

    startPendingRef.current = true
    setStatus('正在启动录音...')
    setLiveText('')
    setFinalText('')
    setBlobText('')

    try {
      const recorder = ensureRecorder()
      if (!recorderOpenedRef.current) {
        await openRecorder(recorder, () => {
          recorderOpenedRef.current = true
        })
      }

      const asr = createAsr()
      asrRef.current = asr
      await startAsr(asr)
      recorder.start()
      setIsRecording(true)
      setStatus('录音 + 实时识别中...')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatus(`启动失败: ${message}`)
      asrRef.current = null
    } finally {
      startPendingRef.current = false
    }
  }

  function stop() {
    const recorder = recorderRef.current
    if (!recorder || !isRecording) {
      setStatus('当前没有正在进行的录音')
      return
    }

    setStatus('正在结束识别...')
    const asr = asrRef.current

    recorder.stop(
      (blob) => {
        lastBlobRef.current = blob
        if (!asr) {
          setIsRecording(false)
          setStatus('录音已停止')
          return
        }

        asr.stop(
          (text, abortMessage) => {
            setFinalText(text)
            setLiveText('')
            setIsRecording(false)
            asrRef.current = null
            setStatus(abortMessage ? `识别结束（中断: ${abortMessage}）` : '识别结束')
          },
          (message) => {
            setIsRecording(false)
            asrRef.current = null
            setStatus(`停止识别失败: ${message}`)
          }
        )
      },
      (message) => {
        setIsRecording(false)
        setStatus(`停止录音失败: ${message}`)
      }
    )
  }

  function asrLastRecBlobToText() {
    if (!lastBlobRef.current) {
      setStatus('请先完成一次录音')
      return
    }

    try {
      setStatus('正在识别最后一段录音文件...')
      const asr = createBlobToTextAsr(lang)
      asr.audioToText(
        lastBlobRef.current,
        (text) => {
          setBlobText(text)
          setStatus('录音文件识别完成')
        },
        (message) => setStatus(`录音文件识别失败: ${message}`)
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatus(`录音文件识别失败: ${message}`)
    }
  }

  return (
    <main className={styles.page}>
      {RECORDER_SCRIPTS.map((src) => (
        <Script
          key={src}
          src={src}
          strategy="afterInteractive"
          onLoad={() => setScriptLoaded((count) => count + 1)}
          onError={() => setStatus(`脚本加载失败: ${src}`)}
        />
      ))}

      <section className={styles.panel}>
        <h1>阿里云 NLS 流式语音识别（最佳实践 Token 方案）</h1>
        <p className={styles.description}>
          浏览器仅请求 <code>/api/token</code> 获取短期 Token，音频流不经过本服务端代理。
        </p>

        <div className={styles.controls}>
          <label htmlFor="lang">语言模型</label>
          <select
            id="lang"
            value={lang}
            disabled={isRecording}
            onChange={(event) => setLang(event.target.value)}
          >
            {LANGUAGE_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.controls}>
          <button onClick={isRecording ? stop : start} disabled={!scriptsReady && !isRecording}>
            {isRecording ? '停止录音' : '开始录音 + 识别'}
          </button>
          <button onClick={asrLastRecBlobToText} disabled={isRecording}>
            识别最后一段录音文件
          </button>
        </div>

        <p className={styles.status}>{status}</p>

        <div className={styles.resultBox}>
          <h2>实时结果</h2>
          <p>{liveText || '等待输入...'}</p>
        </div>

        <div className={styles.resultBox}>
          <h2>最终结果</h2>
          <p>{finalText || '停止后显示最终文本'}</p>
        </div>

        <div className={styles.resultBox}>
          <h2>录音文件识别结果</h2>
          <p>{blobText || '点击“识别最后一段录音文件”后显示'}</p>
        </div>
      </section>
    </main>
  )
}
