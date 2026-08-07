# MERGE-PORT-DIFFS — 非结构性冲突文件的定制移植 diff（供灰狐 review）

> **模式**：`@CodeBuddy 替我上班`
> **目标**：落地 `MERGE-REFACTOR-PLAN.md` §6.1 的「CNB NPC 可先行」部分——把本地 10 个非结构性冲突文件的**定制移植点**写成逐文件、可直接执行的最小 diff，供灰狐在 `merge-upstream` 分支实施结构性重构前 review。
> **本文件只出 diff 方案，不修改任何业务代码**（护栏约定）。
> **产出日期**：2026-08-07 ｜ **对照基线**：
> - 本地 `HEAD` = `e59ea8f`（工作树 clean）
> - 上游 `upstream/main` = `c0c859c`（2026-08-07）
> - 已 clone 到 `/tmp/upstream-freellmapi` 只读参考

---

## 0. 总览

| # | 文件 | 合并基底 | 需移植的本地定制（最小 diff 点） | 依赖的上游新文件 |
|---|---|---|---|---|
| 1 | `services/router.ts` | **上游**（拿 leases/endpoint_scope/新 gate） | `filterExhaustedQuota` ×3 调用点、`filterHighValueIfLarge` + `HIGH_VALUE_INPUT_THRESHOLD` | 无 |
| 2 | `services/ratelimit.ts` | **上游** | `NO_LIMIT_COOLDOWN_CAP_MS` 合入 `getCooldownDecisionForLimit`（方案 A） | 无 |
| 3 | `services/health.ts` | **上游** | keyless 适配（`provider.keyless ? '' : decrypt`）+ 崩溃 watchdog 日志前缀 `[Health] Key N (` | 无 |
| 4 | `services/catalog-sync.ts` | **上游** | UPDATE 排除 `rpd_limit`（`#P2-b`）；本地注释 `raw_capabilities/capability_sources` 保留 | 无 |
| 5 | `lib/request-log.ts` | **上游** | 第 12 参 `clientTag`（本地 `requests.client_tag`）+ `notifyTracker`(3003) 保留；`noteRequestRowId` 采纳上游 | 上游 `attempt-trace.ts` / `client-context.ts` |
| 6 | `lib/guardrails.ts` | **上游**（add/add） | 本地薄包装 `exceedsTokenBudget`（可选）；常量名映射 | 无 |
| 7 | `db/migrate/defaults.ts` | **上游** | 保留本地 3 迁移注册（`20260701_*` ×2 + `20260802_000000`），注意文件名升序 | 本地 3 个迁移文件已存在 |
| 8 | `providers/index.ts` | **上游** | OpenRouter `validateUrl`、agnes `.cn`、cline 平台；modelscope 用上游 `ModelScopeProvider` 替换本地简化版 | 上游 `providers/modelscope.ts` / `providers/ai-horde.ts` |
| 9 | `app.ts` | **上游** | config 路由双挂载（`/api/config` + `/v1/config`）；`DISABLE_ALL_MIDDLEWARE` 保留（保守） | 上游新路由 |
| 10 | `index.ts` | **上游** | `cleanupExpiredCooldowns()` 启动调用；`installLogRedaction` 采纳上游 | 上游 `cooldown-probe.ts` / `wake-detect.ts` / `log-redaction.ts` |

**决策速查**：
- 除 `guardrails.ts`（add/add）外，其余 9 个文件**一律以上游版本为基底**，手工移植本地定制，**不要 `-X ours`**（会让 `fallback-loop.ts` 编译失败）。
- 每个文件移植完必须跑 §10 的 grep 漂移验证，确保定制存活。

---

## 1. `services/router.ts`（本地 1099 → 上游 1698）

### 1.1 上游新增能力（直接保留，无需改动）

- in-flight leases：`selectKeyForModel` 返回 `RouteResult` 带 `release?.()`；`acquireLease` / `releaseLease`（上游 L1156/L1168）。
- `endpoint_scope` 列参与 key 与统计。
- 新 gate：`canUseProviderMinute` / `canUseProviderTokens` / key-concurrency。
- `routeRequest` 新增第 8 参 `requireStructured`。
- `resolveStickyPreference` / `hasOtherUsableKey` / `summarizeExhaustion`（带 `getSoonestCooldownExpiry`）。
- exploration toggle（`getExploreEnabled`）。

### 1.2 定制移植点 A：`filterExhaustedQuota`

**本地现状**（`router.ts` L439-L461）：按 `(platform, key_id)` 从 `provider_quota_state` 剔除 `remaining_value=0` 且未过 `reset_at` 的池。`reset_at IS NULL OR reset_at > datetime('now')` 是本地修复（防 stale 观察永久封池）。

**上游现状**：`getActiveChain` / `getChainByProfileName` / `getChainByGlobalSort` 三处**都没有**该过滤。

**移植动作**（上游为基底）：

```diff
--- 上游 router.ts（getActiveChain）
+function filterExhaustedQuota(db: Db, chain: ChainRow[]): ChainRow[] {
+  let rows: { platform: string; key_id: number | null }[] = [];
+  try {
+    rows = db.prepare(
+      `SELECT platform, key_id FROM provider_quota_state
+        WHERE remaining_value = 0
+          AND (reset_at IS NULL OR reset_at > datetime('now'))`
+    ).all() as { platform: string; key_id: number | null }[];
+  } catch {
+    return chain; // table missing — skip filtering rather than crash the router
+  }
+  if (rows.length === 0) return chain;
+  const exhausted = new Set<string>();
+  for (const r of rows) exhausted.add(`${r.platform}::${r.key_id}`);
+  const filtered = chain.filter(c => !exhausted.has(`${c.platform}::${c.key_id}`));
+  return filtered.length > 0 ? filtered : chain;
+}
+
 function getActiveChain(db: Db): ChainRow[] {
   const profileId = getActiveProfileId(db);
   if (profileId != null) {
     const chain = db.prepare(`...`).all(profileId) as ChainRow[];
-    if (chain.length > 0) return chain;
+    if (chain.length > 0) return filterExhaustedQuota(db, chain);
   }
 
-  return db.prepare(`...`).all() as ChainRow[];
+  return filterExhaustedQuota(db, db.prepare(`...`).all() as ChainRow[]);
 }
```

**getChainByProfileName / getChainByGlobalSort 同理**：

```diff
   // getChainByProfileName
-  return db.prepare(`...`).all(profile.id) as ChainRow[];
+  return filterExhaustedQuota(db, db.prepare(`...`).all(profile.id) as ChainRow[]);

   // getChainByGlobalSort（注意：上游此处已合入 #634 的 chainEnabled/LEFT JOIN 增强，保留）
-  return orderChain(allEnabled, strat);
+  return filterExhaustedQuota(db, orderChain(allEnabled, strat));
```

> ⚠️ 上游 `getChainByGlobalSort` 的 SQL 已含 `#634` 的 enable 语义增强（`LEFT JOIN fallback_config/profile_models` + `COALESCE(...)=1`）——**保留上游 SQL**，只在外层套 `filterExhaustedQuota`，不要回退本地旧 SQL。

### 1.3 定制移植点 B：`filterHighValueIfLarge` + `HIGH_VALUE_INPUT_THRESHOLD`

**本地现状**（`router.ts` L888-L918）：`estimatedTokens > 20000` 时从 auto 链剔除 `is_high_value=1` 模型，若过滤后为空则回退原链。在 `routeRequest` 内 `orderChain` 之前调用。

**上游现状**：无此函数；`routeRequest` 结构为 `chain = (prefetchedChain ?? getActiveChain(db)).filter(e => e.enabled)` → exploration 采样 → sticky/pin → `for (entry of sortedChain)` 循环。

**移植动作**（在上游 `routeRequest` 内、`orderChain` 之后、exploration 之前插入）：

```diff
   const chain = (prefetchedChain ?? getActiveChain(db)).filter(e => e.enabled);
 
   const sortedChain = orderChain(chain, strategy);
 
+  // ── LOCAL: context grading (P1-b) ──
+  // Drop is_high_value=1 models from the auto chain when the estimated input
+  // exceeds the threshold — but only if that still leaves models to serve.
+  const HIGH_VALUE_INPUT_THRESHOLD = 20000;
+  const filterHighValueIfLarge = (db: Db, c: ChainRow[]): ChainRow[] => {
+    const hv = new Set<number>(
+      (db.prepare('SELECT id FROM models WHERE is_high_value = 1').all() as { id: number }[]).map(r => r.id),
+    );
+    if (hv.size === 0) return c;
+    const filtered = c.filter(e => !hv.has(e.model_db_id));
+    return filtered.length > 0 ? filtered : c;
+  };
+  if (estimatedTokens > HIGH_VALUE_INPUT_THRESHOLD) {
+    const graded = filterHighValueIfLarge(db, sortedChain);
+    if (graded.length > 0) sortedChain.splice(0, sortedChain.length, ...graded);
+  }
+
   // Exploration toggle (#685/#707 follow-up): ...
```

> ⚠️ **与上游 exploration 的先后顺序**：`MERGE-REFACTOR-PLAN.md` §3.1 建议「high-value 过滤在 `orderChain` 之后、exploration 之前」——即 **sortedChain 先剔除高价值，再让 exploration 从未测量模型里采样**，两者正交（high-value 模型通常已有样本，exploration 采样到的概率极低），顺序安全。
>
> ⚠️ **不要用 `chain = graded` 重新赋值**（那会丢掉本地 sortedChain 引用），用 `splice` 原地替换，避免破坏后续 exploration 对 `sortedChain` 的引用。

### 1.4 验证 grep

```bash
grep -n "filterExhaustedQuota"  server/src/services/router.ts   # 期望：函数定义 + 3 处调用
grep -n "filterHighValueIfLarge\|HIGH_VALUE_INPUT_THRESHOLD" server/src/services/router.ts
grep -n "acquireLease\|releaseLease\|requireStructured"       server/src/services/router.ts  # 上游能力存活
```

---

## 2. `services/ratelimit.ts`（本地 594 → 上游 1161）

### 2.1 上游新增能力（直接保留）

- in-flight leases：`acquireLease` / `releaseLease` / `canUseKeyConcurrency` / `inFlightForKey`。
- `CooldownSource` 溯源 + `setCooldown(..., source)` 写 `rate_limit_cooldowns.source/set_at_ms`。
- `getCooldownDecisionForLimit` / `getCooldownDecisionForError`。
- `LOCAL_ENDPOINT_COOLDOWN_MS=5s` 本地 endpoint 豁免（#592）。
- `quotaSignal` 门（#592）。
- `getProbeableCooldowns` / `clearCooldownEarly` / `getSoonestCooldownExpiry` / `getActiveCooldownsForKeys` / `clearCooldownsForKey`。

### 2.2 定制移植点（方案 A，单点）：`NO_LIMIT_COOLDOWN_CAP_MS`

**上游现状**（`getCooldownDecisionForLimit` L805-L860）：

```ts
  const base = (rpdExhausted || tpdExhausted || heuristicallyExhausted)
    ? getNextCooldownDuration(platform, modelId, keyId)
    : TRANSIENT_COOLDOWN_MS;
```

**问题**：上游 `heuristicallyExhausted` 走 `getNextCooldownDuration` 阶梯（2m→10m→1h→24h），**没有 10min 封顶**——无上限免费 provider（cloudflare/ollama/nvidia/hf/mistral）在瞬时 RPM jitter 下会升级到 24h 死亡冷却，正是本地 `CUSTOM-PATCHES.md §6.4` 修过的 P0。

**移植动作**（方案 A，推荐）：

```diff
+// ── LOCAL: no-limit free providers (cloudflare/ollama/nvidia/hf/mistral/...) ──
+// emit 429 on transient RPM jitter, not real daily exhaustion. Cap their bench
+// at 10min so a burst of 429s under heavy load never escalates to a 24h death
+// penalty that cascades 429s to high-volume consumers. (CUSTOM-PATCHES §6.4)
+const NO_LIMIT_COOLDOWN_CAP_MS = 10 * 60 * 1000;
+
   const base = (rpdExhausted || tpdExhausted)
     ? getNextCooldownDuration(platform, modelId, keyId)      // 真 RPD/TPD 耗尽仍走 24h 阶梯（正确）
     : heuristicallyExhausted
-      ? getNextCooldownDuration(platform, modelId, keyId)
+      ? NO_LIMIT_COOLDOWN_CAP_MS                             // 无文档上限 provider 的启发式 → 10min 封顶
       : TRANSIENT_COOLDOWN_MS;
```

- `source` 仍标 `'heuristic'`（上游该函数末尾 `return { durationMs: base, source: 'heuristic' }`），cooldown-probe 因此**仍可提前恢复**——10min 封顶 + probe 恢复兼容。
- `getCooldownDurationForLimit` 是 `getCooldownDecisionForLimit` 的薄包装（上游 L786-794），**无需单独改**。
- `quotaSignal` 门（#592）上游已有——**不要回退**（本地没有该门，但上游是对的：timeout/5xx 不应喂 null-limits 启发式）。

### 2.3 验证 grep

```bash
grep -n "NO_LIMIT_COOLDOWN_CAP_MS" server/src/services/ratelimit.ts   # 定义 + getCooldownDecisionForLimit 内引用
grep -n "acquireLease\|getCooldownDecisionForLimit\|getSoonestCooldownExpiry" server/src/services/ratelimit.ts
```

---

## 3. `services/health.ts`（本地 100 → 上游 399）

### 3.1 上游新增能力（直接保留）

- `probeKeyValidity(keyId)`：无副作用 validateKey（供 cooldown-probe）。
- `markKeyHealthyFromRequest(keyId)`：成功请求后 `'error'` → `'healthy'`。
- `interleaveByProvider`：按 provider 打散探测顺序。
- 并发 pass 守卫（`checkAllInFlight`）、`HealthPassOptions`、`checkAllKeys` 返回 `HealthPassResult`。

### 3.2 定制移植点 A：keyless 适配（`checkKeyHealth` 与 `probeKeyValidity`）

**本地现状**（`health.ts` L31）：

```ts
const apiKey = provider.keyless ? '' : decrypt(row.encrypted_key, row.iv, row.auth_tag);
```

**上游现状**：
- `checkKeyHealth`（上游 L83）：`const apiKey = decrypt(...)`（**无 keyless 分支**）。
- `probeKeyValidity`（上游 L150-180）：`const apiKey = decrypt(...)`（**无 keyless 分支**）。

**移植动作**：

```diff
   // checkKeyHealth
-  const apiKey = decrypt(row.encrypted_key, row.iv, row.auth_tag);
+  // LOCAL: keyless providers (kilo, pollinations anon tier) store a sentinel
+  // encrypted key not meant to be decrypted — pass '' so validateKey skips the
+  // Authorization header via authHeader().
+  const apiKey = provider.keyless ? '' : decrypt(row.encrypted_key, row.iv, row.auth_tag);

   // probeKeyValidity（同样加）
-  const apiKey = decrypt(row.encrypted_key, row.iv, row.auth_tag);
+  const apiKey = provider.keyless ? '' : decrypt(row.encrypted_key, row.iv, row.auth_tag);
```

### 3.3 定制移植点 B：崩溃 watchdog 日志前缀

**本地现状**（`health.ts` L73-78）：

```ts
console.error(
  `[Health] Key ${keyId} (${row.platform}, base=${row.base_url ?? 'default'}) ` +
  `transport error: ${err.message}`,
);
```

**上游现状**：日志格式可能不同（上游 `runHealthPass` 有自己的日志）。需**核对上游 transport-error 日志是否保留 `[Health] Key N (` 前缀**——12h 崩溃 watchdog（cron `bff5ae167d28`）抓 `/tmp/freellmapi.log` 里这些行。若上游格式变了，把前缀移植回上游对应日志行。

### 3.4 验证 grep

```bash
grep -n "provider.keyless\|\[Health\] Key " server/src/services/health.ts
grep -n "probeKeyValidity\|markKeyHealthyFromRequest\|interleaveByProvider" server/src/services/health.ts
```

---

## 4. `services/catalog-sync.ts`（本地 543 → 上游 777）

### 4.1 上游演进（直接保留）

- `source` 列（`models.source = 'catalog'`）、`selectModel` 带 `source`。
- tombstone provenance、`meta_json`、media/embedding 同步面扩大。
- `migrateModelsV26+`。

### 4.2 定制移植点：UPDATE 排除 `rpd_limit`（#P2-b）

**上游现状**（`catalog-sync.ts` L253）：

```sql
UPDATE models SET
  display_name = @displayName, intelligence_rank = @intelligenceRank, speed_rank = @speedRank,
  size_label = @sizeLabel, rpm_limit = @rpm, rpd_limit = @rpd, tpm_limit = @tpm, tpd_limit = @tpd,
  ...
```

**问题**：上游 UPDATE **仍带 `rpd_limit = @rpd`**。catalog 大多数平台 `rpd_limit=null`，恢复 catalog-sync 会再次清掉本地 P0 每日上限（FLA-RPD）。

**移植动作**（删除 UPDATE SET 里的 `rpd_limit = @rpd`，保留 INSERT）：

```diff
   const updateModel = db.prepare(`
     UPDATE models SET
       display_name = @displayName, intelligence_rank = @intelligenceRank, speed_rank = @speedRank,
-      size_label = @sizeLabel, rpm_limit = @rpm, rpd_limit = @rpd, tpm_limit = @tpm, tpd_limit = @tpd,
+      size_label = @sizeLabel, rpm_limit = @rpm, tpm_limit = @tpm, tpd_limit = @tpd,
       monthly_token_budget = @monthlyTokenBudget, context_window = @contextWindow,
       supports_vision = @supportsVision, supports_tools = @supportsTools,
       enabled = @enabled
     WHERE id = @id
   `);
+  // LOCAL (#P2-b): rpd_limit is intentionally EXCLUDED from the UPDATE above —
+  // the catalog ships rpd_limit=null for most platforms; applying it would
+  // clobber the locally-managed per-model daily caps (FLA-RPD). New models
+  // still receive the catalog default via the INSERT statement.
```

> ⚠️ 同时核对上游 `updateMedia` 的 `meta_json` 与本地 `media_models` 表结构是否兼容（上游新增 `meta_json` 列迁移 `20260726_000004_media_model_meta` 已注册，见 §7）。
>
> ⚠️ 本地注释提到的 `raw_capabilities / capability_sources` 是 LOCAL-ONLY 字段——上游版本 SELECT 是否含这些列需核对；若上游 `applyCatalog` 的 `selectModel`/`updateModel` 不含，则本地 P2-b 注释保留即可，无实际 diff。

### 4.3 验证 grep

```bash
grep -n "rpd_limit" server/src/services/catalog-sync.ts   # UPDATE SET 不应再有 rpd_limit；INSERT 应有
grep -n "#P2-b\|治本" server/src/services/catalog-sync.ts  # 注释保留
```

---

## 5. `lib/request-log.ts`（本地 137 → 上游 142）

### 5.1 上游新增能力（直接保留）

- `client_ip` / `client_user_agent` / `client_agent` 三列（从 `getClientContext()` 读）。
- `served_model` 列（上游第 11 参，`lib/served-model.ts`）。
- `noteRequestRowId(insert.lastInsertRowid)` → attempt-trace 回写。
- `persistRequestAttempts(trace)`。

### 5.2 定制移植点 A：`clientTag` 第 12 参

**上游现状**：`logRequest` 第 11 参 = `servedModel`，**没有 `clientTag`**。

**本地现状**：第 11 参 = `requestedModel`，第 12 参 = `clientTag`（写 `requests.client_tag`，迁移 `20260802_000000_quota_guard_columns` 建的列）。

**移植动作**（追加第 12 参，与上游 `servedModel` 并存——**两个都要**，语义不同：`client_agent` 是上游从 UA/path 分类的粗粒度枚举，`client_tag` 是本地调用方自报 tag）：

```diff
 export function logRequest(
   platform: string, modelId: string, keyId: number,
   status: string, inputTokens: number, outputTokens: number,
   latencyMs: number, error: string | null,
   ttfbMs: number | null = null,
   requestedModel: string | null = null,
   servedModel: string | null = null,
+  // LOCAL: calling client/app identifier (from the x-client-tag request header).
+  // Kept alongside upstream's client_agent (UA-derived) because the semantics
+  // differ: client_agent is a coarse enum, client_tag is the caller's self-
+  // reported tag for precise attribution during quota investigations (P2-a).
+  clientTag: string | null = null,
 ) {
   try {
     const db = getDb();
     const client = getClientContext();
     const tx = db.transaction(() => {
       const insert = db.prepare(`
-        INSERT INTO requests (platform, model_id, key_id, status, input_tokens, output_tokens, latency_ms, error, ttfb_ms, requested_model, served_model, client_ip, client_user_agent, client_agent)
-        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
-      `).run(platform, modelId, keyId, status, inputTokens, outputTokens, latencyMs, error, ttfbMs, requestedModel, servedModel, client.ip, client.userAgent, client.agent);
+        INSERT INTO requests (platform, model_id, key_id, status, input_tokens, output_tokens, latency_ms, error, ttfb_ms, requested_model, served_model, client_ip, client_user_agent, client_agent, client_tag)
+        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
+      `).run(platform, modelId, keyId, status, inputTokens, outputTokens, latencyMs, error, ttfbMs, requestedModel, servedModel, client.ip, client.userAgent, client.agent, clientTag);
```

> ⚠️ `requests.client_tag` 列由本地迁移 `20260802_000000_quota_guard_columns` 创建（§7 已注册）——上游没有该列，所以**上游迁移合入后仍需本地迁移补列**，见 §7。

### 5.3 定制移植点 B：`notifyTracker`（3003 外部依赖）

**本地现状**（`request-log.ts` L106-L137）：成功且有 token 时非阻塞 POST `http://localhost:3003/api/log`，300ms 超时、失败静默。

**上游现状**：无。

**移植动作**：把本地 `notifyTracker` 函数 + 调用点（`if (status === 'success' && (inputTokens > 0 || outputTokens > 0)) notifyTracker(...)`）原样搬到上游 `logRequest` 的 `tx()` 之后、`pruneRequestAnalytics` 之前。**保留但确认外部服务缺失时零影响**（现状已是 fire-and-forget）。

### 5.4 调用点适配（灰狐在结构重构时一并处理）

本地三个路由调用 `logRequest` 的第 11 参是 `clientTag`，第 12 参是 `pinnedModelId`（见下方实际签名）：

```ts
logRequest(platform, modelId, keyId, status, in, out, latency, err, ttfb, pinnedModelId, clientTag);
```

上游签名是 `(…, requestedModel, servedModel)`。**合并后调用点必须重排**：

```ts
// 上游语义：requestedModel = 客户端 pin 的模型；servedModel = 上游自称的模型（#534）
logRequest(platform, modelId, keyId, status, in, out, latency, err, ttfb, pinnedModelId, null, clientTag);
```

> ⚠️ 这是 `MERGE-REFACTOR-PLAN.md` §6 决策点 A 的落地：**追加第 12 参保留 `clientTag`**（推荐），而不是改用上游 `client_agent`。

### 5.5 验证 grep

```bash
grep -n "clientTag\|notifyTracker" server/src/lib/request-log.ts
grep -n "noteRequestRowId\|served_model\|client_agent" server/src/lib/request-log.ts
```

---

## 6. `lib/guardrails.ts`（add/add 冲突）

### 6.1 上游现状

上游 `lib/guardrails.ts` 注释明确 **"Ported from @coffcoe's fork e5024d53"**，是本地护栏层的同源升级版：
- `applyTokenBudget`（含 `TOKEN_BUDGET_OUTPUT_CAP=4096`）+ `tokenBudgetMessage`。
- `newBreaker(limit)` / `recordBreakerFailure`（返回是否跳闸）。
- 读设置支持 env fallback（`readGuardrailValue`）。

### 6.2 移植建议（方案）

**直接采用上游版本**（比本地完整）。本地 `exceedsTokenBudget` 简单形态在 stream 内 early-stop 用——若灰狐确认仍需要，保留一个薄包装：

```ts
// LOCAL thin wrapper: keep the simple pre-flight boolean the local routes use.
import { applyTokenBudget } from './guardrails.js';
export function exceedsTokenBudget(estimatedTotal: number, budget: number): boolean {
  return applyTokenBudget(estimatedTotal, Math.max(0, budget - estimatedTotal)).rejection !== null;
}
```

> ⚠️ 但注意**常量名**：上游用 `REQUEST_MAX_TOKENS_BUDGET_SETTING` / `MAX_CONSECUTIVE_UPSTREAM_FAILS_SETTING`；本地用 `SETTING_REQUEST_MAX_TOKENS_BUDGET` / `SETTING_MAX_CONSECUTIVE_UPSTREAM_FAILS`。settings 表里存的 key 是**同一个字符串**（`request_max_tokens_budget` / `max_consecutive_upstream_fails`），所以**数据兼容、只需改代码引用**。
>
> ⚠️ 调用点：`newBreaker()` → `newBreaker(limit)`（上游第一参是 limit，默认从设置读）；`recordUpstreamFailure(state)` → `recordBreakerFailure(state)`（返回值从无到有，`tripped` 判定改由返回值驱动）。

### 6.3 验证 grep

```bash
grep -n "applyTokenBudget\|TOKEN_BUDGET_OUTPUT_CAP\|recordBreakerFailure" server/src/lib/guardrails.ts
grep -rn "exceedsTokenBudget" server/src/routes/   # 应为 0（已替换）或仅薄包装
```

---

## 7. `db/migrate/defaults.ts`（本地 39 → 上游 78）

### 7.1 移植动作

**以上游为基底**（上游已注册 16 个新迁移），**追加本地 3 个迁移注册**：

```diff
 import * as githubGpt41Context from '../migrations/20260630_000001_github_gpt41_context.js';
+import * as addCategoryToModels from '../migrations/20260701_000001_add_category_to_models.js';
+import * as addProbeFields from '../migrations/20260701_000002_add_probe_fields.js';
 import * as requestClientInfo from '../migrations/20260706_000001_request_client_info.js';
 ...
 import * as customEndpointHostLabels from '../migrations/20260802_000001_custom_endpoint_host_labels.js';
+import * as quotaGuardColumns from '../migrations/20260802_000000_quota_guard_columns.js';
 import * as keyModelScope from '../migrations/20260805_000001_key_model_scope.js';
 ...
```

**DEFAULT_MIGRATIONS 数组**（保持文件名升序）：

```diff
   { filename: GITHUB_GPT41_CONTEXT_FILENAME, module: githubGpt41Context },
+  { filename: ADD_CATEGORY_TO_MODELS_FILENAME, module: addCategoryToModels },
+  { filename: ADD_PROBE_FIELDS_FILENAME, module: addProbeFields },
   { filename: REQUEST_CLIENT_INFO_FILENAME, module: requestClientInfo },
   ...
+  // 20260802_000000 must sort BEFORE 20260802_000001 (runner sorts by filename)
+  { filename: QUOTA_GUARD_COLUMNS_FILENAME, module: quotaGuardColumns },
   { filename: CUSTOM_ENDPOINT_HOST_LABELS_FILENAME, module: customEndpointHostLabels },
```

### 7.2 关键注意

- 本地 `quota_guard_columns` 建的 `client_tag` 列与上游 `request_client_info` 建的 `client_ip/client_user_agent/client_agent` **并存无冲突**（不同列名）。
- `20260802_000000`（本地）与 `20260802_000001`（上游 `custom_endpoint_host_labels`）同一天——**文件名升序保证 `000000` 在前**（迁移 runner 按 filename 排序）。
- 本地 3 个迁移文件**已存在**（`882adda` 补交），无需新增文件。

### 7.3 验证 grep

```bash
grep -n "20260701_000001_add_category\|20260701_000002_add_probe\|20260802_000000_quota_guard" server/src/db/migrate/defaults.ts
```

---

## 8. `providers/index.ts`（本地 347 → 上游 409）

### 8.1 上游新增能力（直接保留）

- 大量新平台（aionlabs / requesty / navy / bynara / sea-lion 等）。
- `ModelScopeProvider`（独立 `providers/modelscope.ts`，1-token chat 验证，比本地 `/models` 验证准）。
- `AIHordeProvider`（独立文件，queue-based）。
- agnes `timeoutMs: 60_000`（reasoning 平台）。

### 8.2 定制移植点 A：OpenRouter `validateUrl`

**本地**（`index.ts` L60-66）：
```ts
register(new OpenAICompatProvider({
  platform: 'openrouter', name: 'OpenRouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  validateUrl: 'https://openrouter.ai/api/v1/key',   // /models 对垃圾 key 也返回 200，健康检查虚高
  extraHeaders: { 'HTTP-Referer': 'http://localhost:3001', 'X-Title': 'FreeLLMAPI' },
}));
```

**上游**：无 `validateUrl`。

**移植动作**：在上游 openrouter 注册项加一行 `validateUrl: 'https://openrouter.ai/api/v1/key',`（含本地注释，见 `CUSTOM-PATCHES §6.3`）。

### 8.3 定制移植点 B：agnes `.cn`

**本地**：`baseUrl: 'https://apihub.agnes-ai.cn/v1'`（修复，上游是 `.com`）。
**上游**：`baseUrl: 'https://apihub.agnes-ai.com/v1', timeoutMs: 60_000`。

**移植动作**：
```diff
   platform: 'agnes',
   name: 'Agnes AI',
-  baseUrl: 'https://apihub.agnes-ai.com/v1',
+  baseUrl: 'https://apihub.agnes-ai.cn/v1',   // LOCAL: .com 无法访问（CUSTOM-PATCHES §6.x）
   timeoutMs: 60_000,                          // 保留上游 60s（reasoning 平台）
```

### 8.4 定制移植点 C：cline 平台（上游无）

**移植动作**：把本地 cline 注册块搬到上游（位置放在 agnes 之后即可）：
```ts
// Cline.bot — OpenAI-compatible gateway offering 1M context free models.
// Free tier requires registration at app.cline.bot (no card required).
// Models: minimax-m3, mimo-v2.5, deepseek-v4-flash.
register(new OpenAICompatProvider({
  platform: 'cline',
  name: 'Cline.bot',
  baseUrl: 'https://api.cline.bot/api/v1',
}));
```

### 8.5 modelscope：采用上游，替换本地简化版

**上游**有独立 `ModelScopeProvider`（1-token chat 验证 + `#581` retired-model 注释）——**直接采用上游**，删除本地 `index.ts` 里的简化版 `OpenAICompatProvider` modelscope 注册。本地 `shared/types.ts` 已含 `'modelscope'` 平台枚举，与上游一致。

> ⚠️ 需确认 `shared/types.ts` 上游是否也含 `'cline'`。若上游不含，`Platform` 联合类型要补 `'cline'`（本地 §3.1 已加）。合并时 `shared/types.ts` 若冲突，以「上游类型 + 本地 cline」合并。

### 8.6 验证 grep

```bash
grep -n "validateUrl.*api/v1/key\|agnes-ai.cn\|platform: 'cline'" server/src/providers/index.ts
grep -n "ModelScopeProvider" server/src/providers/index.ts
```

---

## 9. `app.ts` + `index.ts`（挂载与启动）

### 9.1 `app.ts` 移植点 A：config 路由双挂载

**上游**无 config 路由。**移植动作**（上游为基底，在 `/api` 区追加）：

```diff
   app.use('/api/analytics', requireAuth, analyticsRouter);
+  // LOCAL: multi-client onboarding — mounted on both authenticated and public
+  // paths so /api/config needs dashboard login while /v1/config uses the
+  // unified API key (client SDKs can self-configure).
+  app.use('/api/config', requireAuth, configRouter);
+  app.use('/v1/config', configRouter);
```

（import 处加 `import { configRouter } from './routes/config.js';`——上游无此文件，本地 `routes/config.ts` 已存在。）

### 9.2 `app.ts` 移植点 B：middleware 链（保守方案）

`MERGE-REFACTOR-PLAN.md` §3.7 推荐**保守方案**：合并期保留整条 `buildProxyMiddlewareChain()`，挂在上游 `/v1` proxyRouter 之前。但上游已把 auth 移进路由内（`resolveAuth` 在 `proxy.ts` 内调用），若再挂本地 `proxyAuth` 中间件会**双重校验**。

**决策**：
- **推荐**：`proxyAuth` 不再挂（上游 `resolveAuth` + `timingSafeStringEqual` 是等价的 HMAC 时序安全实现，`system-prompt.ts` L16-24 已核实）；其余 5 段（sanitizer/validator/normalizer/estimator/capabilityGate）与上游各路由内联校验功能重叠——**合并期先不挂**，保留 `DISABLE_ALL_MIDDLEWARE` env 兜底。
- **保守替代**（若担心 `resolveAuth` 语义变化）：仅保留 `proxyAuth` 挂载，其余 5 段用 `DISABLE_*` 默认关闭。**二选一，由领航员定**（对应 `MERGE-REFACTOR-PLAN.md` §6 决策点 B）。

### 9.3 `index.ts` 移植点：`cleanupExpiredCooldowns`

**上游**无 `cleanupExpiredCooldowns()` 启动调用（已核实：上游 ratelimit.ts 无此函数，cooldown-probe 只在运行时 `clearCooldownEarly`）。**移植动作**（上游为基底，在 `initDb` + `applyDeclarativeConfigFromEnv` 之后、`applyProxyUrl` 之前）：

```diff
   initDb(config.dbPath ?? undefined);
   applyDeclarativeConfigFromEnv();
 
+  // LOCAL: proactive cooldown cleanup on startup — stale DB rows from previous
+  // sessions would otherwise survive until a request hits that exact
+  // (platform, model, key). If every model is cooldown-blocked, no request can
+  // trigger the lazy cleanup in isOnCooldown → "routing exhausted" deadlock.
+  const cleared = cleanupExpiredCooldowns();
+  if (cleared > 0) {
+    console.log(`[startup] Cleaned ${cleared} expired rate-limit cooldown(s)`);
+  }
+
   // Load the persisted proxy settings from the DB (env var wins if set).
```

（import 处加 `import { cleanupExpiredCooldowns } from './services/ratelimit.js';`——**上游无此函数，需从本地移植**到上游 ratelimit.ts，注意本地实现用 `withDb` 事务删除 `expires_at_ms <= now` 的行 + 清内存 `cooldowns`，与上游 `persistCooldown` 的 `source` 列无冲突。）

### 9.4 上游新增启动项（直接保留）

- `installLogRedaction()`（模块级，日志脱敏）。
- `startCooldownProbe(scheduler)`。
- `startWakeDetect({ onWake })`（睡眠恢复）。
- `userCount() === 0 → generateSetupCode()`（首启 setup code）。

### 9.5 验证 grep

```bash
grep -n "configRouter\|/api/config\|/v1/config" server/src/app.ts
grep -n "cleanupExpiredCooldowns" server/src/index.ts
grep -n "startCooldownProbe\|startWakeDetect\|installLogRedaction" server/src/index.ts
```

---

## 10. 统一漂移验证清单（合并后逐项跑）

```bash
# 0) 编译
cd server && npx tsc --noEmit            # 零错误

# 1) 10 个文件移植点 grep 存活
grep -n "filterExhaustedQuota\|filterHighValueIfLarge"       server/src/services/router.ts
grep -n "NO_LIMIT_COOLDOWN_CAP_MS"                            server/src/services/ratelimit.ts
grep -n "provider.keyless\|\[Health\] Key "                   server/src/services/health.ts
grep -n "rpd_limit.*#P2-b\|rpd_limit 治本"                    server/src/services/catalog-sync.ts
grep -n "clientTag\|notifyTracker"                            server/src/lib/request-log.ts
grep -n "applyTokenBudget\|TOKEN_BUDGET_OUTPUT_CAP"           server/src/lib/guardrails.ts
grep -n "20260802_000000_quota_guard"                         server/src/db/migrate/defaults.ts
grep -n "validateUrl.*api/v1/key\|agnes-ai.cn\|platform: 'cline'" server/src/providers/index.ts
grep -n "configRouter"                                        server/src/app.ts
grep -n "cleanupExpiredCooldowns"                             server/src/index.ts

# 2) 上游新机制存活（不能被 -X ours 丢掉）
grep -n "acquireLease\|releaseLease"                          server/src/services/router.ts
grep -n "getCooldownDecisionForLimit\|getSoonestCooldownExpiry" server/src/services/ratelimit.ts
grep -n "probeKeyValidity\|markKeyHealthyFromRequest"         server/src/services/health.ts
grep -n "startCooldownProbe"                                  server/src/index.ts
grep -n "noteRequestRowId\|request_attempts"                  server/src/lib/request-log.ts server/src/db/migrate/defaults.ts

# 3) 冒烟
curl -s localhost:3001/api/ping                               # {"status":"ok"}
curl -s -o /dev/null -w '%{http_code}' localhost:3001/v1/models  # 401（无 key）
```

---

## 11. 风险点与回退

| 风险 | 等级 | 缓解 |
|---|---|---|
| ratelimit 方案 A 单点改动出错（10min 封顶 vs 上游阶梯） | 🔴 高 | diff 最小化；加单测覆盖 `getCooldownDecisionForLimit`（heuristic + quotaSignal 两分支） |
| `filterHighValueIfLarge` 用 `splice` 原地替换的引用安全 | 🟡 中 | 与 exploration 顺序核对；保留「过滤后为空回退原链」语义 |
| `clientTag` 与上游 `client_agent` 双列并存，analytics 口径混乱 | 🟡 中 | 文档说明两列语义；dashboard 查询默认用 `client_agent` |
| 上游 `Platform` 枚举不含 `'cline'`（已核实：含 modelscope/aihorde/siliconflow，无 cline） | 🟡 中 | `shared/types.ts` 合并时补 `'cline'`（本地 §3.1 已加），否则 cline 平台解析失败 |
| 上游 `models.source` 列：catalog-sync SELECT/UPDATE 结构变化 | 🟡 中 | 以上游为准，只移植 rpd_limit 排除；`source` 语义由上游管理 |
| 中间件链取舍（§9.2 决策点） | 🟡 中 | 二选一由领航员定；`DISABLE_ALL_MIDDLEWARE` 兜底 |
| 本地 3 迁移与上游 16 迁移在运行库执行顺序 | 🟢 低 | 文件名升序；PRAGMA 守卫幂等；`npm run db:migration:status` 预检 |

**回退策略**：所有移植在 `merge-upstream` 分支上进行，独立于 `main`（`e59ea8f`）；任何一步出问题 `git checkout main` 即回退。不 push 任何 github remote，不自动 merge。

---

## 12. 结论

1. **10 个非结构性冲突文件的移植点全部可落地**，无一需要删除本地定制；`NO_LIMIT_COOLDOWN_CAP_MS` 是唯一需要**单点手工合入上游函数**的定制（方案 A）。
2. **必须以上游为基底、不能 `-X ours`**：`router.ts` / `ratelimit.ts`（fallback-loop 依赖其新导出）；`health.ts` / `catalog-sync.ts` / `request-log.ts` / `app.ts` / `index.ts` / `defaults.ts` / `guardrails.ts` / `providers/index.ts` 同理（丢上游能力或丢本地定制）。
3. **灰狐后续只需做**：3 个结构性路由（`anthropic.ts` / `proxy.ts` / `responses.ts`）的 `runFallbackLoop` 重构 + 本文件 §5.4 的 `logRequest` 调用点重排 + 整体验证。本文件已把其余文件的最小 diff 全部给出，可直接按 §10 清单验证。

---

## 附 A. 结构性路由的定制保留清单（灰狐职责，NPC 仅列清单）

> 以下定制全部位于 3 个结构性冲突路由内，**归灰狐在 `runFallbackLoop` 重构时保留**（NPC 不碰路由，只列清单保证不丢）。已逐一核实上游 proxy.ts 无等价实现（`detectCategoryScene` / `truncateMessagesForGithub` / `inferClientTag` 上游全无）。

| 定制 | 本地文件:行 | 上游有无 | 重构时保留点 |
|---|---|---|---|
| `inferClientTag`（`x-client-tag`/`x-app-tag`） | `proxy.ts` L145 | ❌ 无 | 循环外取一次，传给 `logRequest` 第 12 参 |
| `detectCategoryScene` / `detectSceneTags`（场景软偏好） | `proxy.ts` L296/L352 | ❌ 无 | dispatch 前保留（`outboundMessages` 不变，只影响模型选择） |
| `GITHUB_MAX_INPUT_TOKENS=7500` / `GITHUB_MAX_OUTPUT_TOKENS=4096` | `proxy.ts` L503-504 | ❌ 无 | dispatch 内、`streamChatCompletion` 之前，仅 `platform==='github'` 时截断 + max_tokens 封顶 |
| `truncateMessagesForGithub` | `proxy.ts` L511 | ❌ 无 | 同上 |
| `clientAborted` 熔断 → 上游 `clientGone` + AbortController | `proxy.ts` L769/L1130 | ✅ 上游更强 | 改用 `clientGone` + `clientAbort.signal` + `isClientAbortError`；采纳上游 `'canceled'` 状态行 |
| `rescueInlineToolCalls` / `repairToolArguments` / `toolSchemaMap` | `proxy.ts` / `anthropic.ts` | ⚠️ 上游 anthropic 有、proxy 需核对 | dispatch 内保留本地版或对齐上游 |
| `setStickyModel`（成功时） | `proxy.ts` / `anthropic.ts` | ⚠️ 上游 `recordUpstreamSuccess` | 成功后调用，保持一致 |
| `notifyTracker`（3003） | `request-log.ts` | ❌ 无 | 已在 §5.3 处理 |
| `StreamAlreadyStarted` 类 | `anthropic.ts` | ⚠️ 上游有等价 | catch 里映射 `'committed'` |
| `sendError` / `sendExhaustion` 风格 | `proxy.ts` / `anthropic.ts` | ⚠️ 上游 `sendExhaustion` 更好 | 建议用上游 `sendExhaustion`（错误码映射更全） |
| 本地 `responses.ts` 对 `proxy.js` 的 import 耦合 | `responses.ts` | ❌ 上游已解耦 | 重构时改从 `lib/fallback-loop.js` + 各自模块引入 |

**灰狐验证命令**（合并后）：

```bash
grep -n "inferClientTag\|detectCategoryScene\|truncateMessagesForGithub\|GITHUB_MAX_INPUT" server/src/routes/proxy.ts
```
