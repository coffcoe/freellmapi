# FreeLLMAPI 开发日志

> 与 `CUSTOM-PATCHES.md`（数据/操作台账）互补：本文件专门记录**代码层修改**（文件/函数/行为/原因/验证）。
> 纪律：cb-2102 裁决落地前代码不 commit，本日志是 git 之外的权威留痕。

---

## 2026-09-07 · T1 探活分级 + B-1 健康信号降权 + 巡检体系 + 清理固化

**主题**：运行质量优化闭环（探活审计驱动的清理、路由健康信号、三方一致性巡检、GLM 免费解）。

### 服务端代码（server/src）

| 文件 | 改动 | 原因 | 验证 |
|---|---|---|---|
| `services/health.ts` | ① provider 未注册时不再静默返回 error——写入 `last_health_error = "hard: provider not registered: <platform>"` + 时间戳（可见性，不判 verdict）；② 确认无效（401/403）错误前缀 `hard:`；③ 瞬态网络错误前缀 `soft:` | 原逻辑静默冻结 `last_checked_at`，status 永远 healthy 但路由期失败；分级协议供 B-1 消费 | tsc 0；探活后 dashboard 可见 hard/soft 标记 |
| `services/router.ts` | 新增导出 `platformHealthFactors(db)`：一次查询聚合平台级健康因子——hard: → 0.9（硬降权，不受后续 soft 覆盖）、soft: → 0.98（近似无操作）、无信号 → 1；`scoreChainEntry` 增加 `healthFactors` 参数，因子乘到 reliability 轴 | B-1：硬错误平台应被路由降权，软错误不误伤 | 测试 2 个新用例绿 |
| `__tests__/services/router.test.ts` | +2 测试：① factor 映射（hard 0.9 / soft 0.98 / mixed hard 赢 / clean 缺席）；② bandit 路由对 hard 平台降权（同 rank 双平台） | B-1 回归保护（此前改动零覆盖） | 全量测试 71 绿 |
| `services/catalog-sync.ts` | `counts` 增加 `skippedByPlatform: Record<string, number>`；新增 `bumpSkipped(platform)` 取代 3 处裸 `counts.skippedUnknownPlatform++` | 127 skipped 只见计数看不到平台分布，无法定位（实为 navy 104 等） | dist 重编译含 bumpSkipped；缺口 124/5 平台三源一致 |
| `scripts/free-model-audit.ts` | 报告路径 `Y:/KnowledgeBase-V2` → `F:/KnowledgeBase-V2` | 盘符漂移收敛（Y: 不存在） | 审计报告正常落 F 盘 |
| `db/migrations/20260907_000001_probe_logs_cascade.ts`（新） | probe_logs 外键重建为 `ON DELETE CASCADE`（SQLite 不支持 ALTER 改外键，重建表；幂等守卫：仅当 on_delete != CASCADE） | catalog prune `DELETE FROM models` 触发 FK 约束 → 事务回滚 → catalog_applied_version 卡死（Windows 08.11 / macOS 08.01 根因） | 幂等重跑无副作用 |
| `db/migrate/defaults.ts` | 注册新迁移 `PROBE_LOGS_CASCADE_FILENAME` | 迁移需进 DEFAULT_MIGRATIONS 才执行 | — |

### 巡检/清理脚本（scripts/）

| 文件 | 版本 | 改动 | 验证 |
|---|---|---|---|
| `apply-invalid-models.py` | v5 | MODEL_EOL_PATTERNS 增加 410/end of life/retirement（修 410 不在模式漏网）；fallback 同步 disabled；幂等 | 清理 40+4 模型；dry-run 前置 |
| `platform-quality-audit.py` | — | 探活门禁（🟢62/🟡100/🔴91 首跑） | 报告落 F 盘 |
| `platform-consistency-audit.py` | v1.1 | 新增 ④ 无 key 僵尸检查（keyless 白名单 aihorde + 30 天探活成功动态判断） | 清理 99 僵尸后 0 漂移 exit 0 |
| `catalog-gap-audit.py` | v1 | catalog 缺口统计（缺口 124/5 平台），`--gate` | 与三源一致 |

### 数据/模型层（DB 变更，详见 CUSTOM-PATCHES §4.24–4.35）

- xunfei→xfyun 命名漂移修复（providers/models/api_keys 对齐）
- 清理 40 + 4 EOL + 99 无 key 僵尸 → enabled 252→109
- 摘链 39 disabled；fallback 0 残留；池 109 = 链内 109
- modelscope **GLM-5.2 免费旗舰入池**（实测 200）
- GLM-Free-API（俄）key 53 保留（SSE 不兼容待修）；5.3-Flash 收费实锤（disabled）

### 构建/部署

- `tsc` 0 错误；测试 71 绿；`dist` 重编译（备份 `dist.bak-20260907-t1` / `dist.bak-20260907-xunfei`）
- 服务重启 `Restart-Service FreeLLMAPI`（等 ~15s）；日志 `D:\Users\Yin\TencentDB-Logs\freellmapi-nssm.out.log`

### 未决/接力

- GLM-Free-API SSE 兼容修复（本地转发代理 ~50 行 node）——待用户确认
- 周巡检全链路 cron（`11770531948290`，周一 10:30，首跑 9/14）三脚本 `--gate`
- cloudflare key 39 过期（26 模型休眠）——待用户月度换 key

---

## 2026-09-08 · cloudflare 探活盲区修复（cb-2140）

**问题**：cloudflare alidateKey 只调 /user/tokens/verify（token 活性），token active ≠ 账户 AI 服务可用——坏 key（账户路由 404）永远显示 healthy（假阳性）。

### 代码改动

| 文件 | 改动 | 验证 |
|---|---|---|
| server/src/providers/cloudflare.ts | alidateKey 在 token verify 通过后新增 erifyAccountService() 探测：GET /accounts/{id}/ai/models/search?per_page=1——200 → 真健康；404/403/410/5xx → hard invalid（错误含状态码+上游消息）；传输错误抛给 health.ts → soft（网络不误杀）。新增私有方法 erifyAccountService（10s 超时，记录 quota observations，endpoint i/models/search） | tsc 0；cloudflare.test.ts 8/8 |
| server/src/__tests__/providers/cloudflare.test.ts | 2 个 validateKey 测试断言更新：fetch 调用数 1→2（user-scoped 路径 + models/search）、2→3（fallback 路径 + models/search），新增 calls[1]/calls[2] 含 /ai/models/search?per_page=1 断言 | 8/8 通过 |
| server/src/__tests__/db/migrate/roundtrip.test.ts | EXPECTED_MIGRATION_FILENAMES + 20260907_000001_probe_logs_cascade.ts（TD-012a drift guard，昨日迁移未同步） | roundtrip 4/4 通过 |

### 构建/部署

- 
px tsc 0 错误 → dist 编译（cloudflare.js 含 verifyAccountService）；Restart-Service FreeLLMAPI；3001 在线。
- 全量测试 1884：24 failed 为**环境依赖类**（fusion judge 真实调用 groq 429 / compression 性能预算 / fallback wall-clock），与本次改动无关（改动前即存在，未列入本次范围）。

### 数据侧（CUSTOM-PATCHES §4.36 已记）

- key 39（旧，账户 404）disabled；key 54（新 "gamil"）真健康；kimi-k2.6 + llama-3.2-11b-vision（403）disabled；cloudflare 26 模型 24 可用。

### 验证结果（2026-09-08 11:40 实测）

- **新逻辑直接验证**：key 54 → `TRUE`（token verify + 账户 AI 服务探测双通过，真健康）；key 39 已被服务侧删除（DB 无此行，404 路径由 cloudflare.test.ts 断言覆盖）。
- 服务重启后 3001 在线；cloudflare 24 模型可用。

### 未决

- 修复方案已实施；dashboard/audit 将能暴露同类坏 key（不再永久假阳性）。


---

## 2026-09-08 · Pollinations 匿名通道接入（keyless）

**背景**：用户要求把 Pollinations 配上（原记录"匿名可用"）。实测 2026-09-08：`gen.pollinations.ai/v1` 已要求 API key（匿名 401 "A valid API key is required"）；老端点 `text.pollinations.ai/openai/v1` 仍匿名可用（openai=GPT-5.4-nano 实测 200/556ms）。

### 代码改动

| 文件 | 改动 |
|---|---|
| `server/src/providers/pollinations.ts` | BASE_URL 切 `text.pollinations.ai/openai/v1`（注释记录 gen 需 key 事实 + 未来切回路径）；构造函数加 `keyless: true`（复用 kilo 匿名范式：路由省略 Authorization、sentinel key 不解密） |

### 数据侧（freeapi.db）

- `models`：pollinations/openai（GPT-5.4 Nano，ctx 400k，key_id=NULL，**source='user'**——catalog-sync 用户行保护不删；首插 source='catalog' 被同步删除，教训：用户自定义模型必须 source='user'）
- `api_keys`：pollinations-anon-sentinel（enabled=1，sentinel hex，仿 kilo/llm7 范式）

### 验证

- tsc 0；重启 FreeLLMAPI；路由测试 `model=openai` → **HTTP 200 / 2.4s**（GPT-5.4-nano 回复正常）。
- 老端点仅确认 `openai` 可用（qwen3.8-flash / glm-5.3-flash 404 不支持）。

### 备注

- 若想用 gen 全模型池（300+，GPT-5.6/Claude/Gemini）：注册 `enter.pollinations.ai/keys` 拿 key → 切回 gen BASE_URL + 关 keyless → 模型全量入库。当前匿名单模型够用，未做。
