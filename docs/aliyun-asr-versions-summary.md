# 阿里云 ASR 实现版本总结（2026-02-21）

## 参考标准

本文对照阿里云官方文档：

- 《移动端应用使用 Token 或 STS 安全访问智能语音交互服务》
- 核心要点：
  - 实时/一句话识别：服务端创建 Token，下发客户端，客户端直连阿里云 WS
  - 录音文件离线识别：使用 STS 临时凭证

## 当前仓库中的阿里云相关版本

| 目录 | 产品线 | 能否运行 | 是否符合上述最佳实践 | 结论 |
|---|---|---|---|---|
| `aliyun/` | 阿里云 NLS | 是 | **基本符合**（服务端签发 Token + 客户端直连） | 可用，但不作为首选 |
| `aliyun-asr-codeex/` | 阿里云 NLS | 是 | **符合**（服务端 SDK CreateToken + Token 复用 + 客户端直连） | ✅ 作为 NLS 主版本 |
| `aliyun-bailian/` | 阿里云百炼 DashScope | 是 | 不适用（不是 NLS Token/STS 文档场景） | 可保留，但不参与 NLS 最佳实践对比 |

## 为什么新增 `aliyun-asr-codeex/`

相比 `aliyun/`，`aliyun-asr-codeex/` 增加/明确了：

1. 服务端通过阿里云 SDK 调 `CreateToken`（官方推荐路径）
2. 服务端内存缓存 Token，默认提前 2 小时刷新
3. 前端仅拿短期 Token，音频不经服务端 WS 代理
4. 兼容两套 AK/SK 环境变量命名（`ALIYUN_ACCESS_KEY_*` 与 `ALIYUN_ACCESSKEY_*`）

## 本次建议

- 如果目标是 **阿里云 NLS 流式识别**：统一迁移到 `aliyun-asr-codeex/`
- `aliyun/` 作为历史兼容示例保留（不再主推）
- `aliyun-bailian/` 因为产品线不同，可继续保留用于 DashScope 对比
