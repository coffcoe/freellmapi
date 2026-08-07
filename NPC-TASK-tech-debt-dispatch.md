# 🤖 NPC 任务：剩余技术债分派表（按 §9.1 边界）

> **模式**：`@CodeBuddy 替我上班`
> **依据**：`NPC-ISSUE-freellmapi-merge-改造方案.md` §9.1 任务分配 + 文首 2026-08-08 权限修订
> **基线分支**：`merge-upstream`（从此切出，**不直推**）
> **产出**：代码走 `npc/<任务号>` 分支；文档产出总入口 `NPC-TASK-tech-debt-dispatch-REPLY.md`

---

## ⚠️ 0.0 权限已升级（2026-08-08，务必先读）

**你现在可以直接改代码了**，原「只出方案不改代码」的限制已由领航员解除。

原限制的理由是「NPC 尚不熟悉本仓定制，怕误改」；经 merge 改造方案一轮协作，该前提已消失。

**但采用分级放开，不是全面放开**，原因有二：

1. **测试基线目前不可信** —— 全量 `npm test` 现有 **48 例既有失败**（就是 TD-012 那批）。在红底之上改代码，无法区分「既有的红」与「你新引入的红」。所以第一批只放解基线的任务。
2. **`router.ts` 刚被改过且未复核** —— 灰狐本轮为回填场景路由改了 +141 行（commit `e586d95`），复核结论未出。此时叠加 TD-014a 的千行级拆分，风险不可控。

### 交付流程（强制）

```
git checkout merge-upstream
git checkout -b npc/td-012a          # 一个任务一个分支
# ... 改代码 ...
npm test                              # 自测：必须跑，且贴出前后对比
git push origin npc/td-012a           # 推自己的分支，不推 merge-upstream
```

然后在 REPLY 文档里写明分支名 + 自测结果，**由灰狐跑全量回归验证后合并**。
`§9.1「整体验证不外包」原则不变` —— 你的自测是必要条件，不是充分条件。

### 每项任务的完成判据（三条都要满足）

| 判据 | 含义 |
|------|------|
| **能重跑** | 换环境/重跑仍通过，不是一次性侥幸 |
| **会报错** | 异常路径显式失败并暴露，不静默吞掉 |
| **有验收** | 附可验证事实：分支名、测试前后数字、关键文件路径 |

> 若某项改到一半发现「越改越大」（改动超出该 TD 描述范围），**立即停手并出方案**，不要一路改下去。宁可拆成两轮。

---

## 0. 边界复述（本表的分派依据）

| 承接方 | 文件范围 | 禁区 |
|--------|---------|------|
| **CNB NPC** | `guardrails.ts` / `settings.ts` / `router.ts` / `ratelimit.ts` / `db/migrate/*` / `db/migrations/*` / 数据层（catalog） | **不得碰** `routes/proxy.ts`、`routes/anthropic.ts`、`lib/scene.ts`、`CUSTOM-PATCHES.md` |
| **灰狐（本地）** | `routes/anthropic.ts` / `routes/proxy.ts` / `app.ts` / 文档台账 / **整体验证** | 整体验证**不能外包** |

> `db/migrate` 与 `db/migrations` 未在原 §9.1 表中列名。判定归 NPC，理由：与 `router.ts` 同属数据/服务层，且明确不属灰狐的 `anthropic.ts`/`proxy.ts` 范围。若你认为该判定不当，请在回复中提出。

---

## 1. 分派总表（含放开批次）

### 1.0 批次表 —— 先看这个，决定你现在能改什么

| 批次 | 状态 | 任务 | 权限 | 解锁条件 |
|------|------|------|------|---------|
| **Batch 1** | 🟢 **现在就做** | TD-012a、TD-012b、TD-027 | **可直接改代码** | 已解锁 |
| **Batch 2** | 🟡 待解锁 | TD-026、TD-022 | 可改代码 | **Batch 1 合并后、全量 `npm test` 基线归零** |
| **Batch 3** | 🔴 暂缓 | TD-014a | 暂只出方案 | `NPC-REVIEW-scene-routing-router.md` 复核结论出来后，由领航员另行裁定 |
| **常设** | 🔵 仅分析 | TD-013 | **不改代码** | 口径裁定权归领航员，性质使然，不解锁 |

**Batch 1 为什么是这三项**：TD-012a/012b 直接解 48 例既有失败，修完测试基线才可信，是后续一切改动的前提；TD-027 是纯数据层补全（`models.category` 覆盖），不触碰路由与限流逻辑，风险最低，适合作为放开后的第一次代码交付验证协作流程。

**建议顺序**：`TD-012a → TD-012b`（先解基线）`→ TD-027`。前两项做完请**先同步一次结果**再继续，便于及早发现流程问题。

---

### 1.1 分派明细

| TD | 标题 | 优先级 | 承接方 | 批次 | 判定依据 |
|----|------|--------|--------|------|---------|
| TD-001 | 场景路由丢失 | P0 | ✅ 已闭环 | — | `router.ts` 部分另见 `NPC-REVIEW-scene-routing-router.md` |
| **TD-012a** | **roundtrip 迁移期望列表滞后** | **P1** | **NPC** | 🟢 **1** | `db/migrate` 层 |
| **TD-012b** | **两个迁移 `down()` 抛 not implemented** | **P1** | **NPC** | 🟢 **1** | `db/migrations` 层 |
| TD-010 | 死代码 `stream-handler.ts`/`sticky-session.ts` | P1 | 灰狐 | — | 路由层辅助，与 proxy 同域 |
| TD-011 | 评审交付物丢失 | P1 | ✅ 已闭环 | — | 已恢复到工作树 |
| TD-013 | 双重客户端标识体系 | P1 | **NPC 分析 → 灰狐裁定** | 🔵 仅分析 | `client-context.ts` 属服务层；口径裁定需领航员 |
| TD-014a | `router.ts` ~1200 行过大 | P1 | **NPC** | 🔴 **3** | 归 NPC 文件；等 router 复核结论 |
| TD-014b | `proxy.ts` ~2100 行过大 | P1 | 灰狐 | — | 归灰狐文件 |
| TD-020 | middleware 链双轨 | P2 | 灰狐 | — | `app.ts` + 需写 ADR |
| TD-021 | `CUSTOM-PATCHES.md` 台账漂移 | P2 | 灰狐 | — | guardrails 禁 NPC 动此文件 |
| **TD-022** | **冷却清理与上游探测未整合** | **P2** | **NPC** | 🟡 **2** | `ratelimit.ts`/`health.ts` 归 NPC |
| TD-023 | web2kb `.bak` 蔓延 | P2 | 灰狐 | — | 关联项目，不在本仓分工表 |
| TD-024 | web2kb 单体过大 + 缺测试 | P2 | 灰狐 | — | 同上 |
| TD-025 | schema 漂移（两列无迁移） | P1 | ✅ 已闭环 | — | 本轮补迁移 |
| **TD-026** | **`models.tags` 三格式并存（写侧）** | **P1** | **NPC** | 🟡 **2** | 数据层 + catalog 写侧 |
| **TD-027** | **`models.category` 覆盖不足** | **P2** | **NPC** | 🟢 **1** | 数据层 |

**派给 NPC 的共 7 项**：TD-012a、TD-012b、TD-013（仅分析）、TD-014a、TD-022、TD-026、TD-027。
**其中 Batch 1 可立即动代码的 3 项**：TD-012a、TD-012b、TD-027。

> 另有 **1 项独立复核任务**（不在上表内）：`router.ts` +141 行事后复核，见 `NPC-REVIEW-scene-routing-router.md`。
> 故 **NPC 侧当前待办合计 8 项** = 技术债 7 项 + 复核 1 项。

---

## 2. NPC 任务详情

### TD-012a — `roundtrip.test.ts` 迁移期望列表滞后 【P1】

**证据（截至 commit `0704278` 实测，可直接核对）**：
- `server/src/db/migrate/defaults.ts` L52 起的 `DEFAULT_MIGRATIONS` 数组现有 **19 条**。
- `server/src/__tests__/db/migrate/roundtrip.test.ts` L71-L86 的期望数组只列 **15 条**，缺 **4 条**。
- 根因提交：`2b4a73c`「fix(db): register 20260701_* migrations in DEFAULT_MIGRATIONS with PRAGMA guards」—— **注册了迁移但没同步更新测试期望**；本轮 `e586d95` 新增 scene_routing 后缺口扩大到 4 条。

**⚠️ 关键：缺失项不是"追加到末尾"，位置分散，照抄顺序会失败**

`DEFAULT_MIGRATIONS` 实际顺序（方括号标出测试里缺的）：

```
 1 LEGACY_BASELINE                 11 PROFILE_CHAIN_BACKFILL
 2 CUSTOM_PROVIDER_MODALITIES      12 KEY_HEALTH_ERROR
 3 CATALOG_MODEL_STATE             13 COOLDOWN_PROBE_PROVENANCE
 4 REQUEST_AGGREGATES              14 REQUEST_ATTEMPTS
 5 GITHUB_GPT41_CONTEXT            15 MODEL_SOURCE_PROVENANCE
[6 ADD_CATEGORY_TO_MODELS]  ←缺    16 MEDIA_MODEL_META
[7 ADD_PROBE_FIELDS]       ←缺    17 REQUEST_SERVED_MODEL
[8 QUOTA_GUARD_COLUMNS]    ←缺    18 ATTEMPT_ERROR_SUMMARY
 9 REQUEST_CLIENT_INFO             [19 SCENE_ROUTING_COLUMNS] ←缺
10 CUSTOM_MODEL_TOOL_SUPPORT
```

即：**3 条要插在第 6/7/8 位（`GITHUB_GPT41_CONTEXT` 之后、`REQUEST_CLIENT_INFO` 之前），只有 1 条追加到末尾。**

**任务**：
1. 补齐 `roundtrip.test.ts` 的常量声明与期望数组，使其与 `DEFAULT_MIGRATIONS` 完全一致（**顺序按上表，别追加到末尾了事**）。
2. **顺带治本**：把期望改为直接从 `DEFAULT_MIGRATIONS` 派生（如 `DEFAULT_MIGRATIONS.map(m => m.filename)`），使"注册了迁移却忘了更新测试"在未来自动暴露，而不是靠人肉同步。
   - ⚠️ 但请**保留至少一条硬编码断言**（例如断言总条数，或断言首尾若干项），否则测试会退化成同义反复 —— 数组自己跟自己比永远为真，等于把这个测试废掉。这是本项最容易做错的地方。

**交付物**：🟢 **Batch 1 — 直接改代码**，交付分支 `npc/td-012a`（**不推 `merge-upstream`**）
**验收**：
- 能重跑：`npx vitest run src/__tests__/db/migrate/roundtrip.test.ts` 可重复执行
- 会报错：故意漏注册一条迁移时，测试必须转红
- 有验收：贴出通过计数 + 分支名 + 每个新增期望项对应的来源 commit

---

### TD-012b — 两个迁移 `down()` 抛 "Downgrade not implemented" 【P1】

**证据（实测）**：

| 文件 | 行 | 现状 |
|------|-----|------|
| `db/migrations/20260701_000001_add_category_to_models.ts` | `down()` | `throw new Error('Downgrade not implemented for this migration')` |
| `db/migrations/20260701_000002_add_probe_fields.ts` | L41 | 同上 |

这直接导致 `roundtrip.test.ts` 的第二个用例失败：
```
FAIL  migration round trip > runs all migrations up, down to baseline, then up to the same schema
Error: Downgrade not implemented for this migration
 ❯ Module.down src/db/migrations/20260701_000002_add_probe_fields.ts:41:9
 ❯ runDownToBaseline src/__tests__/db/migrate/roundtrip.test.ts:128:5
```

**关键情报**：注释里写的"SQLite 不支持 DROP COLUMN"**已经过时**。SQLite ≥ 3.35 支持 `DROP COLUMN`，且本仓已有先例 —— `20260802_000000_quota_guard_columns.ts` 的 `down()` 就是这么写的：
```ts
const modelColumns = db.prepare('PRAGMA table_info(models)').all() as { name: string }[];
if (modelColumns.some(col => col.name === 'is_high_value')) {
  db.prepare('ALTER TABLE models DROP COLUMN is_high_value').run();
}
```
本轮新增的 `20260807_000001_scene_routing_columns.ts` 也已按此范式实现 `down()`，可作为第二个参考。

**任务**：
1. 按上述范式实现两个迁移的 `down()`：
   - `add_category_to_models`：DROP `models.category`
   - `add_probe_fields`：DROP `models.last_verified_at`、`models.probe_status`；DROP TABLE `probe_logs`（含两个索引）
2. 全部用 PRAGMA / `IF EXISTS` 守卫，保证幂等。
3. 注意 `roundtrip.test.ts` 的 `runDownToBaseline` 有一条隐藏契约：**每个 `down()` 必须真的改变 app DB 状态，否则断言 `.not.toEqual(before)` 会失败**。请确认这两个 down 满足。

**交付物**：🟢 **Batch 1 — 直接改代码**，交付分支 `npc/td-012b`（**不推 `merge-upstream`**）
**验收**：
- 能重跑：`roundtrip.test.ts` 两个用例均绿
- 会报错：down 若未真正改变 schema，测试应转红
- 有验收：贴出 up→down→up 后 schema 快照一致的证据 + 分支名

---

### TD-013 — 双重客户端标识体系（**仅分析，不改代码**）【P1】

**证据**：上游 `server/src/lib/client-context.ts`（IP / UA / agent 维度）与本地 `clientTag`（`server/src/lib/request-log.ts` 的 `inferClientTag`）双轨并存。

**任务**：只做语义边界分析，产出对照表：
| 维度 | client-context | clientTag | 是否重复 | 建议归口 |

**禁止**：不要改代码，不要合并两套体系 —— 口径统一属业务决策，由领航员裁定。
**交付物**：分析章节 + 建议方案（至少两种）

---

### TD-014a — `router.ts` 单体过大（~1200 行）【P1】

**任务**：给出拆分方案（**只出方案**）。建议切分维度：链构建 / 过滤（quota、high-value）/ 评分（combineScore、bandit）/ 场景偏好 / 排序。
**约束**：
- 场景偏好部分请等 `NPC-REVIEW-scene-routing-router.md` 复核完成后再纳入拆分方案，避免与 review 结论冲突。
- 拆分不得改变任何对外导出符号的行为。
**交付物**：拆分方案 + 每个新模块的职责与导出清单 + 迁移步骤

---

### TD-022 — 启动冷却清理与上游探测未整合 【P2】

**证据**：本地 `cleanupExpiredCooldowns`（`server/src/index.ts` 启动时）与上游 `startCooldownProbe` 各自独立运行，冷却恢复策略分裂。
**任务**：评估能否合并为单一冷却生命周期管理；说明合并后对 `NO_LIMIT_COOLDOWN_CAP_MS`（本地定制，10 分钟无限冷却上限）的影响。
**约束**：`NO_LIMIT_COOLDOWN_CAP_MS` 是必保定制（`CUSTOM-PATCHES.md` #2），方案不得使其失效。
**交付物**：整合方案 + 风险点

---

### TD-026 — `models.tags` 三种格式并存（写侧根因）【P1】

**证据（生产库 `freeapi.db` 实测，147 行非空）**：

| 格式 | 样例 | 行数 |
|------|------|------|
| JSON 对象数组 | `[{"platform_policy": ...}]` | 111 |
| 合法 JSON 字符串数组 | `["free-tier","long-context"]` | 9 |
| 裸 CSV | `free-tier,long-context` | 8 |

读侧已由本轮 `parseModelTags()`（`router.ts`）容错缓解，但**写侧根因未修** —— 仍会继续写入脏格式。

**任务**：
1. 定位所有写 `models.tags` 的代码路径（重点查 `services/catalog-sync.ts`、管理端 API）。
2. 给出统一写侧格式的方案（建议统一为 JSON 字符串数组）。
3. 给出一次性数据迁移方案，把存量 111 + 8 行归一化。
4. 评估归一化后能否收紧 `parseModelTags` 为只认 JSON 数组。

**交付物**：写侧改造方案 + 数据迁移脚本草案（**不要直接执行**）

---

### TD-027 — `models.category` 覆盖不足 【P2】

**证据**：现有目录 category 仅 `chat` / `function-calling` / `vision` / `reasoning`，另有 **73 行 NULL**。
**影响**：场景路由 L2 层（category 匹配 +2）对 `coding`、`audio` 两类场景**恒不命中** —— 映射逻辑已就位（`lib/scene.ts` 的 `sceneToCategory`），纯粹是数据缺失。

**任务**：
1. 统计各 category 分布与 NULL 明细。
2. 给出补齐方案：能否从 catalog 上游元数据推断？还是需人工标注？
3. 特别评估 `coding` / `audio` 两个 category 的补齐可行性。
4. 实现推断逻辑（catalog 侧）+ 配套单测。

**交付物**：🟢 **Batch 1 — 可改代码**，交付分支 `npc/td-027`

**⚠️ 数据边界（本项特有）**：
- ✅ 可改：catalog 侧的 category 推断/回填**代码**、幂等**迁移脚本**、单测。
- ⛔ 不可：直接 UPDATE 生产库数据。生产 DB 在领航员本地（`D:\Users\Yin\freellmapi`，端口 3001 服务每日高频写入），**只能由灰狐在本地执行你提供的脚本**。
- 回填脚本必须**幂等**且**可 dry-run**（先输出将影响多少行，确认后才写）。

**验收**：
- 能重跑：推断逻辑对同一输入稳定输出；脚本重复执行不产生副作用
- 会报错：无法推断的模型应显式留 NULL 并计数上报，**不得猜一个默认值糊上去**
- 有验收：dry-run 输出（各 category 补齐行数 + 仍 NULL 行数）+ 分支名

---

## 3. guardrails（严格遵守）

### 3.1 已放开

- ✅ **可以直接改代码** —— 但**仅限 Batch 1 的三项**（TD-012a / TD-012b / TD-027）。其余批次仍只出方案。
- ✅ 可以自建 `npc/<任务号>` 分支并 push 该分支。

### 3.2 仍是红线

- ⛔ **不要 push `merge-upstream`**，只推自己的 `npc/*` 分支，由灰狐验证后合并。
- ⛔ **不要碰** `routes/proxy.ts`、`routes/anthropic.ts`、`lib/scene.ts` —— 归灰狐（§9.1）。
- ⛔ **不要动** `CUSTOM-PATCHES.md`。
- ⛔ **不要删除**任何本地定制函数（`filterExhaustedQuota`、`filterHighValueIfLarge`、`NO_LIMIT_COOLDOWN_CAP_MS` 等），即使认为上游已有等价实现。
- ⛔ **不要动未解锁批次的代码**（TD-014a / TD-022 / TD-026 现阶段只出方案）。
- ⛔ **不要为了让测试变绿而修改测试断言本身**（TD-012a 是例外，它的任务定义就是修正期望列表 —— 但需逐条说明每个新增期望项的来源 commit）。

### 3.3 遇到这些情况请停手并出方案

- 改动范围明显超出该 TD 描述（"越改越大"）。
- 需要改 §3.2 红线内的文件才能完成。
- 发现该 TD 的前提描述与代码实际不符。
- 任何"确实冲突"的情形：写出冲突点 + **两种兼容方案**，交领航员裁定。

### 3.4 推进顺序

**Batch 1 内部**：`TD-012a → TD-012b → TD-027`。

前两项做完请**先同步一次结果**（贴分支名 + 测试前后数字）再做 TD-027 —— 这是放开权限后的第一次代码协作，早点对齐流程比赶进度重要。

---

## 4. 参考文件

| 文件 | 用途 |
|------|------|
| `TECH-DEBT-INVENTORY.md` | 技术债全量台账（TD-001 ~ TD-027） |
| `BUSINESS-LOGIC-PRESERVATION.md` | 18 项定制保全矩阵 |
| `CUSTOM-PATCHES.md` | 定制权威台账（**只读**） |
| `NPC-ISSUE-freellmapi-merge-改造方案.md` §9.1 | 任务边界约定 |
| `NPC-REVIEW-scene-routing-router.md` | 并行进行的 router.ts 复核任务 |
| `server/src/db/migrations/20260802_000000_quota_guard_columns.ts` | `down()` 正确范式参考 |
