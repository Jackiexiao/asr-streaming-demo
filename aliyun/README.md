# 阿里云 NLS 流式识别（最佳实践 + 可复用版）

`aliyun/` 按阿里云官方安全实践实现：

- 服务端持有 AK/SK，创建并缓存 Token
- 客户端只拿短期 Token，直接连阿里云 NLS WebSocket
- 音频流不经过你的服务端代理

## 为什么 Next.js 开发者更常选这个方案

- 不需要自定义 WebSocket 代理服务器
- 仅依赖 `/api/token` 路由 + 客户端直连阿里云 NLS
- 对函数化部署更友好，运维复杂度更低

## 启动

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

打开 `http://localhost:3000`。

## 环境变量

必填：

```env
ALIYUN_ACCESS_KEY_ID=
ALIYUN_ACCESS_KEY_SECRET=
ALIYUN_APP_KEY=
```

兼容旧命名（可选）：

```env
ALIYUN_ACCESSKEY_ID=
ALIYUN_ACCESSKEY_SECRET=
```

可选：

```env
ALIYUN_APP_KEYS_JSON={"普通话":"xxx","英语":"yyy","粤语":"zzz"}
ALIYUN_TOKEN_REFRESH_AHEAD_SECONDS=7200
```

## 可复用代码结构

- 服务端：`lib/server/`
  - `nls-token.js`：Token 能力与配置解析
  - `token-handler.js`：可直接复用的 `/api/token` 处理器
- 前端：`lib/client/`
  - `types.ts`：类型定义
  - `constants.ts`：脚本/语言/默认配置
  - `aliyun-recorder.ts`：录音与 ASR 封装
- 复用说明：`lib/README.md`

## API 路由（推荐写法）

`app/api/token/route.ts`：

```ts
const { handleTokenRequest } = require('../../../lib/server/token-handler')

export async function GET(req: Request) {
  return handleTokenRequest(req)
}

export async function POST(req: Request) {
  return handleTokenRequest(req)
}
```

## 验证

```bash
pnpm test
pnpm build
```
