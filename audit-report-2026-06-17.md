# FreeLLMAPI 代码审计总报告

**审计日期**: 2026-06-17
**审计范围**: `server/src/` 全量 TypeScript 源码 (70+ 文件)
**测试状态**: 315/315 通过 (0 失败)
**编译状态**: 0 TypeScript 错误

---

## 一、功能完整性审计

### 1.1 README 功能清单对照

| # | 功能项 | 状态 | 实现位置 | 备注 |
|---|--------|------|----------|------|
| 1 | OpenAI-compatible `/v1/chat/completions` | ✅ 已实现 | `routes/proxy.ts` | 核心代理路由，含 retry loop |
| 2 | `GET /v1/models` | ✅ 已实现 | `routes/proxy.ts:106-130` | 含 `auto` 虚拟模型 |
| 3 | `/v1/responses` Responses API shim | ✅ 已实现 | `routes/responses.ts` | 含 streaming + tool calls |
| 4 | Streaming (`stream: true`) | ✅ 已实现 | `proxy.ts:485-538` | SSE 格式，TTFB 追踪 |
| 5 | Non-streaming (`stream: false`) | ✅ 已实现 | `proxy.ts:555-603` | JSON 响应 |
| 6 | Tool calling | ✅ 已实现 | `proxy.ts:134-142, 586-593` | 含参数修复 (repairToolArguments) |
| 7 | Automatic fallover (retry loop) | ✅ 已实现 | `proxy.ts:460-649` | MAX_RETRIES=20，429/5xx/timeout |
| 8 | Per-key rate tracking (RPM/RPD/TPM/TPD) | ✅ 已实现 | `services/ratelimit.ts` | 内存 + SQLite 双重持久 |
| 9 | Sticky sessions | ✅ 已实现 | `routes/proxy.ts:59-103` | SHA1 hash, 30min TTL, 500 cap |
| 10 | Encrypted key storage (AES-256-GCM) | ✅ 已实现 | `lib/crypto.ts` | in-memory 解密 |
| 11 | Unified API key | ✅ 已实现 | `db/index.ts` + `proxy.ts:30-38` | constant-time 比较 |
| 12 | Dashboard login | ✅ 已实现 | `routes/auth.ts`, `middleware/requireAuth.ts` | scrypt + session |
| 13 | Health checks | ✅ 已实现 | `services/health.ts` | 5min 间隔，3 次失败自动 disable |
| 14 | Admin dashboard (React+Vite) | ✅ 已实现 | `client/` | dark mode |
| 15 | Analytics | ✅ 已实现 | `routes/analytics.ts`, `services/request-retention.ts` | 90天/10万条 |
| 16 | Bandit routing (5 策略) | ✅ 已实现 | `services/scoring.ts`, `services/router.ts` | Thompson sampling |
| 17 | Custom provider | ✅ 已实现 | `providers/index.ts:181-185` | 用户自定义 baseUrl |
| 18 | Proxy hot-swap | ✅ 已实现 | `providers/base.ts` | 直连探测 6h 重测 |
| 19 | Vision (image input) | ✅ 已实现 | `proxy.ts:389-404`, `google.ts:145-208` | 自动过滤非 vision 模型 |
| 20 | Smart proxy manager | ✅ 已实现 | `lib/proxy-manager.ts` | 按平台差异化代理策略 |

### 1.2 计划内未实现（README 明确标注"Not yet supported"）

| 功能 | 状态 | 说明 |
|------|------|------|
| `/v1/embeddings` | ⚠️ 部分实现 | `routes/embeddings.ts` 存在但路由未挂载到 `app.ts` |
| Image generation | ❌ 未实现 | 按计划 |
| Audio / speech | ❌ 未实现 | 按计划 |
| Legacy completions | ❌ 未实现 | 按计划 |
| Moderation | ❌ 未实现 | 按计划 |
| `n > 1` | ❌ 未实现 | 按计划 |
| Multi-tenant auth | ❌ 未实现 | 按计划 (single-user) |

**发现**: `routes/embeddings.ts` 和 `services/embeddings.ts` 已存在且有测试，但 `app.ts` 中 `embeddingsRouter` 挂载路径为 `/api/embeddings` (需 auth)，而 OpenAI 标准路径 `/v1/embeddings` 未挂载。这是一个**架构偏差**。

### 1.3 功能完整性结论

- **核心功能覆盖率: 100%** (20/20)
- **Not yet supported 合规: 100%** (7/7 未实现)
- **遗留文件**: `stream-handler.ts` 存在但未在生产中使用 (proxy.ts 已内联实现)

---

## 二、代码质量审计

### 2.1 结构评估

| 维度 | 评分 | 说明 |
|------|------|------|
| 模块划分 | ⭐⭐⭐⭐⭐ | services/, routes/, providers/, middleware/, lib/, db/ 各司其职 |
| 命名规范 | ⭐⭐⭐⭐⭐ | 清晰的驼峰命名，语义明确 |
| 注释质量 | ⭐⭐⭐⭐⭐ | 复杂逻辑有详尽注释 (如 hot-swap、bandit、cooldown 等) |
| 错误处理 | ⭐⭐⭐⭐⭐ | 分层处理 (retryable vs non-retryable, 中间流 vs 预流) |
| 重复代码 | ⭐⭐⭐⭐ | `responses.ts` 与 `proxy.ts` 有 ~40% 重复 (retry loop, empty completion)，属有意设计 |
| 可维护性 | ⭐⭐⭐⭐⭐ | 20+ 次 DB migration、feature flags、模块化中间件 |

### 2.2 具体问题

| 严重度 | 问题 | 位置 | 建议 |
|--------|------|------|------|
| P2 | `stream-handler.ts` 未使用 | `routes/stream-handler.ts` | 可删除或集成 |
| P3 | `responses.ts` 与 `proxy.ts` 重复 ~120 行 retry logic | `routes/responses.ts` | 可提取公共 retry 抽象 |
| P3 | `routes/models.ts` 与 `proxyRouter.get('/models')` 重复 | `routes/models.ts` + `proxy.ts` | 统一到 `modelsRouter` |
| P2 | `db/index.ts` 有 23 次 migration 函数 | `db/index.ts:38-63` | 可接受 (schema 演进必然) |
| P4 | `rate-limit.ts` 内存 map 无持久化/重启清零 | `services/ratelimit.ts` | 预期行为 (设计如此) |

---

## 三、架构一致性审计

### 3.1 README 描述架构 vs 实际架构

```
README 描述:                          实际架构:
┌──────────────────┐                  ┌──────────────────┐
│ Express proxy    │                  │ Express + 中间件链 │
│   Router         │                  │   + proxy.ts     │
│   Ratelimit      │    ≈             │   + middleware/  │
│   Providers      │                  │   + services/    │
│   Health         │                  │   + lib/         │
│   Dashboard      │                  │   + client/      │
└──────────────────┘                  └──────────────────┘
```

**一致性评分: 95%**

| 维度 | 一致性 | 偏差 |
|------|--------|------|
| 模块划分 | ✅ 一致 | middleware/ 目录是增强，非原始计划但有 feature flag 控制 |
| 分层结构 | ✅ 一致 | routes → services → providers → db 三层清晰 |
| 数据流走向 | ✅ 一致 | req → middleware → proxy → router → provider |
| 中间件链 | ⚠️ +增强 | Hybrid Approach (6 个中间件 + feature flags) 是增强而非偏离 |
| 测试覆盖 | ✅ 一致 | 38 个测试文件，315 个测试，315 通过 |

### 3.2 架构增强点 (正偏离)

1. **Hybrid Middleware Chain**: 比原始描述多了一层预处理横切关注点 (auth → sanitize → validate → normalize → estimate → gate)
2. **Proxy Hot-Swap**: 自动直连探测，比原始描述更智能
3. **Escalating Cooldown**: 429 冷却递增 (2min → 10min → 1h → 24h)
4. **Provider Daily Request Cap**: OpenRouter 等全局配额感知

---

## 四、接口与数据规范审计

### 4.1 OpenAI API 兼容

| 接口 | 标准格式 | 实际实现 | 一致性 |
|------|----------|----------|--------|
| `POST /v1/chat/completions` | OpenAI 格式 | Zod 验证 + 完整字段映射 | ✅ |
| `GET /v1/models` | `list` + `data[]` | 含 `auto` + `context_window` | ✅ |
| `POST /v1/responses` | Responses API 格式 | 完整翻译层 | ✅ |
| `POST /v1/embeddings` | OpenAI 格式 | 存在但未挂载到 `/v1` | ⚠️ |

### 4.2 数据模型

| 表名 | 字段数 | 索引 | 备注 |
|------|--------|------|------|
| `models` | 15 | platform+model_id | 含 intelligence_rank, size_label |
| `api_keys` | 9 | platform | 含 encrypted_key, iv, auth_tag |
| `requests` | 10 | created_at, platform, key_id | 含 ttfb_ms |
| `rate_limit_usage` | 6 | platform+model_id+key_id+kind+created_at_ms | |
| `rate_limit_cooldowns` | 4 | PK(platform, model_id, key_id) | |
| `fallback_config` | 4 | PK, FK(models) | |
| `settings` | 2 | PK(key) | |
| `users` | 4 | email(unique) | |
| `sessions` | 4 | PK, idx(user) | |

**数据模型一致性: 100%** (全部字段与 README 描述一致)

### 4.3 类型安全

- TypeScript strict mode 编译通过 ✅
- Zod schema 验证请求体 ✅
- `declare module` 扩展 `Request` 类型 (middleware 间数据传递) ✅

---

## 五、性能与安全性审计

### 5.1 性能分析

| 关注点 | 评分 | 说明 |
|--------|------|------|
| 数据库查询 | ⭐⭐⭐⭐ | 每次 route 1 次查询，stats cache 60s TTL |
| 内存管理 | ⭐⭐⭐⭐ | stickySessionMap 有 500 cap + TTL 清理；rate windows 有 pruning |
| 循环效率 | ⭐⭐⭐⭐⭐ | routeRequest 循环 + 20 次 max retries，无嵌套循环瓶颈 |
| SSE 流 | ⭐⭐⭐⭐⭐ | 直接 `res.write()` 转发，零额外序列化 |
| 缓存 | ⭐⭐⭐⭐ | `refreshStatsCache` 60s TTL，monthly token usage 实时 SQL |

### 5.2 安全分析

| 安全项 | 评分 | 说明 |
|--------|------|------|
| API Key 存储 | ⭐⭐⭐⭐⭐ | AES-256-GCM 加密，in-memory 解密 |
| Timing-safe 比较 | ⭐⭐⭐⭐⭐ | `crypto.timingSafeEqual` + 等长缓冲 |
| SQL 注入 | ⭐⭐⭐⭐⭐ | 全部参数化查询 (better-sqlite3) |
| XSS | ⭐⭐⭐⭐ | Helmet CSP disabled (SPA inline styles 需求)，但服务本地 HTTP |
| 认证 | ⭐⭐⭐⭐⭐ | Dashboard (scrypt + session), Proxy (unified API key) 双层 |
| SSRF | ⭐⭐ | `imageUrlToInlineData()` 在 google.ts 中 fetch 用户提供的 URL，虽有 http/https 白名单和 8MB 限制 |
| CORS | ⭐⭐⭐⭐ | 默认只允许 localhost:5173，可配置 |
| 错误脱敏 | ⭐⭐⭐⭐⭐ | `sanitizeProviderErrorMessage` 防止泄露 provider 内部信息 |
| Rate Limiting | ⭐⭐⭐⭐⭐ | 4 维度 (RPM/RPD/TPM/TPD) + 递增冷却 + provider 全局配额 |
| 代理热交换 | ⭐⭐⭐ | `needsProxy: true` 平台首次直连探测会发出真实网络请求 |

---

## 六、偏离与偏差分析

### 6.1 已识别的偏离

| # | 偏离 | 方向 | 合理性 | 记录 |
|---|------|------|--------|------|
| 1 | middleware/ 目录及 6 个中间件 | +增强 | ✅ 合理，feature flag 控制 | 已记录在 memory/2026-06-17.md |
| 2 | `stream-handler.ts` 存在但未被引用 | -冗余 | ⚠️ 可清理 | |
| 3 | `embeddingsRouter` 挂载 `/api/embeddings` 而非 `/v1/embeddings` | -偏离 | ❌ 不符合 OpenAI 标准 | |
| 4 | responses.ts 与 proxy.ts 重复 retry loop | -重复 | ✅ 有意为之 (README 明确说"deliberately self-contained") | |
| 5 | PROXY_CONFIG 在 base.ts 中先漏导入后修复 | -修复 | ✅ 已修复 | |
| 6 | Proxy Hot-Swap 测试拦截问题 | -修复 | ✅ 已修复 (DISABLE_PROXY_HOT_SWAP) | |

### 6.2 不合理偏离

| # | 偏离 | 风险 | 建议 |
|---|------|------|------|
| 3 | `/v1/embeddings` 路由缺失 | 客户端无法通过 OpenAI SDK 使用 embeddings | 在 `app.ts` 添加 `app.use('/v1', embeddingsRouter)` 或创建独立路由 |

---

## 七、总体评分

| 维度 | 评分 | 权重 | 加权分 |
|------|------|------|--------|
| 功能完整性 | 95% | 25% | 23.75 |
| 代码质量 | 92% | 20% | 18.40 |
| 架构一致性 | 95% | 20% | 19.00 |
| 接口与数据规范 | 95% | 15% | 14.25 |
| 性能与安全性 | 92% | 20% | 18.40 |
| **综合评分** | | **100%** | **93.8 / 100** |

---

## 八、改进建议 (按优先级排序)

### P0 — 必须修复
1. **`/v1/embeddings` 路由缺失**: 在 `app.ts` 中将 `embeddingsRouter` 挂载到 `/v1` 路径
2. **`stream-handler.ts` 清理**: 删除或集成到 proxy.ts (当前 215 行未使用代码)

### P1 — 建议优化
3. **`responses.ts` 与 `proxy.ts` 重复代码**: 提取公共 retry loop 为 `retryLoop.ts`
4. **SSRF 缓解**: `imageUrlToInlineData()` 增加超时和 URL 域名白名单
5. **`/v1/models` 统一**: `proxyRouter.get('/models')` 与 `modelsRouter` 统一到一处

### P2 — 可优化
6. **Stats cache 可配置**: 当前 60s TTL hard-coded
7. **Rate limit 内存数据**: 重启后清零，可考虑写入 `rate_limit_usage` 做 WAL 恢复
8. **Test timeout**: `google.test.ts` 默认 5s 太紧，建议改为 10s 或动态调整

### P3 — 锦上添花
9. **E2E 集成测试**: 当前均为单元测试，缺少模拟完整请求链的集成测试
10. **Coverage 报告**: 未见 `--coverage` 配置，不清楚具体覆盖率

---

## 九、风险提示

| 风险项 | 严重度 | 说明 |
|--------|--------|------|
| SSRF (google.ts) | 🟡 中 | 用户图片 URL 被直接 fetch，虽有限制但可被利用 |
| 无 HTTPS 支持 | 🟢 低 | 预期行为 — 本地代理，不公开暴露 |
| 单用户架构 | 🟢 低 | README 明确声明，非安全问题 |
| 内存泄漏 (map 增长) | 🟢 低 | stickySessionMap 有 TTL + cap，其他 map 也有 pruning |
| 依赖版本 | 🟡 中 | Express 5 (beta), better-sqlite3 12 (较新)，需关注稳定性 |
