# ASR Streaming Demo

多厂商流式语音识别对比 demo，展示如何在生产环境中安全接入各家 ASR 服务。

## 架构

```
浏览器 ──→ 后端 (localhost:3000) ──→ 获取临时 token/签名
浏览器 ──→ 直连厂商 WebSocket（用临时凭证）
```

## 目录结构

```
server/     Node.js token 服务（统一下发临时凭证）
deepgram/   Deepgram 流式识别 demo
aliyun/     阿里云 NLS 流式识别 demo
xunfei/     讯飞实时语音转写 demo
```

## 快速开始

### 1. 启动 token 服务

```bash
cd server
cp .env.example .env   # 填入你的 API Key
npm install
npm start
```

### 2. 打开 demo 页面

```bash
# 需要通过 HTTP 服务器打开（麦克风权限要求）
cd ..
python3 -m http.server 8080
```

然后访问：
- http://localhost:8080/deepgram/
- http://localhost:8080/aliyun/
- http://localhost:8080/xunfei/

## 各厂商申请地址 & 所需参数

| 厂商 | 控制台 | 所需参数 |
|------|--------|---------|
| Deepgram | https://console.deepgram.com/ | `DEEPGRAM_API_KEY` |
| 阿里云 NLS | https://nls-portal.console.aliyun.com/ | `ALIYUN_ACCESS_KEY_ID` `ALIYUN_ACCESS_KEY_SECRET` `ALIYUN_APP_KEY` |
| 讯飞 | https://console.xfyun.cn/services/rtasr | `XUNFEI_APP_ID` `XUNFEI_API_KEY` |

## 临时凭证机制说明

- **Deepgram**：后端调用 `/v1/auth/grant` 生成 30 秒有效的临时 key，客户端用该 key 作为 WebSocket subprotocol 连接
- **阿里云**：后端用 AccessKey 签名换取 NLS Token（有效期 24h），客户端用 token 连接 NLS WebSocket
- **讯飞**：后端用 HMAC-SHA256 对 `appId + timestamp` 签名，生成带签名的 WebSocket URL，客户端直接连接该 URL
