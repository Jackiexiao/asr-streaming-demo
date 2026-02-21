# aliyun Library 复用指南

这个目录把阿里云 NLS 的实现拆成了可复用模块，方便迁移到其他 Next.js 项目。

## 目录结构

- `lib/server/nls-token.js`
  - Token 创建、环境变量读取、AppKey 选择、过期判断
- `lib/server/token-handler.js`
  - `/api/token` 的完整服务端处理（含内存缓存与提前刷新）
- `lib/client/types.ts`
  - Recorder.js 与 ASR 扩展的 TS 类型
- `lib/client/constants.ts`
  - 脚本路径、语言选项、默认 tokenApi 等
- `lib/client/aliyun-recorder.ts`
  - 前端录音/ASR 的复用函数（创建 recorder、start/stop、blob 转文本）

## 在其他项目里复用

1. 复制以下文件：
   - `lib/server/nls-token.js`
   - `lib/server/token-handler.js`
   - `lib/client/types.ts`
   - `lib/client/constants.ts`
   - `lib/client/aliyun-recorder.ts`
   - `public/recorder/`（Recorder.js 运行时脚本）
2. 新建或替换你的 `app/api/token/route.ts`：

```ts
const { handleTokenRequest } = require('../../../lib/server/token-handler')

export async function GET(req: Request) {
  return handleTokenRequest(req)
}

export async function POST(req: Request) {
  return handleTokenRequest(req)
}
```

3. 页面里引入 `lib/client/aliyun-recorder.ts` 和 `RECORDER_SCRIPTS`，按 `app/page.tsx` 的方式接入。

## 必要环境变量

```env
ALIYUN_ACCESS_KEY_ID=xxx
ALIYUN_ACCESS_KEY_SECRET=xxx
ALIYUN_APP_KEY=xxx
```

兼容旧命名（可选）：

```env
ALIYUN_ACCESSKEY_ID=xxx
ALIYUN_ACCESSKEY_SECRET=xxx
```

可选配置：

```env
ALIYUN_APP_KEYS_JSON={"普通话":"xxx","英语":"yyy"}
ALIYUN_TOKEN_REFRESH_AHEAD_SECONDS=7200
```
