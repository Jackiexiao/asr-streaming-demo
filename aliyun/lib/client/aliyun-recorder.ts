import { DEFAULT_TOKEN_API, MAX_DURATION_MS } from './constants'
import type { AliyunAsrInstance, RecorderFactory, RecorderInstance } from './types'

export function getRecorderFactory() {
  const Recorder = window.Recorder
  if (!Recorder) {
    throw new Error('Recorder.js 还在加载中，请稍后再试')
  }
  return Recorder
}

export function createRecorderInstance(
  asrRef: { current: AliyunAsrInstance | null },
  factory: RecorderFactory = getRecorderFactory()
) {
  return factory({
    type: 'mp3',
    sampleRate: 16000,
    bitRate: 16,
    onProcess: (
      buffers: Int16Array[],
      _powerLevel: number,
      _duration: number,
      sampleRate: number,
      newBufferIdx: number
    ) => {
      asrRef.current?.input(buffers, sampleRate, newBufferIdx)
    },
  }) as RecorderInstance
}

export function createRealtimeAsr({
  lang,
  onLiveText,
  onStatus,
  tokenApi = DEFAULT_TOKEN_API,
  maxDurationMs = MAX_DURATION_MS,
  factory = getRecorderFactory(),
}: {
  lang: string
  onLiveText: (text: string) => void
  onStatus: (text: string) => void
  tokenApi?: string
  maxDurationMs?: number
  factory?: RecorderFactory
}) {
  return factory.ASR_Aliyun_Short({
    tokenApi,
    apiArgs: { lang },
    asrProcess: (text: string, nextDuration: number, abortMessage = '') => {
      onLiveText(text)
      if (abortMessage) {
        onStatus(`识别中断: ${abortMessage}`)
        return false
      }
      return nextDuration <= maxDurationMs
    },
    log: (message: string) => console.log(`[aliyun-asr] ${message}`),
  }) as AliyunAsrInstance
}

export function createBlobToTextAsr(lang: string, tokenApi = DEFAULT_TOKEN_API) {
  const Recorder = getRecorderFactory()
  return Recorder.ASR_Aliyun_Short({
    tokenApi,
    apiArgs: { lang },
  }) as AliyunAsrInstance
}

export function openRecorder(recorder: RecorderInstance, onOpened?: () => void) {
  return new Promise<void>((resolve, reject) => {
    recorder.open(
      () => {
        onOpened?.()
        resolve()
      },
      (message) => reject(new Error(message))
    )
  })
}

export function startAsr(asr: AliyunAsrInstance) {
  return new Promise<void>((resolve, reject) => {
    asr.start(resolve, (message) => reject(new Error(message)))
  })
}
