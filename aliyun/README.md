# 阿里云 NLS Web 流式识别 Demo

这个 demo 已整合 `Recorder.js + ASR_Aliyun_Short` 的可跑通方案，流程为：

1. 前端加载 `public/recorder` 下的 Recorder.js 脚本。
2. 前端请求 `/api/token` 获取 `appkey + token`。
3. Recorder.js 直接通过 WebSocket 连接阿里云一句话识别服务。
4. 页面支持实时识别、停止后的最终结果、以及“最后一段录音文件转文字”。

## 启动

```bash
pnpm install
cp .env.example .env.local
pnpm run dev
```

打开 `http://localhost:3000`。

## 环境变量

必填：

```bash
ALIYUN_ACCESS_KEY_ID=
ALIYUN_ACCESS_KEY_SECRET=
ALIYUN_APP_KEY=
```

可选（多语言 AppKey 映射）：

```bash
ALIYUN_APP_KEYS_JSON={"普通话":"xxx","英语":"yyy","粤语":"zzz"}
```

当 `ALIYUN_APP_KEYS_JSON` 配置了对应语言时，会优先按 `lang` 取 AppKey；否则回退到 `ALIYUN_APP_KEY`。

## 参考来源

- `https://github.com/Jackiexiao/recoderjs_aliyun_asr_demo`
- 该仓库内的 `src/extensions/asr.aliyun.short.js` 及 Recorder.js 相关脚本已放入 `public/recorder/`。
