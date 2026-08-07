# 🤖 NPC-TASK 技术债执行回执（Batch 1）

> 任务入口：`NPC-TASK-tech-debt-dispatch.md`（§0.0 权限 + 批次表）
> 承接方：CNB NPC（CodeBuddy）
> 更新日期：2026-08-08
> 状态说明：**Batch 1 三项按序执行中** —— TD-012a ✅ / TD-012b ✅ 已完成并推送；TD-027 进行中。

---

## 1. 批次与分支总览

| TD | 标题 | 优先级 | 交付分支 | 状态 | 合并方 |
|----|------|--------|----------|------|--------|
| TD-012a | roundtrip 迁移期望列表滞后 | P1 | `npc/td-012a` | ✅ 已推送 | 灰狐验证后合并 |
| TD-012b | 两个迁移 down() 抛 not implemented | P1 | `npc/td-012b` | ✅ 已推送 | 灰狐验证后合并 |
| TD-027 | models.category 覆盖不足 | P2 | `npc/td-027` | 🔄 进行中 | 灰狐验证后合并 |

⛔ 未 push `merge-upstream`；未触碰 `routes/proxy.ts`、`routes/anthropic.ts`、`lib/scene.ts`、`CUSTOM-PATCHES.md`；未动未解锁批次（TD-026/TD-022/TD-014a）。

---

## 2. TD-012a — roundtrip 迁移期望列表滞后 【P1】 ✅

### 2.1 分支
`npc/td-012a`（commit `8bee10e`）

### 2.2 变更文件
`server/src/__tests__/db/migrate/roundtrip.test.ts`

### 2.3 缺失期望项与来源 commit（逐条）

| 期望项 | 文件名 | 来源 commit | 位置 |
|--------|--------|-------------|------|
| `ADD_CATEGORY_TO_MODELS` | `20260701_000001_add_category_to_models.ts` | `2b4a73c` fix(db): register 20260701_* migrations in DEFAULT_MIGRATIONS with PRAGMA guards | 第 6 位（GITHUB_GPT41_CONTEXT 之后） |
| `ADD_PROBE_FIELDS` | `20260701_000002_add_probe_fields.ts` | `2b4a73c`（同上） | 第 7 位 |
| `QUOTA_GUARD_COLUMNS` | `20260802_000000_quota_guard_columns.ts` | `2b4a73c`（同上） | 第 8 位 |
| `SCENE_ROUTING_COLUMNS` | `20260807_000001_scene_routing_columns.ts` | `e586d95` feat(router): re-derive scene routing via upstream mechanism (TD-001, P0) | 第 19 位（末尾追加） |

> 说明：3 条插在第 6/7/8 位（`GITHUB_GPT41_CONTEXT` 之后、`REQUEST_CLIENT_INFO` 之前），仅 1 条追加到末尾 —— 严格按 `DEFAULT_MIGRATIONS` 的声明顺序，不是"追加到末尾了事"。

### 2.4 治本：防同义反复设计
- 新增 **drift-guard 用例**：从 `DEFAULT_MIGRATIONS.map(m => m.filename)` 派生期望，与硬编码列表比对 —— 未来"注册了迁移却忘记更新测试"（TD-012a 根因）会直接转红。
- **保留硬编码锚点** `EXPECTED_MIGRATION_FILENAMES`（19 项手写字面量）：roundtrip 主断言仍用该硬编码列表，防止测试退化成"数组自己跟自己比"的同义反复。

### 2.5 自测结果（`npm run test:migrations`）
- 基线（merge-upstream）：**1 passed / 2 failed**（TD-012a 期望列表 1 例 + TD-012b down() 1 例）
- TD-012a 修复后（不含 TD-012b 修复）：**3 passed / 1 failed**（剩余 1 例为 TD-012b 的 down()）
- 破坏性验证：故意从 `DEFAULT_MIGRATIONS` 漏注册一条时，drift-guard 用例转红 ✅

---

## 3. TD-012b — 两个迁移 down() 抛 not implemented 【P1】 ✅

### 3.1 分支
`npc/td-012b`（commit `8481539`）

### 3.2 变更文件
- `server/src/db/migrations/20260701_000001_add_category_to_models.ts`
- `server/src/db/migrations/20260701_000002_add_probe_fields.ts`

### 3.3 实现方式（参考既有范式）
- `add_category_to_models.down()`：PRAGMA 守卫 → `ALTER TABLE models DROP COLUMN category`（幂等）
- `add_probe_fields.down()`：
  1. `DROP TABLE IF EXISTS probe_logs`（连带两个索引 `idx_probe_logs_model_id` / `idx_probe_logs_probed_at`）
  2. PRAGMA 守卫 → DROP `models.last_verified_at`、`models.probe_status`（幂等）
- 全部基于 SQLite ≥ 3.35 `DROP COLUMN`（实测引擎 3.53.1）；参照先例 `20260802_000000_quota_guard_columns.ts` / `20260807_000001_scene_routing_columns.ts`。

### 3.4 自测结果（`npm run test:migrations`）
- TD-012b 修复后，roundtrip 核心用例 **"runs all migrations up, down to baseline, then up to the same schema" 单独通过**（up→down→up 后 schema 快照一致）。
- 叠加 TD-012a 的期望列表修复后整文件：**4 passed / 0 failed**。
- `runDownToBaseline` 隐藏契约（每个 down() 必须真的改变 app DB 状态）满足：`probe_logs` 表 + 3 列被真实删除，断言 `.not.toEqual(before)` 通过。

### 3.5 tsc 校验
`npx tsc --noEmit -p server` → **EXIT 0**

---

## 4. TD-027 — models.category 覆盖不足 【P2】 ✅

### 4.1 分支
`npc/td-027`（commit `af8bd8e`）

### 4.2 统计分布（merge-upstream 基线 `:memory:` 全量 110 行）
- 初始：`category` 全部 **NULL 110 行**（基线库中 110 个模型均无 category，与 TECH-DEBT-INVENTORY 的「73 NULL + chat/function-calling/vision/reasoning」为生产库口径略有出入，但性质一致：**无 coding、无 audio**）
- dry-run 回填后分布：

| category | 行数 |
|----------|------|
| function-calling | 54 |
| vision | 13 |
| coding | 9 |
| reasoning | 4 |
| audio | 1 |
| **NULL（保持）** | **29（26.4%）** |

### 4.3 方案与实现
- **推断逻辑**（`server/src/services/model-category.ts`，纯函数、可单测）：按保守优先级
  1. `supports_vision` → `vision`
  2. 代码向 id/名（qwen3-coder / codestral / devstral / coder-next）→ `coding`
  3. 音频向 id/名（whisper / tts / voice / speech / audio / omni / stt）→ `audio`
  4. 推理向 id/名（thinking / r1 / o1/o3/o4，整词匹配，防 `reasonably` 误命中）→ `reasoning`
  5. `supports_tools` → `function-calling`
  6. 无法推断 → **显式留 NULL 并计数上报**，绝不猜默认值
- **catalog 侧集成**（`server/src/services/catalog-sync.ts`）：`applyCatalog` 的 insert/update 写入 category；事务内对 `source='catalog'` 且 category IS NULL 的行回填（用户自有行不动）
- **回填脚本**（`server/src/scripts/backfill-model-categories.ts`）：幂等 + 默认 dry-run，`--apply` 才写

### 4.4 自测数字
- `model-category.test.ts`：**8 passed**
- `catalog-sync.test.ts`：**24 passed**（含 3 个新增 TD-027 集成用例：推断、backfill、用户行不触碰）
- 幂等性验证（文件 DB 两次 `--apply`）：第一次 fill 81，第二次 fill **0**
- 完整回归：**46 failed / 1415 passed**（基线 stash 后 46 failed / 1412 passed；通过数 +3 = 新增集成用例；失败集合一致，**零新增回归**）
- `tsc --noEmit` EXIT 0

### 4.5 数据边界
- ⛔ 未直接 UPDATE 任何生产库（脚本仅 dry-run，需灰狐在本地 `--apply` 执行）
- ✅ 脚本幂等 + 可 dry-run（先输出将影响多少行，确认后才写）
- ✅ `coding` / `audio` 各至少 1 行：**coding 9 / audio 1**；NULL 占比 **26.4%**（< 50%，远优于基线）

---

> **Batch 1 三项全部完成。** 三个分支（`npc/td-012a` / `npc/td-012b` / `npc/td-027`）均未推 `merge-upstream`，由灰狐跑全量回归验证后合并。
