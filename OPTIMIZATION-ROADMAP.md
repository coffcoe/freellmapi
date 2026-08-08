# 优化路线图 (Optimization Roadmap) — freellmapi + web2kb

> **维度**：代码质量 / 性能 / 可靠性 / 可维护性 / 安全与合规
> **日期**：2026-08-07 ｜ **基线**：merge-upstream @ `df001b2`（`tsc` EXIT 0）
> **配套**：`BUSINESS-LOGIC-PRESERVATION.md`、`TECH-DEBT-INVENTORY.md`

---

## ① 代码质量 (Code Quality)

| 项 | 动作 | 优先级 | 验收（可量化） |
|----|------|--------|---------------|
| 删死代码 | 移除 `stream-handler.ts` / `sticky-session.ts` | P1 | `tsc` EXIT 0 + 无残留 import |
| 补场景路由 | 回填 `detectCategoryScene`/`applyScenePreference` | P0 | 单测 6 场景 + score 偏置生效 |
| 拆单体 | `proxy.ts`/`router.ts` 按职责拆 < 600 行 | P1 | 单文件行数达标 |
| 消 `.bak` | web2kb 用 git 代替工作区 `.bak`，清理 | P2 | `scripts/` 无 `.bak` |
| 去 `any` | 复查残留 `any`（旧 `detectCategoryScene` 用过） | P2 | `tsc --strict` 下 0 新增 `any` |

## ② 性能 (Performance)

| 项 | 动作 | 优先级 | 验收 |
|----|------|--------|------|
| 冷却租约 | 确认上游 in-flight leases（`ratelimit.ts`）已启用，闭合 check-then-act 竞态 | P1 | 并发选 key 无双计成功 |
| `/models` 缓存 | 复用 `routes/cache.ts`，对模型列表响应加 TTL | P2 | 高频 `/models` 命中缓存、DB 压力降 |
| 场景评分 O(n) | 路由链评分已线性，确认无 N² | P2 | 大模型池下 p99 路由延迟稳定 |
| attempt-trace 落库 | 频控 `request_attempts` 写入，避免高频写库 | P2 | 压测下 DB 写吞吐不塌 |

## ③ 可靠性 (Reliability)

| 项 | 动作 | 优先级 | 验收 |
|----|------|--------|------|
| 客户端断开 | `clientGone` + `AbortController` 已健壮（L930-935）；补流式中途断开单测 | P1 | 客户端挂断不泄漏上游连接 |
| 集成测试 | merge-upstream 合入前跑 `npm test`（server+client） | P1 | 全绿，回归覆盖路由/冷却 |
| 健康检查 | `health.ts` probeKeyValidity / markKeyHealthy 已合入，保留 keyless 适配 | P1 | 探活不误杀无 key 模型 |
| cooldown 恢复 | 上游 `cooldown-probe` 与本地 `cleanupExpiredCooldowns` 统一生命周期 | P2 | 冷却恢复可观测、不重复 |

## ④ 可维护性 (Maintainability)

| 项 | 动作 | 优先级 | 验收 |
|----|------|--------|------|
| 文档门禁 | CI 校验 `FREELLMAPI-CODEBASE-REVIEW.md` 等关键文档存在 | P2 | 误删即红 |
| ADR 登记 | 为「保留本地 middleware 链」「场景路由重演」写 ADR | P2 | `docs/adr/` 有记录 |
| 台账同步 | `CUSTOM-PATCHES.md` 标注每项当前状态 | P2 | 9+ 项状态齐全 |
| web2kb 拆模块 | `kb_enhance.py`(71KB) 拆 ingest/enrich/dedup | P2 | 单脚本 < 40KB |
| web2kb 测试 | 引入 `pytest` smoke（distill/dedup 关键路径） | P2 | `pytest` 有基础覆盖 |

## ⑤ 安全与合规 (Security & Compliance)

| 项 | 现状 | 优先级 | 验收 |
|----|------|--------|------|
| HMAC 常量比较 | `timingSafeStringEqual` 已保全（`proxyAuth.ts` 等） | ✅ 已具备 | — |
| 错误脱敏 | `lib/error-redaction.ts` / `log-redaction.ts` 存在 | ✅ 已具备 | — |
| 安全策略 | `SECURITY.md`（#615）已提交 | ✅ 已具备 | — |
| 密钥管理 | `.env` 勿入库；建议密钥经 `credential-vault` | P2 | `.gitignore` 覆盖 `.env`；无明文密钥提交 |
| 客户端标识 | `client-context` + `clientTag` 双轨需厘清边界（TD-013） | P1 | analytics 无重复计数 |
| web2kb 外部调用 | 抓取/API 走代理与超时；建议登记出网白名单 | P2 | 无任意 URL 直连泄露内网 |

---

## 优先级总览（先做什么）

1. **P0**：TD-001 场景路由回填（核心理念）
2. **P1**：TD-010 死代码 / TD-012 集成测试 / TD-013 标识边界 / ①拆单体 / ③clientGone 单测
3. **P2**：文档门禁 / ADR / 台账同步 / web2kb `.bak`+测试+拆分 / 密钥 vault

> **二分标注**：以上「✅ 已具备」为执行层实测（grep/git）；其余为规则层建议，待执行层验收。
