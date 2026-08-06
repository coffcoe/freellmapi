# FreeLLMAPI 免费额度参考手册

> 本手册汇总 FreeLLMAPI 所聚合平台的免费额度信息，供路由评估和选型参考。
> 数据来源：2026-07-15 知识库卡片 `platform-free-llm-tiers-comprehensive-2026.md`
> 注意：平台政策随时变化，请以各平台官方页面为准。

---

## 国产平台

| 平台 | 免费模型/额度 | 限制条件 | Base URL | 备注 |
|------|--------------|---------|----------|------|
| **硅基流动** | 9B 以下模型永久免费不限量；新用户送 ¥14（约 2000 万 token，180 天有效） | 速率限制 10-20 RPM | `https://api.siliconflow.com/v1` | 代表模型：Qwen2.5-7B、GLM-4-9B-Chat、DeepSeek-R1-Distill-Llama-8B |
| **智谱 AI** | GLM-4-Flash 永久免费不限量；新用户送 2000 万 token 体验包（3 个月有效） | 30 并发 | `https://open.bigmodel.cn/api/paas/v4` | 国内最稳定的永久免费层之一 |
| **百度千帆** | ERNIE-3.5-8K 和 ERNIE-Speed-8K 永久免费不限量；ERNIE-4.0 新用户每月 100 万 token | 需实名认证 | `https://qianfan.baidubce.com/v2` | 文心系列模型 |
| **阿里云百炼** | 每个模型 100 万 token，90 天有效，多模型可叠加 | 需阿里云账号 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | DeepSeek-R1 等模型可叠加 |
| **DeepSeek** | 新用户 500 万 token，约 30 天有效 | 仅限新用户 | `https://api.deepseek.com/v1` | 深度求索模型 |
| **阶跃星辰** | Step Plan 新用户 15-90 天免费体验（邀请好友可延长期限），月限额 4 亿 Credits | 仅限新用户，活动截止 2026-07-31 | `https://api.stepfun.com/v1` | 代表模型：step-3.7-flash、step-router-v1 |

---

## 海外平台

| 平台 | 免费模型/额度 | 限制条件 | Base URL | 备注 |
|------|--------------|---------|----------|------|
| **Google Gemini** | 免费层长期开放，无需绑卡 | 曾削减 50-80% 配额，当前为削减后水平 | `https://generativelanguage.googleapis.com/v1beta` | 数据可能被 Google 用于改进模型 |
| **OpenRouter** | 28+ 免费模型，零成本，无需绑卡，余额 $0 也能用 | 各模型速率限制不同 | `https://openrouter.ai/api/v1` | 代表模型：NVIDIA Nemotron 3 Ultra 1M 上下文、OpenAI GPT-OSS-120B 131K 上下文 |
| **GitHub Models** | 用 GitHub PAT 调用，速率限制按模型分档 | 仅限原型测试，2026-07-30 关停倒计时 | `https://models.github.ai/inference` | ⚠️ 即将关停 |
| **Cloudflare Workers AI** | 每天 10,000 Neurons 永久有效，每天重置 | 无卡，匿名可用 | `https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run` | 需 account_id |
| **OpenAI 数据共享计划** | 每日免费 token 按 Usage Tier 分级 | 需 Tier 1 充值 $5，数据会被用于训练 | `https://api.openai.com/v1` | 不推荐隐私场景 |
| **Groq** | 免费 tier 可用 | 速率限制 | `https://api.groq.com/openai/v1` | 推理速度快 |
| **Cerebras** | 免费 tier 可用 | 速率限制 | `https://api.cerebras.ai/v1` | 支持大模型推理 |
| **Mistral** | 免费 tier 可用 | 速率限制 | `https://api.mistral.ai/v1` | 欧洲模型厂商 |

---

## 聚合/网关平台

| 平台 | 免费模型/额度 | 限制条件 | Base URL | 备注 |
|------|--------------|---------|----------|------|
| **Kilo Gateway** | :free  routes，匿名可用，rate-limited 200 req/hr per IP | 匿名访问，prompts/outputs 可能被用于训练 | `https://api.kilo.ai/api/gateway/v1` | 包含 stepfun/step-3.7-flash:free 等模型 |
| **Pollinations** | openai-fast (GPT-OSS 20B) 匿名可用 | 队列限制，1 并发请求/IP | `https://text.pollinations.ai/openai/v1` | 匿名 tier 永久有效 |
| **LLM7** | 100 req/hr free；anonymous access 可用 | 基础模型 | `https://api.llm7.io/v1` | 聚合 GPT-OSS、Llama 3.1、Codestral、GLM-4.6V-Flash |
| **OVH AI Endpoints** | anonymous (2 req/min per IP per model) 和 authenticated (400 req/min) | 匿名 tier 无需卡 | `https://oai.endpoints.kepler.ai.cloud.ovh.net/v1` | 欧洲节点 |
| **OpenCode Zen** |  promotional models 限时免费 | 需 free account key（no card） | `https://opencode.ai/zen/v1` | trial-only， prompts/outputs 可能被用于训练 |
| **AINative Studio** | 约 10M tokens/month free allocation（未验证） | 需 bearer auth | `https://api.ainative.studio/api/v1` | 配额真实性待确认 |
| **BazaarLink** | auto:free 路由零成本模型 | 无卡，支持 agent 自注册 | `https://bazaarlink.ai/api/v1` | reasoning models 可能消耗内部 max_tokens |
| **ReKa** | 每月 recurring credit grant（no card） | 免费 tier | `https://api.reka.ai/v1` | 模型：reka-flash-3、reka-edge-2603 |
| **Reka** | 每月 recurring credit grant（no card） | 免费 tier | `https://api.reka.ai/v1` | 模型：reka-flash-3、reka-edge-2603 |

---

## 特殊/社区平台

| 平台 | 免费模型/额度 | 限制条件 | Base URL | 备注 |
|------|--------------|---------|----------|------|
| **AI Horde** | 免费，社区驱动推理（志愿者 workers） | 匿名 key `0000000000`（最低优先级）；注册 key 提高优先级 | `https://aihorde.net/api/v1` | 排队可能 tens of seconds，无 tool calling |
| **ModelScope** | 2000 requests/day（no card） | 需阿里云账号 + 实名认证 | `https://api-inference.modelscope.cn/v1` | 国内平台 |
| **Cline.bot** | 1M context free models | 需注册（no card） | `https://api.cline.bot/api/v1` | 模型：minimax-m3、mimo-v2.5、deepseek-v4-flash |

---

## 排错三例（来自知识卡片）

1. **注册后没额度** → 没做实名认证
2. **401/403** → API Key 错误/过期/Base URL 不对
3. **额度突然清零** → 有效期到期或平台政策变更

---

## 进阶组合建议（来自知识卡片）

- **日常对话/轻量任务**：智谱 GLM-4-Flash + 硅基流动免费模型
- **代码生成/推理**：DeepSeek + 阿里百炼 DeepSeek-R1
- **英文/多模态**：Google Gemini
- **备选/兜底**：OpenRouter + Cloudflare Workers AI

---

## 相关链接

- [FreeLLMAPI 路由文档](../README.md)
- [FreeLLMAPI 模型定价](model-pricing.ts)
- [平台免费额度全攻略卡片](https://mp.weixin.qq.com/s/9sNE6Mkk1rd9g56v8c0I4Q)

---

*维护者：🦊 灰狐 | 创建于 2026-07-15 | 下次审核：2026-07-31（阶跃星辰活动截止）*
