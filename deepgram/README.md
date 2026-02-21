# Deepgram Next.js Demo

这是一个基于 Next.js 的 Deepgram 语音识别演示，包含两种能力：

1. 预录音识别（本地文件上传 + 浏览器录音后上传）
2. 流式语音识别（浏览器麦克风实时识别）

## 环境准备

```bash
cp .env.example .env.local
```

在 `.env.local` 中填写：

```bash
DEEPGRAM_API_KEY=your_deepgram_api_key
```

## 启动

```bash
pnpm install
pnpm dev
```

打开：

- 文件识别：`http://localhost:3000`
- 流式识别：`http://localhost:3000/streaming`

## 说明

- WebSocket 代理由 `server.js` 提供，浏览器不会直接暴露 Deepgram API Key。
- 预录音识别 API 在 `app/api/transcribe/route.js`。
- 流式识别默认使用 `nova-2 + zh-CN`，如果选择了不支持的组合（如 `nova-3 + zh-CN`），服务端会自动降级到 `nova-2`。
