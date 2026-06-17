# FreeLLMAPI 项目部署指南

> 自托管 OpenAI 兼容 API 代理 — 一个端点，16+ 免费 LLM 提供商，每月 ~17 亿 tokens

---

## 目录

1. [项目概述](#1-项目概述)
2. [安装与部署](#2-安装与部署)
3. [注册流程](#3-注册流程)
4. [AI 助手接入](#4-ai-助手接入)
5. [支持的平台与模型列表](#5-支持的平台与模型列表)
6. [调度机制](#6-调度机制)
7. [工作原理](#7-工作原理)
8. [代码结构](#8-代码结构)
9. [改造说明](#9-改造说明)
10. [脱敏处理说明](#10-脱敏处理说明)
11. [上游同步策略](#11-上游同步策略)

---

## 1. 项目概述

### 核心价值

FreeLLMAPI 将全球 16 个主流 AI 提供商的**免费层**聚合为一个统一的 OpenAI 兼容 API 端点。开发者只需一个 API Key 即可调用来自 Google、Groq、智谱、OpenRouter 等 16+ 平台的 100+ 免费模型。

### 解决的问题

- **免注册多个 API Key**：无需为每个 AI 平台单独申请和购买 API Key
- **智能路由**：自动选择最优提供商，避免单点故障
- **成本节省**：全部使用免费模型，每月约 17 亿 tokens 容量
- **统一接口**：一个 API Key 访问所有提供商，完全兼容 OpenAI SDK
- **自动故障切换**：路由自动降级和重试，对调用方完全透明

### 技术栈

| 组件 | 技术选型 | 说明 |
|------|----------|------|
| 后端 | Node.js 20+、TypeScript、Express | API 服务端 |
| 前端 | React、Vite、shadcn/ui | 管理仪表盘 |
| 数据库 | SQLite + better-sqlite3 | 数据存储 |
| 加密 | AES-256-GCM | 密钥加密存储 |
| 容器 | Docker (multi-arch) | linux/amd64 + linux/arm64 |

### 系统要求

- Node.js 20+（本地开发）或 Docker（推荐部署）
- 2 GB RAM 即可运行
- ~40 MB RSS 空闲内存占用
- 跨平台：Windows、macOS、Linux（含 ARM 如树莓派）

---

## 2. 安装与部署

### 方式一：Docker Compose（推荐）

**前置条件**：Docker、Docker Compose、OpenSSL

```bash
# 1. 克隆仓库
git clone https://github.com/coffcoe/freellmapi.git
cd freellmapi

# 2. 生成加密密钥
ENCRYPTION_KEY="$(openssl rand -hex 32)"
printf "ENCRYPTION_KEY=%s\nPORT=3001\n" "$ENCRYPTION_KEY" > .env

# 3. 启动服务
docker compose up -d

# 4. 查看日志
docker compose logs -f freellmapi
```

启动完成后：
- **API 端点**：http://localhost:3001
- **管理仪表盘**：http://localhost:3001（端口同 API，通过路由区分）
- **API 模型列表**：http://localhost:3001/v1/models

**从其他设备访问**：
```bash
# 默认仅限本机访问，如需局域网访问：
HOST_BIND=0.0.0.0 docker compose up -d
```

**Docker Hub / GHCR 镜像**：
```bash
# 拉取最新镜像
docker pull ghcr.io/tashfeenahmed/freellmapi:latest

# 直接运行
docker run -d \
  --name freellmapi \
  -p 3001:3001 \
  -v freellmapi-data:/app/server/data \
  -e ENCRYPTION_KEY=$(openssl rand -hex 32) \
  ghcr.io/tashfeenahmed/freellmapi:latest
```

**数据持久化**：
- SQLite 数据存储在 Docker volume `freellmapi-data` 中，路径 `/app/server/data`
- 升级时务必保留相同的 `.env` `ENCRYPTION_KEY` 和数据卷
- 密钥为加密存储，更换加密密钥会导致所有已存密钥无法解密

### 方式二：本地开发

**前置条件**：Node.js 20+、npm

```bash
# 1. 克隆仓库
git clone https://github.com/coffcoe/freellmapi.git
cd freellmapi

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp .env.example .env
ENCRYPTION_KEY="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
printf "ENCRYPTION_KEY=%s\nPORT=3001\n" "$ENCRYPTION_KEY" > .env

# 4. 启动开发模式（同时启动 API + 仪表盘）
npm run dev
```

**生产构建**：
```bash
npm run build
node server/dist/index.js
```

### 方式三：PM2 生产部署

```bash
npm install -g pm2
cd C:/Users/coffcoe/freellmapi
npm run build
pm2 start server/dist/index.js --name freellmapi
pm2 startup
pm2 save
```

---

## 3. 注册流程

### 3.1 生成统一 API Key

1. 访问管理仪表盘：http://localhost:3001
2. 在 **Keys** 页面顶部可查看您的统一 API Key（格式：`freellmapi-xxxxx`）
3. 将此 Key 提供给您的 OpenAI SDK 客户端使用

### 3.2 注册第三方提供商

FreeLLMAPI 需要您为各提供商注册 API Key（免费层级）：

| 提供商 | 免费注册 | 免费额度参考 | 注意事项 |
|--------|----------|-------------|----------|
| **Google Gemini** | https://ai.google.dev | ~300万 tokens/月/模型 | 需信用卡 |
| **Groq** | https://console.groq.com | ~3000万 tokens/月/模型 | 需注册 |
| **智谱AI** | https://open.bigmodel.cn | ~3000万 tokens/月/共享 | 中国可用，免信用卡 |
| **Cloudflare** | https://developers.cloudflare.com | ~2000万 tokens/月/共享 | 中国可用 |
| **GitHub Models** | https://github.com/marketplace/models | ~1800万 tokens/月 | 需 GitHub 账号 |
| **Mistral** | https://mistral.ai | ~10亿 tokens/月 | 中国可用 |
| **OpenRouter** | https://openrouter.ai | ~600万 tokens/月/模型 | 需注册 |
| **HuggingFace** | https://huggingface.co | ~300万 tokens/月 | 免费层级 |
| **讯飞星火** | https://xinghuo.xfyun.cn | ~200万 tokens/月 | 中国可用 |
| **SenseNova** | https://www.sensenova.cn | 免费层级 | 科大讯飞旗下 |

**注册步骤**：
1. 访问提供商官网注册账号
2. 获取 API Key
3. 回到 FreeLLMAPI Dashboard → Keys 页面
4. 点击 "Add Provider Key"，填入提供商名称和 API Key
5. 密钥将以 AES-256-GCM 加密存储

### 3.3 自定义提供商（Local LLM）

FreeLLMAPI 支持接入任何 OpenAI 兼容端点的自定义提供商：

```bash
# 示例：启动本地 Ollama
ollama serve &

# 在 FreeLLMAPI Dashboard → Keys 页面
# 提供商名称：custom
# API Key：任意字符串
# Base URL：http://localhost:11434/v1
```

支持的自定义端点：
- **Ollama**（本地或远程）
- **LM Studio**
- **vLLM**
- **llama.cpp**
- **任何其他 OpenAI 兼容端点**

---

## 4. AI 助手接入

### 4.1 接入方式一览

FreeLLMAPI 完全兼容 OpenAI SDK 协议，因此任何能接入 OpenAI API 的工具都可以使用：

```
API Base URL: http://localhost:3001/v1
API Key: freellmapi-your-unified-key
Model: auto（自动路由）
```

### 4.2 Python 接入示例

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3001/v1",
    api_key="freellmapi-your-unified-key",
)

# 自动路由到最优模型
resp = client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": "请总结一下这篇文章的内容"}],
)
print(resp.choices[0].message.content)

# 查看实际路由到的提供商
print("Routed via:", resp.headers.get("x-routed-via"))
```

### 4.3 Stream 流式输出

```python
stream = client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": "请写一篇关于春天的诗歌"}],
    stream=True,
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="", flush=True)
```

### 4.4 多模态（图像理解）

```python
resp = client.chat.completions.create(
    model="auto",  # 自动路由到视觉模型
    messages=[{
        "role": "user",
        "content": [
            {"type": "text", "text": "这张图片里有什么？"},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}},
        ],
    }],
)
print(resp.choices[0].message.content)
```

### 4.5 工具调用（Function Calling）

```python
tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "获取城市天气",
        "parameters": {
            "type": "object",
            "properties": {"city": {"type": "string"}},
            "required": ["city"],
        },
    },
}]

# 第1步：模型发起工具调用
first = client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": "北京天气怎么样？"}],
    tools=tools,
    tool_choice="required",
)
call = first.choices[0].message.tool_calls[0]

# 第2步：执行工具，反馈结果
final = client.chat.completions.create(
    model="auto",
    messages=[
        {"role": "user", "content": "北京天气怎么样？"},
        first.choices[0].message,
        {"role": "tool", "tool_call_id": call.id, "content": '{"temp_c": 22, "cond": "晴朗"}'},
    ],
    tools=tools,
)
print(final.choices[0].message.content)
```

### 4.6 cURL 示例

```bash
# 基础对话
curl http://localhost:3001/v1/chat/completions \
  -H "Authorization: Bearer freellmapi-your-unified-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "你好"}]
  }'

# 指定模型
curl http://localhost:3001/v1/chat/completions \
  -H "Authorization: Bearer freellmapi-your-unified-key" \
  -d '{"model": "glm-4-flash", "messages": [{"role": "user", "content": "你好"}]}'

# 列出可用模型
curl http://localhost:3001/v1/models
```

### 4.7 接入的 AI 助手工具

| 工具名称 | 接入方式 | 说明 |
|----------|----------|------|
| **LangChain** | `base_url` 替换 | 完全兼容 |
| **LlamaIndex** | `base_url` 替换 | 完全兼容 |
| **Continue（VS Code 插件）** | `OPENAI_API_BASE` 设置 | VS Code 代码助手 |
| **Cursor** | 自定义 OpenAI 端点 | 支持 |
| **Codex CLI** | `OPENAI_BASE_URL` 设置 | 支持 Responses API |
| **Hermes（终端聊天）** | 配置端点和 Key | 命令行 AI 助手 |
| **Dify** | 自定义 API 端点 | 企业级 AI 应用 |

---

## 5. 支持的平台与模型列表

### 5.1 平台完整列表

| 提供商 | 免费额度参考 | 中国可用 | 状态 |
|--------|-------------|----------|------|
| Google Gemini | ~300万 tokens/月/模型 | ❌ | ✅ 支持 |
| Groq | ~3000万 tokens/月/模型 | ❌ | ✅ 支持 |
| Cerebras | ~3000万 tokens/月 | ❌ | ✅ 支持 |
| 智谱AI (Zhipu) | ~3000万 tokens/月 | ✅ | ✅ 支持 |
| Cloudflare | ~2000万 tokens/月 | ✅ | ✅ 支持 |
| GitHub Models | ~1800万 tokens/月 | ⚠️ | ✅ 支持 |
| SambaNova | ~300万 tokens/月 | ⚠️ | ✅ 支持 |
| HuggingFace | ~300万 tokens/月 | ❌ | ✅ 支持 |
| Mistral | ~10亿 tokens/月 | ✅ | ✅ 支持 |
| OpenRouter | ~600万 tokens/月/模型 | ⚠️ | ✅ 支持 |
| Cohere | ~1-2万 tokens/月 | ⚠️ | ✅ 支持 |
| Ollama Cloud | GPU时间 | ⚠️ | ✅ 支持 |
| Kilo Gateway | ~200/小时 | ⚠️ | ✅ 支持 |
| Pollinations | 匿名免费 | ✅ | ✅ 支持 |
| LLM7 | ~100/小时 | ✅ | ✅ 支持 |
| NVIDIA NIM | 积分制 | ✅ | ⚠️ 默认禁用 |
| 讯飞星火 | ~200万 tokens/月 | ✅ | ✅ 支持 |
| SenseNova | 免费层级 | ✅ | ✅ 支持 |
| **Custom** | 不限 | 不限 | ✅ 支持（自定义端点） |

### 5.2 代表模型列表

| 模型 | 提供商 | 能力类型 | 用途 |
|------|--------|----------|------|
| GLM-4.5 / GLM-4.7 Flash | 智谱 | 文本 | 中文推理、通用对话 |
| Gemini 2.5 Flash / 3.x | Google | 多模态 | 图像理解、代码生成 |
| Llama 3.3 70B | Groq | 文本 | 快速推理、英文任务 |
| Kimi K2.5 / K2.6 | Cloudflare | 文本 | 复杂推理、多语言 |
| DeepSeek V3.1 / V4 | OpenRouter | 文本 | 代码生成、数学推理 |
| GPT-4.1 / GPT-4o | GitHub | 多模态 | 通用对话、图像理解 |
| Qwen3 235B | Cerebras | 文本 | 大规模推理 |
| SenseChat-5 | SenseNova | 文本 | 中文对话 |
| Mistral Large 3 | Mistral | 文本 | 通用推理 |
| gpt-oss-120b | Cloudflare | 文本 | 大规模模型 |

### 5.3 模型能力维度

| 能力维度 | 说明 | 示例模型 |
|----------|------|----------|
| **视觉 (Vision)** | 支持图像输入理解 | Gemini 2.5/3.x, GPT-4o, Llama 4 |
| **工具 (Tools)** | 支持函数调用/结构化输出 | GPT-4o, Gemini 3.x, Claude |
| **纯文本 (Text)** | 仅文本对话 | 大部分模型 |
| **代码 (Code)** | 代码生成专长 | Codestral, DeepSeek-Coder |
| **快速 (Fast)** | 低延迟推理 | Groq Llama 3.3, Cerebras Qwen3 |
| **小规模 (Small)** | 极致速度 | Phi-3-mini, Qwen1.5-0.5B |

---

## 6. 调度机制

### 6.1 多级优先级架构（P0-P3）

```
P0: 核心能力模型（中国本土稳定）
    ├─ 智谱 GLM-4 Flash
    ├─ 讯飞 Spark 3.5
    └─ SenseNova SenseChat

P1: 平衡性能模型（免费额度大 + 能力广谱）
    ├─ OpenRouter DeepSeek-V4
    ├─ Cloudflare Qwen3-30B
    └─ NVIDIA Nemotron

P2: 特殊能力模型（针对性强）
    ├─ Groq Llama 3.3-70B（超快推理）
    ├─ Google Gemini（多模态原生）
    └─ Mistral（代码专长）

P3: 本地兜底模型（离线可用）
    └─ Ollama Qwen2.5:1.5B
```

### 6.2 六维调度评分

每个模型请求时，系统基于六个维度进行智能评分：

| 维度 | 权重 | 说明 | 数据来源 |
|------|------|------|----------|
| **可靠性** | 30% | 历史成功率 | Thompson Sampling 贝叶斯推断 |
| **速度** | 25% | 响应延迟 + 生成速度 | TTFB + Tok/sec |
| **智能度** | 20% | 模型能力层级 | Size Label + Rank |
| **预算余量** | 15% | 剩余免费额度 | Monthly Token Budget |
| **限流惩罚** | 10% | 近期 429 错误 | 动态 penalty + 时间衰减 |
| **手动优先级** | 平局决胜 | 管理员排序 | Fallback Chain 配置 |

### 6.3 五种路由策略

| 策略 | 说明 | 适用场景 |
|------|------|----------|
| **priority** | 人工排序 + 429 惩罚（默认） | 明确指定模型偏好 |
| **balanced** | 均衡六权重 | 通用场景 |
| **smartest** | 智能权重占比最高 | 追求质量 |
| **fastest** | 速度权重最高 | 实时交互 |
| **reliable** | 可靠性权重最高 | 稳定性优先 |

### 6.4 自动故障恢复

```
请求失败（429/5xx/超时）
    ↓
记录失败 → 扣减可靠度
    ↓
暂停该模型 60 秒
    ↓
自动切换到下一个候选模型
    ↓
60 秒后自动重试 → 成功则恢复优先级
    ↓
连续失败 → 当日停用 → 需要人工干预
```

### 6.5 粘性会话（Sticky Sessions）

- **机制**：多轮对话锁定同一模型，防止上下文切换
- **实现**：SHA1 哈希首条消息 → 映射到 model_db_id
- **TTL**：30 分钟有效
- **例外**：视觉/工具请求会覆盖粘性（确保模型具备相应能力）

---

## 7. 工作原理

### 7.1 请求处理流程

```
用户请求 → OpenAI 兼容端点
    ↓
【身份认证】验证统一 API Key
    ↓
【请求解析】提取 messages、tools、images
    ↓
【能力匹配】过滤 supports_vision / supports_tools 模型
    ↓
【多维评分】六维打分（可靠性+速度+智能+预算+限流）
    ↓
【策略排序】按路由策略排列候选列表
    ↓
【粘性检查】是否有多轮对话需锁定模型
    ↓
【速率限制】检查 RPM/RPD/TPM/TPD 配额
    ↓
【密钥解密】AES-256-GCM 解密提供商 Key
    ↓
【调用提供商】发起 HTTP 请求
    ↓
【结果处理】流式/非流式返回
    ↓
【记录分析】存储请求日志到 SQLite
```

### 7.2 密钥加密存储

```
提供商 API Key
    ↓
AES-256-GCM 加密（使用 ENCRYPTION_KEY）
    ↓
(iv, auth_tag, encrypted_cipher) 存入 SQLite
    ↓
请求前才解密 → 在内存中使用
    ↓
使用后不保留明文
```

### 7.3 路由决策示意

```javascript
// 每个模型的综合评分公式
score = (
  reliability × 0.30 +     // 可靠性
  speed × 0.25 +           // 速度
  intelligence × 0.20 +    // 智能度
  headroom × 0.15 +        // 预算余量
  rateLimit × 0.10         // 限流因子
) × manualPriority          // 手动优先级（决胜）
```

### 7.4 429 自动重试

```
最大重试次数：20 次
重试逻辑：
1. 当前模型/Key 返回 429
2. 检查是否为每日配额耗尽
3. 若是 → 进入冷却期（递增：2min → 10min → 1h → 24h）
4. 否则 → 切换到下一个模型
5. 20 次后仍失败 → 返回 "All models exhausted"
```

---

## 8. 代码结构

### 8.1 目录树

```
freellmapi/
├── client/                        # 管理仪表盘（React + Vite）
│   ├── src/
│   │   ├── components/            # UI 组件（shadcn/ui）
│   │   ├── pages/                 # 页面
│   │   │   ├── KeysPage.tsx       # API Key 管理
│   │   │   ├── FallbackPage.tsx   # 回退链排序
│   │   │   ├── PlaygroundPage.tsx # 在线测试
│   │   │   ├── AnalyticsPage.tsx  # 数据分析
│   │   │   └── EmbeddingsPage.tsx # 嵌入模型管理
│   │   ├── lib/                   # 工具库
│   │   └── main.tsx               # 入口
│   └── vite.config.ts
│
├── server/                        # 后端 API 服务
│   ├── src/
│   │   ├── routes/
│   │   │   ├── proxy.ts           # /v1/chat/completions（核心路由）
│   │   │   ├── responses.ts       # /v1/responses（Codex CLI 兼容）
│   │   │   ├── analytics.ts       # 分析数据 API
│   │   │   ├── keys.ts            # Key 管理 API
│   │   │   └── fallback.ts        # 回退链配置 API
│   │   ├── services/
│   │   │   ├── router.ts          # 智能路由器（核心）
│   │   │   ├── scoring.ts         # 六维评分算法
│   │   │   ├── ratelimit.ts       # 限流控制
│   │   │   ├── health.ts          # 健康检查
│   │   │   └── embeddings.ts      # 嵌入模型路由
│   │   ├── providers/
│   │   │   ├── index.ts           # 提供商注册表
│   │   │   ├── base.ts            # 提供商基类
│   │   │   ├── google.ts          # Google Gemini 适配器
│   │   │   ├── cohere.ts          # Cohere 适配器
│   │   │   ├── cloudflare.ts      # Cloudflare Workers AI
│   │   │   └── openai-compat.ts   # OpenAI 兼容通用适配器
│   │   ├── middleware/
│   │   │   ├── auth.ts            # 身份认证
│   │   │   ├── requestValidator.ts# 请求验证
│   │   │   └── requestSanitizer.ts# 请求清洗
│   │   ├── db/
│   │   │   └── index.ts           # 数据库初始化 + 迁移
│   │   ├── lib/
│   │   │   ├── crypto.ts          # AES-256-GCM 加解密
│   │   │   ├── proxy-manager.ts   # 代理管理
│   │   │   └── budget.ts          # 预算解析
│   │   ├── __tests__/             # 测试套件
│   │   │   └── ...                 # 300+ 测试用例
│   │   ├── app.ts                 # Express 应用入口
│   │   └── index.ts               # 服务启动
│   ├── package.json
│   └── tsconfig.json
│
├── .env.example                   # 环境变量模板
├── .env                           # 实际配置（含加密密钥，不要提交）
├── Dockerfile                     # Docker 构建文件
├── docker-compose.yml             # Docker Compose 配置
├── LICENSE                        # MIT 许可证
└── README.md                      # 英文原版文档
```

### 8.2 核心模块说明

| 模块 | 文件 | 职责 | 核心函数 |
|------|------|------|----------|
| **路由器** | `router.ts` | 请求路由决策 | `routeRequest()` |
| **评分器** | `scoring.ts` | 六维评分算法 | `combineScore()` |
| **限流器** | `ratelimit.ts` | RPM/RPD/TPM/TPD 计数 | `canMakeRequest()` |
| **健康检查** | `health.ts` | 定期探测 Key 状态 | 定时任务 |
| **提供商适配** | `providers/*.ts` | 各平台协议适配 | `chatCompletion()` |
| **加密** | `crypto.ts` | AES-256-GCM 加解密 | `encrypt()`/`decrypt()` |
| **数据库** | `db/index.ts` | Schema + 迁移 | `getDb()`/`init()` |
| **仪表盘** | `client/src/pages/` | React 管理界面 | - |

---

## 9. 改造说明

### 9.1 本项目的改造点

| 改造点 | 说明 | 原因 |
|--------|------|------|
| **代理热交换 (Hot Swap)** | 海外厂商首次请求测试直连，成功则后续全走直连，6 小时重测 | 减少代理延迟，提升响应速度 |
| **国内厂商直连** | 智谱、讯飞、SenseNova 默认 `needsProxy: false` | 中国网络环境下直连更稳定 |
| **FreeLLMAPI 路由集成** | 智谱总结子模块默认走 FreeLLMAPI 路由，节省智谱资源包 | 充分利用免费模型池 |
| **本地 Ollama 兜底** | qwen2.5:1.5B 作为 P4 级本地兜底模型 | 网络中断时保底服务 |
| **tracker.py 集成** | logRequest 自动 POST 到 Tracker Dashboard，恢复预算告警 | 数据流断裂修复 |
| **DISABLE_PROXY_HOT_SWAP** | 测试环境关闭热交换以隔离网络 | 测试覆盖 |
| **路由去重** | 同 priority 多个模型时，按可靠性 + 速度 + 智能度排序 | 提高路由质量 |
| **空响应处理** | 200 OK 但无文本/工具调用视为失败，触发重试 | 避免无效请求浪费额度 |

### 9.2 兼容性影响

- **API 完全兼容**：改造不涉及 OpenAI API 协议变更
- **前端兼容**：React Dashboard 未改动
- **测试覆盖**：300+ 测试用例均通过
- **数据库**：无 schema 变更，增量迁移

---

## 10. 脱敏处理说明

### 10.1 需要脱敏的内容

| 内容 | 脱敏方式 | 说明 |
|------|----------|------|
| `ENCRYPTION_KEY` | 示例占位符 | 用户部署时自行生成 |
| 提供商 API Key | 示例占位符 | 用户注册时自行填入 |
| 用户邮箱/密码 | 不存储 | 仪表盘中用户凭据由服务端管理 |
| 数据库路径 | 绝对路径 → 相对路径 | 示例中展示相对路径 |

### 10.2 `.env` 脱敏

```bash
# 原始 .env（不要提交到仓库）
ENCRYPTION_KEY=a1b2c3d4...64个字符
PORT=3001

# 脱敏后 .env.example
ENCRYPTION_KEY=your-64-char-hex-key-here
PORT=3001
```

### 10.3 `.gitignore` 保护

```
# .gitignore 中包含：
.env
server/data/*.db
server/data/*.db-journal
server/data/*.db-wal
```

---

## 11. 上游同步策略

### 11.1 同步流程

**升级前必须：**

```bash
# 1. 保存本地修改
cd C:/Users/coffcoe/freellmapi
git stash

# 2. 拉取上游最新版本
git pull upstream main

# 3. 恢复本地修改
git stash pop

# 4. 处理冲突（如有）

# 5. 验证服务正常
curl http://localhost:3001/v1/models

# 6. 推送
git push origin main
```

### 11.2 冲突处理原则

| 冲突类型 | 处理策略 |
|----------|----------|
| 上游修改了核心文件（如 `router.ts`） | 优先采纳上游改动，再合并本地改造 |
| 上游修改了 `.env.example` | 合并上游新环境变量，保留本地新增变量 |
| 上游修改了测试文件 | 保留上游测试，本地追加自己的测试 |
| 上游新增提供商适配器 | 检查是否与本地修改冲突，一般无冲突 |

### 11.3 禁止事项

- **禁止直接修改上游源码**（`C:\Users\coffcoe\freellmapi`）
- **禁止提交 `.env` 文件**（含加密密钥）
- **升级 `upgrade` 会覆盖上游源码**，升级后需重新合并 tracker 通知逻辑

---

## 附录：常见问题

### Q: 遇到 429 错误怎么办？
**A:** 表示该模型额度已用完。系统会自动切换到下一个可用模型。如果所有模型都报 429，需要：1) 注册更多提供商 Key；2) 等待每日配额重置。

### Q: 如何添加新提供商？
**A:** Dashboard → Keys 页面 → Add Provider Key。对于自定义端点（如本地 Ollama），填写 `base_url` 即可。

### Q: 支持中文吗？
**A:** 完全支持。智谱 GLM-4、讯飞星火、SenseNova 对中文理解尤其出色。

### Q: 数据安全吗？
**A:** API Key 以 AES-256-GCM 加密存储在本地 SQLite 中，不会泄露到外网。建议仅在可信局域网内运行。

### Q: 支持哪些模型调用方式？
**A:** 完全兼容 OpenAI Chat Completions API + Streaming + Tool Calling + Vision/Image Input。

---

**版本**: v5.0.1  
**最后更新**: 2026-06-17  
**许可证**: MIT  
**上游仓库**: https://github.com/tashfeenahmed/freellmapi  
**个人 Fork**: https://github.com/coffcoe/freellmapi