# 技术债盘点清单 (Tech-Debt Inventory) — freellmapi merge-upstream

> **分支**：`merge-upstream` @ `df001b2` ｜ **日期**：2026-08-07
> **严重度**：P0 阻断核心理念 / P1 应修 / P2 待办
> **配套**：`BUSINESS-LOGIC-PRESERVATION.md`、`OPTIMIZATION-ROADMAP.md`

---

## P0 — 阻断核心理念保全

### TD-001 场景路由业务逻在重构中丢失
- **位置**：原 `server/src/routes/proxy.ts` L295-466 / L1433-1466；`df001b2` 删除
- **证据**：`git log -S detectCategoryScene` → `df001b2`；新 `proxy.ts` 对 `sceneToCategory`/`detectSceneTags`/`score +=` 0 命中
- **影响**：失去「按请求语义软偏好模型」+ L3 场景标签（free-tier/long-context/low-latency/compliance）评分；本地 fork 智能路由核心特性缺失
- **修复**：见 `BUSINESS-LOGIC-PRESERVATION.md` §3.3（前置计算 + `applyScenePreference` 注入，不回退 for 循环）
- **验收**：单测覆盖 6 场景识别 + score 偏置；`tsc` EXIT 0；回归确认 `filterHighValueIfLarge` 不冲突

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

### TD-012 merge 后未跑集成测试验证
- **证据**：仅做了 `tsc --noEmit`（类型层）；`npm test` 未在 merge-upstream 实测
- **影响**：运行时回归（如场景路由丢失）类型检查无法发现
- **修复**：merge-upstream 合入前跑 `npm test`（server + client）
- **验收**：`npm test` 全绿

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

## 汇总

| 严重度 | 数量 | 项 |
|--------|------|----|
| P0 | 1 | TD-001 |
| P1 | 4 | TD-010 / 011 / 012 / 013 / 014（注：实际 5 条，含 TD-014）|
| P2 | 5 | TD-020 / 021 / 022 / 023 / 024 |

> 注：freellmapi 侧技术债集中在「merge 收尾 + 文档卫生」；web2kb 侧集中在「备份纪律 + 单体拆分 + 测试」。两项目均**无安全级 P0 债**（HMAC/错误脱敏/SECURITY.md 已保全）。
