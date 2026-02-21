export type RecorderInstance = {
  open: (success: () => void, fail: (message: string) => void) => void
  close?: () => void
  start: () => void
  stop: (success: (blob: Blob, duration: number) => void, fail: (message: string) => void) => void
}

export type AliyunAsrInstance = {
  start: (success: () => void, fail: (message: string) => void) => void
  stop: (success: (text: string, abortMessage: string) => void, fail: (message: string) => void) => void
  input: (buffers: Int16Array[], sampleRate: number, offset: number) => void
  audioToText: (blob: Blob, success: (text: string) => void, fail: (message: string) => void) => void
}

export type RecorderFactory = {
  (options: Record<string, unknown>): RecorderInstance
  ASR_Aliyun_Short: (options: Record<string, unknown>) => AliyunAsrInstance
}

declare global {
  interface Window {
    Recorder?: RecorderFactory
  }
}
