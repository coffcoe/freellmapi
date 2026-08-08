# 🤖 NPC 任务：`router.ts` 场景路由评分改动 · 专项复核

> **模式**：`@CodeBuddy 替我上班`
> **类型**：Code Review（**只复核、不改代码**）
> **目标文件**：`server/src/services/router.ts`（本次改动 +141 行）
> **产出**：`NPC-REVIEW-scene-routing-router-REPLY.md`（复核意见 + 逐项裁定）
> **分支**：`merge-upstream`

---

## 0. 为什么这份 review 存在（边界说明，请先读）

`NPC-ISSUE-freellmapi-merge-改造方案.md` §9.1 的任务分配表约定：

| 承接方 | 文件范围 |
|--------|---------|
| **CNB NPC** | `guardrails.ts` / `settings.ts` / **`router.ts`** / `ratelimit.ts` |
| 灰狐（本地） | `anthropic.ts` / `proxy.ts` + 整体验证 |

本次场景路由回填时，**灰狐越界改了 `router.ts`（+141 行）** —— 该文件按约定归 NPC。
代码已写完并带 30 例单测，作废重来不经济，故改为**事后协同**：代码照常合入 `merge-upstream`，但 `router.ts` 那 141 行**必须经 NPC 复核**才算闭环。

**请把这份 review 当作对"一份未经你同意就动了你负责文件"的质量把关**，可以严厉。

---

## 1. 背景：这段业务逻辑是什么、为什么要回填

### 1.1 丢失经过

- 本 fork 原有一套**场景路由**：从请求内容推断使用场景，对候选模型链施加**软偏好**。
- 在 `df001b2`（"adopt upstream runFallbackLoop; preserve local business logic"）重构中，该逻辑随旧的 `for (let attempt = 0; ...)` 循环一并被删。
- `git log -S detectCategoryScene` 可确认删除点。
- 这是 18 项本地定制保全矩阵中**唯一丢失项**，登记为 **TD-001（P0）**。

### 1.2 回填约束（领航员指令原文）

> "经上游机制重演（功能保全、形式变化）方式重写场景路由业务逻辑"

拆解为三条硬约束：

| 约束 | 含义 | 本次做法 |
|------|------|---------|
| **上游机制** | 必须复用上游 `runFallbackLoop`，**禁止**回退旧 `for` 循环 | 偏好折叠进 router 现有 `orderChain` 评分，重试/降级/冷却完全不碰 |
| **功能保全** | 三层权重必须与原实现一致 | L1 network_tier +4 / L2 category +2 / L3 每 tag +1 |
| **形式变化** | 允许（且应当）改变实现形态 | 检测（纯函数，`lib/scene.ts`）与评分（`router.ts`）分离 |

### 1.3 原始实现的三层权重（`git show df001b2^` 取证）

```
L1  network_tier 匹配（X-Network-Tier 请求头）   +4
L2  category 匹配（models.category）              +2
L3  tags 命中（models.tags）                      +1 / 每个命中 tag
```

---

## 2. 本次 `router.ts` 改动清单（你要复核的部分）

| # | 新增/修改 | 符号 | 行为 |
|---|----------|------|------|
| 1 | 新增 export | `ModelSceneAttrs` | 每模型场景属性（category / networkTier / tags） |
| 2 | 新增 export | `parseModelTags(raw)` | 容错解析 `models.tags` 三种并存格式 |
| 3 | 新增 export | `loadSceneAttrs(db, chain)` | 按链内 `id IN (...)` 查询场景属性，**每次调用重查、不缓存** |
| 4 | 新增 export | `sceneBiasScore(entry, scene, attrs)` | 三层加权，返回"优先级分"（越大越优） |
| 5 | 新增常量 | `SCENE_BIAS_UNIT = 0.02` | bandit 模式量纲换算因子 |
| 6 | 修改签名 | `orderChain(chain, strategy, sampled, scene?, attrs?)` | 注入偏好 |
| 7 | 修改签名 | `routeRequest(..., scene?: SceneSignal)` | 尾参新增 |

### 2.1 两种排序模式的注入方式（**符号方向是重点**）

```ts
// priority 分支：升序，数值越小越优 → 必须【减】bias
eff: e.priority + getPenalty(e.model_db_id) - sceneBiasScore(e, scene, attrs)

// bandit 分支：降序，分数越高越优 → 【加】bias × UNIT
s: scoreChainEntry(...).score + sceneBiasScore(e, scene, attrs) * SCENE_BIAS_UNIT
```

### 2.2 惰性加载

```ts
const sceneAttrs = scene && !isEmptyScene(scene) ? loadSceneAttrs(db, chain) : undefined;
```
无场景的调用方（fusion 面板、dashboard、既有测试）零额外查询。

---

## 3. 五个关键决策点 —— 请逐项挑战

### D-1 `SCENE_BIAS_UNIT = 0.02` 的取值

**理由**：`combineScore` 是 `[0,1]` 区间的凸组合，再乘 headroom 与 rateLimit 两个护栏因子。
若直接把原始优先级分（最大可达 `4+2+1×4 = 10`）加进去，会**碾压可靠性、速度以及 rateLimit 护栏**，把"软偏好"变成"硬覆盖" —— 极端情况会持续路由到已被限流的模型。
按 0.02/点缩放后总上限约 **0.2**：足以在接近的候选间重排序、也足以压过 priority 平局判定，但不足以翻盘一个显著的健康度差距。

**请复核**：
- [ ] 0.02 是否过小（软偏好实际不起作用）或过大（仍可能压过 rateLimit 护栏）？
- [ ] 是否应改为**相对量纲**（例如按当前候选分数的标准差自适应）而非硬编码常量？
- [ ] 是否应做成 `settings` 可配置项而非编译期常量？

### D-2 priority 模式用**减法**

**理由**：priority 模式是升序（小者优先）。若沿用加法，场景命中的模型反而被推到链尾 —— 语义完全颠倒。

**已做变异测试**：把 `-` 翻回 `+`，3 个用例转红，证明测试对符号方向有鉴别力（非空跑）。

**请复核**：
- [ ] 减法后 `eff` 可能为负（如 priority=1、bias=7 → eff=-6）。是否需要 clamp 到 0？
- [ ] 与 `getPenalty()`（429 惩罚）叠加时，场景偏好会不会抵消掉限流惩罚？**这是我最不确定的一点**：bias 最大 -7，而 penalty 的量级需要你确认是否可能被完全吃掉。

### D-3 `loadSceneAttrs` 不做进程级缓存

**理由**：管理端 UI 可随时改模型的 category/tags，模块级缓存会把路由钉死在旧标签上直到重启。主键 `IN (...)` 查几十个 id 的成本，低于这个陈旧风险。

**请复核**：
- [ ] 高 QPS 下每请求一次 `SELECT ... WHERE id IN (...)` 是否可接受？
- [ ] 是否应改为**带失效通知的缓存**（写侧改 category/tags 时主动 invalidate）？
- [ ] 能否与既有的链查询合并成一次 SQL，避免二次往返？

### D-4 `parseModelTags` 容错三格式

**现状取证**（生产库 `freeapi.db`，`models.tags` 共 147 行非空）：

| 格式 | 样例 | 行数 |
|------|------|------|
| JSON 对象数组 | `[{"platform_policy": ...}]` | 111 |
| 合法 JSON 字符串数组 | `["free-tier","long-context"]` | 9 |
| 裸 CSV | `free-tier,long-context` | 8 |

旧实现是 `JSON.parse` + `catch → []`，因此**后两类之外的约 75% 行静默贡献为空**，L3 层对大部分目录形同虚设。
新实现三种都接受，对象数组只保留其中的 string 元素。

**请复核**：
- [ ] 静默接受脏格式，是否在**掩盖**写侧的数据质量问题（登记为 TD-026，写侧根因仍开放）？
- [ ] 是否应改为**一次性数据迁移统一格式** + 读侧只认 JSON 数组？
- [ ] 对象数组里只挑 string 丢弃对象，会不会丢掉本应作为 tag 的语义？

### D-5 三层权重照搬原值（4 / 2 / 1）

**理由**："功能保全"是硬约束，权重必须与丢失前一致，不借回填之机调参。

**请复核**：
- [ ] 权重本身是否合理？L1(+4) 压倒 L2(+2) 的设计（网络层级优先于能力匹配）是否成立？
- [ ] 若你认为不合理，**请只提议、不要改** —— 调参属于独立变更，须领航员另行裁定。

---

## 4. 复核清单（逐项勾选并给结论）

### 4.1 正确性
- [ ] `sceneBiasScore` 三层权重与 §1.3 原值一致
- [ ] priority 分支符号方向正确（减法）
- [ ] bandit 分支不会因 bias 突破 `combineScore` 的语义边界
- [ ] `loadSceneAttrs` 的 `IN (...)` 占位符构造无 SQL 注入面（ids 来自 `chain` 的 `model_db_id`，均为 DB 整数主键）
- [ ] `parseModelTags` 对 `null` / 空串 / 畸形 JSON 均不抛异常

### 4.2 与既有定制的相容性
- [ ] 不破坏 `filterExhaustedQuota`（精确 `(platform,key_id)` 维度配额过滤）
- [ ] 不破坏 `filterHighValueIfLarge`（大请求保护稀缺模型）
- [ ] 不破坏 `NO_LIMIT_COOLDOWN_CAP_MS` 相关冷却语义
- [ ] 不干扰 sticky session / 显式 pin（`preferredModelDbId` 前置逻辑在偏好排序**之后**执行，请确认顺序无误）

### 4.3 上游机制符合度
- [ ] 未引入任何自建重试循环
- [ ] 未改动 `runFallbackLoop` 的降级阶梯
- [ ] 未改动冷却 / 探测恢复 / in-flight lease 逻辑

### 4.4 性能
- [ ] 无场景请求的额外开销确认为 0
- [ ] 有场景请求的额外开销可接受（一次主键 IN 查询）

---

## 5. guardrails（严格遵守）

- **不要改任何代码**，只出 `NPC-REVIEW-scene-routing-router-REPLY.md`。

  > 📌 **澄清**：2026-08-08 起你在技术债任务上**已获得改代码权限**（见 `NPC-TASK-tech-debt-dispatch.md` §0.0）。但**本文件是复核任务，不适用** —— 复核的价值在于独立视角，改手与审手同一人就失去意义。你的结论会交领航员裁定后，再决定由谁改。
- **不要碰** `server/src/routes/proxy.ts`、`server/src/routes/anthropic.ts`、`server/src/lib/scene.ts` —— 归灰狐（§9.1）。
- **不要动** `CUSTOM-PATCHES.md`。
- 若认为某处必须改，写出**具体 diff 建议 + 两种方案**，由领航员裁定，不要直接改。
- 发现缺陷请标注严重度：**P0 阻断合入** / **P1 须修但不阻断** / **P2 建议**。

---

## 6. 参考文件

| 文件 | 用途 |
|------|------|
| `server/src/services/router.ts` | 复核主体 |
| `server/src/lib/scene.ts` | 检测侧（纯函数，只读参考，勿改） |
| `server/src/__tests__/services/scene-routing.test.ts` | 30 例单测，判断覆盖是否充分 |
| `server/src/db/migrations/20260807_000001_scene_routing_columns.ts` | 补声明 `network_tier`/`tags` 两列 |
| `BUSINESS-LOGIC-PRESERVATION.md` §3 | 回填方案与落地实况 |
| `TECH-DEBT-INVENTORY.md` TD-001 / TD-025 ~ 027 | 相关技术债 |
| `NPC-ISSUE-freellmapi-merge-改造方案.md` §9.1 | 任务边界约定 |

---

## 7. 交付格式

```markdown
# NPC-REVIEW-scene-routing-router-REPLY.md

## 总体结论
[ 通过 / 有条件通过 / 打回 ]

## 决策点裁定
| 决策点 | 结论 | 严重度 | 理由 | 建议方案 |
|--------|------|--------|------|---------|
| D-1 SCENE_BIAS_UNIT=0.02 | | | | |
| D-2 priority 减法 | | | | |
| D-3 不缓存 | | | | |
| D-4 tags 三格式 | | | | |
| D-5 权重 4/2/1 | | | | |

## 复核清单结果
（§4 逐项，附证据行号）

## 新发现的缺陷
| # | 位置 | 严重度 | 描述 | 建议 |

## 测试覆盖评估
（30 例是否充分，缺哪些边界）
```
