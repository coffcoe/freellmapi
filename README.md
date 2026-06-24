<div align="center">

# FreeLLMAPI

**一个 OpenAI 兼容端点。十六个免费大语言模型提供商。每月约 17 亿 tokens。**

将 Google、Groq、Cerebras、NVIDIA、Mistral、OpenRouter、GitHub Models、Cohere、Cloudflare、HuggingFace、智谱 AI（GLM）、Ollama、Kilo、Pollinations、LLM7、OVH AI Endpoints、OpenCode Zen 的免费额度聚合在同一个 `/v1/chat/completions` 端点后。API 密钥加密存储。路由器为每个请求选择最佳可用模型，当某个提供商限流时自动回退到下一个，并跟踪每个密钥的使用量，确保不超出免费额度上限。

[![CI](https://github.com/tashfeenahmed/freellmapi/actions/workflows/ci.yml/badge.svg)](https://github.com/tashfeenahmed/freellmapi/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)
[![Docker image](https://img.shields.io/badge/ghcr.io-freellmapi-2496ED?logo=docker&logoColor=white)](https://github.com/tashfeenahmed/freellmapi/pkgs/container/freellmapi)

**[freellmapi.co](https://freellmapi.co)** — 浏览实时模型目录

![回退链与按提供商 token 预算](repo-assets/fallback-chain.png)

</div>

---

## 目录

- [项目背景](#项目背景)
- [支持的提供商](#支持的提供商)
- [功能特性](#功能特性)
- [暂不支持](#暂不支持)
- [快速开始](#快速开始)
- [Docker 部署](#docker-部署)
- [桌面应用](#桌面应用)
- [高级版（实时目录）](#高级版实时目录)
- [API 使用方式](#api-使用方式)
- [截图预览](#截图预览)
- [工作原理](#工作原理)
- [上下文交接](#上下文交接)
- [局限性](#局限性)
- [参与贡献](#参与贡献)
- [服务条款审查](#服务条款审查)
- [免责声明](#免责声明)

## 项目背景

如今每个主流 AI 实验室都提供免费额度——每月几百万 tokens、每天几千次请求。单独看，每个额度都只是个玩具。但叠加在一起，它们的总和约为 **每月 17 亿 tokens** 的有效推理容量，覆盖 100+ 模型，从小而快到相当 capable 的都有。

问题在于：手动叠加它们非常痛苦——十七个不同的 SDK、十七个不同的速率限制、十七个可能失败的地方。FreeLLMAPI 将它们压缩为一个 OpenAI 兼容的端点。将任何 OpenAI 客户端库指向你的本地服务器，它就会透明地路由到你已添加密钥的任意提供商。

## 支持的提供商

<table>
<tr>
<td align="center" width="180"><a href="https://ai.google.dev"><b>Google</b><br/>Gemini 2.5 Flash · 3.x 预览版</a></td>
<td align="center" width="180"><a href="https://groq.com"><b>Groq</b><br/>Llama 3.3、Llama 4、GPT-OSS、Qwen3</a></td>
<td align="center" width="180"><a href="https://cerebras.ai"><b>Cerebras</b><br/>Qwen3 235B</a></td>
<td align="center" width="180"><a href="https://opencode.ai/zen"><b>OpenCode Zen</b><br/>DeepSeek V4 Flash · Nemotron（推广中）</a></td>
</tr>
<tr>
<td align="center"><a href="https://mistral.ai"><b>Mistral</b><br/>Large 3 · Medium 3.5 · Codestral · Devstral</a></td>
<td align="center"><a href="https://openrouter.ai"><b>OpenRouter</b><br/>21 个免费层级模型</a></td>
<td align="center"><a href="https://github.com/marketplace/models"><b>GitHub Models</b><br/>GPT-4.1 · GPT-4o</a></td>
<td align="center"><a href="https://developers.cloudflare.com/workers-ai"><b>Cloudflare</b><br/>Kimi K2 · GLM-4.7 · GPT-OSS · Granite 4</a></td>
</tr>
<tr>
<td align="center"><a href="https://cohere.com"><b>Cohere</b><br/>Command R+ · Command-A（试用）</a></td>
<td align="center"><a href="https://docs.z.ai"><b>智谱 AI（GLM）</b><br/>GLM-4.5 · GLM-4.7 Flash</a></td>
<td align="center"><a href="https://build.nvidia.com"><b>NVIDIA</b><br/>NIM · 40 RPM 免费（仅评估 ToS）</a></td>
<td align="center"><a href="https://huggingface.co/docs/inference-providers"><b>HuggingFace</b><br/>Router → DeepSeek V4 · Kimi K2.6 · Qwen3</a></td>
</tr>
<tr>
<td align="center"><a href="https://ollama.com"><b>Ollama Cloud</b><br/>GLM-4.7 · Kimi K2 · gpt-oss · Qwen3</a></td>
<td align="center"><a href="https://kilo.ai"><b>Kilo Gateway</b><br/>:free 路由（允许匿名）</a></td>
<td align="center"><a href="https://pollinations.ai"><b>Pollinations</b><br/>GPT-OSS 20B（允许匿名）</a></td>
<td align="center"><a href="https://llm7.io"><b>LLM7</b><br/>GPT-OSS · Llama 3.1 · GLM（允许匿名）</a></td>
</tr>
<tr>
<td align="center"><a href="https://endpoints.ai.cloud.ovh.net"><b>OVH AI Endpoints</b><br/>Qwen3.5 397B · GPT-OSS · Llama 3.3（允许匿名）</a></td>
<td align="center"></td>
<td align="center"></td>
<td align="center"></td>
</tr>
</table>

此外还支持 **自定义** 提供商——在「密钥」页面中指向任何 OpenAI 兼容的端点（llama.cpp、LM Studio、vLLM、本地 Ollama 或远程网关）。

## 功能特性

- **OpenAI 兼容** — `POST /v1/chat/completions` 和 `GET /v1/models` 可与官方 OpenAI SDK 及任何 OpenAI 兼容客户端（LangChain、LlamaIndex、Continue、Hermes 等）配合使用。只需更改 `base_url`。
- **Responses API** — `POST /v1/responses`（当前 Codex CLI 版本所需的 wire 格式）已实现为同一路由器上的翻译适配层，支持完整流式事件和工具调用。
- **流式与非流式** — `stream: true` 使用 Server-Sent Events，`stream: false` 返回 JSON 响应。每个提供商适配器均实现了这两种方式。
- **工具调用** — OpenAI 风格的 `tools` / `tool_choice` 请求会透传，助手的 `tool_calls` + `tool` 角色后续消息会在提供商之间完整往返。
- **Embeddings** — `/v1/embeddings` 采用基于系列的路由：回退仅发生在为**同一**模型提供服务的提供商之间（来自不同模型的向量不兼容），绝不跨模型回退。
- **自动回退** — 如果所选提供商返回 429、5xx 或超时，路由器会跳过它，将该密钥置于短暂冷却期，并在回退链中重试下一个模型（最多 20 次尝试）。
- **按密钥速率跟踪** — 每个 `(平台, 模型, 密钥)` 的 RPM、RPD、TPM 和 TPD 计数器，确保路由器始终选择未超出上限的密钥。
- **粘滞会话** — 多轮对话在 30 分钟内持续与同一模型对话，避免中途切换模型带来的幻觉激增。
- **密钥加密存储** — API 密钥在写入 SQLite 之前使用 AES-256-GCM 加密；解密仅在请求前在内存中进行。
- **统一 API 密钥** — 客户端使用单个 `freellmapi-…` Bearer Token 向你的代理进行身份验证。你永远不会将上游提供商密钥暴露给应用程序。
- **控制面板登录** — 管理 UI 和所有 `/api/*` 路由均通过邮箱 + 密码账号（scrypt 哈希、会话令牌身份验证）进行保护，在首次运行时设置。`/v1` 代理保留其自身的统一密钥身份验证以供应用程序使用。
- **健康检查** — 定期探测将密钥标记为 `healthy`、`rate_limited`、`invalid` 或 `error`，以便路由器自动跳过失效的密钥。
- **管理控制面板** — React + Vite UI，用于管理密钥、重新排序回退链、查看分析数据，以及在试玩台中运行提示词。包含深色模式。
- **分析统计** — 每次请求的日志记录，包含延迟、token 计数、成功率和按提供商细分的数据。
- **模型切换时上下文交接** — 可选功能。当会话回退到不同模型时，注入一条精简的系统消息，以便新模型知道它正在继续现有任务。默认禁用；通过设置 `FREELLMAPI_CONTEXT_HANDOFF=on_model_switch` 启用。
- **可在任何运行 Node 20+ 的地方运行** — Windows、macOS、Linux 服务器，或小型 ARM 单板计算机（包括树莓派）。在 PM2 / systemd / 你偏好的任何监控工具后台，空闲时约占用 40 MB RSS。

## 暂不支持

本项目的范围 intentionally 较窄。如果某个功能不在此列表中且不在下方，假定它尚未实现。

- **图像生成** (`/v1/images/*`)
- **音频 / 语音** (`/v1/audio/*`)
- **旧版补全** (`/v1/completions`) — 仅实现了聊天端点
- **审核** (`/v1/moderations`)
- **`n > 1`**（每次请求多个补全）
- **按用户计费 / 多租户身份验证** — 设计为单用户*

欢迎提交添加其中任何功能的 PR。详见[参与贡献](#参与贡献)。

## 快速开始

**一行命令**（需要 Docker — 设置 `~/freellmapi`、生成加密密钥、拉取镜像并启动容器）：

```bash
curl -fsSL https://freellmapi.co/install.sh | bash
```

更喜欢在 pipe 到 bash 之前先阅读？[脚本在此](https://freellmapi.co/install.sh)。重新运行是安全的：你的 `.env`（和加密密钥）会被保留，容器会更新到 `:latest`。通过 `FREELLMAPI_DIR`、`PORT` 或 `HOST_BIND` 环境变量覆盖默认值。

**或使用 Docker Compose 手动安装。** 它会在端口 3001 上同时运行 API 和控制面板，并在命名卷中持久化 SQLite。

**前置要求：** Docker、Docker Compose、OpenSSL。

```bash
git clone https://github.com/tashfeenahmed/freellmapi.git
cd freellmapi

# 为静态密钥存储生成加密密钥
ENCRYPTION_KEY="$(openssl rand -hex 32)"
printf "ENCRYPTION_KEY=%s\nPORT=3001\n" "$ENCRYPTION_KEY" > .env

docker compose up -d
```

打开 http://localhost:3001，在**「密钥」**页面添加你的提供商密钥，根据喜好重新排序**「回退链」**，并从**「密钥」**页面标题处获取你的统一 API 密钥。这个统一密钥就是你指向 OpenAI SDK 的东西。

> **从另一台机器访问？** 默认情况下，容器仅发布到 `127.0.0.1`，因此 `http://<服务器IP>:3001` 无法从其他设备加载（页面只是挂起）。要在你的 LAN 上暴露它——例如 IP 为 `http://192.168.1.x:3001` 的树莓派——使用 `HOST_BIND=0.0.0.0` 启动它：
>
> ```bash
> HOST_BIND=0.0.0.0 docker compose up -d
> ```
>
> 仅在受信任的网络上进行此操作：代理是单用户的，仅由统一 API 密钥保护。

### 本地开发

**前置要求：** Node.js 20+、npm。

```bash
git clone https://github.com/tashfeenahmed/freellmapi.git
cd freellmapi
npm install
cp .env.example .env
ENCRYPTION_KEY="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))")"
printf "ENCRYPTION_KEY=%s\nPORT=3001\n" "$ENCRYPTION_KEY" > .env
npm run dev
```

`ENCRYPTION_KEY` 是启动所必需的。仅当 `DEV_MODE=true` 且 `NODE_ENV` 不是 `production` 时，服务器才会回退到数据库存储的开发密钥；请勿在使用真实提供商密钥时使用该回退方案。

请求分析数据默认保留 90 天或 100000 条请求记录，以先达到的限制为准。在 `.env` 中设置 `REQUEST_ANALYTICS_RETENTION_DAYS=0` 或 `REQUEST_ANALYTICS_MAX_ROWS=0` 以禁用任一保留限制。

打开 http://localhost:5173（Vite 开发 UI），在**「密钥」**页面添加你的提供商密钥，根据喜好重新排序**「回退链」**，并从**「密钥」**页面标题处获取你的统一 API 密钥。

> **从 LAN 上的另一台设备访问开发 UI？** 使用 `npm run dev:lan`——它会将 `--host` 传递给 Vite，然后 Vite 会打印一个 `Network: http://<你的IP>:5173` URL，你可以从手机或其他机器上打开它。（普通的 `npm run dev -- --host` 在这里**无效**：根 `dev` 脚本是一个 `concurrently` 包装器，因此标志永远不会到达 Vite。）API 调用通过 Vite 的开发代理进行，因此不需要额外的服务器配置。

对于不含 Docker 的生产构建：

```bash
npm run build
node server/dist/index.js     # 服务器 + 控制面板均在 :3001 上提供服务
```

## Docker 部署

FreeLLMAPI 发布单个生产镜像，包含 Express 服务器和已构建的 React 控制面板：

```bash
docker pull ghcr.io/tashfeenahmed/freellmapi:latest   # 或固定某个发行版，例如 :v1.2.3
```

该镜像是多架构的（`linux/amd64` + `linux/arm64`），因此可以在树莓派上运行）。已发布的标签：`latest`（默认分支）、`v*.*.*`（Git 发行版标签）和 `sha-<commit>`。

推荐的安裝方式是使用附带的 `docker-compose.yml`：

```bash
docker compose up -d
docker compose logs -f freellmapi
```

默认情况下，容器的端口绑定到 `127.0.0.1`（仅本地主机）。要从网络上的另一台机器访问控制面板/API，使用 `HOST_BIND=0.0.0.0 docker compose up -d` 在所有接口上发布它——仅在受信任的 LAN 上这样做，因为代理是单用户的。

SQLite 数据存储在 `/app/server/data` 的 `freellmapi-data` 卷中。升级时保留相同的 `.env` `ENCRYPTION_KEY` 和卷，因为提供商密钥是静态加密的。

更多 Docker 操作和示例见 [docker/README.md](./docker/README.md)。

## 桌面应用

原生的菜单栏应用位于 [`desktop/`](./desktop)：整个路由器 + 控制面板从你的系统托盘运行，带有显示实时请求统计数据的毛玻璃弹出窗口。

![FreeLLMAPI 桌面应用](repo-assets/desktop.png)

**[从 Releases 下载 macOS 应用](https://github.com/tashfeenahmed/freellmapi/releases/latest)**，或在此仓库中几分钟内自行构建：

```bash
npm install
npm run desktop:dist        # macOS：desktop/dist-electron/FreeLLMAPI-…-arm64.dmg
npm run desktop:dist:win    # Windows 安装程序
```

> **Windows：** 构建配置已就绪但尚未测试——如果你尝试了，请在 Issue 中快速报告（可用或不可用），我们将不胜感激。

## 高级版（实时目录）

路由器会自动保持模型目录更新：它每天两次从 [freellmapi.co](https://freellmapi.co) 拉取已签名的目录，并将新模型、配额变更和提供商怪癖修复应用到你的本地数据库（你自己启用/禁用的选择和自定义提供商永远不会被触及；每次下载在应用之前都会针对固定的 Ed25519 密钥进行验证）。

- **免费版**用户遵循**月度快照**——零成本，永久免费。
- **[高级版](https://freellmapi.co/#pricing)**（$19/年或 $49 一次性买断）遵循**实时订阅源**，每 2-3 天刷新一次，因此新免费模型在出现的那一刻就会进入你的路由器。一个密钥覆盖你所有设备；在控制面板的**「高级版」**下激活它。在 [freellmapi.co/manage](https://freellmapi.co/manage) 自行管理取消或账单。

目录服务器永远不会看到你的提示词、补全或提供商密钥——无论哪种方式，路由器都保持完全自托管。

本地构建的应用启动时没有 Gatekeeper/SmartScreen 警告——不涉及代码签名。完整说明见 [desktop/README.md](./desktop/README.md)。

## API 使用方式

任何 OpenAI 兼容的客户端均可使用。示例：

**Python**

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3001/v1",
    api_key="freellmapi-your-unified-key",
)

resp = client.chat.completions.create(
    model="auto",  # 让路由器选择；或指定例如 "gemini-2.5-flash"
    messages=[{"role": "user", "content": "用一句话总结罗马的陷落。"}],
)
print(resp.choices[0].message.content)
print("路由经由：", resp.headers.get("x-routed-via"))
```

**curl**

```bash
curl http://localhost:3001/v1/chat/completions \
  -H "Authorization: Bearer freellmapi-your-unified-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "你好"}]
  }'
```

**流式传输**

```python
stream = client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": "为我写一首关于 SQLite 的俳句。"}],
    stream=True,
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="", flush=True)
```

**工具调用**

传递 OpenAI 风格的 `tools` 和 `tool_choice`；助手响应往返通过代理，就像 OpenAI API 一样。多步骤流程（助手 `tool_calls` → `tool` 角色后续 → 最终答案）在路由器可以到达的每个提供商之间工作。

```python
tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "获取某城市的当前天气。",
        "parameters": {
            "type": "object",
            "properties": {"city": {"type": "string"}},
            "required": ["city"],
        },
    },
}]

# 1. 模型请求工具调用
first = client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": "卡拉奇的天气怎么样？"}],
    tools=tools,
    tool_choice="required",
)
call = first.choices[0].message.tool_calls[0]

# 2. 你执行工具，将结果反馈回去
final = client.chat.completions.create(
    model="auto",
    messages=[
        {"role": "user", "content": "卡拉奇的天气怎么样？"},
        first.choices[0].message,
        {"role": "tool", "tool_call_id": call.id, "content": '{"temp_c": 32, "cond": "晴天"}'},
    ],
    tools=tools,
)
print(final.choices[0].message.content)
```

**Gemini Google 搜索接地**

Google 的模型可以将其答案接地于实时 Google 搜索结果。由于 OpenAI wire 格式无法表达这一点，请求一个名为 `google_search` 的工具，Google 提供商将其转换为 Gemini 的原生接地工具。它可以单独发送，也可以与你的常规函数工具一起发送。

```python
resp = client.chat.completions.create(
    model="gemini-2.5-flash",  # 固定到 Google 模型，以便请求路由到那里
    messages=[{"role": "user", "content": "这周末谁赢了 F1 比赛？"}],
    tools=[{"type": "function", "function": {"name": "google_search", "parameters": {}}}],
)
print(resp.choices[0].message.content)
```

**视觉 / 图像输入**

使用标准 OpenAI `image_url` 内容块（base64 `data:` URL 或 `http(s)` URL）发送图像。当请求包含图像时，路由器将其自身限制为**支持视觉的模型**，并忽略仅支持文本的模型。支持视觉的模型在回退链页面上标有**「视觉」**徽章；当前集合包括 Gemini（2.5 / 3.x）、Llama 4 Scout/Maverick（Groq、NVIDIA）、GLM-4.6V Flash（智谱 AI）、Nemotron Nano 12B VL（OpenRouter）和 GitHub 的 GPT-4o / GPT-4.1。

```python
resp = client.chat.completions.create(
    model="auto",  # 自动路由到视觉模型
    messages=[{
        "role": "user",
        "content": [
            {"type": "text", "text": "这张图片里有什么？"},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,<...>"}},
        ],
    }],
)
print(resp.choices[0].message.content)
```

## 截图预览

### 密钥管理

管理提供商凭据，并获取应用程序连接所用的统一 API 密钥。每个密钥都显示状态点和上次健康检查的时间。

![密钥页面](repo-assets/keys.png)

### 试玩台

通过路由器发送聊天补全，并查看哪个提供商为其提供服务，模型 ID 和延迟会直接打印在消息上。

![试玩台页面](repo-assets/playground.png)

### 分析统计

请求量、成功率、输入和输出 tokens、平均延迟，以及按 24 小时 / 7 天 / 30 天窗口的按提供商细分数据。

![分析页面](repo-assets/analytics.png)

## 工作原理

```
┌──────────────────┐   Bearer freellmapi-…   ┌─────────────────────────┐
│  OpenAI SDK /    │ ──────────────────────▶ │  Express 代理 (:3001)  │
│  curl / 任何      │ ◀────────────────────── │  /v1/chat/completions   │
│  OpenAI 客户端   │     流式 tokens       └────────────┬────────────┘
└──────────────────┘                                      │
                                                          ▼
                             ┌────────────────────────────────────────────────┐
                             │  路由器                                        │
                             │   1. 选择满足以下条件的最高优先级模型：          │
                             │      (a) 拥有健康的密钥，并且                 │
                             │      (b) 未超出其所有速率限制。         │
                             │   2. 解密密钥，调用提供商 SDK。           │
                             │   3. 遇到 429/5xx → 冷却 + 重试下一个模型。 │
                             └────────────────────────────────────────────────┘
                                          │
   ┌──────────────┬────────────┬──────────────┬─────────────┬─────────────┐
   ▼              ▼            ▼                    ▼             ▼          ▼
 Google         Groq        Cerebras           OpenRouter        HF       …10 更多
```

- **路由器** (`server/src/services/router.ts`) — 为每个请求选择一个模型。
- **速率限制账本** (`server/src/services/ratelimit.ts`) — 由 SQLite 支持的内存中 RPM/RPD/TPM/TPD 计数器，在 429 时触发冷却。
- **提供商适配器** (`server/src/providers/*.ts`) — 每个提供商一个文件，实现 `Provider` 基类：`chatCompletion()` 和 `streamChatCompletion()`。
- **健康检查服务** (`server/src/services/health.ts`) — 定期探测保持密钥状态新鲜。
- **控制面板** (`client/`) — React + Vite + shadcn/ui 管理界面。
- **存储** — SQLite (`better-sqlite3`)，密钥使用 AES-256-GCM 信封加密。

## 上下文交接

当 FreeLLMAPI 在对话中途回退到不同模型时（配额、速率限制、冷却），新模型不知道它正在接手其他人的任务。**上下文交接**向出站请求添加一条精简的 `system` 消息，明确告诉新模型这一点：

```
FreeLLMAPI 上下文交接：
你正在从另一个模型（groq:llama-3 → google:gemini-flash）接手一个正在进行的对话。
使用此请求中已提供的对话上下文继续用户的任务。
不要重新启动任务、重新询问已回答的设置问题，或丢弃先前的工具结果。
尊重用户的最新消息作为最高优先级指令。

近期会话摘要：
用户：……
助手：……
```

**在 `.env` 中启用它：**

```env
FREELLMAPI_CONTEXT_HANDOFF=on_model_switch
```

**工作原理：**

- 按会话存储消息（TTL：3 小时）。
- 仅当给定会话密钥的所选模型发生更改时注入。
- 不在首次请求、同模型继续或已存在交接消息时注入。
- 会话密钥：如果存在 `X-Session-Id` 标头，则使用它；否则使用第一条用户消息的 SHA-1（与粘滞会话相同）。
- 存储仅在内存中。不会写入磁盘或记录日志。

> **重要提示：** 上下文交接提高了通过 FreeLLMAPI 路由的对话的连续性。它无法恢复提供商内部的隐藏状态或从未发送到代理的消息。

## 局限性

叠加免费额度有真实的权衡。对自己诚实：

- **没有前沿模型。** 免费层级目录上限约为 Llama 3.3 70B、GLM-4.5、Qwen 3 Coder 和 Gemini 2.5 Pro。你无法通过此方式获得 GPT-5 或 Claude Opus 级别的推理能力。对于困难问题，请为真正的 API 付费。
- **智能在一天中逐渐退化。** 你的排名最高模型（通常是 Gemini 2.5 Pro、通过 GitHub Models 的 GPT-4o）拥有最低的日常上限。一旦它们达到限制，路由器就会沿你的优先级链向下回退到更小/更弱的模型。预计每个工作日深夜，端点的有效智能会下降——然后在 UTC 午夜重置。
- **延迟高度可变。** Cerebras 和 Groq 极快；其他则不是。你会得到可用 whichever one。
- **免费额度可在不通知的情况下更改。** 提供商经常收紧、放松或移除免费额度。当这种情况发生时，你会看到 429 或身份验证错误，直到你更新目录。重新种子脚本位于 `server/src/scripts/`。
- **没有 SLA，根据定义。** 如果你需要可靠性，请使用有合同的付费提供商。
- **本地优先。** 没有多租户身份验证。为自己运行此程序；不要将其暴露到互联网。

## 参与贡献

贡献者非常欢迎！详见 [CONTRIBUTING.md](CONTRIBUTING.md) 了解开发循环、PR 期望以及关于 AI/LLM 辅助贡献的政策（简短版本：欢迎，质量标准与任何其他 PR 相同）。好的首个 PR：

- **添加提供商** — 复制 `server/src/providers/openai-compat.ts` 作为模板，将其接入 `server/src/providers/index.ts`，在 `server/src/db/index.ts` 中为其种子化模型，在 `server/src/__tests__/providers/` 中添加测试。
- **添加端点** — 图像、审核、音频。Provider 基类可以增长新方法；适配器声明它们支持哪些。
- **改进路由器** — 成本感知路由（最便宜-健康-最快权衡）、更好的延迟加权优先级、区域固定。
- **控制面板优化** — 分析页面上的图表、密钥轮换 UX、从 `.env` 批量导入密钥。
- **文档** — 更多示例、Go/Rust 等客户端库片段、Docker 或 Fly 的部署配方。

**开发循环：**

```bash
npm install
npm run dev      # 服务器在 :3001，控制面板在 :5173，均带 HMR
npm test         # 服务器 vitest；如果工作区添加了客户端测试，也会运行
npm run build    # 编译服务器和控制面板
```

PR 应包含测试，保持现有测试套件通过，并匹配仓库中已有的 `.editorconfig` / tsconfig 默认值。Issue 和讨论均开放。

### 贡献者

（此处保留原贡献者头像列表）

## 服务条款审查

针对每个提供商的服务条款（2026 年 5 月）重新审查了自托管、单用户、个人使用设置。摘要：

| 提供商 | 结论 | 备注 |
|---|---|---|
| Google Gemini | ⚠️ 注意 | 2026 年 3 月 ToS 缩小范围为*"专业或商业用途，而非消费者使用"*——自托管开发者代理仍然可辩护，但该条款是新的。 |
| Groq | ✅ 可能没问题 | GroqCloud 服务协议允许客户应用程序集成。 |
| Cerebras | ✅ 可能没问题 | 允许；明确禁止出售/转移 API 密钥。 |
| Mistral | ✅ 可能没问题 | API 允许用于个人/内部商业用途。 |
| OpenRouter | ✅ 可能没问题 | 2026 年 4 月 ToS 强化了禁止转售 / 禁止竞争服务条款；私人单用户代理仍然没问题。 |
| Cloudflare Workers AI | ⚠️ 含糊 | 没有反代理条款；受一般 Self-Serve 订阅协议覆盖。 |
| NVIDIA NIM | ⚠️ 注意 | 试用 ToS §1.2 / §1.4：*"仅评估，非生产。"* 免费访问是反复出现的 40 RPM 速率限制（2025 年信用系统已停产），但仅评估范围仍然成立。 |
| GitHub Models | ⚠️ 注意 | 免费层级明确限定为*"实验"*和*"原型设计。"* |
| Cohere | ❌ 避免 | 条款 §14 仍然禁止*"个人、家庭或家庭用途。"* |
| 智谱 AI（open.bigmodel.cn） | ✅ 可能没问题 | 个人/非商业研究保留条款仍在平台文档中。 |
| 智谱 AI（api.z.ai） | ⚠️ 注意 | 新行——新加坡实体（不同于智谱 CN）。§III.3(l) 反流量重定向条款可能被解读为针对代理；没有明确的个人使用保留条款。 |
| Ollama Cloud | ✅ 可能没问题 | 新行——免费计划允许云模型访问（1 并发，5 小时会话上限）。未发现反代理 / 反转售条款。 |
| OVH AI Endpoints | ✅ 可能没问题 | 新行（2026 年 6 月）——匿名访问已正式记录（每 IP 每模型 2 请求/分钟）。OVH 保留引入 token/消耗上限的权利。 |

让你大多数提供商满意的经验法则：**每个提供商一个账号**，**不转售**，**不与其他人共享你的端点**，**不要将免费层级作为付费生产后端进行冲击**。这是信息性的，而非法律建议——阅读每个提供商的 ToS 并做出你自己的判断。

自 2026 年 4 月审查以来已移除：Hugging Face、Moonshot 和 MiniMax 直接集成已从目录中删除（HF——工具调用格式问题；Moonshot——已转为仅付费；MiniMax——已被 OpenRouter `minimax/minimax-m2.5:free` 路由取代）。

## 免责声明

**本项目用于个人实验和学习，而非生产。** 免费层级的存在是为了让开发者可以针对它们进行原型设计；它们不是稳定的、受支持的推理基础设施，也不应被视为如此。如果你在 FreeLLMAPI 之上构建了真实的东西，请在发布之前换入付费 API。你与每个上游提供商的关系受你创建账号时接受的条款管辖——当流量通过此项目代理时，这些条款仍然适用，你有责任遵守它们。

## Star 历史

[![Star History Chart](https://api.star-history.com/chart?repo=tashfeenahmed/freellmapi&type=Date&legend=top-left)](https://www.star-history.com/?repo=tashfeenahmed%2Ffreellmapi&type=date&legend=top-left)

## 许可证

[MIT](./LICENSE)
