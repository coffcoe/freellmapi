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

---

## 7. 既有规划与未竟事项（必须一并考虑）

> 以下是我们对 FreeLLMAPI 的**历史规划、未竟事项、已知风险**。你的改造方案必须评估这些事项在 merge 后的可行性，**不能只解决语法冲突，还要回答"merge 后这些规划是否还能继续推进"**。

### 7.1 中期演进：LiteLLM 混合架构（ADR-002 后续行动）

- **来源**：`architecture-overview/adr/ADR-002-freellmapi-resilience-architecture.md`（已采纳，2026-07-10）
- **现状**：当前保留自研入口，仅做声明式固化（主模型 + auto 回退链）。
- **未竟事项**：
  - [ ] （可选中期）把 FreeLLMAPI 多提供商接入/回退层借 LiteLLM 轮子，入口不变
  - [ ] （可选）把 invalid/error 状态 key 从 fallback 彻底降级（当前留作休眠兜底）
- **对你的方案的影响**：
  - 如果上游已引入类似 LiteLLM 的抽象层，评估是否值得**直接采用上游方案**而非继续自研。
  - 如果上游没有，评估我们的自研接入/回退层与上游 `runFallbackLoop` 的**兼容性**。

### 7.2 Phase 2 Pipeline 集成（LL-PHASE2-001）

- **来源**：`shared/lessons-learned/LL-PHASE2-001-free-llmapi-integration-2026-08-01.md`
- **需求**：Phase 2 "反思 QA" Pipeline 需要调用 FreeLLMAPI，涉及 vault 凭证管理（API Key + 主密码）。
- **现状**：seedling，待实现。vault 集成因 openssl 缺失暂时用 Node.js 脚本绕过。
- **对你的方案的影响**：
  - merge 后 API 路由是否有 breaking change？Phase 2 Pipeline 的调用方式是否受影响？
  - 如果上游引入了新的认证/调用方式，评估是否简化 Phase 2 集成。

### 7.3 catalog-sync 恢复决策（FLA-QUOTA-WATCH）

- **来源**：`_active-tasks.md` FLA-QUOTA-WATCH
- **现状**：`catalog-sync.ts` UPDATE 已移除 `rpd_limit`（#P2-b），rebuild 生效。`automation-1784880302906`（模型同步）现可安全恢复，但**恢复为领航员决策，未自动执行**。
- **对你的方案的影响**：
  - merge 后 `catalog-sync.ts` 是否有进一步改动？是否会影响我们的 `rpd_limit` 持久化策略？
  - 上游是否引入了新的 catalog 同步机制？如果有，评估是否替换我们的修复。

### 7.4 Ostrom 本地自治率限（ Tragedy of Commons 解决方案）

- **来源**：`shared/discussions/agent-grey-fox/2026-08-06-book-to-skill-phase1-执行报告.md`
- **观点**：FreeLLMAPI quota/token pool 是典型 Tragedy of Commons，解决方案不是统一排队争抢，而是**每个 agent 自带 fallback provider + rate limit**（本地自治）。
- **对你的方案的影响**：
  - 评估上游的 `runFallbackLoop` + `clientGone` + in-flight leases 是否已实现"本地自治率限"？
  - 如果没有，我们的改造是否应保留/增强本地自治能力？

### 7.5 skillopt 试点（freellmapi 评测集）

- **来源**：`_active-tasks.md` B 任务
- **现状**：skillopt skill 已建，freellmapi 评测集就绪（7/8 条），**试点优化待领航员确认**。
- **对你的方案的影响**：
  - merge 后是否需要更新评测集？
  - 上游新功能（如 in-flight leases、cooldown-probe）是否应纳入评测集？

### 7.6 设备验证（LL-INFRA-002-6）

- **来源**：`_active-tasks.md` LL-INFRA-002-6
- **现状**：验证所有设备调用 FreeLLMAPI 正常，**转信天翁恢复后**执行。
- **对你的方案的影响**：
  - merge 后如果路由逻辑大变，设备验证清单是否需要更新？

---

## 8. 新增：上游 `runFallbackLoop` 对 LiteLLM 混合架构的替代分析（P0 决策依据）

> **背景**：ADR-002 规划了"中期把 FreeLLMAPI 接入/回退层借 LiteLLM 轮子"的自研 hybrid 架构。现在上游已引入 926 行的 `fallback-loop.ts` + `runFallbackLoop`，需评估是否值得直接采用上游方案。

### 8.1 上游 `runFallbackLoop` 核心能力清单

| 能力 | 上游实现 | 我们现有实现 | 差异分析 |
|------|----------|--------------|----------|
| 统一 retry/fallback loop | ✅ `runFallbackLoop(candidates, dispatch)` | ❌ 每个路由各自 `for (let attempt = 0; ...)` | **上游更统一**，消除重复 |
| in-flight leases | ✅ 防止并发风暴 | ❌ 无 | **上游独有**，解决高并发下的级联失败 |
| cooldown-probe recovery | ✅ provider 冷却后自动探测恢复 | ⚠️ 仅 `setCooldown` + 定时 catalog-sync | **上游更主动** |
| callback dispatch | ✅ `logFailure`, `onFatal`, `onRoutingExhausted`, `onExhausted` | ⚠️ 散落在各路由的 `recordRateLimitHit`, `setCooldown`, `learnLimitFromError` | **上游更结构化** |
| client abort detection | ✅ `clientGone/clientAbort` | ✅ `clientAborted` + `res.on('close')` | **等价**，上游已覆盖 |
| provider-specific pre-processing | ❌ 无 | ✅ `truncateMessagesForGithub`, `inferClientTag` | **我们必须保留** |
| quota exhaustion filter | ❌ 无（仅 `onRoutingExhausted` 回调） | ✅ `filterExhaustedQuota`（精确 `(platform,key_id)` 维度） | **我们的更精细**，需作为 pre-check 保留 |
| high-value model protection | ❌ 无 | ✅ `filterHighValueIfLarge`（大请求保护稀缺模型） | **我们必须保留** |
| unbounded provider cooldown cap | ❌ 无（上游可能用固定 cooldown） | ✅ `NO_LIMIT_COOLDOWN_CAP_MS = 10min` | **需注入上游 cooldown 逻辑** |

### 8.2 对 LiteLLM 混合架构的评估

**结论：上游 `runFallbackLoop` **已足够好**，可以**直接替代** ADR-002 规划的 LiteLLM 混合架构。**

**理由**：
1. **统一抽象层已存在**：上游提供了完整的 retry/fallback 基础设施，不需要额外引入 LiteLLM 作为依赖。
2. **in-flight leases + cooldown-probe**：这两个特性已经解决了我们规划中"本地自治率限"的核心需求（Ostrom 方案），不需要自研。
3. **callback-based 扩展点充足**：`logFailure`/`onFatal`/`onRoutingExhausted` 提供了足够的钩子注入我们的定制逻辑。
4. **减少外部依赖**：避免引入 LiteLLM 这个额外的依赖和抽象层，降低维护成本。

**代价**：
1. 需要重构 `anthropic.ts` / `proxy.ts` 的循环逻辑为 `runFallbackLoop` 风格。
2. 需要将我们的 9 项定制适配到 upstream 的 callback/pre-check 模型中。
3. 需要修改 upstream 的 cooldown 逻辑以支持 `NO_LIMIT_COOLDOWN_CAP_MS`。

### 8.3 改造后架构对比

```
改造前（当前）：
  anthropic.ts: for 循环 → router → provider
  proxy.ts: for 循环 → router → provider
  (各路由各自实现 retry/fallback)

改造后（采用上游 runFallbackLoop）：
  anthropic.ts: runFallbackLoop(candidates, dispatch) → router → provider
  proxy.ts: runFallbackLoop(candidates, dispatch) → router → provider
  (统一抽象，定制逻辑通过 callbacks/pre-checks 注入)

LiteLLM 混合架构（已废弃）：
  anthropic.ts → LiteLLM Router → provider
  proxy.ts → LiteLLM Router → provider
  (多一层抽象，无必要)
```

### 8.4 对既有规划的影响汇总

| 规划项 | 来源 | 当前状态 | merge 后影响 | 建议 |
|--------|------|----------|-------------|------|
| **LiteLLM 混合架构** | ADR-002 | 可选中期 | **Superseded**（上游已提供等价能力） | **放弃**，直接采用上游 `runFallbackLoop` |
| Phase 2 Pipeline 集成 | LL-PHASE2-001 | seedling | API 路由不变（`/v1/chat/completions` 等），**无需调整** | 继续推进 |
| catalog-sync 恢复 | FLA-QUOTA-WATCH | 待决策 | `catalog-sync.ts` 上游改动不影响我们的 `rpd_limit` 治本修复 | 恢复前验证即可 |
| Ostrom 本地自治率限 | 2026-08-06 讨论 | 规划中 | **上游已支持**（in-flight leases + cooldown-probe），无需自研 | 采用上游方案 |
| skillopt 试点 | _active-tasks B | 待领航员确认 | 需将 upstream 新功能（in-flight leases、cooldown-probe）纳入评测集 | 更新评测集 |
| 设备验证 | LL-INFRA-002-6 | 转信天翁后 | 路由逻辑大变，**需更新验证清单** | 更新清单后执行 |

---

## 9. 任务拆分策略（最终方案）

> **基于 8.4 分析，采用"拆分任务"策略，而非让 NPC 全权处理。**

### 9.1 任务分配

| 承接方 | 文件 | 工作内容 | 理由 |
|--------|------|----------|------|
| **CNB NPC** | `guardrails.ts` / `settings.ts` / `router.ts` / `ratelimit.ts` | 合入上游改动，保留我们的定制（`filterExhaustedQuota`、`NO_LIMIT_COOLDOWN_CAP_MS`、`is_high_value`、`clientAborted` 映射） | 这些文件逻辑相对独立，冲突较少，NPC 可以处理 |
| **灰狐（本地）** | `anthropic.ts` / `proxy.ts` | 重构为 `runFallbackLoop` + dispatch 回调风格，保留 `truncateMessagesForGithub`、`clientTag`、`rescueInlineToolCalls`、`repairToolArguments`、`sendError`/`sendExhaustion` | 核心路由逻辑，需要精细控制，避免破坏现有功能 |
| **灰狐（本地）** | 整体验证 | tsc 编译、冒烟测试、9 项定制 grep 验证、既有规划兼容性逐项确认 | 必须本地验证，不能外包 |

### 9.2 NPC 任务边界（ guardrails.ts / settings.ts / router.ts / ratelimit.ts ）

**NPC 必须做的**：
1. 分析上游 `router.ts` / `ratelimit.ts` / `health.ts` 的新功能（in-flight leases、cooldown-probe recovery）
2. 评估我们的定制（`filterExhaustedQuota`、`NO_LIMIT_COOLDOWN_CAP_MS`、`is_high_value`）与上游新逻辑的兼容性
3. 给出保留我们定制的具体 diff 策略（如：保留我们的函数，合入上游的新辅助函数）
4. 输出 `MERGE-REFACTOR-PLAN.md` 的 §3 部分（router.ts / ratelimit.ts / health.ts 方案）

**NPC 不能做的**：
1. 不能修改 `anthropic.ts` / `proxy.ts`（灰狐处理）
2. 不能删除任何我们的定制函数
3. 不能直接 push 代码

### 9.3 灰狐任务边界（anthropic.ts / proxy.ts）

**灰狐必须做的**：
1. 将 `anthropic.ts` 的 `for` 循环改造成 `runFallbackLoop` + dispatch 回调
2. 将 `proxy.ts` 的两个路由（`/chat/completions`、`/completions`）改造成 `runFallbackLoop`
3. 保留并适配以下定制：
   - `clientAborted` → 映射到 upstream `clientGone/clientAbort`
   - `truncateMessagesForGithub` → 保留在 dispatch 前
   - `inferClientTag` → 保留
   - `rescueInlineToolCalls` / `repairToolArguments` → 保留在 dispatch 回调中
   - `sendError` / `sendExhaustion` → 映射到 upstream `onFatal` / `onRoutingExhausted`
4. 整体验证（tsc、冒烟测试、grep 验证）

### 9.4 实施顺序

```
Week 1:
  Day 1-2: CNB NPC 完成 guardrails.ts/settings.ts/router.ts/ratelimit.ts 方案
  Day 3-4: 灰狐 review NPC 方案，提出修改意见
  Day 5: NPC 根据意见修改方案，最终确认

Week 2:
  Day 1-3: 灰狐实施 anthropic.ts/proxy.ts 重构（本地 branch，不依赖 NPC）
  Day 4: 灰狐合并 NPC 的 router.ts/ratelimit.ts 改动
  Day 5: 整体验证（tsc + 冒烟测试 + grep 验证 + 既有规划兼容性确认）
```

---

## 10. 最终交付格式（更新）

```markdown
# MERGE-REFACTOR-PLAN.md

## 摘要
- 改造文件数：X
- 预计冲突面：从 20 文件降到 Y 文件
- 核心定制保全率：Z%
- **既有规划兼容性**：A/B/C/D/E/F 各项在 merge 后的可行性评估
- **LiteLLM 替代结论**：采用上游 `runFallbackLoop`，放弃 LiteLLM 混合架构

## 逐文件方案

### 1. anthropic.ts（灰狐处理）
- 改造前：for 循环（L393-L631）
- 改造后：runFallbackLoop + dispatch 回调
- 保留定制：xxx
- 删除代码：xxx
- 新增代码：xxx
- 风险点：xxx
- **对既有规划的影响**：xxx（如 Phase 2 Pipeline 集成是否受影响）

### 2. proxy.ts（灰狐处理）
...

### 3. router.ts / ratelimit.ts / health.ts（NPC 处理）
...

### 4. 既有规划兼容性矩阵

| 规划项 | 来源 | 当前状态 | merge 后影响 | 建议 |
|--------|------|----------|-------------|------|
| LiteLLM 混合架构 | ADR-002 | 可选中期 | Superseded | 放弃，采用上游 runFallbackLoop |
| Phase 2 Pipeline 集成 | LL-PHASE2-001 | seedling | 无需调整 | 继续 |
| catalog-sync 恢复 | FLA-QUOTA-WATCH | 待决策 | 无需调整 | 恢复前验证 |
| Ostrom 本地自治率限 | 2026-08-06 讨论 | 规划中 | 上游已支持 | 采用上游 |
| skillopt 试点 | _active-tasks B | 待领航员确认 | 需更新评测集 | 更新 |
| 设备验证 | LL-INFRA-002-6 | 转信天翁后 | 需更新清单 | 更新 |

## 实施步骤
1. ...
2. ...
3. ...

## 验证清单
- [ ] tsc --noEmit 零错误
- [ ] curl localhost:3001/health 返回 200
- [ ] /v1/chat/completions 冒烟测试通过
- [ ] 9 项核心定制 grep 验证存活
- [ ] 既有规划兼容性矩阵逐项确认
- [ ] LiteLLM 替代方案确认（runFallbackLoop 功能覆盖评估）
```

---

## 11. guardrails

- **不要直接 push 代码**，只出方案文档（`MERGE-REFACTOR-PLAN.md`）。
- **不要删除**任何我们的定制函数，即使你认为"上游已有等价实现"。
- **不要动** `CUSTOM-PATCHES.md`。
- 如果某个定制与上游新逻辑**确实冲突**，明确写出冲突点和**两种兼容方案**，让我们决策。
- 如果某个上游新功能（如 in-flight leases）与我们现有逻辑**不兼容**，给出 fallback 方案。
- **NPC 只处理 guardrails.ts/settings.ts/router.ts/ratelimit.ts**，**不要碰 anthropic.ts/proxy.ts**（灰狐处理）。

---

## 12. 参考文件

- `CUSTOM-PATCHES.md`（必须读）
- `server/src/lib/fallback-loop.ts`（上游新文件，已存在于 upstream/main）
- `server/src/routes/anthropic.ts`（我们的版本，for 循环）
- `server/src/routes/proxy.ts`（我们的版本，for 循环）

---
