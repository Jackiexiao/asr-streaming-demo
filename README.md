# Web 端流式语音识别 Demo 合集

> 为什么要建这个仓库？因为我被坑惨了。

## 背景与吐槽

### 为什么不用录音文件识别？

最简单的语音识别方案是录音文件识别：录完音 → 上传 MP3/WAV 到对象存储 → 调 API → 拿结果。但这个方案有个致命问题：**延迟极高**。录音越长，等待越久，用户体验极差。

所以只要你想做实时语音输入，就必须上**流式语音识别**（Streaming ASR）。

### 流式 ASR 的坑

流式 ASR 比文件识别复杂得多，接入比较复杂，直接让 AI 写容易有 bug

1. **需要 WebSocket**：不是一次 HTTP 请求，而是持久连接，边说边传边出结果
2. **鉴权麻烦**：API Key 不能暴露在前端，需要服务端签名/换取临时凭证，再让客户端直连厂商 WebSocket
3. **音频格式有要求**：通常需要 PCM 16kHz 16bit，浏览器 `AudioContext` 采集到的 Float32 需要手动转换
4. **各家协议不统一**：消息格式、事件名、鉴权方式全都不一样，文档写得一言难尽

### 为什么不用浏览器原生语音识别？

浏览器自带 `webkitSpeechRecognition` / `SpeechRecognition`，看起来最省事，但问题很多：

- **Chrome**：音频直接发给 Google 服务器，你无法控制用哪家 ASR，中文效果也一般
- **Firefox**：完全不支持
- **Safari**：支持，但功能残缺，interim result 行为不一致
- **无法定制**：不能换模型、加热词、调参数，识别结果拿到就是拿到，出错了你也没辙
- **隐私问题**：音频数据流向浏览器厂商服务器，ToB 场景基本不可接受

所以只要对准确率、延迟、可控性有要求，就得自己接 ASR API。`chrome-safari-asr/` 目录里有个原生方案的 demo，仅供对比参考。

### Deepgram 的体验对比

用完国内厂商再去用 [Deepgram](https://deepgram.com)，真的是降维打击。它的 onboarding 会先问你：你是技术人员还是非技术人员？你想先体验什么？然后一步步引导你跑通 demo。整个接入体验流畅到离谱。

这个仓库的目的就是：**把我踩过的坑整理成可以直接跑的 demo，让后来的开发者少受点罪。**

---

## 已跑通的方案

| 目录 | 厂商 | 鉴权方式 | 状态 |
|------|------|---------|------|
| `deepgram/` | [Deepgram](https://console.deepgram.com) | 服务端换临时 key（30s），客户端直连 | ✅ |
| `aliyun/` | [阿里云 NLS](https://nls-portal.console.aliyun.com) | 服务端 SDK CreateToken + Token 复用，客户端直连 | ✅（推荐） |
| `aliyun-bailian/` | [阿里云百炼](https://dashscope.console.aliyun.com) | 服务端 WebSocket 代理（DashScope Realtime） | ✅（不同产品线） |
| `volcengine/` | [火山引擎](https://console.volcengine.com/speech) | 服务端代理 WebSocket（双向转发） | ✅ |

---

## 架构说明

大多数方案的架构：

```
浏览器麦克风
    ↓ PCM 音频流
浏览器 WebSocket → 厂商 WebSocket（用临时凭证直连）
                        ↓
                   实时识别结果 → 浏览器展示

服务端 /api/token（只负责签名/换凭证，不转发音频）
```

火山引擎因为鉴权复杂，采用服务端代理：

```
浏览器 WebSocket → 本地 server.js → 火山引擎 WebSocket
```

为什么不是浏览器直接拿临时 token 连火山引擎？

- 火山引擎流式接口要求握手时带自定义 header（如 `X-Api-App-Key`、`X-Api-Access-Key`）
- 浏览器原生 `WebSocket` 不支持自定义握手 header
- 所以 Web 端一般采用服务端代理转发，避免在前端暴露长期密钥

### 火山引擎参考文档

火山引擎这套 demo 主要参考下面两篇官方文档：

- [鉴权方法（豆包语音）](https://www.volcengine.com/docs/6561/107789?lang=zh)：说明签名和鉴权参数，`volcengine/server.js` 按这个流程做请求签名。
- [大模型流式语音识别 API（豆包语音）](https://www.volcengine.com/docs/6561/1354869?lang=zh)：定义 WebSocket 接口和消息协议，`volcengine/lib/volc-protocol.js` 按这个协议封包/解包。
- [录音文件识别（标准版）](https://www.volcengine.com/docs/6561/1354868?lang=zh)：`volcengine/app/file` 页面支持 URL 模式和“本地上传到 R2/S3 后识别”模式。

> 文档可能迭代，若遇到字段或错误码变动，请以火山引擎官方文档为准。

---

## 快速开始

```bash
cd deepgram          # 或 aliyun / aliyun-bailian / volcengine
cp .env.example .env.local
# 填入对应的 API Key（见下方）
pnpm install
pnpm run dev         # http://localhost:3000
```

### 阿里云 NLS 最佳实践对齐说明

根据阿里云文档《移动端应用使用 Token 或 STS 安全访问智能语音交互服务》：

- 实时/一句话识别：推荐 **服务端创建 Token，下发给客户端，客户端直连阿里云 WebSocket**
- 录音文件离线识别：推荐 **STS 临时凭证**（不是实时流式场景）

本仓库里如果你要做 NLS 实时流式识别，优先使用 `aliyun/`。

> 说明：旧版阿里云 NLS 示例已移除，当前 `aliyun/` 为统一维护的最佳实践版本。

### 阿里云两个示例的区别

- `aliyun/`：阿里云 **NLS（智能语音交互）**，服务端创建 Token，浏览器直连 NLS WebSocket（实时场景优先）
- `aliyun-bailian/`：阿里云 **百炼 DashScope**，服务端代理 WebSocket（模型与接口体系不同，适合百炼生态）
- 对 Next.js 开发者（尤其部署到 Vercel/函数平台）通常更推荐 `aliyun/`：它不需要在部署平台上维护 WebSocket 代理服务器。

两者都可用于实时语音识别，但属于不同产品线，鉴权与接入方式也不同。

部署提示：`aliyun-bailian/` 依赖自定义 Node 服务器（`server.js` + `ws`）做代理，更适合可常驻进程的部署方式；`aliyun/` 只需要常规 Next.js 路由能力。

### 各厂商所需环境变量

**Deepgram**
```
DEEPGRAM_API_KEY=
```

**阿里云 NLS**
```
ALIYUN_ACCESS_KEY_ID=
ALIYUN_ACCESS_KEY_SECRET=
ALIYUN_APP_KEY=
```

**火山引擎**
```
VOLCENGINE_APP_ID=
VOLCENGINE_ACCESS_TOKEN=
VOLCENGINE_RESOURCE_ID=volc.bigasr.sauc.duration
# 小时版：volc.seedasr.sauc.duration
# 并发版：volc.seedasr.sauc.concurrent
```

---

## 关键实现细节

**浏览器音频采集 → PCM 转换**（各方案通用）

```js
const ctx = new AudioContext({ sampleRate: 16000 })
const processor = ctx.createScriptProcessor(4096, 1, 1)
processor.onaudioprocess = (ev) => {
  const f32 = ev.inputBuffer.getChannelData(0)
  const i16 = new Int16Array(f32.length)
  for (let i = 0; i < f32.length; i++)
    i16[i] = Math.max(-32768, Math.min(32767, f32[i] * 32768))
  ws.send(i16.buffer)  // 发送 PCM 16bit
}
```

---

## 另外对比一下编程能力

至少在这个场景中 opus4.6 生成的bug 很多， 反倒是 gpt codex 5.3 效果最好

## License

MIT
