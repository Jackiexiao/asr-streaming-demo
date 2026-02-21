# 阿里云 ASR 实现版本总结（2026-02-21）

## 结论（现在只保留两个主示例）

- `aliyun/`：阿里云 NLS（智能语音交互）最佳实践版
- `aliyun-bailian/`：阿里云百炼（DashScope）示例

## 两个示例的差异

| 目录 | 产品线 | 实时链路 | 鉴权方式 | 适用场景 |
|---|---|---|---|---|
| `aliyun/` | 阿里云 NLS | 浏览器直连 NLS WebSocket | 服务端 CreateToken（AK/SK 仅服务端保存） | NLS 一句话/实时识别 |
| `aliyun-bailian/` | 阿里云百炼 DashScope | 浏览器 -> 你的服务端 WS -> DashScope WS | 服务端 `DASHSCOPE_API_KEY` 代理调用 | 百炼模型生态（Realtime + 文件识别） |

## 关于“服务端 WS 代理”的说明

`aliyun-bailian/` 的代理方式在技术上是可行的，也能保护 API Key 不暴露到前端；
但比“客户端直连上游”多一跳网络，通常会带来少量额外延迟与服务端转发开销。

对 Next.js 开发者（尤其偏向函数/边缘部署）通常更建议优先 `aliyun/`：
不需要维护自定义 WebSocket 代理服务器，部署复杂度更低。

## 仓库建议

- 做阿里云 NLS：优先 `aliyun/`
- 做阿里云百炼：使用 `aliyun-bailian/`
- 旧版 NLS 示例已删除（统一收敛到当前 `aliyun/` 最佳实践版）
