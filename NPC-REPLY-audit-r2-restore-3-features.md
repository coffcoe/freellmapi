# NPC 派单回执 · freellmapi 3 项自定义功能 v0.7.0 风格重写

> 派单：灰狐 🦊（2026-08-13）｜ 执行：CNB-NPC ｜ 分支：`npc/audit-r2-restore-features` ｜ 基准：cnb/main @ `73a6eee`
> 提交：`0058601`

## 对齐契约 · freellmapi 3 项自定义功能 v0.7.0 风格重写

- **目标**：按上游方式重写实现 `filterHighValueIfLarge` / `truncateMessagesForGithub` / `notifyTracker` 的等价功能
- **验收**：
  - `npm run build:server` ✅ **0 错误**
  - 3 项功能测试全过（见下方测试证据）
  - `git diff cnb/main..分支 --stat` 仅目标文件 + 测试，无删除、无安全回退
  - 无明文密钥
  - 无迁移注册遗漏（未新增迁移）
- **证据**：分支 diff + vitest stdout + 每项实现说明
- **负责人**：CNB-NPC（实现）+ 灰狐（终审）

---

## 实现说明（按功能）

### 任务 1：高价值模型保护（P1-b，原 `filterHighValueIfLarge`）

- **实现方式**：上游 `router.ts` 的评分/过滤管道风格（对比 `routeRequest` 内既有 capability 门（vision/tools/context/TPM）+ `model-retirement.ts` / `model-weight-overrides.ts` 的纯函数+导出测试风格）。
- **改动**：
  - `ChainRow` 增加 `is_high_value` 字段；8 处链构建 SELECT（`getActiveChain` 双分支 / `getChainByProfileName` / `getChainByGlobalSort` / `getModelChainRow` / `resolveModelGroupCandidates` 双分支 / `routeRequest` pinnedRow）均补 `m.is_high_value`。
  - 新增 `HIGH_VALUE_INPUT_THRESHOLD = 20000` 与纯函数 `filterHighValueIfLarge(chain, estimatedTokens)`：`estimatedTokens > 阈值` 时剔除 `is_high_value=1`；若剔除后链空则保留原链；小请求原样返回。
  - 在 `routeRequest` 链构建处调用，使 `models.is_high_value` 列真正接入路由链（此前运行时零引用，仅迁移残留）。
- **效果**：大输入请求不再烧稀缺免费模型的珍贵额度；显式 pinned 模型仍可达（pin 在过滤后注入）。
- **测试**：`server/src/__tests__/services/high-value-model.test.ts`（6 用例：纯函数 4 + routeRequest 集成 2）。

### 任务 2：github 输入截断护栏（P2/⚠️修复，原 `truncateMessagesForGithub`）

- **实现方式**：上游 `sampling-params.ts` 的 per-provider 参数表 + `resolveMaxTokens` 统一封顶模式；输入截断并入 `proxy.ts` 现有 dispatch 管道（`outboundMessages` per-attempt 拷贝）。
- **改动**：
  - `lib/content.ts` 新增 `truncateMessagesForGithub(messages, budget=GITHUB_MAX_INPUT_TOKENS=7500)`：chars/4 估算，保留 system prompt + 最新上下文，单条超限就地截断文本（数组/图像块不动），已在预算内则返回原数组（非 github 平台零开销）。
  - `proxy.ts` 主 `/chat/completions` 与 legacy `/completions` 的 dispatch 中，当 `route.platform === 'github'` 时对 outbound 消息调用截断，消灭 413。
  - `sampling-params.ts` 新增 per-platform `maxTokensCap` 字段 + `GITHUB_MAX_OUTPUT_TOKENS=400`，github 策略启用，`resolveMaxTokens` 取平台封顶与运营统一封顶的较紧者 → 消灭 400。
- **效果**：github 上游硬限（输入≤8000→413、max_tokens 受限→400）双端被护栏覆盖。
- **测试**：`content.test.ts` 新增 `truncateMessagesForGithub` 块（6 用例）；`unified-max-tokens.test.ts` 新增 github 封顶块（5 用例）。

### 任务 3：token tracker 通知（P2-a，原 `notifyTracker`）

- **实现方式**：并入上游 `request-log.ts` 现有日志管道（对比其 `logRequest` 事务 + 失败静默的健壮模式）。**采用新方案（并入 request-log 管道 + 环境变量化 tracker URL）而非强求外部 3003 服务固定地址**——理由：
  1. 原功能硬编码 `localhost:3003` 且依赖仓库外 Flask 组件（`tracker.py` 不在本仓库，`CUSTOM-PATCHES §3.4` 明确标注）；按派单「若上游有更优的追踪/埋点模式则采用」精神，并入既有 `logRequest` 管道可复用同一事务时机、且把 tracker 地址参数化（`TOKEN_TRACKER_URL`），默认仍指向历史 `http://localhost:3003/api/log`，行为兼容但更可控。
  2. 非阻塞 + 300ms 超时 + 失败静默语义完整保留，且可从 env 关闭（`''`/`off`），缺失 tracker 零影响。
- **改动**：`lib/request-log.ts` 新增 `notifyTracker` + `effectiveTrackerUrl` + `TrackerPayload`；`logRequest` 在成功且有 token 的请求末尾 fire-and-forget 调用（不 await）。
- **测试**：`server/src/__tests__/lib/request-log-tracker.test.ts`（7 用例：URL 默认/覆盖/禁用、payload 形状、失败静默、300ms 超时 abort）。

---

## 约束核对

| 约束 | 状态 |
|---|---|
| 仅实现 3 项 | ✅ 未改其他业务代码 |
| 禁碰 .cnb.yml/governance/CUSTOM-PATCHES.md/panshi/verify-cnb-merge.sh | ✅ 未触碰 |
| 无明文密钥 | ✅ grep 无命中 |
| 迁移纪律 | ✅ 未新增迁移（`is_high_value`/`client_tag` 已由 `20260802_000000_quota_guard_columns.ts` 提供并注册进 defaults.ts + 可逆 down()） |
| push 到 npc/audit-r2-restore-*，不直推 main | ✅ `npc/audit-r2-restore-features` |
| 不删历史文件 | ✅ 无删除（locale-config.ts 等保留） |

## 验收证据

- `npm run build:server` → tsc 0 错误
- 目标测试（vitest，`--pool=forks --fileParallelism=false`）：`content.test.ts` 30 ✅、`unified-max-tokens.test.ts` 16 ✅、`request-log-tracker.test.ts` 7 ✅、`high-value-model.test.ts` 6 ✅、`router.test.ts` ✅（合计 71 用例全过）
- 全量 server 测试：2300 ✅ / 8 ❌（❌ 均在 `ratelimit-local-endpoint` / `ratelimit-cooldown-error-kind` / `guardrails`，为**基准 73a6eee 已存在的 pre-existing 失败**，与本次改动无关——已用 `git stash` 对照复现验证）
- `git diff cnb/main..HEAD --stat`：9 文件，569 增 8 删，无删除、无禁碰文件

## 待续接
灰狐审核 → 开 PR → 领航员批准 → 合入 → 派磐石 T6 同步
