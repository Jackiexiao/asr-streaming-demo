# Volcengine Streaming ASR Demo（Next.js）

这个目录是火山引擎流式语音识别的开发者演示项目，重点是：

- 浏览器实时录音 + WebSocket 流式发送
- 服务端按官方二进制协议封包/解包
- 支持二遍修正（`enable_nonstream`）并展示最终文本
- 页面内可直接调参并查看返回帧

## 参考开发者文档

- 鉴权文档（豆包语音）：https://www.volcengine.com/docs/6561/107789?lang=zh
- 大模型流式语音识别 API：https://www.volcengine.com/docs/6561/1354869?lang=zh
- 火山引擎官网：https://www.volcengine.com/

> 文档可能迭代，参数字段请以官方文档为准。

## 安全与鉴权说明

本 Demo 使用**服务端代理模式**：

```
Browser WebSocket -> /api/asr-ws (server.js) -> Volcengine WebSocket
```

- `VOLCENGINE_ACCESS_TOKEN` 只在 `server.js` 服务端读取并放到上游请求头
- 浏览器端不会拿到 `secret/token`，也不会直连火山引擎
- 前端仅与本地 `/api/asr-ws` 通信

为什么不是“前端拿临时 token 直连”？

- 流式 WebSocket 接口要求在握手时带自定义请求头（`X-Api-App-Key` / `X-Api-Access-Key` / `X-Api-Resource-Id`）
- 浏览器原生 `WebSocket` API 不能自定义握手 header
- 为了避免把长期密钥放到客户端，采用服务端代理是更稳妥的接入方式

## 环境变量

复制并填写：

```bash
cp .env.example .env.local
```

```env
VOLCENGINE_APP_ID=
VOLCENGINE_ACCESS_TOKEN=
VOLCENGINE_RESOURCE_ID=volc.bigasr.sauc.duration
VOLCENGINE_FILE_RESOURCE_ID=volc.bigasr.auc

# /file 本地上传一键识别所需（R2/S3）
OBJECT_STORAGE_PROVIDER=r2
OBJECT_STORAGE_BUCKET=
OBJECT_STORAGE_REGION=auto
OBJECT_STORAGE_ENDPOINT=
OBJECT_STORAGE_ACCESS_KEY_ID=
OBJECT_STORAGE_SECRET_ACCESS_KEY=
OBJECT_STORAGE_PUBLIC_BASE_URL=
# 可选：未配置 PUBLIC_BASE_URL 时使用签名 URL
OBJECT_STORAGE_SIGNED_URL_TTL_SEC=3600
OBJECT_STORAGE_KEY_PREFIX=volcengine-file-asr

# Volcengine TOS（S3 兼容）别名配置（与 OBJECT_STORAGE_* 二选一）
TOS_ACCESS_KEY=
TOS_SECRET_KEY=
TOS_BUCKET=01mvp-public
TOS_REGION=cn-shanghai
TOS_S3_ENDPOINT=tos-s3-cn-shanghai.volces.com
TOS_PUBLIC_BASE_URL=https://01mvp-public.tos-cn-shanghai.volces.com
```

## 运行

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`。

## 页面可调参数（Demo）

- `enable_nonstream`: 二遍修正（建议开启）
- `enable_itn`: 文本规范化
- `enable_punc`: 自动标点
- `show_utterances`: 返回分句信息
- `end_window_size`: 200-10000ms（尾句判停窗口）

服务端请求固定使用 `result_type=full`，方便开发者观察实时结果到最终修正的覆盖过程。

## 录音文件识别 Demo

新增页面：`/file`

- 标准版文档：https://www.volcengine.com/docs/6561/1354868?lang=zh
- 支持 `submit / query / recognize(提交+轮询)` 三种模式
- 通过本地接口：
  - `POST /api/file-asr/submit`
  - `POST /api/file-asr/query`
  - `POST /api/file-asr/recognize`
  - `POST /api/file-asr/upload-and-recognize`（本地文件上传+识别）
- 页面支持浏览器录音按钮（开始录音/停止录音），录音后可直接上传识别
- 页面输入音频 URL（公网可访问），可调 `enable_itn` / `enable_punc` / 轮询参数
- 页面支持本地音频文件上传，服务端会自动上传到 R2/S3 生成可访问 URL 后识别
- 录音按钮会优先把浏览器录音转换成 `wav(16k)` 后再识别（提高 Chrome / Safari 兼容性）
- 标准版 API 的任务 ID 语义按官方文档实现：
  - `submit` 成功时 **Response Body 为空**
  - 任务 ID 使用请求头 `X-Api-Request-Id`（提交与查询保持一致）
  - `query` 请求体为 `{}`，任务 ID 放在 `X-Api-Request-Id`

说明：文件识别同样使用服务端调用火山引擎，保证密钥只在服务端使用。
说明 2：对象存储层是 S3 兼容调用，已内置 TOS 环境变量别名（`TOS_ACCESS_KEY/TOS_SECRET_KEY/...`）。

## 关键实现位置

- `server.js`: 本地 WS 代理 + 上游连接 + 协议收发
- `server.js`: 也包含文件识别 HTTP API（submit/query/recognize）
- `lib/volc-protocol.js`: 火山协议封包/解包
- `lib/asr-config.js`: Query 参数解析与请求配置构建
- `lib/file-asr-service.js`: 文件识别请求构建、提交、查询、轮询
- `lib/file-upload-service.js`: 本地文件 base64 解析与音频格式推断
- `lib/object-storage.js`: R2/S3 上传与可访问 URL 生成
- `lib/file-asr-demo-client.ts`: 前端调用本地文件识别 API 的客户端
- `app/page.tsx`: 演示 UI、录音控制、调参面板、文档说明
- `app/file/page.tsx`: 录音文件识别演示页

## 调试建议

- 停止录音时页面会进入 `finishing`，最多等待约 6 秒拿最终修正结果
- 建议保留服务端日志中的 `X-Tt-Logid` 以便排查问题
- 文档建议单包时长约 100-200ms，本 Demo 默认约 128ms（2048 帧 @ 16kHz）
