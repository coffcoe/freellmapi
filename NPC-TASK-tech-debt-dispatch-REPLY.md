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

## 4. TD-027 — models.category 覆盖不足 【P2】 🔄

> 进行中，完成后在本节补充：统计分布、补齐方案、dry-run 输出（各 category 补齐行数 + 仍 NULL 行数）、分支名。
