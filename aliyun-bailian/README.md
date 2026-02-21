# Aliyun Bailian ASR Demo (Next.js)

阿里云百炼语音识别示例，包含：

- 实时语音识别（`qwen3-asr-flash-realtime-2026-02-10`）
- 录音文件同步识别（`qwen3-asr-flash`）
- 录音文件异步识别（`qwen3-asr-flash-filetrans`）

## 安全设计

本项目使用 **Next.js + Node 自定义服务器**：

- 浏览器只连接本地接口：
  - `ws://localhost:3000/api/realtime-ws`
  - `/api/file-asr/*`
- `DASHSCOPE_API_KEY` 仅在服务端读取（`server.js`）
- 前端不会拿到 API Key

## 部署注意

该示例依赖自定义 Node 服务器（`server.js`）来做 WebSocket 代理（`/api/realtime-ws`）。
如果你的部署方式不适合运行常驻 WebSocket 代理进程，建议改用 `aliyun/`（NLS Token 直连方案）。

## 环境变量

复制并填写：

```bash
cp .env.example .env.local
```

`.env.local`：

```env
DASHSCOPE_API_KEY=sk-xx
```

## 安装与运行

```bash
pnpm install
pnpm dev
```

打开：

- 实时识别页面：`http://localhost:3000/`
- 文件识别页面：`http://localhost:3000/file`

## 可用脚本

```bash
pnpm dev
pnpm test
pnpm lint
pnpm build
pnpm start
```

## 文件识别 API

- `POST /api/file-asr/sync`
  - 同步识别，支持 `audioUrl` 或 `audioDataUrl`
- `POST /api/file-asr/submit`
  - 异步提交，返回 `taskId`（需要 `audioUrl`）
- `POST /api/file-asr/query`
  - 查询异步任务状态（传 `taskId`）
- `POST /api/file-asr/recognize`
  - 服务端一键“提交 + 轮询”

> 注意：异步模型官方接口需要可访问的 `audioUrl`。本地文件请优先使用同步识别。

## 主要实现位置

- `server.js`：
  - DashScope Realtime WebSocket 代理
  - 文件识别同步/异步 API
- `app/page.tsx`：实时识别页面
- `app/file/page.tsx`：文件识别页面
- `lib/file-asr.js`：文件识别请求构建与结果解析
- `lib/audio.js` / `lib/realtime-transcript.js`：公共处理函数
- `test/lib/*.test.js`：Node 内置测试
