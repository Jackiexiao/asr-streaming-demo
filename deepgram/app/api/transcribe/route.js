import { NextResponse } from "next/server"
import { createClient } from "@deepgram/sdk"

import deepgramUtils from "../../../lib/deepgram"

const { extractTranscript } = deepgramUtils

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

let deepgramClient = null

function getDeepgramClient() {
  const apiKey = process.env.DEEPGRAM_API_KEY
  if (!apiKey) {
    throw new Error("服务端未配置 DEEPGRAM_API_KEY")
  }

  if (!deepgramClient) {
    deepgramClient = createClient(apiKey)
  }

  return deepgramClient
}

export async function POST(request) {
  try {
    const formData = await request.formData()
    const file = formData.get("file")

    if (!file || typeof file.arrayBuffer !== "function") {
      return NextResponse.json({ error: "请上传音频文件" }, { status: 400 })
    }

    const model = formData.get("model") || "nova-3"
    const language = formData.get("language") || "zh-CN"

    const arrayBuffer = await file.arrayBuffer()
    if (!arrayBuffer.byteLength) {
      return NextResponse.json({ error: "上传文件为空" }, { status: 400 })
    }

    const buffer = Buffer.from(arrayBuffer)
    const deepgram = getDeepgramClient()

    const response = await deepgram.listen.prerecorded.transcribeFile(
      buffer,
      {
        model,
        language,
        punctuate: true,
        smart_format: true,
        mimetype: file.type || "audio/webm",
      },
    )

    const resultPayload = response?.result?.results || response?.results || null
    const { transcript, words } = extractTranscript({ results: resultPayload })

    return NextResponse.json({ transcript, words })
  } catch (error) {
    const message = error?.message || "识别失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
