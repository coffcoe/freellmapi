# MERGE-REFACTOR-PLAN — freellmapi 上游 merge 冲突分析与改造方案

> **模式**：`@CodeBuddy 替我上班`
> **目标**：分析 `coffcoe/freellmapi`（本地 fork）与上游 `tashfeenahmed/freellmapi` 的 merge 冲突，给出**可落地的改造方案**。
> **本文件只做分析与方案，不修改任何业务代码**（护栏约定）。
> **产出日期**：2026-08-07 ｜ **对照基线**：
> - 本地 `HEAD` = `9588913`（`docs: update NPC merge refactor task…`，工作树 clean）
> - 上游 `upstream/main` = `c0c859c`（2026-08-07，含 v0.6.8+，共 **188 个 commit 领先**本地 merge-base `c2f1dee`）
> - 本地领先上游：**31 个 commit**（含 9 项核心定制 + 补漏 + 文档）

---

## 摘要

| 指标 | 数值 |
|---|---|
| 实际冲突文件数（`git merge --no-commit` 实测） | **23** |
| 其中结构性（无法自动合并，必须改造） | **3**（`anthropic.ts` / `proxy.ts` / `responses.ts`） |
| 其中需人工决策的语义冲突 | **~8**（`router.ts` / `ratelimit.ts` / `health.ts` / `catalog-sync.ts` / `request-log.ts` / `providers/index.ts` / `app.ts` / `index.ts` 等） |
| 可 `-X ours` 直接保留本地版本的 | ~12（README / client i18n / 测试文件等） |
| 核心定制保全率（9 项） | **100% 可保全**（方案保证） |
| 建议的合并策略 | **`runFallbackLoop` 统一重构 + 保留定制 + 增量合入上游新能力** |

> ⚠️ **重要更正**：本任务原始描述（`NPC-ISSUE-freellmapi-merge-改造方案.md`）与最新的 `9588913` 文档说"冲突面从 20 文件降到 Y 文件"、并假设 `responses.ts` 不在冲突面。**实测** 真实冲突为 **23 个文件**，且 **`responses.ts` 是第三个结构性冲突面**（本地它仍是 `for` 循环、上游已用 `runFallbackLoop`）。本方案按实测数据编写。

---

## 0. 基线事实（实测，先确认再动手）

### 0.1 版本差距

```bash
git merge-base HEAD upstream/main        # c2f1dee
git rev-list --count HEAD..upstream/main # 188（上游领先）
git rev-list --count upstream/main..HEAD # 31（本地领先）
```

本地落后上游 188 个 commit，但本地 fork 点（`c2f1dee`）之后上游已完成大量架构演进：
- **`lib/fallback-loop.ts`（998 行）**：统一 retry/fallback 循环，各路由只留薄 `dispatch` 适配器。
- **in-flight leases**（`ratelimit.ts`）：按 key 并发租约，闭合「选中 key → 写成功计数」之间的 check-then-act 竞态。
- **cooldown-probe 恢复**（`services/cooldown-probe.ts`）：对 `heuristic` 来源的冷却做探测提前恢复。
- **attempt-trace / `request_attempts` 表**：每次失败尝试的明细落库（P2 #15）。
- **`client-context` / `client-classifier`**：请求级调用方识别（IP/UA/agent），替代我们的 `clientTag` 思路（但语义不同，见 §5）。
- **`model-retirement`、`provider-timeout`、`url-guard`、`structured-output`、`system-prompt`（client-profile 密钥）、`gemini/mcp/ollama` 等 23 个新 lib + 10 个新 route + 10 个新 service**（本地 lib 18 → 上游 40）。
- **16 个新迁移**（`request_client_info` / `cooldown_probe_provenance` / `request_attempts` / `model_source_provenance` / `key_model_scope` / `client_profiles` 等）。

### 0.2 本地定制现状（已核实，`CUSTOM-PATCHES.md` + 代码）

| # | 定制 | 文件 | 本地代码核实 | 上游是否有 |
|---|---|---|---|---|
| 1 | `filterExhaustedQuota` | `services/router.ts` L439 | ✅ 存在 | ❌ 无（上游没有按 `(platform,key_id)` 剔除耗尽池） |
| 2 | `NO_LIMIT_COOLDOWN_CAP_MS=10min` | `services/ratelimit.ts` L310/L414 | ✅ 存在 | ⚠️ 上游有 `nullLimitHits` 启发式但**没有 10min 封顶**（上游会进入 `getNextCooldownDuration` 阶梯到 24h） |
| 3 | `clientAborted` 熔断 | `routes/proxy.ts` | ✅ 存在（L769/L1130） | ⚠️ 上游用 `clientGone` + AbortController + `isClientAbortError`（更完整，见 §4） |
| 4 | `GITHUB_MAX_INPUT_TOKENS` / `truncateMessagesForGithub` | `routes/proxy.ts` L490-524 | ✅ 存在 | ❌ 无（上游无 github 截断护栏） |
| 5 | `OPENROUTER_VALIDATE`（`/api/v1/key`） | `providers/index.ts` L63 | ✅ 存在 | ❌ 无（上游 OpenRouter 无 `validateUrl`，仍走默认 `/models`） |
| 6 | `AGNES_BASE_URL`（`.cn`） | `providers/index.ts` L206 | ✅ `.cn` | ⚠️ 上游是 `.com`（**本地是修复，上游未合入**） |
| 7 | `CLIENT_TEMPLATES` | `routes/config.ts`（本地独有文件） | ✅ 存在（882adda 已补交） | ❌ 无（上游没有 config 路由） |
| 8 | `is_high_value` + `filterHighValueIfLarge` | `router.ts` L888-918 | ✅ 存在 | ❌ 无 |
| 9 | `CUSTOM-PATCHES.md` | 仓库根 | ✅ 存在 | ❌ |
| 10 | `clientTag` + `notifyTracker` | `lib/request-log.ts` | ✅ 存在 | ⚠️ 上游用 `client-context`（IP/UA/agent），**不读 `x-client-tag` 头、无 3003 tracker** |
| 11 | HMAC `timingSafeStringEqual` | `middleware/proxyAuth.ts` | ✅ 存在 | ⚠️ 上游在 `lib/system-prompt.ts` 也有 `timingSafeStringEqual`，但**中间件链结构已被上游抛弃** |
| 12 | middleware 链（6 段） | `middleware/*` + `app.ts` | ✅ 存在（19e8771） | ❌ 上游已改为 `clientContextMiddleware` + 内联校验，**中间件链被废弃** |
| 13 | 场景路由（`detectCategoryScene` 等） | `routes/proxy.ts` L300-375 | ✅ 存在 | ❌ 无 |
| 14 | catalog-sync `rpd_limit` 排除 | `services/catalog-sync.ts` L177 | ✅ 存在 | ❌ 无（上游 UPDATE 仍带 `rpd_limit`） |
| 15 | 启动清理过期冷却 | `index.ts` | ✅ 存在 | ❌ 无（上游没有 `cleanupExpiredCooldowns` 启动调用） |
| 16 | cline / modelscope 平台 | `providers/index.ts` | ✅ 存在 | ⚠️ modelscope 上游有（独立 provider 文件）、cline 上游无 |
| 17 | `routes/config.ts`（多客户端接入） | 本地独有 | ✅ 存在 | ❌ 无 |
| 18 | 本地独有路由 `sticky-session.ts` / `stream-handler.ts` | 本地独有 | ⚠️ **stream-handler.ts 无任何导入方**（死代码，19e8771 遗留） | ❌ |

> **注意**：`sticky-session.ts` 被 `stream-handler.ts` 引用，而 `stream-handler.ts` 没有被任何地方 import（`grep handleStreamRoute` 仅命中自身）。**这是本地死代码**，合并时可一并清理。

---

## 1. 逐文件冲突清单（实测）

```bash
# 在干净 worktree 上实测（HEAD = 9588913）
git merge upstream/main --no-commit --no-ff   # 23 个冲突
```

| # | 文件 | 冲突类型 | 分类 |
|---|---|---|---|
| 1 | `server/src/routes/proxy.ts` | content | 🔴 **结构性**（for 循环 vs runFallbackLoop） |
| 2 | `server/src/routes/anthropic.ts` | content | 🔴 **结构性**（for 循环 vs runFallbackLoop） |
| 3 | `server/src/routes/responses.ts` | content | 🔴 **结构性**（for 循环 vs runFallbackLoop） |
| 4 | `server/src/services/router.ts` | content | 🟡 语义（需保留定制 + 合入上游新 gate） |
| 5 | `server/src/services/ratelimit.ts` | content | 🟡 语义（需保留 10min 封顶 + 合入 leases/provenance） |
| 6 | `server/src/services/health.ts` | content | 🟡 语义（需合入 probeKeyValidity/markKeyHealthy，保留 keyless 适配） |
| 7 | `server/src/services/catalog-sync.ts` | content | 🟡 语义（需保留 rpd_limit 排除 + 合入上游 catalog 演进） |
| 8 | `server/src/lib/request-log.ts` | content | 🟡 语义（需保留 clientTag/tracker + 合入 client-context/attempt-trace） |
| 9 | `server/src/providers/index.ts` | content | 🟡 语义（需保留 openrouter validateUrl / agnes .cn / cline / modelscope） |
| 10 | `server/src/providers/openai-compat.ts` | content | 🟡 语义（需保留本地 validateKey 修复？核实后决定） |
| 11 | `server/src/app.ts` | content | 🟡 语义（middleware 链 vs 上游挂载；需保留 config 路由） |
| 12 | `server/src/index.ts` | content | 🟡 语义（需保留 cleanupExpiredCooldowns + 合入 startCooldownProbe） |
| 13 | `server/src/db/migrate/defaults.ts` | content | 🟡 语义（需合入上游 16 个迁移注册 + 保留本地 3 个） |
| 14 | `server/src/middleware/errorHandler.ts` | content | 🟢 可自动（`-X ours` 或手工） |
| 15 | `server/src/providers/cloudflare.ts` | content | 🟢 可自动 |
| 16 | `server/src/providers/cohere.ts` | content | 🟢 可自动 |
| 17 | `server/src/providers/google.ts` | content | 🟢 可自动 |
| 18 | `server/src/services/model-listing.ts` | content | 🟡 语义（需保留本地扩充字段 + 合入上游） |
| 19 | `server/src/routes/settings.ts` | content | 🟢 可自动（guardrails API 双方都有） |
| 20 | `server/src/lib/guardrails.ts` | add/add | 🟡 语义（两边都是新增；上游是从 e5024d5 移植，需统一） |
| 21 | `server/src/__tests__/lib/guardrails.test.ts` | add/add | 🟢 可自动（取上游测试 + 补本地 case） |
| 22 | `package.json` | content | 🟢 可自动（取上游 + 保留本地依赖） |
| 23 | `README.md` / `client/src/i18n/I18nProvider.tsx` | content | 🟢 可自动（`-X ours`） |

---

## 2. 结构性冲突改造方案（核心）

### 2.1 `server/src/routes/proxy.ts`（最大冲突面，本地 2113 行 vs 上游 2174 行）

**冲突本质**：本地 `/chat/completions` 和 `/completions` 两个路由各自实现了 `for (let attempt = 0; attempt < MAX_RETRIES; attempt++)` 重试循环（含内联的冷却/跳闸/记账/日志）；上游把这一切收敛进 `lib/fallback-loop.ts` 的 `runFallbackLoop(hooks)`，路由只留**请求翻译 + 流式帧 + 错误体渲染**。

**改造目标骨架**（两个路由统一形态）：

```ts
// 前置：token 预算、vision/tools 门、fusion、模型 pin/组、scene 偏好（本地保留，全部在循环之外）
const state = newFallbackState();
const attemptLog: AttemptRecord[] = [];
let clientGone = false;
const clientAbort = new AbortController();
res.on('close', () => {
  if (!res.writableEnded) { clientGone = true; clientAbort.abort(newClientAbortError()); }
});
const dispatchOptions = { temperature, max_tokens, top_p, stop, tools, tool_choice, parallel_tool_calls, signal: clientAbort.signal };

await runFallbackLoop({
  maxRetries: MAX_RETRIES,
  state,
  attemptLog,
  clientGone: () => clientGone,
  route: (attempt) => routeRequest(
    routingEstimate,
    state.skipKeys.size > 0 ? state.skipKeys : undefined,
    preferredModel, hasImage, wantsTools,
    state.skipModels.size > 0 ? state.skipModels : undefined,
    groupChain ?? resolvedChain?.chain,
  ),
  dispatch: async (route, attempt) => {
    // ── 本地定制保留点 ──
    // 1) github 截断 + max_tokens 封顶（truncateMessagesForGithub）→ 在 dispatch 开头对 outboundMessages 处理
    // 2) context handoff 注入（maybeInjectContextHandoff）
    // 3) clientTag 溯源（inferClientTag）→ 保留，上游 client-context 是替代但不是等价
    // 4) 流内 dialect 救援 / tool-args 修复 / 空完成 → 在 dispatch 内（上游已内置等价，需核对）
    // 5) 成功记账 → recordUpstreamSuccess(route, tokens)（上游统一）
    return 'done'; // 或 'committed'（流已提交时）
  },
  logFailure: (route, err, attempt) => { /* 本地 traceRouteEvent + logRequest 保留 */ },
  onFatal: (route, err, attempt) => { /* 502 provider_error */ },
  onRoutingExhausted: (lastError, routeErr, exhaustion, info) => { /* 本地诊断日志 + 渲染 */ },
  onExhausted: (exhaustion, info) => { /* 渲染 exhaustion */ },
});
```

**`clientAborted` → `clientGone` 映射**：

| 本地（现状） | 上游（目标） |
|---|---|
| `let clientAborted = false; res.on('close', () => { if (!res.writableFinished) clientAborted = true; })` | `let clientGone = false; const clientAbort = new AbortController(); res.on('close', () => { if (!res.writableEnded) { clientGone = true; clientAbort.abort(newClientAbortError()); } })` |
| 循环内 `if (clientAborted) break/return` | 循环顶部 `if (attempt > 0 && hooks.clientGone?.()) return;`（**下一个 attempt 前**检查） |
| 流内 `if (clientAborted) break` | 流内 `if (clientGone) break`（reader.cancel() 触发 abort） |
| 客户端断开后自己收尾、不记账 | 上游 `isClientAbortError` 分支：`logRequest(...,'canceled',...)` + 返回，**不 bench、不 failover** |

**关键差异**：
1. **上游多一层 AbortController**：本地只在「下一个 attempt 前」和「流内 chunk 间」检查标志位，**已发出的上游 fetch 不会真正被取消**；上游把 `signal` 传进 `CompletionOptions`，客户端断开会**立刻 abort 在途请求**，省 token + 立刻释放 in-flight lease。**这是必须采纳的上游改进**（对「Ostrom 本地自治率限」也是关键支撑）。
2. **上游多一条 `'canceled'` 状态行**（#752）：纯 abort 现在也会在 `requests` 表留一条 `canceled` 记录（不计 success/error，统计与评分都排除），本地目前 abort 是**什么都不记**。建议采纳。
3. **`truncateMessagesForGithub` 的挂钩点**：放在 `dispatch` 内部、`route.provider.chatCompletion/streamChatCompletion` 调用之前，且只在 `route.platform === 'github'` 时生效（与现状一致）。`GITHUB_MAX_INPUT_TOKENS`/`GITHUB_MAX_OUTPUT_TOKENS` 常量原样保留。

### 2.2 `server/src/routes/anthropic.ts`（本地 695 行 vs 上游 967 行）

**冲突本质**：与 proxy 相同——本地 `for` 循环，上游 `runFallbackLoop`。上游已把 Anthropic 面也接入统一循环，并补齐了本地缺失的：
- inline tool-call dialect 救援（`rescueInlineToolCalls`）——**本地 anthropic 目前没有**，上游有（好消息）；
- 共享 exhaustion body（400 invalid_request / 413 / 404 / 502 语义统一）；
- `StreamAlreadyStarted` 语义映射到 `'committed'`。

**改造骨架**：

```ts
const state = newFallbackState();
const attemptLog: AttemptRecord[] = [];
let clientGone = false;
const clientAbort = new AbortController();
res.on('close', () => { if (!res.writableEnded) { clientGone = true; clientAbort.abort(newClientAbortError()); } });
const dispatchOptions = { ...completionOptions, signal: clientAbort.signal };

await runFallbackLoop({
  maxRetries: MAX_RETRIES,
  state, attemptLog, clientGone: () => clientGone,
  route: () => routeRequest(estimatedTotal, state.skipKeys.size > 0 ? state.skipKeys : undefined,
    preferredModel, hasImage, wantsTools, state.skipModels.size > 0 ? state.skipModels : undefined),
  dispatch: async (route, attempt) => {
    if (stream) {
      try {
        await streamCompletion(res, route, messages, dispatchOptions, { start, attempt, attemptLog, clientGone: () => clientGone, requestedModel, estimatedInputTokens, tools, pinnedModelId, sessionId, pinned: resolved.pinned });
        return 'done';
      } catch (err) { if (err instanceof StreamAlreadyStarted) return 'committed'; throw err; }
    }
    const result = await route.provider.chatCompletion(route.apiKey, messages, route.modelId, dispatchOptions);
    // ... 空完成 skipBench、dialect 救援、repairToolArguments、记账、响应体 ...
    return 'done';
  },
  logFailure: (route, err, attempt) => { /* 本地 logRequest + sanitize */ },
  onFatal: (route, err, attempt) => { setFallbackHeaders(...); sendError(res, 502, 'api_error', ...); },
  onRoutingExhausted: (lastError, routeErr, exhaustion, info) => { setFallbackHeaders(...); sendExhaustion(res, exhaustion); },
  onExhausted: (exhaustion, info) => { setFallbackHeaders(...); sendExhaustion(res, exhaustion); },
});
```

**本地需要保留/适配的定制**：
- `sendError` / `sendExhaustion` 风格 → 可保留 `sendError`；`sendExhaustion` 按上游新增（或复用上游 `exhaustionErrorPayload`）。
- `setStickyModel`（成功时）→ 上游 `recordUpstreamSuccess` 之后调用，保持一致。
- `repairToolArguments` / `toolSchemaMap` → 在 dispatch 内保留（上游 anthropic 也有）。
- `StreamAlreadyStarted` → 保留类，catch 里映射 `'committed'`。
- Anthropic 专属的 `clientAborted` 等价 → 同 §2.1 的 `clientGone` + AbortController。

**风险点**：
- **SSE 事件序列**：`message_start → content_block_* → message_delta → message_stop` 必须保持。上游 `streamCompletion` 已按此实现，直接采用上游版本最稳；若用本地版本，需要自己加 `clientGone` 检查和 `signal` 透传。
- **错误码映射**：上游 `sendExhaustion` 会把 `kind` 映射为 Anthropic 词汇（auth→api_error / unavailable→overloaded_error / context_too_large→request_too_large / model_not_found→not_found_error / upstream→api_error）。本地现在的 `sendError` 是硬编码，建议直接用上游 `sendExhaustion`。

### 2.3 `server/src/routes/responses.ts`（本地 935 行 vs 上游 935 行——**第三个结构性冲突面**）

**任务原始描述漏掉了它**。本地 `responses.ts` 仍是 `for` 循环（L381），上游已改为 `runFallbackLoop`。改造方式与 §2.2 完全一致（`/v1/responses` 是 Codex 的 Responses API shim）。

**本地独有注意点**：
- 本地 `responses.ts` 从 `./proxy.js` import 了大量辅助（`traceRouteEvent`/`exhaustedRetryError`/`logRequest`/`getStickyModel`…）。改造后这些应从 `lib/fallback-loop.js` + 各自模块引入，**打破对 proxy.ts 的耦合**（这也是上游的方向）。
- `buildResponseObject` / Responses SSE 事件序列（`response.created` / `output_item.added` / `content_part.added` / `output_text.delta` / `response.completed`）保留本地逻辑，只把外层循环换成 `runFallbackLoop`。

---

## 3. 其他文件的 merge 策略

### 3.1 `services/router.ts`（本地 1099 行 vs 上游 ~1700 行）

**上游新增**：
- in-flight lease 获取：`selectKeyForModel` 返回的 `RouteResult` 带 `release?.()`，`acquireLease` 在 key 通过所有 gate 后调用（`router.ts` L1156）。
- `endpoint_scope` 列参与 key 与统计（多 base_url 同一平台按 endpoint 区分）。
- `canUseProviderMinute` / `canUseProviderTokens` / `key-concurrency` 三个新 gate。
- `routeRequest` 新增第 8 参 `requireStructured`（结构化输出路由）。
- `resolveStickyPreference`、`hasOtherUsableKey`、`summarizeExhaustion`（带 `getSoonestCooldownExpiry`）。
- exploration toggle（`getExploreEnabled`）。

**本地定制保留点**（上游没有）：
- `filterExhaustedQuota`（L439）：在 `getActiveChain` / `getChainByProfileName` / `getChainByGlobalSort` 三处调用。**必须在改造后的 `getActiveChain` 里原样保留**——上游没有这个过滤，直接 `-X ours` 会丢掉它。
- `filterHighValueIfLarge` + `HIGH_VALUE_INPUT_THRESHOLD=20000`（L888-918）：在 `routeRequest` 内、`orderChain` 之前调用。**必须保留**。

**diff 策略**（推荐）：
1. **以上游 router.ts 为基底**（拿 leases / endpoint_scope / 新 gate / exploration）；
2. 把 `filterExhaustedQuota` 调用点**移植回** `getActiveChain` 等三处；
3. 把 `filterHighValueIfLarge` 块**移植回** `routeRequest`（放在 `const chain = ...` 之后）；
4. 本地 `routeRequest` 的 `diag` 逻辑与上游 `summarizeExhaustion` 兼容（上游已把 disposition 文本化成 summary），**建议采纳上游版本**（信息更全，含 soonest cooldown ETA）。

**兼容性结论**：
- `filterExhaustedQuota` 与 leases **不冲突**：一个是「从 DB 观察到的已耗尽池剔除」，一个是「在途请求并发计数」，职责正交。
- `filterHighValueIfLarge` 与 exploration toggle **不冲突**：前者在链构建时按 token 大小过滤，后者在排序后按采样数插入，先后顺序需确认（建议 high-value 过滤在 `orderChain` 之前、exploration 在之后，与现状一致）。

### 3.2 `services/ratelimit.ts`（本地 594 行 vs 上游 ~1160 行）

**上游新增**（必须合入）：
- **in-flight leases**：`acquireLease` / `releaseLease` / `canUseKeyConcurrency` / `inFlightForKey`，provisional 计数闭合 check-then-act 竞态。
- **CooldownSource 溯源**：`setCooldown(..., source)` 写入 `rate_limit_cooldowns.source/set_at_ms`（迁移 `20260726_000001_cooldown_probe_provenance`），cooldown-probe 只探测 `heuristic`。
- **`getCooldownDecisionForLimit`**（返回 `{durationMs, source}`）+ `getCooldownDecisionForError`（在 fallback-loop 里）。
- `LOCAL_ENDPOINT_COOLDOWN_MS=5s`（本地 endpoint 豁免 #592）。
- `quotaSignal` 门（#592）：只有真 429 才喂 null-limits 启发式，timeout/5xx 不再误升级。
- `getProbeableCooldowns` / `clearCooldownEarly` / `getSoonestCooldownExpiry` / `getActiveCooldownsForKeys` / `clearCooldownsForKey`。

**本地定制保留点**：
- `NO_LIMIT_COOLDOWN_CAP_MS = 10min`（L310/L414）。**上游没有这个封顶**——上游 `nullLimitHits` 启发式命中后走 `getNextCooldownDuration` 阶梯（2m→10m→1h→24h），**没有 10min 上限**。

**diff 策略（关键决策点）**：
- **方案 A（推荐）**：以上游为基底，把本地 `NO_LIMIT_COOLDOWN_CAP_MS` 语义**合入上游 `getCooldownDecisionForLimit`**——即把上游的
  ```ts
  const base = (rpdExhausted || tpdExhausted || heuristicallyExhausted)
    ? getNextCooldownDuration(platform, modelId, keyId)
    : TRANSIENT_COOLDOWN_MS;
  ```
  改为
  ```ts
  const base = (rpdExhausted || tpdExhausted)
    ? getNextCooldownDuration(platform, modelId, keyId)      // 真 RPD/TPD 耗尽仍走 24h 阶梯（正确）
    : heuristicallyExhausted
      ? NO_LIMIT_COOLDOWN_CAP_MS                             // 无文档上限 provider 的启发式 → 10min 封顶
      : TRANSIENT_COOLDOWN_MS;
  ```
  source 仍标 `'heuristic'`（这样 cooldown-probe 还能提前恢复，10min 封顶 + probe 恢复兼容）。
- **方案 B（保守）**：本地整个 `getCooldownDurationForLimit` 不动，仅把返回值适配成上游 `CooldownDecision` 结构（包一层）。但会丢失上游的 `quotaSignal` 门和本地 endpoint 豁免，**不推荐**。

> ⚠️ **冲突提示**：若直接 `-X ours` 整个 ratelimit.ts，会丢掉 leases/provenance/cooldown-probe/本地豁免，**fallback-loop 无法编译**（它 import `getCooldownDecisionForLimit`、`getSoonestCooldownExpiry`、`CooldownSource`）。所以 ratelimit.ts **必须手工合并**，不能 `-X ours`。

### 3.3 `services/health.ts`（本地 100 行 vs 上游 399 行）

**上游新增**：
- `probeKeyValidity(keyId)`：**无副作用**的 validateKey（不写 status/last_checked_at/failureCount），供 cooldown-probe 使用。
- `markKeyHealthyFromRequest(keyId)`：成功请求后把 `'error'` 状态抬回 `'healthy'`（fallback-loop 成功路径调用）。
- `interleaveByProvider`：按 provider 打散探测顺序（防同一 IP 连续打同一 provider）。
- 并发 pass 守卫（`checkAllInFlight`）、`HealthPassOptions`、并发/间隔参数。

**本地保留点**：
- `checkKeyHealth` 的 **keyless 适配**（kilo/pollinations 用空串验证 + `inferQuotaPoolKey`）；`checkAllKeys` 的日志格式（`[Health] Key N (platform, base=...)`）被 12h 崩溃 watchdog 依赖。

**diff 策略**：以上游为基底，把本地 keyless 分支和日志格式移植进上游 `checkKeyHealth`。`probeKeyValidity` 里也要保留 keyless 处理（上游 probe 直接 `decrypt`，keyless 会炸——需加 `provider.keyless ? '' : decrypt(...)`）。

### 3.4 `services/catalog-sync.ts`（本地 545 行 vs 上游 ~800 行）

**上游演进**：catalog 模型更多、`migrateModelsV26+`、tombstone provenance、media/embedding 同步面扩大。**上游 UPDATE 仍带 `rpd_limit`**（会清掉本地 P0 的每日上限）。

**本地保留点**：
- UPDATE 排除 `rpd_limit`（以及本地 `raw_capabilities`/`capability_sources` 排除）。**必须移植到上游版本**。
- 本地额外排除 `capability_sources` 的处理需与上游新字段核对（上游可能已引入 capability 概念，见 `model_source_provenance` 迁移）。

**diff 策略**：以上游为基底，把 `updateModel` 的 SET 里删掉 `rpd_limit`（保留 INSERT 用 catalog 默认）。用 grep 标记 `rpd_limit 治本, #P2-b` 验证。

### 3.5 `lib/request-log.ts`（本地 119 行 vs 上游 ~200 行）

**上游新增**：
- `client_ip` / `client_user_agent` / `client_agent` 三列（`20260706_000001_request_client_info` + `20260727_000001_agent_compatibility`），从 `client-context` 读取。
- `served_model` 列（`20260726_000005_request_served_model`）。
- attempt-trace 回写（`noteRequestRowId` / `persistRequestAttempts`）。

**本地保留点**：
- `clientTag` 参数（`x-client-tag`/`x-app-tag`）写入 `requests.client_tag`（本地迁移 `20260802_000000_quota_guard_columns`）。
- `notifyTracker`：成功且有 token 时非阻塞 POST 到 `localhost:3003`（Flask tracker），300ms 超时、失败静默。

**diff 策略**：
- **`client_tag` 与上游 `client_agent` 语义不同**：上游是从 UA/path 分类的粗粒度 agent 枚举；本地是调用方自报的 tag。**建议两者都保留**（`client_agent` 用于聚合，`client_tag` 用于精确溯源），`logRequest` 签名合并两个可选参数。
- `notifyTracker` 是外部依赖（tracker.py 不在仓库），上游没有——**保留但确认外部服务缺失时零影响**（现状已如此）。
- attempt-trace 的 `noteRequestRowId` 需要在本地 `logRequest` 里补（上游 fallback-loop 依赖）。

### 3.6 `providers/index.ts` + `openai-compat.ts`（本地定制 vs 上游）

**必须保留的本地定制**：
1. OpenRouter `validateUrl: 'https://openrouter.ai/api/v1/key'`（上游无——上游 OpenRouter 没设 validateUrl，健康检查会虚高，正是本地修过的 bug #6.3）。
2. agnes `baseUrl: 'https://apihub.agnes-ai.cn/v1'`（上游是 `.com`，本地是修复）。
3. cline 平台注册（上游无）。
4. modelscope：**上游有**（独立 `providers/modelscope.ts`，带自定义 validateKey），本地是简化版 `OpenAICompatProvider`。**建议采用上游版本**（上游的 validateKey 用 1-token chat 验证，比本地的默认 `/models` 验证更准）。
5. `openai-compat.ts`：本地有 openrouter `/api/v1/key` 相关的 validateKey 改动需要核对（上游 `validateKey` 支持 `baseUrl` override + custom endpoint discovery，需手工合入本地 validateUrl 逻辑）。

**diff 策略**：以上游为基底，追加 OpenRouter validateUrl / agnes .cn / cline 三处；modelscope 用上游文件替换本地；本地 `openai-compat.ts` 的 validateUrl 逻辑移植到上游 `OpenAICompatProvider` 构造选项。

### 3.7 `app.ts`（middleware 链 vs 上游挂载）

**本地独有**：6 段 `buildProxyMiddlewareChain()`（proxyAuth / requestSanitizer / requestValidator / messageNormalizer / tokenEstimator / capabilityGate）+ `configRouter` 双挂载（`/api/config` + `/v1/config`）。

**上游结构**：`clientContextMiddleware` + `express.json` + `helmet` + 大量新路由（`gemini/mcp/ollama/url-tokens/cache/compression/update/status/docs/client-profiles`）。

**决策点**：
- **本地 middleware 链是否保留？** 上游已废弃该结构（改用 `clientContextMiddleware` + 各路由内联校验）。本地 6 段中的 `requestValidator`/`messageNormalizer`/`tokenEstimator` 与上游各路由内联逻辑**功能重叠**，且**在 `/v1/messages` 和 `/v1/responses` 上行为不一致**（中间件链只挂 `/v1` 的 proxyRouter 之前）。**建议**：
  - `proxyAuth`（HMAC 修复）→ 上游 `resolveAuth` 已有等价 `timingSafeStringEqual`，**可废弃本地 middleware，采用上游**；
  - `configRouter` → **必须保留**（本地独有功能），在 app.ts 里追加 `/api/config` + `/v1/config` 挂载；
  - 其余 5 段 → 建议**逐步废弃**（上游内联校验已覆盖），合并时先保留 `proxyAuth` 兼容（若担心上游 `resolveAuth` 语义变化），其余用 `-X ours` 或手工删。
- 保守方案：**合并期保留整条 chain**（挂在上游 `app.use('/v1', ...buildProxyMiddlewareChain())` 之前），后续再逐步迁移到上游内联。**推荐保守方案**，降低一次性风险。

### 3.8 `index.ts`（启动流程）

- 保留本地 `cleanupExpiredCooldowns()` 启动调用。
- 合入上游 `startCooldownProbe(scheduler)`。
- 上游 `run.ts`/`index.ts` 结构变化需核对（上游把启动拆到 `run.ts`），本地只需保留等价。

### 3.9 `db/migrate/defaults.ts`

- 以上游为基底（16 个新迁移注册）。
- 保留本地 3 个迁移注册：`20260701_000001_add_category_to_models`、`20260701_000002_add_probe_fields`、`20260802_000000_quota_guard_columns`。
- **注意**：本地 `quota_guard_columns` 建的 `client_tag` 列与上游 `request_client_info` 建的 `client_ip/client_user_agent/client_agent` 并存，无冲突（不同列名）。
- 迁移命名时间戳：本地的 `20260802_000000` 与上游的 `20260802_000001_custom_endpoint_host_labels` 同一天，`DEFAULT_MIGRATIONS` 数组顺序需保持文件名升序（runner 按 filename 排序），**确保本地 `20260802_000000` 排在 `20260802_000001` 之前**。

### 3.10 `lib/guardrails.ts`（add/add 冲突）

- 本地与上游都是"新增文件"，git 视为 add/add。
- **上游是从本地 `e5024d5` 移植的**（上游注释明确 "Ported from @coffcoe's fork"）。上游版本更完整：`applyTokenBudget`（含 `TOKEN_BUDGET_OUTPUT_CAP=4096`）+ `newBreaker(limit)` + `recordBreakerFailure`。
- **建议直接采用上游版本**，本地 `exceedsTokenBudget` 换成上游 `applyTokenBudget`（三处调用点：proxy ×2、anthropic ×1、responses 上游已有）。
- 若想保留本地 `exceedsTokenBudget` 简单形态（stream 内 early-stop 用），可保留一个薄包装。

### 3.11 `settings.ts`（guardrails API）

- 双方都有 `GET/PUT /guardrails`，语义一致（`requestMaxTokensBudget` / `maxConsecutiveUpstreamFails`）。上游用 zod schema，本地是手写判断。**采用上游**即可，行为无变化。

---

## 4. 定制 × 上游新机制兼容性矩阵

| 本地定制 | 上游 in-flight leases | 上游 cooldown-probe | 上游 clientGone/abort | 上游 attempt-trace | 结论 |
|---|---|---|---|---|---|
| `filterExhaustedQuota` | ✅ 正交（DB 观察 vs 在途计数） | ✅ | ✅ | ✅ | **兼容，保留** |
| `NO_LIMIT_COOLDOWN_CAP_MS` | ✅ | ⚠️ 需 source 标 `heuristic` 才能被 probe | ✅ | ✅ | **需手工合入**（见 §3.2 方案 A） |
| `clientAborted` 熔断 | ✅（abort 释放 lease） | ✅ | ✅ **上游更优**（AbortController） | ✅ | **改用上游 clientGone** |
| github 截断护栏 | ✅ | ✅ | ✅ | ✅ | **保留，放 dispatch 前** |
| OpenRouter `/api/v1/key` | ✅ | ✅ | ✅ | ✅ | **保留**（上游无） |
| agnes `.cn` | ✅ | ✅ | ✅ | ✅ | **保留**（上游是 .com） |
| `CLIENT_TEMPLATES` config 路由 | ✅ | ✅ | ✅ | ✅ | **保留**（上游无） |
| `is_high_value` / `filterHighValueIfLarge` | ✅ | ✅ | ✅ | ✅ | **保留** |
| `clientTag` / tracker | ⚠️ 上游 `client_agent` 语义不同 | ✅ | ✅ | ✅ | **双轨保留**（见 §3.5） |
| HMAC `timingSafeStringEqual` | ✅ | ✅ | ✅ | ✅ | 上游有等价实现 |
| 场景路由（scene/tags） | ✅ | ✅ | ✅ | ✅ | **保留**（上游无） |
| catalog-sync `rpd_limit` 排除 | ✅ | ✅ | ✅ | ✅ | **保留**（上游会清上限） |

> **结论**：9 项核心定制 + 场景路由 + config 路由 + catalog-sync 修复，**全部与上游新机制兼容**，无一需要删除。只有 `NO_LIMIT_COOLDOWN_CAP_MS` 需要手工合入上游 cooldown 决策函数。

---

## 5. 既有规划兼容性矩阵（merge 后还能不能推进）

| 规划项 | 来源 | 当前状态 | merge 后影响 | 建议 |
|---|---|---|---|---|
| **LiteLLM 混合架构** | ADR-002（已采纳） | 可选中期 | **Superseded**：上游 `runFallbackLoop` + leases + cooldown-probe 已提供等价接入/回退层，且无外部依赖 | **放弃自研**，直接采用上游抽象 |
| **Phase 2 Pipeline 集成** | LL-PHASE2-001 | seedling | `/v1/chat/completions` / `/v1/messages` 路径不变；上游新增 client-profile 密钥（#411）反而**提供更规范的调用方式**（可给 Pipeline 建独立 profile key + system prompt） | 继续，merge 后评估 client-profile 集成 |
| **catalog-sync 恢复** | FLA-QUOTA-WATCH | 待领航员决策 | 上游 catalog-sync 演进**仍带 `rpd_limit` UPDATE** → 若不移植本地排除，恢复 automation 会再次清掉 P0 上限 | **恢复前必须确认本地 rpd_limit 排除已移植** |
| **Ostrom 本地自治率限** | 2026-08-06 讨论 | 规划中 | **上游已实现核心机制**：in-flight leases（防并发风暴）+ cooldown-probe（自动恢复）+ `'canceled'` 可见性；但"每个 agent 自带 fallback + 限流"仍需业务侧配置 | **采用上游机制**，业务侧按需配置；本方案保留的 `NO_LIMIT_COOLDOWN_CAP_MS` 是本地自治的重要补充 |
| **skillopt 试点** | `_active-tasks` B | 待确认 | 上游 188 commit 新增大量能力（leases / probe / attempt-trace / structured-output / gemini/mcp/ollama），评测集应补充这些场景 | **更新评测集**后试点 |
| **设备验证** | LL-INFRA-002-6 | 转信天翁后 | 路由逻辑大改（for→runFallbackLoop）+ `/v1` 挂载变化，验证清单需更新 | **更新清单后执行** |

---

## 6. 实施步骤（拆分任务）

### 6.1 任务拆分（建议）

| 承接方 | 文件/工作 | 理由 |
|---|---|---|
| **灰狐（本地，必须）** | `anthropic.ts` / `proxy.ts` / `responses.ts` 三处 `runFallbackLoop` 重构 | 核心路由，需本地实跑验证（tsc + 冒烟），不可外包 |
| **CNB NPC（可）** | `router.ts` / `ratelimit.ts` / `health.ts` / `catalog-sync.ts` / `request-log.ts` / `providers/index.ts` / `app.ts` / `index.ts` / `defaults.ts` / `guardrails.ts` 的定制移植 | 逻辑相对独立，可先出 diff 方案，灰狐 review |
| **灰狐（必须）** | 整体验证（tsc / 冒烟 / 9 项定制 grep / 规划兼容性逐项确认） | 不可外包 |

### 6.2 实施顺序

```
Phase 0（准备）
  1. 在本地新分支 `merge-upstream` 上操作（勿直接改 main）
  2. 先 merge upstream/main --no-commit，冻结冲突现场
  3. 手工解决 §3 的 20 个非结构性冲突（以上游为基底 + 移植本地定制）
  4. 最后解决 3 个结构性冲突（§2）

Phase 1（结构性重构，灰狐）
  5. anthropic.ts / proxy.ts / responses.ts → runFallbackLoop
  6. 本地定制适配：clientGone 映射、github 截断、clientTag、scene、dialect rescue

Phase 2（验证）
  7. cd server && npx tsc --noEmit 零错误
  8. npm test（server 测试套件）
  9. 启动 + /api/ping + /v1/models(401) + /v1/chat/completions 冒烟
  10. 9 项核心定制 grep 验证存活（§7 漂移清单）
  11. 规划兼容性矩阵逐项确认（§5）

Phase 3（收尾）
  12. commit merge + 清理死代码（stream-handler.ts 等，单独 commit）
  13. 若发现业务 bug，单独 PR 说明动机与影响范围；不自动 merge
```

### 6.3 关键操作防坑

```bash
# 不要做的
❌ git reset --hard upstream/main          # 丢全部定制
❌ git clean -f                            # 删 CUSTOM-PATCHES.md
❌ git add . / commit -a                   # 扫入他人/历史改动
❌ 直接 -X ours 整个 ratelimit.ts / router.ts   # 会让 fallback-loop 编译失败

# 推荐的
✅ 新分支：git checkout -b merge-upstream
✅ 每解决一个冲突文件就 grep 对应定制标记（§7）
✅ 结构冲突分步走：先 -X theirs 拿上游全量，再逐块移植本地定制
```

---

## 7. 验证清单（合并后逐项跑）

```bash
# 0) 编译
cd server && npx tsc --noEmit            # 零错误

# 1) 9 项核心定制 grep 存活
grep -n "filterExhaustedQuota\|filterHighValueIfLarge"  server/src/services/router.ts
grep -n "NO_LIMIT_COOLDOWN_CAP_MS"                        server/src/services/ratelimit.ts
grep -n "clientGone\|clientAbort\|isClientAbortError"     server/src/routes/proxy.ts
grep -n "truncateMessagesForGithub\|GITHUB_MAX_INPUT"     server/src/routes/proxy.ts
grep -n "validateUrl.*api/v1/key"                          server/src/providers/index.ts
grep -n "agnes-ai.cn"                                      server/src/providers/index.ts
grep -n "CLIENT_TEMPLATES"                                 server/src/routes/config.ts
grep -n "is_high_value\|HIGH_VALUE_INPUT_THRESHOLD"        server/src/services/router.ts
grep -n "rpd_limit 治本\|#P2-b"                            server/src/services/catalog-sync.ts
# 补充定制
grep -n "clientTag\|notifyTracker"                         server/src/lib/request-log.ts
grep -n "detectCategoryScene\|detectSceneTags"             server/src/routes/proxy.ts
grep -n "cleanupExpiredCooldowns"                          server/src/index.ts
grep -n "platform: 'cline'"                                server/src/providers/index.ts

# 2) 冒烟
curl -s localhost:3001/api/ping                           # {"status":"ok"}
curl -s -o /dev/null -w '%{http_code}' localhost:3001/v1/models   # 401（无 key）
curl -s -H "Authorization: Bearer $KEY" localhost:3001/v1/models  # 200
curl -s -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"hi"}]}' \
  localhost:3001/v1/chat/completions                        # 200 或合理的 429/502

# 3) 上游新机制验证
grep -n "acquireLease\|releaseLease"        server/src/services/router.ts   # leases 合入
grep -n "startCooldownProbe"                server/src/index.ts             # probe 启动
grep -n "request_attempts"                  server/src/db/migrate/defaults.ts # attempt-trace 迁移
grep -n "client_agent\|client_ip"           server/src/db/migrate/defaults.ts # 上游 client 列
```

---

## 8. 风险点与回退

| 风险 | 等级 | 缓解 |
|---|---|---|
| `runFallbackLoop` 首次大规模接入，SSE 流语义回归 | 🔴 高 | 三路由逐一重构、每步 tsc + 冒烟；保留 `X-Fallback-Attempts` 头便于线上观测 |
| ratelimit.ts 手工合并出错（10min 封顶 vs 上游阶梯） | 🔴 高 | 方案 A 单点改动，diff 要最小化；加单测覆盖 `getCooldownDecisionForLimit` |
| clientTag 与上游 client_agent 双列并存，analytics 口径混乱 | 🟡 中 | 文档说明两列语义；dashboard 查询默认仍用 `client_agent` |
| 中间件链保留导致 `/v1` 双重校验（proxyAuth + resolveAuth） | 🟡 中 | 合并期先保留（防御），确认无 401 回归后逐步删 |
| 上游 16 个新迁移在已有运行库上执行失败 | 🟡 中 | 迁移全部 PRAGMA 守卫幂等；先备份 DB（db-backup 已启动）；`npm run db:migration:status` 预检 |
| 本地 `quota_guard_columns` 的 `client_tag` 列与上游 `request_client_info` 顺序冲突 | 🟢 低 | 文件名升序保证 `20260802_000000` 在前；两者列名不同无冲突 |

**回退策略**：`merge-upstream` 分支独立于 `main`，任何一步出问题 `git checkout main` 即回到 `9588913`；不 push 到任何 github remote，不自动 merge。

---

## 9. 结论

1. **冲突面实测 23 文件**，其中 **3 个结构性冲突**（`anthropic.ts` / `proxy.ts` / `responses.ts`）必须改造为 `runFallbackLoop`——**任务原始描述漏掉了 `responses.ts`**。
2. **9 项核心定制 + 场景路由 + config 路由 + catalog-sync 修复全部可保全**，无一与上游新机制冲突。
3. **必须手工合并、不能 `-X ours`** 的文件：`router.ts` / `ratelimit.ts`（fallback-loop 依赖其新导出）、`health.ts`、`catalog-sync.ts`、`request-log.ts`、`app.ts`、`index.ts`、`defaults.ts`、`guardrails.ts`。
4. **`NO_LIMIT_COOLDOWN_CAP_MS` 需单点合入上游 `getCooldownDecisionForLimit`**（方案 A），否则上游会把无上限 provider 的启发式升级到 24h 阶梯——这是本地 P0 修复，**不能丢**。
5. **上游已取代 LiteLLM 混合架构规划**（ADR-002 superseded）；Ostrom 本地自治率限的上游机制已齐备；catalog-sync 恢复前必须确认 rpd_limit 排除已移植。
6. 建议按 §6 拆分任务：**灰狐做三路由重构 + 整体验证，NPC 可先行产出 router/ratelimit/health 等文件的移植 diff 供 review**。

> 本文件仅为方案，未修改任何业务代码。如需落地，建议在 `merge-upstream` 分支执行，完成后再由领航员决策是否合入 `main`。
