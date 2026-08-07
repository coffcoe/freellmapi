# 🤖 任务：freellmapi 上游 merge 冲突分析与改造方案

> **模式**：`@CodeBuddy 替我上班`
> **目标**：分析 `coffcoe/freellmapi` 与上游 `tashfeenahmed/freellmapi` 的 merge 冲突，给出**可落地的改造方案**，**不要直接改代码**。
> **产出**：`MERGE-REFACTOR-PLAN.md`（含逐文件 diff 策略、改造步骤、风险点）

---

## 1. 背景

- **我们的 fork**：`coffcoe/freellmapi`，基于 2026-06 快照，深度定制了 9 项核心功能。
- **上游**：`tashfeenahmed/freellmapi`，已前进 98 个 commit（`97ffc60`）。
- **我们的 main 分支**：`882adda`（快照 + 补漏）。
- **核心冲突**：`anthropic.ts` / `proxy.ts` 被上游完全重构，与我们现有的 `for (let attempt = 0; ...)` 循环语法不兼容，导致 merge 后 TS1128/TS1005 编译错误。

---

## 2. 权威定制台账（必须阅读）

**第一步**：读取 `CUSTOM-PATCHES.md`（仓库根目录），这是所有非上游定制的唯一权威来源。

**必须保全的 9 项定制**（如缺失则方案不合格）：

| # | 定制名 | 文件 | 函数/常量 |
|---|--------|------|----------|
| 1 | `filterExhaustedQuota` | `server/src/services/router.ts` | `filterExhaustedQuota()` |
| 2 | `NO_LIMIT_COOLDOWN_CAP_MS` | `server/src/services/ratelimit.ts` | 常量 |
| 3 | `clientAborted` 熔断 | `server/src/routes/proxy.ts` | `clientAborted` + `res.on('close')` |
| 4 | `GITHUB_MAX_INPUT_TOKENS` | `server/src/routes/proxy.ts` | `truncateMessagesForGithub()` |
| 5 | `OPENROUTER_VALIDATE` | `server/src/providers/openai-compat.ts` | `/api/v1/key` 验证 |
| 6 | `AGNES_BASE_URL` | `server/src/providers/index.ts` | Agnes provider 配置 |
| 7 | `CLIENT_TEMPLATES` | `server/src/routes/config.ts` | `CLIENT_TEMPLATES` |
| 8 | `is_high_value` 模型标记 | `server/src/services/router.ts` | `is_high_value` 列 + `filterHighValueIfLarge` |
| 9 | `CUSTOM-PATCHES.md` 本身 | 仓库根目录 | 文档 |

---

## 3. 当前 merge 冲突清单

执行 `git merge upstream/main --no-commit --no-ff` 后，以下文件冲突：

### 3.1 结构性冲突（必须改造才能合并）

| 文件 | 我们的版本 | 上游版本 | 冲突原因 |
|------|-----------|----------|----------|
| `server/src/routes/anthropic.ts` | `for (let attempt = 0; ...)` 循环 | `runFallbackLoop` + `dispatch` 回调 | 语法不兼容，merge 后 TS1128 |
| `server/src/routes/proxy.ts` | 同上（两个路由） | 同上 | 同上 |

### 3.2 可自动解决的冲突（建议 `-X ours`）

以下文件的上游改动主要是 UI/配置/文档，不影响核心功能，**直接保留我们的版本**：

- `README.md`
- `client/src/i18n/I18nProvider.tsx`
- `package.json`
- `server/src/__tests__/lib/guardrails.test.ts`
- `server/src/app.ts`
- `server/src/db/migrate/defaults.ts`
- `server/src/index.ts`
- `server/src/lib/guardrails.ts`
- `server/src/lib/request-log.ts`
- `server/src/providers/cloudflare.ts`
- `server/src/providers/cohere.ts`
- `server/src/providers/google.ts`
- `server/src/providers/index.ts`
- `server/src/providers/openai-compat.ts`
- `server/src/services/catalog-sync.ts`
- `server/src/services/health.ts`
- `server/src/services/model-listing.ts`
- `server/src/services/ratelimit.ts`
- `server/src/services/router.ts`

---

## 4. 你的任务

请分析 `anthropic.ts` 和 `proxy.ts` 的差异，给出**改造方案**（不要直接改代码），具体包括：

### 4.1 anthropic.ts 改造方案

**目标**：将我们的 `for` 循环改造成上游的 `runFallbackLoop` + `dispatch` 回调风格，同时保留：
- `clientAborted` 熔断（或等价替代）
- `setCooldown / learnLimitFromError / recordRateLimitHit`（上游 `logFailure` 已内置，需确认）
- `setStickyModel`（成功时）
- `inline tool-call rescue`（`rescueInlineToolCalls`）
- `repairToolArguments`（双编码修复）
- `StreamAlreadyStarted` 类
- `sendError` / `sendExhaustion` 风格

**产出要求**：
1. 给出改造后的 `anthropic.ts` 骨架代码（伪代码或关键片段）
2. 标注哪些是我们的定制、哪些是上游通用逻辑
3. 指出改造后的风险点（如 SSE 流处理、错误码映射）

### 4.2 proxy.ts 改造方案

**目标**：同理，将 `/chat/completions` 和 `/completions` 两个路由的 `for` 循环改造成 `runFallbackLoop`。

**必须保留的定制**：
- `clientAborted`（P1-c 熔断）→ 用上游 `clientGone/clientAbort` 机制替代
- `truncateMessagesForGithub`（github 输入截断）→ 保留在 dispatch 前
- `inferClientTag`（client_tag 溯源）→ 保留
- `GITHUB_MAX_INPUT_TOKENS` / `GITHUB_MAX_OUTPUT_TOKENS` → 保留
- `fusion` 路由 → 不受影响，独立保留

**产出要求**：
1. 给出改造后的 `/chat/completions` 和 `/completions` 路由骨架
2. 说明 `clientAborted` 如何映射到上游的 `clientGone/clientAbort`
3. 说明 `truncateMessagesForGithub` 放在哪个生命周期钩子

### 4.3 其他文件的 merge 策略

对 `router.ts` / `ratelimit.ts` / `health.ts`：
- 分析上游新增的 in-flight leases / cooldown-probe recovery 是什么
- 说明我们的定制（`filterExhaustedQuota`、`NO_LIMIT_COOLDOWN_CAP_MS`、`is_high_value`）是否与上游新逻辑冲突
- 给出保留我们定制的具体 diff 策略（如：保留我们的函数，合入上游的新辅助函数）

### 4.4 最终交付格式

```markdown
# MERGE-REFACTOR-PLAN.md

## 摘要
- 改造文件数：X
- 预计冲突面：从 20 文件降到 Y 文件
- 核心定制保全率：Z%

## 逐文件方案

### 1. anthropic.ts
- 改造前：for 循环（L393-L631）
- 改造后：runFallbackLoop + dispatch 回调
- 保留定制：xxx
- 删除代码：xxx
- 新增代码：xxx
- 风险点：xxx

### 2. proxy.ts
...

### 3. router.ts / ratelimit.ts / health.ts
...

## 实施步骤
1. ...
2. ...
3. ...

## 验证清单
- [ ] tsc --noEmit 零错误
- [ ] curl localhost:3001/health 返回 200
- [ ] /v1/chat/completions 冒烟测试通过
- [ ] 9 项核心定制 grep 验证存活
```

---

## 5.  guardrails

- **不要直接 push 代码**，只出方案文档（`MERGE-REFACTOR-PLAN.md`）。
- **不要删除**任何我们的定制函数，即使你认为"上游已有等价实现"。
- **不要动** `CUSTOM-PATCHES.md`。
- 如果某个定制与上游新逻辑**确实冲突**，明确写出冲突点和**两种兼容方案**，让我们决策。
- 如果某个上游新功能（如 in-flight leases）与我们现有逻辑**不兼容**，给出 fallback 方案。

---

## 6. 参考文件

- `CUSTOM-PATCHES.md`（必须读）
- `server/src/lib/fallback-loop.ts`（上游新文件，已存在于 upstream/main）
- `server/src/routes/anthropic.ts`（我们的版本，for 循环）
- `server/src/routes/proxy.ts`（我们的版本，for 循环）
