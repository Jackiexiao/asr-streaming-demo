# ASR Streaming Demo

多厂商流式语音识别对比，每个厂商是独立的 Next.js App Router 应用。

## 架构

```
浏览器 → /api/token（Next.js Route Handler，密钥在服务端）→ 获取临时凭证
浏览器 → 直连厂商 WebSocket（用临时凭证）
```

## 目录

| 目录 | 厂商 | 申请地址 |
|------|------|---------|
| `deepgram/` | Deepgram | https://console.deepgram.com |
| `aliyun/` | 阿里云 NLS | https://nls-portal.console.aliyun.com |
| `xunfei/` | 讯飞实时语音转写 | https://console.xfyun.cn/services/rtasr |

## 快速开始

```bash
cd deepgram          # 或 aliyun / xunfei
cp .env.example .env.local
# 填入对应的 API Key
npm install
npm run dev          # http://localhost:3000
```

## 各厂商所需参数

**Deepgram** — `deepgram/.env.example`
- `DEEPGRAM_API_KEY`

**阿里云** — `aliyun/.env.example`
- `ALIYUN_ACCESS_KEY_ID` / `ALIYUN_ACCESS_KEY_SECRET` / `ALIYUN_APP_KEY`

**讯飞** — `xunfei/.env.example`
- `XUNFEI_APP_ID` / `XUNFEI_API_KEY`

## 临时凭证机制

- **Deepgram**：`/api/token` 调用 `/v1/auth/grant` 生成 30s 临时 key，客户端用 WebSocket subprotocol 传递
- **阿里云**：`/api/token` 用 AccessKey HMAC-SHA1 签名换取 NLS Token（24h 有效），客户端用 token 连接
- **讯飞**：`/api/token` 用 HMAC-SHA256 对 `appId+timestamp` 签名，返回带签名的 WebSocket URL
