# 技术债盘点清单 (Tech-Debt Inventory) — freellmapi merge-upstream

> **分支**：`merge-upstream` @ `df001b2` ｜ **日期**：2026-08-07
> **严重度**：P0 阻断核心理念 / P1 应修 / P2 待办
> **配套**：`BUSINESS-LOGIC-PRESERVATION.md`、`OPTIMIZATION-ROADMAP.md`

---

## P0 — 阻断核心理念保全

### TD-001 场景路由业务逻在重构中丢失 — ✅ CLOSED 2026-08-07
- **位置**：原 `server/src/routes/proxy.ts` L295-466 / L1433-1466；`df001b2` 删除
- **证据**：`git log -S detectCategoryScene` → `df001b2`；新 `proxy.ts` 对 `sceneToCategory`/`detectSceneTags`/`score +=` 0 命中
- **影响**：失去「按请求语义软偏好模型」+ L3 场景标签（free-tier/long-context/low-latency/compliance）评分；本地 fork 智能路由核心特性缺失
- **修复**：已按 `BUSINESS-LOGIC-PRESERVATION.md` §3.3 落地，实况见 §3.4。新增 `lib/scene.ts`（纯检测）+ `router.ts` 的 `sceneBiasScore` 折叠进 `orderChain`；未回退 for 循环
- **验收**：[执行层] `tsc --noEmit` EXIT 0；`scene-routing.test.ts` 30/30 通过；变异测试（翻转偏置符号）令 3 例转红，证明用例有鉴别力
- **副产物**：回填期间发现 4 个旧实现即已存在的缺陷，见 §3.4 表 B-1~B-4；其中 B-3/B-4 使中文识别与 L3 标签层长期近乎失效

---

## P1 — 应修

### TD-010 死代码 `stream-handler.ts` / `sticky-session.ts`
- **证据**：`grep -r handleStreamRoute` 仅命中自身；`sticky-session.ts` 仅被死代码 `stream-handler.ts` 引用，`context-handoff.ts` 仅注释提及
- **影响**：维护噪声、误导读者、潜在误用
- **修复**：确认无运行期引用后删除二者；`tsc` 复验
- **验收**：删除后 `tsc --noEmit` EXIT 0，全仓无残留 import

### TD-011 代码评审交付物从工作树丢失
- **证据**：`git cat-file -e HEAD:FREELLMAPI-CODEBASE-REVIEW.md` → NOT in HEAD tree（仅存 `3b99eb6` 历史）
- **影响**：merge 过程误删文档，交付物不可见、易二次丢失
- **修复**：恢复文档到树（本报告同源已完成）+ 加 CI 存在性校验
- **验收**：`git ls-files | grep CODEBASE-REVIEW` 有输出

### TD-012 merge 后未跑集成测试验证 — ⚠️ 已实测，缺陷已定位并拆分
- **证据**：原先仅做 `tsc --noEmit`（类型层）；`npm test` 未在 merge-upstream 实测
- **影响**：运行时回归（如场景路由丢失）类型检查无法发现
- **2026-08-07 实测结果**（灰狐本地，整体验证不外包）：
  - 基线 `3f5a7cf`：**48 失败 / 1372 通过（1420）**，14 文件失败
  - 含场景路由改动：**48 失败 / 1402 通过（1450）**，14 文件失败 → **零新增回归**
  - 失败分布（用例数）：`audio-transcriptions` 13、`fusion` 7、`openai-compat` 5、`ratelimit-local-endpoint` 3、`reasoning-control` 3、`proxy-completions` 3、`guardrails` 3、`ratelimit-cooldown-error-kind` 2、`declarative-config` 2、`roundtrip` 2、`db/hardening` 2、`routing-semantics` 1、`fallback-hardening` 1、`reasoning-timeouts` 1
- **拆分**：其中 `roundtrip.test.ts` 的 2 例已定位根因，拆为 TD-012a / TD-012b（派 NPC）；其余 46 例待逐类归因
- **验收**：`npm test` 全绿

#### TD-012a `roundtrip.test.ts` 迁移期望列表滞后 —— 派 **CNB NPC**
- **证据**：`DEFAULT_MIGRATIONS` 现 19 条（本轮 +1），`roundtrip.test.ts` L71-88 期望仅 15 条，缺 `add_category_to_models` / `add_probe_fields` / `quota_guard_columns` / `scene_routing_columns`
- **根因**：`2b4a73c` 注册迁移时未同步更新测试期望
- **修复**：补齐期望 + **改为从 `DEFAULT_MIGRATIONS` 派生**，使漏注册自动暴露
- **验收**：故意漏注册一条迁移时测试必须转红

#### TD-012b 两个迁移 `down()` 抛 "Downgrade not implemented" —— 派 **CNB NPC**
- **证据**：`20260701_000001_add_category_to_models.ts` 与 `20260701_000002_add_probe_fields.ts` L41 直接 `throw`，导致 roundtrip 第二个用例（up→down→up）失败
- **关键情报**：注释所称"SQLite 不支持 DROP COLUMN"**已过时**（SQLite ≥3.35 支持）。本仓已有正确范式：`20260802_000000_quota_guard_columns.ts` 与本轮 `20260807_000001_scene_routing_columns.ts`
- **修复**：按范式实现两个 `down()`（PRAGMA 守卫 + `DROP COLUMN` / `DROP TABLE IF EXISTS probe_logs`）
- **验收**：roundtrip 两个用例全绿，up→down→up 后 schema 快照一致

### TD-013 双重客户端标识体系并存
- **证据**：上游 `lib/client-context.ts`（IP/UA/agent）与本地 `clientTag`（`request-log.ts`）双轨
- **影响**：analytics 维度可能重复/歧义；后续埋点评审需厘清
- **修复**：明确 `client-context`（调用方身份）与 `clientTag`（业务自标识）的语义边界，统一归因口径
- **验收**：analytics 文档明确两字段用途，无重复计数

### TD-014 路由单体文件过大
- **证据**：`proxy.ts` ~2100 行、`router.ts` ~1200 行、`anthropic.ts` 重构后仍大
- **影响**：可维护性、评审成本、冲突概率高
- **修复**：按职责拆分（场景偏好 / 请求翻译 / 流式帧 / 错误体渲染分离）；借 TD-001 回填顺势抽取 `lib/scene.ts`
- **验收**：单文件 < 600 行（软上限），`tsc` 通过

---

## P2 — 待办

### TD-020 middleware 链与上游 clientContextMiddleware 双轨
- **证据**：`app.ts` 保留本地 6 段链 + 导入 `clientContextMiddleware`（L34）
- **影响**：请求处理路径双重职责，长期应统一到上游范式或显式说明并存理由
- **修复**：在 `CUSTOM-PATCHES.md` 登记「为何保留本地链」决策（ADR）

### TD-021 文档随代码漂移风险
- **证据**：`CUSTOM-PATCHES.md` 台账未反映 merge 后 4 项 REFACTORED 状态（#3/#5/#10/#12）
- **影响**：后续维护者按旧台账误判定制丢失
- **修复**：更新 `CUSTOM-PATCHES.md` 标注每项当前状态（PRESERVED/REFACTORED/LOST）

### TD-022 启动冷却清理与上游探测未整合
- **证据**：本地 `cleanupExpiredCooldowns`（`index.ts`）+ 上游 `startCooldownProbe` 各自独立
- **影响**：冷却恢复策略分裂
- **修复**：评估合并为单一冷却生命周期管理

### TD-023 web2kb `.bak` 文件蔓延（关联项目）
- **证据**：`web2kb/scripts/` 含 `kb_enhance.py.bak.20260806-121300` 等 4 份、`distill_card.py.bak*` 3 份、`enhanced_fetcher.py.bak*`
- **影响**：工作区脏乱、易误改旧副本、违反「变更前 cp .bak 到归档位」整洁约定
- **修复**：用 git 历史代替工作区 `.bak`；清理 `*.bak`
- **验收**：`scripts/` 无 `.bak`，关键变更均有 commit

### TD-024 web2kb 单体脚本过大 + 缺测试
- **证据**：`kb_enhance.py` 71KB、`kb_cron.py` 53KB、`batch_processor.py` 19KB；`scripts/` 无 `test_*.py`
- **影响**：可维护性、回归风险
- **修复**：拆分 `kb_enhance` 为 ingest/enrich/dedup 模块；引入 `pytest`  smoke 测试
- **验收**：单脚本 < 40KB；`pytest` 有基础覆盖

---

## 2026-08-07 回填期新增（TD-025 ~ TD-027）

> 均在 TD-001 回填过程中由实测发现，属**既有**问题，非本次引入。

### TD-025 schema 漂移：`models.network_tier` / `models.tags` 无迁移声明 — ✅ CLOSED 2026-08-07
- **严重度**：P1（新部署直接崩溃）
- **证据**：`PRAGMA table_info(models)` 于 `server/data/freeapi.db`（147 行）显示两列**存在**，但 `server/src/db/migrations/` 全量 grep `network_tier` → 0 命中；两列系带外 `ALTER TABLE` 加入
- **影响**：老机器正常，**全新 clone / 全新 DB 的首个 auto 路由请求会抛 `SQLITE_ERROR: no such column: network_tier`**。schema 不可复现，也让旧场景路由「在我机器上能跑」
- **修复**：补 `20260807_000001_scene_routing_columns.ts`（PRAGMA 守卫，幂等），注册进 `DEFAULT_MIGRATIONS`
- **验收**：[执行层] 单测 `the migration declares network_tier and tags on models` 在 `:memory:` 全新库断言两列存在，通过

### TD-026 `models.tags` 三种互斥数据格式并存
- **严重度**：P1
- **证据**：147 行统计 —— 对象数组 `[{"platform_policy":…}]` 111 行、裸 CSV `free-tier,long-context` 约 12 行、合法 JSON 字符串数组约 9 行、空/NULL 15 行
- **影响**：旧代码 `JSON.parse` + catch→`[]`，导致 CSV 抛错归零、对象数组 parse 成功但 `includes(tag)` 永不命中 → **L3 标签层对约 90% 目录静默失效**
- **缓解（已做）**：`parseModelTags` 容错三格式，读侧已恢复功能
- **根因未清**：写侧仍可能继续产出异构格式
- **修复**：① 写侧收敛到唯一 JSON 数组格式（管理 API + catalog-sync 校验）；② 数据迁移归一化存量 111 行；③ 迁移后可简化 `parseModelTags`
- **验收**：全表 `tags` 均能 `JSON.parse` 为字符串数组；`parseModelTags` 的 CSV/对象分支单测转为「历史兼容」标记

### TD-027 `models.category` 覆盖不足，coding / audio 场景恒不命中
- **严重度**：P2
- **证据**：`category` 分布 —— NULL 73、`chat` 33、`function-calling` 27、`vision` 9、`reasoning` 5；**无 `coding`、无 `audio`**
- **影响**：`sceneToCategory` 的 `coding→coding`、`audio→audio` 映射永远匹配不到行，两个场景的 L2 层为空转；且 50% 模型 category 为 NULL，L2 整体命中率偏低
- **修复**：补齐目录标注（可借 catalog-sync 或一次性脚本按模型能力回填）
- **验收**：`coding` / `audio` 各至少 1 行；`category IS NULL` 占比 < 20%
- **备注**：属**数据缺口**非逻辑缺口 —— 映射已保留，补数据即自动激活

---

## 汇总

| 严重度 | 开放 | 已闭环 | 项 |
|--------|------|--------|----|
| P0 | 0 | 1 | ~~TD-001~~ ✅ |
| P1 | 7 | 2 | TD-010 / 012（含 a/b）/ 013 / 014 / 026 ｜ ~~TD-011~~ ✅ ~~TD-025~~ ✅ |
| P2 | 6 | 0 | TD-020 / 021 / 022 / 023 / 024 / 027 |

### 承接方分派（按 `NPC-ISSUE-freellmapi-merge-改造方案.md` §9.1 边界）

| 承接方 | 项 | 依据 |
|--------|----|------|
| **CNB NPC** | TD-012a / TD-012b / TD-013（仅分析）/ TD-014a / TD-022 / TD-026 / TD-027 | 归属 `router.ts` / `ratelimit.ts` / `guardrails.ts` / `settings.ts` / `db/migrate*` / 数据层 |
| **灰狐（本地）** | TD-010 / TD-014b / TD-020 / TD-021 / TD-023 / TD-024 + **整体验证** | 归属 `proxy.ts` / `anthropic.ts` / `app.ts` / 文档台账 / web2kb；验证不外包 |
| **NPC 事后复核** | TD-001 的 `router.ts` 部分（+141 行，灰狐越界所改） | 见 `NPC-REVIEW-scene-routing-router.md` |

派单文档：`NPC-TASK-tech-debt-dispatch.md`、`NPC-REVIEW-scene-routing-router.md`。

> 注：freellmapi 侧技术债集中在「merge 收尾 + 文档卫生 + **数据层治理**」；web2kb 侧集中在「备份纪律 + 单体拆分 + 测试」。两项目均**无安全级 P0 债**（HMAC/错误脱敏/SECURITY.md 已保全）。
>
> **2026-08-07 变动**：TD-001（P0）、TD-011、TD-025 闭环；新增 TD-025~027 三条数据层债（TD-026 仅读侧缓解，写侧根因开放）；TD-012 完成实测并拆出 a/b 两个可执行子项；全量回归确认场景路由改动**零新增回归**（48→48 失败，通过 +30）。
