# 阿里云 NLS 流式识别（最佳实践版）

`aliyun-asr-codeex/` 是按阿里云文档《移动端应用使用 Token 或 STS 安全访问智能语音交互服务》实现的 Web Demo。

## 架构（Token 最佳实践）

- 浏览器只拿 `appkey + token`（调用 `/api/token`）
- `AccessKeyId / AccessKeySecret` 只保存在服务端
- 前端拿到 Token 后，**直连阿里云 NLS WebSocket**
- 不做音频 WebSocket 代理转发

```
Browser(Recorder.js) --HTTP--> /api/token(Next.js Server)
/api/token --CreateToken(SDK)--> Aliyun NLS Meta
Browser(携带token) --WebSocket--> Aliyun NLS Gateway
```

## 为什么这版是“最佳实践版”

相对旧版 `aliyun/`，这里补齐了官方实践中的关键点：

1. 服务端使用阿里云 POP SDK 调 `CreateToken`（不是前端签名）
2. 服务端内存缓存 Token，并在过期前提前刷新（默认提前 2 小时）
3. 前端不保存长期 AK/SK，不走音频代理
4. 环境变量统一使用新命名：`ALIYUN_ACCESS_KEY_ID` / `ALIYUN_ACCESS_KEY_SECRET`

## 启动

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

打开 `http://localhost:3000`。

## 环境变量

必填：

```bash
ALIYUN_ACCESS_KEY_ID=
ALIYUN_ACCESS_KEY_SECRET=

ALIYUN_APP_KEY=
```

可选：

```bash
# 语言到 AppKey 的映射
ALIYUN_APP_KEYS_JSON={"普通话":"xxx","英语":"yyy","粤语":"zzz"}

# 提前刷新阈值，单位秒，默认 7200（2小时）
ALIYUN_TOKEN_REFRESH_AHEAD_SECONDS=7200
```

## 测试与构建

```bash
pnpm test
pnpm build
```

## 说明

- 该版本聚焦 **实时/一句话** 识别（Token 方案）
- 若做录音文件离线识别，建议按官方 STS 方案单独实现
