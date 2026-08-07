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

## 3. 唯一缺口：场景路由丢失（P0 · 待回填）

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
