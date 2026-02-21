'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import {
  queryFileTask,
  readFileAsDataUrl,
  recognizeFileTask,
  submitFileTask,
  syncFileTask,
} from '@/lib/file-asr-demo-client'

type RunStatus = 'idle' | 'running' | 'done' | 'error'

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export default function FileAsrPage() {
  const [audioUrl, setAudioUrl] = useState('')
  const [localFile, setLocalFile] = useState<File | null>(null)
  const [language, setLanguage] = useState('zh')
  const [enableItn, setEnableItn] = useState(true)
  const [corpusText, setCorpusText] = useState('')
  const [pollIntervalMs, setPollIntervalMs] = useState(1000)
  const [timeoutMs, setTimeoutMs] = useState(30000)

  const [taskId, setTaskId] = useState('')
  const [syncText, setSyncText] = useState('')
  const [asyncText, setAsyncText] = useState('')
  const [status, setStatus] = useState<RunStatus>('idle')
  const [error, setError] = useState('')
  const [payloadPreview, setPayloadPreview] = useState('')

  const isBusy = status === 'running'
  const asyncDisabled = isBusy || !audioUrl.trim()

  const commonOptions = useMemo(
    () => ({
      language,
      enableItn,
      corpusText,
      pollIntervalMs,
      timeoutMs,
    }),
    [language, enableItn, corpusText, pollIntervalMs, timeoutMs],
  )

  function resetMessages() {
    setError('')
    setPayloadPreview('')
  }

  async function handleSyncRecognize() {
    try {
      resetMessages()
      setStatus('running')

      const payload: Record<string, unknown> = {
        ...commonOptions,
      }

      if (localFile) {
        payload.audioDataUrl = await readFileAsDataUrl(localFile)
      } else if (audioUrl.trim()) {
        payload.audioUrl = audioUrl.trim()
      } else {
        throw new Error('请先输入音频 URL 或选择本地文件')
      }

      const result = await syncFileTask(payload)
      setSyncText(asText(result?.text))
      setPayloadPreview(JSON.stringify(result, null, 2))
      setStatus('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : '同步识别失败')
      setStatus('error')
    }
  }

  async function handleAsyncSubmit() {
    try {
      resetMessages()
      setStatus('running')
      const result = await submitFileTask({
        ...commonOptions,
        audioUrl: audioUrl.trim(),
      })
      setTaskId(asText(result?.taskId))
      setPayloadPreview(JSON.stringify(result, null, 2))
      setStatus('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : '异步提交失败')
      setStatus('error')
    }
  }

  async function handleAsyncQuery() {
    try {
      resetMessages()
      setStatus('running')
      const result = await queryFileTask({ taskId: taskId.trim() })
      const text = asText(result?.text)
      if (text) {
        setAsyncText(text)
      }
      setPayloadPreview(JSON.stringify(result, null, 2))
      setStatus('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : '任务查询失败')
      setStatus('error')
    }
  }

  async function handleAsyncRecognize() {
    try {
      resetMessages()
      setStatus('running')
      const result = await recognizeFileTask({
        ...commonOptions,
        audioUrl: audioUrl.trim(),
      })
      setTaskId(asText(result?.taskId))
      setAsyncText(asText(result?.text))
      setPayloadPreview(JSON.stringify(result, null, 2))
      setStatus('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : '异步识别失败')
      setStatus('error')
    }
  }

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '28px 16px 44px' }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>阿里云百炼 Qwen3 录音文件识别</h1>
      <p style={{ color: '#64748b', marginBottom: 8 }}>
        同步：<code>qwen3-asr-flash</code>（支持 URL / 本地文件）
      </p>
      <p style={{ color: '#64748b', marginBottom: 12 }}>
        异步：<code>qwen3-asr-flash-filetrans</code>（官方要求可访问 URL）
      </p>
      <p style={{ marginBottom: 18 }}>
        <Link href='/' style={{ color: '#2563eb' }}>
          返回实时识别页面
        </Link>
      </p>

      <section style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <h2 style={{ marginBottom: 10, fontSize: 18 }}>输入</h2>
        <label style={{ display: 'block', marginBottom: 10 }}>
          音频 URL（异步必须）：
          <input
            value={audioUrl}
            onChange={(event) => setAudioUrl(event.target.value)}
            placeholder='https://example.com/demo.wav'
            style={{ display: 'block', width: '100%', marginTop: 6 }}
          />
        </label>

        <label style={{ display: 'block', marginBottom: 10 }}>
          本地文件（同步可用）：
          <input
            type='file'
            accept='audio/*'
            onChange={(event) => {
              const file = event.target.files?.[0] || null
              setLocalFile(file)
            }}
            style={{ display: 'block', marginTop: 6 }}
          />
          {localFile ? <span style={{ color: '#64748b' }}>{localFile.name}</span> : null}
        </label>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
          <label>
            语言：
            <input
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              style={{ marginLeft: 8, width: 80 }}
            />
          </label>
          <label>
            轮询间隔(ms)：
            <input
              type='number'
              value={pollIntervalMs}
              min={300}
              onChange={(event) => setPollIntervalMs(Number(event.target.value) || 1000)}
              style={{ marginLeft: 8, width: 110 }}
            />
          </label>
          <label>
            超时(ms)：
            <input
              type='number'
              value={timeoutMs}
              min={2000}
              onChange={(event) => setTimeoutMs(Number(event.target.value) || 30000)}
              style={{ marginLeft: 8, width: 110 }}
            />
          </label>
          <label>
            <input
              type='checkbox'
              checked={enableItn}
              onChange={(event) => setEnableItn(event.target.checked)}
            />
            <span style={{ marginLeft: 6 }}>启用 ITN</span>
          </label>
        </div>

        <label style={{ display: 'block' }}>
          语料（可选）：
          <input
            value={corpusText}
            onChange={(event) => setCorpusText(event.target.value)}
            placeholder='可填行业术语'
            style={{ display: 'block', width: '100%', marginTop: 6 }}
          />
        </label>
      </section>

      <section style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <h2 style={{ marginBottom: 10, fontSize: 18 }}>操作</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <button type='button' onClick={handleSyncRecognize} disabled={isBusy} style={{ padding: '8px 14px' }}>
            同步识别
          </button>
          <button
            type='button'
            onClick={handleAsyncSubmit}
            disabled={asyncDisabled}
            style={{ padding: '8px 14px' }}
          >
            异步提交
          </button>
          <button
            type='button'
            onClick={handleAsyncQuery}
            disabled={isBusy || !taskId.trim()}
            style={{ padding: '8px 14px' }}
          >
            查询任务
          </button>
          <button
            type='button'
            onClick={handleAsyncRecognize}
            disabled={asyncDisabled}
            style={{ padding: '8px 14px' }}
          >
            一键异步识别
          </button>
        </div>
        {status !== 'idle' ? <p style={{ marginTop: 10 }}>状态：{status}</p> : null}
        {error ? <p style={{ color: '#dc2626', marginTop: 8 }}>{error}</p> : null}
      </section>

      <section style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <h2 style={{ marginBottom: 10, fontSize: 18 }}>结果</h2>
        {taskId ? <p style={{ marginBottom: 8 }}>Task ID: {taskId}</p> : null}

        <h3 style={{ fontSize: 16, marginBottom: 6 }}>同步文本</h3>
        <pre style={{ whiteSpace: 'pre-wrap', minHeight: 40 }}>{syncText || '（暂无）'}</pre>

        <h3 style={{ fontSize: 16, margin: '12px 0 6px' }}>异步文本</h3>
        <pre style={{ whiteSpace: 'pre-wrap', minHeight: 40 }}>{asyncText || '（暂无）'}</pre>
      </section>

      <section style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 16 }}>
        <h2 style={{ marginBottom: 10, fontSize: 18 }}>最近响应</h2>
        <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 360, overflow: 'auto' }}>
          {payloadPreview || '暂无'}
        </pre>
      </section>
    </main>
  )
}
