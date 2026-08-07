# 业务逻保全与上游重演报告 (Business-Logic Preservation & Upstream Re-derivation)

> **分支**：`merge-upstream` @ `df001b2` ｜ **日期**：2026-08-07
> **核验方式（执行层，可验证）**：`grep` 符号存活 + `git log -S` 溯源 + `npx tsc --noEmit`（`server/` 内 EXIT 0，0 error）
> **配套文档**：`MERGE-REFACTOR-PLAN.md`（冲突分析）、`MERGE-PORT-DIFFS.md`（端口 diff）、`CUSTOM-PATCHES.md`（定制台账）、`TECH-DEBT-INVENTORY.md`、`OPTIMIZATION-ROADMAP.md`

---

## 0. 一句话结论

上游 merge 已完成**代码层落地**：3 个结构性冲突文件（`proxy.ts` / `anthropic.ts` / `responses.ts`）统一收敛到上游 `runFallbackLoop`，编译通过。**18 项本地定制中 17 项保全（含 4 项经上游机制重演），1 项在 runFallbackLoop 重构中丢失** —— 场景路由 `detectCategoryScene` 及其 L3 场景标签 / 软路由偏好评分。这是「核心理念保全」唯一缺口，需回填（§3）。

---

## 1. 核验方法（执行层，非推断）

| 检查项 | 命令 / 动作 | 结果 |
|---|---|---|
| 编译通过 | `cd server && npx tsc --noEmit -p tsconfig.json` | **EXIT 0**，0 error |
| 符号存活 | 对 18 项定制逐符号 `grep -r` `server/src` | 见 §2 矩阵 |
| 丢失判定 | `git log -S detectCategoryScene -- server/src/routes/proxy.ts` → `df001b2` 删除；旧 `proxy.ts` L1433-1466 的 `score +=` 偏置块在新代码 0 命中 | 确认丢失 |
| 文档存活 | `git cat-file -e HEAD:FREELLMAPI-CODEBASE-REVIEW.md` | **NOT in HEAD tree**（仅存 3b99eb6 历史，见 §5） |

---

## 2. 保全矩阵（18 项）

状态图例：**PRESERVED** 原样保全 ｜ **REFACTORED** 经上游机制重演（功能保全，形式变化）｜ **LOST** 丢失 ｜ **DEAD** 死代码

| # | 定制 | 当前文件 / 位置 | 状态 | 执行层证据 |
|---|------|----------------|------|-----------|
| 1 | `filterExhaustedQuota` | `services/router.ts` | PRESERVED | `grep -rl` → 1 file |
| 2 | `NO_LIMIT_COOLDOWN_CAP_MS`（10min 封顶） | `services/ratelimit.ts` | PRESERVED | 2 refs |
| 3 | `clientAborted` 熔断 | `routes/proxy.ts` | **REFACTORED** → 上游 `clientGone` + `AbortController` + `isClientAbortError` | L930-935 / 997 / 1019 / 1057（更健壮，覆盖流式中途断开） |
| 4 | `GITHUB_MAX_INPUT_TOKENS` / `truncateMessagesForGithub` | `routes/proxy.ts` | PRESERVED | 1 ref 各 |
| 5 | `OPENROUTER_VALIDATE`（`/api/v1/key`） | `providers/index.ts` L63 | **REFACTORED** → 上游 `validateUrl` 字段（同 `/api/v1/key`） | PRESERVED 语义 |
| 6 | `AGNES_BASE_URL`（`.cn` 修复） | `providers/index.ts` L206 | PRESERVED | `baseUrl: 'https://apihub.agnes-ai.cn/v1'` |
| 7 | `CLIENT_TEMPLATES` | `routes/config.ts` | PRESERVED | 1 ref |
| 8 | `is_high_value` + `filterHighValueIfLarge` | `services/router.ts` L1178-1203 | PRESERVED | 2 refs |
| 9 | `CUSTOM-PATCHES.md` | 仓库根 | PRESERVED | 存在 |
| 10 | `clientTag` + `notifyTracker` | `lib/request-log.ts` / `lib/attempt-trace.ts` | **REFACTORED** → 上游 `client-context` 采纳 + 本地 `clientTag` 字段保留（`inferClientTag` 迁入 `request-log.ts`） | `app.ts`/`request-log.ts`/`attempt-trace.ts` 引用 |
| 11 | HMAC `timingSafeStringEqual` | `middleware/proxyAuth.ts` 等 | PRESERVED | `proxyAuth.ts`/`password.ts`/`setup-code.ts` + `proxy`/`anthropic`/`responses`/`mcp` 路由 |
| 12 | middleware 链（6 段） | `app.ts` | **HYBRID** → 本地链保留 + 叠加上游 `clientContextMiddleware`（L34） | `requireAuth`/`proxyAuth`/`requestSanitizer`/`requestValidator`/`messageNormalizer`/`tokenEstimator`/`capabilityGate`/`errorHandler` 全部保留 |
| 13 | 场景路由 `detectCategoryScene` | — | **LOST** | 见 §3 |
| 14 | catalog-sync `rpd_limit` 排除 | `services/catalog-sync.ts` L246-263 | PRESERVED | 注释 + UPDATE 仍排除 `rpd_limit` |
| 15 | 启动清理过期冷却 `cleanupExpiredCooldowns` | `index.ts` | PRESERVED | 2 refs |
| 16 | cline / modelscope 平台 | `providers/index.ts` | PRESERVED | 存在 |
| 17 | `routes/config.ts`（多客户端接入） | `routes/config.ts` | PRESERVED | 存在 |
| 18 | `sticky-session.ts` / `stream-handler.ts` | `routes/` | **DEAD** | `stream-handler.ts` 0 导入方；`sticky-session.ts` 仅被死代码引用 | 

**保全率（功能口径）**：17/18 = **94%**。仅场景路由（#13）为实质丢失；#18 为死代码清理项，不影响运行行为。

---

## 3. 唯一缺口：场景路由丢失（P0 · ✅ 已回填 2026-08-07）

### 3.1 旧逻辑（来源：`f01cdc3` `proxy.ts` L295-466、L1433-1466）
- `detectCategoryScene(messages, hasTools)`：从消息内容推断场景 `agent / vision / coding / long-context / reasoning / speed`。
- `detectSceneTags(messages)`：L3 标签 `free-tier / long-context / low-latency / compliance`。
- `sceneToCategory(scene)`：映射到 DB `category` 值。
- **消费点（旧 L1456-1466）**：
  ```ts
  if (sceneCat && catMap.get(e.model_db_id) === sceneCat) score += 2;   // 场景命中软偏好
  for (const tag of sceneTags) { /* 按 L3 标签加分 */ }
  ```

### 3.2 影响（核心理念层面）
- 失去「**按请求语义软偏好模型**」能力；长上下文 / 低延迟 / 合规等 L3 标签不再参与路由评分。
- 这是本地 fork 区别于上游的「智能路由」核心特性之一，属核心理念范畴，必须回填。

### 3.3 上游方式重演方案（回填，不回退 for 循环）
1. **前置计算**：在 `proxy.ts` 进入 `runFallbackLoop` 之前的 fallback 前置阶段，计算 `sceneCategory` + `sceneTags`（复用旧 `detectCategoryScene` / `detectSceneTags` 纯函数，移至 `services/router.ts` 或 `lib/scene.ts`）。
2. **评分注入**：在 `services/router.ts` 的 chain scoring 处新增纯函数 `applyScenePreference(chain, sceneCategory, sceneTags)`，与现有 `filterHighValueIfLarge`（L1178）同类扩展点并列。
3. **不做**：不恢复 `for (let attempt...)` 重试循环，重试统一走上游 `runFallbackLoop`；场景偏好仅影响「选哪把钥匙」，不影响「失败后怎么换」。
4. **验收**：
   - 单测覆盖 6 类场景识别 + `score += 2` 偏置生效；
   - `tsc --noEmit` EXIT 0；
   - 回归：高价值模型在 large 请求仍被 `filterHighValueIfLarge` 剔除，场景偏好不与之冲突。

### 3.4 落地实况（[执行层] · 2026-08-07）

**形式变化**：检测（纯函数）与评分（DB 感知）彻底分离，偏置折叠进 `orderChain` 既有排序，而非在 `routeRequest` 之前预排序 chain。

| 文件 | 角色 |
|------|------|
| `server/src/lib/scene.ts`（新增） | 纯检测：`detectCategoryScene` / `detectSceneTags` / `detectScene` / `normalizeNetworkTier` / `isEmptyScene`。零 DB、零 req 依赖 |
| `server/src/services/router.ts` | `parseModelTags` / `loadSceneAttrs` / `sceneBiasScore` + `orderChain` 双分支注入；`routeRequest` 新增可选尾参 `scene?: SceneSignal` |
| `server/src/routes/proxy.ts` | `/completions` 与 `/chat/completions` 两处接入，**仅 auto 路由**（`isAutoModel`）生效 |
| `server/src/db/migrations/20260807_000001_scene_routing_columns.ts`（新增） | 补声明 `models.network_tier` / `models.tags` |
| `server/src/__tests__/services/scene-routing.test.ts`（新增） | 30 例，全绿 |

**功能保全**：三层权重与旧版一致 —— L1 `network_tier` +4 ／ L2 `category` +2 ／ L3 每个命中 tag +1。

**回填过程中发现并修复的 4 个既有缺陷**（旧实现即已存在，非本次引入）：

| # | 缺陷 | 后果 | 处置 |
|---|------|------|------|
| B-1 | priority 分支为**升序**（小者优先），旧回填草案用 `+ bias` | 命中场景的模型反被**降权**，偏好方向完全颠倒 | 改为 `- bias`；变异测试（翻回 `+`）确认 3 个用例转红 |
| B-2 | bandit `combineScore ∈ [0,1]`，直接 `+2` | 软偏好变**硬覆盖**，并压过 `rateLimit` 限流护栏，可能持续路由到被限流模型 | 引入 `SCENE_BIAS_UNIT = 0.02`，总上限 ≈0.2，够破近似平局、不够翻盘健康度 |
| B-3 | 中文线索被包在 `/\b(长文档｜论文…)\b/` 内 | JS `\b` 只对 `[A-Za-z0-9_]` 生效，**整条中文识别静默失效** | 中文线索改 `includes()`，单测含 6 条中文回归 |
| B-4 | `models.tags` 存在 3 种互斥格式（JSON 数组／裸 CSV／对象数组），旧代码 `JSON.parse` + catch→`[]` | 147 行中约 90% 的 tags 静默不参与评分，L3 层近乎死层 | `parseModelTags` 容错三格式；单测覆盖 |

**新增边界**：场景偏好**仅对 auto 路由生效**。pin 指定模型或 unified group 是客户端显式选择，重排会违背其意图。

**验收结果**：`tsc --noEmit` EXIT 0；`scene-routing.test.ts` 30/30 通过；变异测试证明用例有鉴别力（非空跑）。

**全量回归对比**（隔离"既有失败"与"本次引入"）：

| 指标 | 基线 `3f5a7cf`（stash 后干净树） | 含本次改动 | 判定 |
|------|------------------------------|-----------|------|
| 失败用例 | 48 | 48 | 持平，**零新增回归** |
| 失败文件 | 14 | 14 | 持平 |
| 通过用例 | 1372 | 1402 | +30（= 本次新增测试数） |
| 总用例 | 1420 | 1450 | +30 |

48 项既有失败归属 **TD-012**（merge 后未跑集成测试遗留），分布见 `TECH-DEBT-INVENTORY.md`；其中 `roundtrip.test.ts` 2 例的根因已定位为 `2b4a73c` 注册迁移时未同步测试期望 + 两个迁移 `down()` 未实现，已拆为 TD-012a / TD-012b 派发。

### 3.5 协作边界说明（[执行层] · 诚实标注）

`NPC-ISSUE-freellmapi-merge-改造方案.md` §9.1 约定：`router.ts` 归 **CNB NPC**，`proxy.ts` / `anthropic.ts` 归灰狐。

本次回填**违反了该边界** —— `router.ts` 被灰狐改动 +141 行（场景评分三层逻辑、`parseModelTags`、`loadSceneAttrs`、`orderChain` 双分支注入）。

| 文件 | 行数 | 约定归属 | 判定 |
|------|------|---------|------|
| `server/src/services/router.ts` | +141 | **CNB NPC** | ❌ 越界 |
| `server/src/routes/proxy.ts` | +22 | 灰狐 | ✅ 本分 |
| `server/src/lib/scene.ts`（新增） | — | 分工表未覆盖 | ⚠️ 灰色 |

**根因**：跨会话接力时，上一轮会话摘要未保留 §9.1 的任务边界表，接力方只依据摘要行动、未回读分工文档。

**处置**（领航员 2026-08-07 裁定）：代码照常合入，但 `router.ts` 部分**必须经 NPC 事后复核**才算闭环 → `NPC-REVIEW-scene-routing-router.md`。剩余技术债按 §9.1 边界重新分派 → `NPC-TASK-tech-debt-dispatch.md`。

**流程教训（固化）**：会话摘要会丢失协作边界。跨会话接力的**第一步必须回读任务分工文档**，不能只信摘要。

---

## 4. 死代码清理（P1）

| 文件 | 证据 | 动作 |
|------|------|------|
| `routes/stream-handler.ts` | `grep -r handleStreamRoute` 仅命中自身；无任何导入方 | 删除 |
| `routes/sticky-session.ts` | 仅被死代码 `stream-handler.ts` 引用；`context-handoff.ts` 仅注释提及 `stickySessionMap` 模式 | 确认无运行期引用后删除 |

**验收**：删除后 `tsc --noEmit` 仍 EXIT 0，且全仓无 `import ... stream-handler` / `sticky-session` 报错。

---

## 5. 文档工作流缺口（P2）

- `FREELLMAPI-CODEBASE-REVIEW.md` 在 `3b99eb6` 提交后，当前 `merge-upstream` 工作树**已不含该文件**（仅存于 git 历史）。本报告将其恢复并扩展（见 `ARCHITECTURE-REVIEW` 同源文档）。
- **建议**：文档纳入版本管理门禁（CI 校验关键 `*.md` 存在），防止 merge 过程误删交付物。

---

## 6. 二审声明（诚实优于自夸 · 二分标注）

- **[执行层]** 以上 17/18 保全、1 丢失、死代码、编译通过，均来自 `grep` / `git` / `tsc` 实测，非推断。
- **[规则层]** 场景路由回填（§3.3）、死代码删除（§4）、文档门禁（§5）为**建议方案**，尚未落地，待执行层验证。
- **[待观察]** `client-context` 与本地 `clientTag` 双轨并存是否导致 analytics 维度重复，需在后续埋点评审中确认。
