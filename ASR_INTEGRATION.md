# Groq ASR 集成 — cobalt 项目改造文档

## 改造概述

在 cobalt 主项目中新增 **Groq Whisper ASR** 能力：
- 有官方字幕 → 直接使用官方字幕（优先）
- 无官方字幕 + `asrEnabled=true` → 下载音频 → Groq Whisper API 转写 → 返回文字字幕

---

## 新增文件

| 文件 | 说明 |
|------|------|
| `api/src/misc/groq-asr.js` | Groq Whisper API 客户端（5 次重试 + 指数退避） |
| `api/src/processing/asr-handler.js` | ASR 处理器（分段下载、Groq 转写、结果合并） |

## 修改文件

| 文件 | 改动 |
|------|------|
| `api/src/core/env.js` | 新增 `groqApiKey` 环境变量读取 |
| `api/src/processing/schema.js` | 新增 `asrEnabled` + `asrLang` 请求字段 |
| `api/src/processing/match.js` | ASR fallback 逻辑（有字幕走字幕，无字幕走 Groq） |
| `api/src/processing/services/bilibili.js` | 返回 `audioUrl` 供 ASR 下载；导入 `asr-handler.js` |

---

## API 新增字段

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `asrEnabled` | boolean | `false` | 启用 ASR 转写（无字幕时） |
| `asrLang` | string | `null` | ISO 639-1 语言代码（`"zh"`, `"en"`, `"ja"` 等），为空则自动检测 |

## 环境变量

| 变量名 | 说明 |
|--------|------|
| `GROQ_API_KEY` | Groq API 密钥（从 https://console.groq.com 获取） |

---

## 调用示例

```bash
# 启用 ASR，请求中文转写
curl -X POST https://your-cobalt.vercel.app/ \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your_api_key" \
  -d '{
    "url": "https://www.bilibili.com/video/BV1xx411c7mD",
    "asrEnabled": true,
    "asrLang": "zh"
  }'

# 返回的 subtitles 字段将包含：
# [
#   {
#     "type": "generated",   ← 或 "subtitles"（官方字幕）
#     "format": "text",
#     "language": "zh",
#     "url": null,
#     "data": [
#       { "start": 0.0, "end": 5.2, "text": "欢迎收看本期视频" },
#       ...
#     ],
#     "warning": null
#   }
# ]
```

---

## ASR 鲁棒性设计

| 机制 | 说明 |
|------|------|
| **5 次重试 + 指数退避** | 500 错误时 1s → 2s → 4s → 8s → 16s 重试 |
| **25 MB 分段** | 音频 > 25 MB 时自动切为 ~6 分钟小块，独立转写后拼接 |
| **单段失败不阻断** | 某段失败超过 5 次重试 → 跳过该段，保留其他成功结果 |
| **asrWarning 警告** | ASR 完全失败时附加 `asrWarning` 到响应 |

---

## Vercel 部署步骤

### 1. 推送代码

```bash
cd /workspaces/cobalt
git add api/src/misc/groq-asr.js api/src/processing/asr-handler.js
git add api/src/core/env.js api/src/processing/schema.js \
       api/src/processing/match.js api/src/processing/services/bilibili.js
git commit -m "feat: add Groq ASR with subtitle-first fallback"
git push
```

### 2. Vercel 环境变量

| Name | Value |
|------|-------|
| `GROQ_API_KEY` | `gsk_iLKVMHh4L...`（你的密钥） |

### 3. Vercel Build Command

```
cd api && npm install && npm run build
```

> ⚠️ 免费版 Vercel **10 秒超时**，ASR 转写（Grok 上传 + 等待）可能超时。解决方案：
> - 使用 **Vercel Pro**（`maxDuration: 60`）
> - 或将 `asrEnabled` 改为**仅在音频 < 5 分钟时启用**，避免超时

---

## 支持平台（当前）

| 平台 | 官方字幕 | ASR Fallback | 说明 |
|------|---------|-------------|------|
| Bilibili | ❌ 未实现（待接入） | ✅ 已完成 | `audioUrl` 字段已添加 |
| YouTube | ✅ 已有 | 需接入 `audioUrl` | 服务已有字幕逻辑 |
| Twitter/X | ✅ HLS 字幕 | ✅ 已完成 | 已有 `audioUrl` |
| Instagram | ❌ 无字幕 | ✅ 可用 | 仅 `asrEnabled` |
| TikTok | ❌ 无字幕 | ✅ 可用 | 仅 `asrEnabled` |
| Reddit | ❌ 无字幕 | ✅ 可用 | 仅 `asrEnabled` |

> **Bilibili 官方字幕**：目前 cobalt bilibili 服务使用 HTML 解析方式，**未接入字幕 API**。biliSub Python 版可获取官方字幕，需移植 `get_subtitle()` 逻辑到 `services/bilibili.js`。

---

*本文件由 GitHub Copilot 自动生成，基于 `/workspaces/cobalt/cobalt` 本地改造验证结果。*