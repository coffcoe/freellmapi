# 🤖 NPC 任务：剩余技术债分派表（按 §9.1 边界）

> **模式**：`@CodeBuddy 替我上班`
> **依据**：`NPC-ISSUE-freellmapi-merge-改造方案.md` §9.1 任务分配 + §11 guardrails
> **分支**：`merge-upstream`
> **产出**：见每项「交付物」列；总入口 `NPC-TASK-tech-debt-dispatch-REPLY.md`

---

## 0. 边界复述（本表的分派依据）

| 承接方 | 文件范围 | 禁区 |
|--------|---------|------|
| **CNB NPC** | `guardrails.ts` / `settings.ts` / `router.ts` / `ratelimit.ts` / `db/migrate/*` / `db/migrations/*` / 数据层（catalog） | **不得碰** `routes/proxy.ts`、`routes/anthropic.ts`、`lib/scene.ts`、`CUSTOM-PATCHES.md` |
| **灰狐（本地）** | `routes/anthropic.ts` / `routes/proxy.ts` / `app.ts` / 文档台账 / **整体验证** | 整体验证**不能外包** |

> `db/migrate` 与 `db/migrations` 未在原 §9.1 表中列名。判定归 NPC，理由：与 `router.ts` 同属数据/服务层，且明确不属灰狐的 `anthropic.ts`/`proxy.ts` 范围。若你认为该判定不当，请在回复中提出。

---

## 1. 分派总表

| TD | 标题 | 优先级 | 承接方 | 判定依据 |
|----|------|--------|--------|---------|
| TD-001 | 场景路由丢失 | P0 | ✅ 已闭环 | `router.ts` 部分另见 `NPC-REVIEW-scene-routing-router.md` |
| **TD-012a** | **roundtrip 迁移期望列表滞后** | **P1** | **NPC** | `db/migrate` 层 |
| **TD-012b** | **两个迁移 `down()` 抛 not implemented** | **P1** | **NPC** | `db/migrations` 层 |
| TD-010 | 死代码 `stream-handler.ts`/`sticky-session.ts` | P1 | 灰狐 | 路由层辅助，与 proxy 同域 |
| TD-011 | 评审交付物丢失 | P1 | ✅ 已闭环 | 已恢复到工作树 |
| TD-013 | 双重客户端标识体系 | P1 | **NPC 分析 → 灰狐裁定** | `client-context.ts` 属服务层；口径裁定需领航员 |
| TD-014a | `router.ts` ~1200 行过大 | P1 | **NPC** | 归 NPC 文件 |
| TD-014b | `proxy.ts` ~2100 行过大 | P1 | 灰狐 | 归灰狐文件 |
| TD-020 | middleware 链双轨 | P2 | 灰狐 | `app.ts` + 需写 ADR |
| TD-021 | `CUSTOM-PATCHES.md` 台账漂移 | P2 | 灰狐 | guardrails 禁 NPC 动此文件 |
| **TD-022** | **冷却清理与上游探测未整合** | **P2** | **NPC** | `ratelimit.ts`/`health.ts` 归 NPC |
| TD-023 | web2kb `.bak` 蔓延 | P2 | 灰狐 | 关联项目，不在本仓分工表 |
| TD-024 | web2kb 单体过大 + 缺测试 | P2 | 灰狐 | 同上 |
| TD-025 | schema 漂移（两列无迁移） | P1 | ✅ 已闭环 | 本轮补迁移 |
| **TD-026** | **`models.tags` 三格式并存（写侧）** | **P1** | **NPC** | 数据层 + catalog 写侧 |
| **TD-027** | **`models.category` 覆盖不足** | **P2** | **NPC** | 数据层 |

**派给 NPC 的共 6 项**：TD-012a、TD-012b、TD-013（仅分析）、TD-014a、TD-022、TD-026、TD-027。

---

## 2. NPC 任务详情

### TD-012a — `roundtrip.test.ts` 迁移期望列表滞后 【P1】

**证据（实测）**：
- `server/src/db/migrate/defaults.ts` 的 `DEFAULT_MIGRATIONS` 数组现有 **18 条**。
- `server/src/__tests__/db/migrate/roundtrip.test.ts` L71-L88 的期望数组只列 **15 条**。
- 缺失 3 条：
  - `20260701_000001_add_category_to_models.ts`
  - `20260701_000002_add_probe_fields.ts`
  - `20260802_000000_quota_guard_columns.ts`
- 根因提交：`2b4a73c`「fix(db): register 20260701_* migrations in DEFAULT_MIGRATIONS with PRAGMA guards」—— **注册了迁移但没同步更新测试期望**。
- 本轮又新增第 19 条 `20260807_000001_scene_routing_columns.ts`，缺口扩大到 4 条。

**任务**：
1. 补齐 `roundtrip.test.ts` 的常量声明与期望数组，使其与 `DEFAULT_MIGRATIONS` 完全一致（**注意顺序必须与数组一致**）。
2. **顺带治本**：增加一条断言，直接从 `DEFAULT_MIGRATIONS` 派生期望，使"注册了迁移却忘了更新测试"在未来自动暴露，而不是靠人肉同步。

**交付物**：diff 建议（**不要直接 push**）
**验收**：
- 能重跑：`npx vitest run src/__tests__/db/migrate/roundtrip.test.ts` 可重复执行
- 会报错：故意漏注册一条迁移时，测试必须转红
- 有验收：贴出通过计数

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

**交付物**：两个文件的 diff 建议
**验收**：
- 能重跑：`roundtrip.test.ts` 两个用例均绿
- 会报错：down 若未真正改变 schema，测试应转红
- 有验收：贴出 up→down→up 后 schema 快照一致的证据

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

**交付物**：分布统计 + 补齐方案（**不要直接改数据**）

---

## 3. guardrails（严格遵守）

- **不要直接 push 代码**，所有产出为方案 / diff 建议。
- **不要碰** `routes/proxy.ts`、`routes/anthropic.ts`、`lib/scene.ts`。
- **不要动** `CUSTOM-PATCHES.md`。
- **不要删除**任何本地定制函数（`filterExhaustedQuota`、`filterHighValueIfLarge`、`NO_LIMIT_COOLDOWN_CAP_MS` 等），即使认为上游已有等价实现。
- 任何"确实冲突"的情形，写出冲突点 + **两种兼容方案**，交领航员裁定。
- 优先级建议按 **TD-012a → TD-012b → TD-026 → TD-014a → TD-013 → TD-022 → TD-027** 推进：前两项直接解锁 `npm test` 全绿，收益最高。

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
