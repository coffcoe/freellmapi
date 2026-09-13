# FreeLLMAPI 自定义改动全量台账（CUSTOM-PATCHES）

> **目的**：从 GitHub 部署到本地起，记录 freellmapi 所有**非上游的自定义改动**——含优化得好（✅）与改出问题（⚠️/🔴）的，均留痕，防止：
> ① `git pull/merge/rebase upstream` 或 `git reset --hard upstream/main` 后丢失；
> ② 改出 BUG 时无法快速回滚或定位根因。
>
> **标签约定**：✅ 优化(好) ｜ ⚠️ 问题(已修/已缓解) ｜ 🔴 风险(未决，需处理)
> **本文件本身需保护**：当前是 untracked，随 `git clean -f` 会丢。请 `git add` 它，或在 `~/.workbuddy/MEMORY.md` 保留指针（已加）。

---

## 0. 上游同步安全流程（必读）

freellmapi 已配 `upstream = tashfeenahmed/freellmapi`（本仓库是从该上游 fork 后长期本地定制）。当前 `main` 上有大量**未提交**自定义改动。同步上游前：

```bash
cd C:/Users/coffcoe/freellmapi
git stash                                          # 暂存全部未提交改动（tracked）
git fetch upstream && git merge upstream/main      # 拉上游；冲突 = 上游动了同一处
git stash pop                                      # 取回自定义改动
# 取回后逐项 grep §7 的漂移标记，确认未被覆盖
```

**不要做**：❌ `git reset --hard upstream/main` ｜ ❌ `git clean -f`（会删本台账）｜ ❌ `git add .` / `commit -a`（扫入他人/历史改动）。
**推荐长期姿势**：把自定义改动 commit 到独立分支（如 `custom`），`main` 仅 `merge upstream/main` + `merge custom`，每次同步可追溯、可回退。

---

## 1. 总览（2026-08-02 实测）

| 维度 | 值 |
|---|---|
| DB 模型总数 | 140 |
| `is_high_value=1`（稀缺配额模型） | 17（google4/cohere9/github1/openrouter3，由 P1-b 数据侧标记） |
| 设了 `rpd_limit` 上限的平台 | 14（nvidia12/cloudflare11/openrouter22/google6/cohere9/groq7/modelscope4/cline3/opencode4/xunfei3/custom1/github1/bazaarlink1/routeway2）——P0 FLA-RPD 本地每日上限 |
| github embedding | id 6/7 已禁用（P1-a） |
| 累计请求日志 | 32,245 条 |
| git 已提交自定义 commit | 多笔（见 §2） |
| 未提交 tracked 改动 | 16 文件 / +505 −76 行（见 §3） |
| 未跟踪自定义文件 | 见 §4（2 个迁移 🔴→✅ 已于 2026-08-02 注册并加 PRAGMA 守卫） |

---

## 2. 已提交自定义历史（git log，随 commit 存活，上游 merge 不丢）

以下为 `main` 上的自定义 commit（非纯上游），均为 ✅ 优化。同步上游时经 merge commit `1971774`（Merge upstream/main）保留：

| commit | 内容 | 性质 |
|---|---|---|
| `e5024d5` | `feat(routing): add guardrails layer - request budget + circuit breaker (策略24)` | ✅ 护栏层（P1-c 熔断的提交版，工作树在此基础上迭代） |
| `f4cd7b4` | `Add catalog controls, persistence backup, and declarative config` | ✅ catalog 控制 + 持久化备份（`fallback_config_backup` 表来源） |
| `bc07927` | `Add router penalty inspector` | ✅ 路由惩罚检视工具 |
| `1fdcae4` | `feat: add AI Horde provider (#345)` | ✅ 新增 AI Horde provider |
| `441dc92` | `feat: manage custom models from keys page (#327)` | ✅ 密钥页管理自定义模型 |
| `5918efc` | `feat(key-import): add provider key import flow` | ✅ provider key 导入流 |
| `8c9cf94` | `fix(ratelimit): escalate NULL-limit providers via hit-count heuristic (#392)` | ✅ 限流启发式（后由 §3 的 `NO_LIMIT_COOLDOWN_CAP_MS` 强化） |
| `d1943a8` | `refactor: add runtime-capability guards and centralize Config (#375)` | ✅ 运行时能力守卫 + Config 集中（config.ts 源头） |
| `a8cdc3d` | `feat(embeddings): accept optional dimensions parameter for MRL truncation (#393)` | ✅ embedding 维度参数 |
| `055c166` | `feat(analytics): durable hourly aggregates + lifetime counters survive raw-row prune (#410)` | ✅ 分析聚合持久化（对应 `request_hourly` 表） |
| `4133cc4` | `fix(google): strip x-* schema extensions for Gemini` | ✅ Google 适配 |
| `a3c8838` | `fix(proxy): surface provider 400 exhaustion as invalid request` | ✅ 错误语义 |
| `c2f1dee` / `fa0fe5b` | `fix: clean up keys and model UI` / `correct GitHub context and usage display` | ✅ UI/显示修正 |
| `1971774` | `Merge upstream/main into local main (v0.4.1 + 50+ commits)` | — 上游合入点 |

> 未逐 commit diff 核验（已提交、随 git 存活）。如需某笔精确改动，用 `git show <hash>`。

---

## 3. 未提交工作树改动（tracked `M`，本会话 + 历史累计，均未 commit）

每行：文件 · 标记(grep) · 作用 · 标签 · 回滚 · 漂移检测。

### 3.1 `shared/types.ts` · `+ 'cline' | 'modelscope'`
- 标记：`| 'cline'` / `| 'modelscope'`
- 作用：新增 Cline.bot / ModelScope 两个平台类型（配合 §3.6 provider 注册）。
- 标签：✅ 优化 ｜ 回滚：`git checkout shared/types.ts` ｜ 漂移：`grep -n "modelscope" shared/types.ts`

### 3.2 `server/package.json` · `build: tsc && cp -r src/docs dist/docs`
- 标记：`cp -r src/docs dist/docs`
- 作用：构建时把 `src/docs` 拷进 `dist`（供 config 路由/文档读取）。
- 标签：✅ 优化(小) ｜ 回滚：改回 `"build": "tsc"` ｜ 漂移：`grep -n "cp -r src/docs" server/package.json`

### 3.3 `server/src/db/migrate/defaults.ts` · 注册 `quota_guard_columns`
- 标记：`QUOTA_GUARD_COLUMNS_FILENAME` (L24) + `DEFAULT_MIGRATIONS` 数组项 (L32)
- 作用：注册本会话新增迁移（§4.3）。
- 标签：✅ 优化 ｜ 回滚：删 L24/L32 ｜ 漂移：`grep QUOTA_GUARD_COLUMNS server/src/db/migrate/defaults.ts`

### 3.4 `server/src/lib/request-log.ts` · `clientTag` + `notifyTracker`
- 标记：`clientTag: string | null = null` (L59) + `notifyTracker(` (L92 起) + `http://localhost:3003/api/log`
- 作用：① `logRequest` 新增 `clientTag` 参数写入 `requests.client_tag`（P2-a 溯源）；② 成功且有 token 的请求**非阻塞** POST 到本地 token tracker（端口 3003，Flask），300ms 超时上限、失败静默。
- 标签：✅ 优化（新增 tracker 集成，依赖外部 3003 服务，缺失不影响主流程）｜ 回滚：`git checkout server/src/lib/request-log.ts` ｜ 漂移：`grep -n "notifyTracker\|clientTag" server/src/lib/request-log.ts`
- ⚠️ 注意：依赖 `localhost:3003` 的 tracker.py（外部组件，不在本仓库）；该服务未运行时不报错、零影响。

### 3.5 `server/src/middleware/proxyAuth.ts` · `timingSafeStringEqual` 重写
- 标记：`crypto.createHmac('sha256', key)` (L62 起)
- 作用：原实现对不齐长度走 `Buffer.alloc` 仍有**长度分支时序泄露**；改为 HMAC 固定长度摘要后 `timingSafeEqual`，消除两种泄露。
- 标签：✅ 优化(安全修)（原实现是 ⚠️ 问题，已修）｜ 回滚：`git checkout server/src/middleware/proxyAuth.ts` ｜ 漂移：`grep -n "createHmac" server/src/middleware/proxyAuth.ts`

### 3.6 `server/src/providers/index.ts` · OpenRouter 健康修复 + agnes + 两新 provider
- 标记：
  - `validateUrl: 'https://openrouter.ai/api/v1/key'` (L55)
  - `baseUrl: 'https://apihub.agnes-ai.cn/v1'` (L206，原 `.com`)
  - `platform: 'cline'` / `platform: 'modelscope'`（新增注册）
- 作用：① OpenRouter 原 `validateUrl` 用 `/models`（**公开端点，垃圾 key 也返 200**），导致健康状态**虚高**——key 30 在真实补全返回 401「User not found」数周但状态一直 healthy（2026-07-29 证实）；改为需鉴权的 `/api/v1/key`；② agnes 域名 `.com`→`.cn`；③ 新增 Cline.bot（1M 上下文免费）、ModelScope（魔搭，2000 req/日免费）。
- 标签：✅ 优化 + ⚠️ 修复(OpenRouter 虚高健康) ｜ 回滚：`git checkout server/src/providers/index.ts` ｜ 漂移：`grep -n "api/v1/key\|agnes-ai.cn\|platform: 'cline'" server/src/providers/index.ts`

### 3.7 `server/src/routes/models.ts` + `server/src/services/model-listing.ts` · 列表字段扩充
- 标记：`category:` / `lastVerifiedAt:` / `probeStatus:` / `rateLimit:` / `tier:` / `requiresCreditCard:`
- 作用：模型列表新增 类目 / 最后验证时间 / 探测状态 / 限流摘要 / 付费层级 / 是否需信用卡 字段（供前端 + config 路由消费）。
- 标签：✅ 优化 ｜ 回滚：`git checkout` 两文件 ｜ 漂移：`grep -n "requiresCreditCard" server/src/services/model-listing.ts`

### 3.8 `server/src/services/catalog-sync.ts` · `rpd_limit` 治本（P2-b）
- 标记：`rpd_limit 治本, #P2-b` 注释 (L177) + UPDATE 的 SET 已**不含** `rpd_limit`（L181-191）
- 作用：上游 catalog 对 nvidia/cloudflare 等 `rpd_limit=null`，若 applyCatalog 的 UPDATE 带该列会**清掉 P0 设的本地每日上限**。故 UPDATE 排除 `rpd_limit` 与 `raw_capabilities`/`capability_sources`（本地能力数据），仅 INSERT 新模型时用 catalog 默认。
- 标签：✅ 优化 / ⚠️ 修复(P2-b，详见 §6.2) ｜ 回滚：`git checkout server/src/services/catalog-sync.ts`（回滚后 catalog 会再覆盖本地上限）｜ 漂移：`grep -n "rpd_limit 治本" server/src/services/catalog-sync.ts`

### 3.9 `server/src/services/ratelimit.ts` · 无上限免费 provider 冷却封顶
- 标记：`NO_LIMIT_COOLDOWN_CAP_MS = 10 * 60 * 1000` (L309) + `heuristicallyExhausted ? NO_LIMIT_COOLDOWN_CAP_MS`
- 作用：cloudflare/ollama/nvidia 等无文档日限额的 provider 在突发 RPM 抖动时狂返 429，原逻辑会把它们抬进 24h 死亡冷却并**级联**到高流量消费者；改为封顶 10min 的有界保护冷却。
- 标签：✅ 优化 / ⚠️ 修复(原 24h 级联惩罚，详见 §6.4) ｜ 回滚：`git checkout server/src/services/ratelimit.ts` ｜ 漂移：`grep -n "NO_LIMIT_COOLDOWN_CAP_MS" server/src/services/ratelimit.ts`

### 3.10 `server/src/services/router.ts` · `filterExhaustedQuota` + `filterHighValueIfLarge`
- 标记：`filterExhaustedQuota(` (L426) + `HIGH_VALUE_INPUT_THRESHOLD = 20000` (L863) + `filterHighValueIfLarge(` (L872)
- 作用：① **P0-3**：剔除 `(platform,key_id)` 维度 `provider_quota_state.remaining_value=0` 的已观测耗尽池（精确不误伤同胞池，如 openrouter::account vs openrouter::free；全链耗尽则回退原链）；② **P1-b**：估算输入 token > 20000 时从 auto 链剔除 `is_high_value=1` 稀缺模型，避免烧珍贵额度（链空则保留原链）。
- 标签：✅ 优化 ｜ 回滚：`git checkout server/src/services/router.ts` ｜ 漂移：`grep -n "filterExhaustedQuota\|filterHighValueIfLarge" server/src/services/router.ts`

### 3.11 `server/src/routes/proxy.ts` · 场景路由 + github 护栏 + 熔断 + clientTag（最大改动 +214）
- 标记：
  - `detectCategoryScene(` / `sceneToCategory(` / `detectSceneTags(`（场景识别：coding/vision/agent/reasoning/long-context/speed/compliance + 标签 low-latency/long-context/compliance/free-tier）
  - `GITHUB_MAX_INPUT_TOKENS = 7500` / `truncateMessagesForGithub(`（github 输入截断护栏）
  - `clientAborted` + `res.on('close'` + `if (clientAborted) break/return`（**P1-c 熔断**）
  - `clientTag` 读取 `x-client-tag`/`x-app-tag` 并传入 `logRequest`（**P2-a**）
- 作用：① 软路由场景偏好；② github 上游硬限输入≤8000（超限 413）、max_tokens 亦受限（400）——发上游前截断输入+封顶输出，消灭 97% 错误；③ 客户端断开即停上游/跳出 failover；④ auto 流量溯源。
- 标签：✅ 优化 / ⚠️ 修复(github 413/400，详见 §6.6) + P1-c/P2-a ｜ 回滚：`git checkout server/src/routes/proxy.ts` ｜ 漂移：`grep -n "clientAborted\|truncateMessagesForGithub\|detectSceneTags" server/src/routes/proxy.ts`

### 3.12 其余 tracked M（支撑性）
- `README.md`(+11)、`package-lock.json`(+26)：文档/依赖锁更新。
- `server/src/__tests__/services/ratelimit.test.ts`(+30)：ratelimit 测试更新。
- `server/src/app.ts`(+5)：挂载 `configRouter`（见 §4.4）。
- 标签：✅ 支撑 ｜ 回滚：`git checkout <file>`。

---

## 4. 未跟踪自定义文件（untracked）

### 4.1 ✅ `server/src/db/migrations/20260701_000001_add_category_to_models.ts`（已注册 2026-08-02）
- 作用：`ALTER TABLE models ADD COLUMN category TEXT`（PRAGMA 守卫幂等）。`down()` 抛错（未实现）。
- **状态**：2026-08-02 已注册进 `DEFAULT_MIGRATIONS`（`ADD_CATEGORY_TO_MODELS_FILENAME` L26 + 数组 L36）。`up()` 改为先 `PRAGMA table_info(models)` 检查 `category` 是否存在，不存在才 `ALTER` → 全新 clone 建列、live DB 重跑跳过 ALTER 不报错。
- 验证：migrate status 显示 `applied @ 2026-08-02 01:51:12`；重启服务干净启动（catalog-sync 正常 re-apply），HTTP 401 认证层正常。

### 4.2 ✅ `server/src/db/migrations/20260701_000002_add_probe_fields.ts`（已注册 2026-08-02）
- 作用：`last_verified_at`/`probe_status` 列（均 PRAGMA 守卫幂等）+ `probe_logs` 表（`CREATE TABLE IF NOT EXISTS`）+ 两索引（`IF NOT EXISTS`）。`down()` 抛错。
- **状态**：2026-08-02 已注册进 `DEFAULT_MIGRATIONS`（`ADD_PROBE_FIELDS_FILENAME` L27 + 数组 L37）。`up()` 对两列加 `PRAGMA table_info(models)` 守卫；表/索引本就幂等。全新 clone 建列+表、live DB 重跑跳过 ALTER 不报错。
- 验证：migrate status 显示 `applied @ 2026-08-02 01:51:12`；`free-model-audit.ts`（§4.5）写 `probe_logs` 路径在新环境可用。

### 4.3 ✅ `server/src/db/migrations/20260802_000000_quota_guard_columns.ts`（已注册，见 §3.3）
- 作用：幂等加 `models.is_high_value` + `requests.client_tag` + 索引；`down()` 反向 DROP。
- 标记：`is_high_value` / `client_tag` ｜ 漂移：`grep -n "is_high_value" server/src/db/migrations/20260802_000000_quota_guard_columns.ts`

### 4.4 ✅ `server/src/routes/config.ts`（新文件，由 §3.12 的 app.ts 挂载到 `/api/config` + `/v1/config`）
- 作用：返回各客户端（openai/claude/cursor/continue/codex/gemini_cli）接入模板（base_url + api_key + 按 category 推荐模型）。
- 标记：`CLIENT_TEMPLATES` ｜ 漂移：`grep -n "CLIENT_TEMPLATES" server/src/routes/config.ts`

### 4.5 ✅ `server/src/scripts/free-model-audit.ts`（新文件，模型探测/审计工具）
- 作用：`--scope/--report/--dry-run` 参数；取 key、探测各模型、分类错误、`writeFileSync` 结果、写 `probe_logs`、生成报告。是 §4.2 `probe_logs` 与 §3.7 `probeStatus` 的数据来源。
- 标记：`classifyError` / `getApiKey` / `probe loop` ｜ 漂移：`grep -n "probe_logs\|classifyError" server/src/scripts/free-model-audit.ts`

### 4.6 ✅ `docs/free-tier-reference.md`（新文件，免费额度参考手册）
- 作用：国产/海外/聚合/特殊平台的免费额度参考 + 排错三例 + 组合建议。自定义文档资产。

### 4.7 ✅ 运维脚本
- `restart-freellmapi.ps1`：**标准重启脚本（2026-08-02 终态）**。流程 = 杀旧 3001 监听进程 → 清 7 天前日志 → `Start-Process` 直连 `node.exe`（绝对路径）+ `-WorkingDirectory $root` + `-RedirectStandardOutput/Error` 落盘 + `-WindowStyle Hidden -PassThru` 脱离会话拉起 → 健康验证（端口监听 + 提示必须测 POST）。**2026-08-02 终态修复史（真根因=编码，非启动机制）**：
  1. 原脚本含中文注释/日志，被按 **UTF-8 无 BOM** 保存；本机 PowerShell 5.1 在非 UTF-8 区域下把 .ps1 当 **系统 GBK** 读取，中文被解析成乱码，某个字节被误读成未闭合的 `"`/`}`，触发**解析期 `ParserError: UnexpectedToken`（级联报 `unexpected }`）**——脚本**零副作用**（不生成 debug 日志、端口不变）因为根本没执行。这才是反复"调用失败"的真凶，不是启动机制。
  2. 附带确认两点本环境不可用：`Start-Process -UseNewEnvironment`（实测 exit 1 / 空日志）+ `cmd.exe`/`cmd /c start`（被宿主安全层拦截 "Starting cmd.exe from PowerShell bypasses validation"）。
  3. **终态**：脚本改为**纯 ASCII（英文注释/日志）+ UTF-8 BOM 保存**；启动一律 `Start-Process node.exe` 直拉（继承当前环境，不用 `-UseNewEnvironment`、不用 `cmd.exe`）。本环境**实跑验证通过**：杀旧 PID 4492 → 拉新 PID 18756 → 3001 监听 → HTTP `/health` **200**、`/v1/models` **401**（服务在线、正常拒未授权），err.log 仅一条无害 `[crypto] No ENCRYPTION_KEY` 警告。**注意**：本文件须保持纯 ASCII；若用中文须确保带 BOM，否则复现解析错误。
- `start_local.sh`：source `.env` + `exec node server/dist/index.js`（Git Bash 可用）。
- `start-freellmapi-manual.cmd`：最小化窗口 + 日志重定向拉起（历史可用，但 `cmd` 链路在本 agent 宿主被拦截，非生产首选）。
- `vault_inject.js`（T-SEC-2）：从 credential-vault（openssl aes-256-cbc）解密 `freellmapi-encryption-key` 输出 stdout；失败静默交回 `.env`。安全集成。
- `ensure-main-model.py`：幂等固化主模型 `zhipu/glm-4-flash`（绑健康智谱 key → `key_id` 非空 → 豁免 catalog-sync 删除；`size_label='User'` 二重豁免）。缓解 §6.1。
- `cleanup_clusterB.py`：把 glm-4-flash 置顶 profile 1（priority=1）、死平台(coze/github)降级 priority 9000+；执行前备份 DB。维护 auto 回退链。
- `agnes-provider.json`：Agnes AI 自定义 provider 配置模板（placeholder key）。
- `start_local.sh`：source `.env` + `exec node server/dist/index.js`。
- `start-freellmapi-manual.cmd`：最小化窗口 + 日志重定向拉起。
- `vault_inject.js`（T-SEC-2）：从 credential-vault（openssl aes-256-cbc）解密 `freellmapi-encryption-key` 输出 stdout；失败静默交回 `.env`。安全集成。
- `ensure-main-model.py`：幂等固化主模型 `zhipu/glm-4-flash`（绑健康智谱 key → `key_id` 非空 → 豁免 catalog-sync 删除；`size_label='User'` 二重豁免）。缓解 §6.1。
- `cleanup_clusterB.py`：把 glm-4-flash 置顶 profile 1（priority=1）、死平台(coze/github)降级 priority 9000+；执行前备份 DB。维护 auto 回退链。
- `agnes-provider.json`：Agnes AI 自定义 provider 配置模板（placeholder key）。

### 4.8 🗑️ 调试残留（非自定义功能，建议清理）
- `.env.bak-*`、`_pscheck.tmp`、`server/_tmp_query*.cjs`、`server/src/providers/index.ts.bak-agnes`、`server/dist.bak-20260721-111406/`
- 这些不是自定义改动，是调试/备份产物，勿入台账、勿随 sync 提交。

### 4.9 ✅ `server/src/db/migrations/20260907_000001_probe_logs_cascade.ts`（已注册 2026-09-07，macOS 根治 FK 卡死）
- 背景：§4.2 `probe_logs` 外键 `REFERENCES models(id)` **无 ON DELETE CASCADE**；catalog-sync（上游逻辑，catalog-sync.ts:505/522）prune 时 `DELETE FROM models WHERE id=?`，待删 model 存在探测记录即 `FOREIGN KEY constraint failed` → 事务回滚 → `catalog_applied_version` 卡死（Windows 08.11 / macOS 08.01，2026-08-13 起，双端同源同病）。
- 作用：重建 `probe_logs` 表，外键改为 `ON DELETE CASCADE`（SQLite 不支持 ALTER 改外键，需重建表）；`up()/down()` 均带 `PRAGMA foreign_key_list` 幂等守卫。数据无损（83 行全量迁移）。
- 状态：2026-09-07 已注册 `DEFAULT_MIGRATIONS`（`PROBE_LOGS_CASCADE_FILENAME`）。**注意**：macOS 服务跑 dist 旧版（defaults 仅 5 迁移），迁移未走 CLI，系直接手动重建表生效；src 迁移文件供未来 build 后自动执行（幂等跳过）。
- 验证：`PRAGMA foreign_key_list(probe_logs)` → on_delete=CASCADE ✅；`PRAGMA foreign_key_check` 空 ✅；catalog_applied_version 08.01 → **2026.09.04**（推进 1 个月+）；catalog_last_error 清空 ✅；HTTP 200。
- **上游 merge 纪律**：probe_logs 为本地独有表（上游无此迁移），本修复为本地 fork 维护点，merge 上游时**必须保留**。
- 漂移：`grep -n "probe_logs_cascade" server/src/db/migrate/defaults.ts`

---

## 5. DB 自定义数据（非代码，不受代码同步影响，但全新 clone 不带）

| 数据 | 设置方式 | 性质 |
|---|---|---|
| `rpd_limit` 上限（14 平台） | P0 FLA-RPD 手动/脚本设 | ✅ 优化（本地每日护栏） |
| `is_high_value=1`（17 行） | P1-b `UPDATE models SET is_high_value=1 WHERE rpd_limit<=50` | ✅ 优化 |
| github embedding 禁用（id 6/7） | P1-a `UPDATE embedding_models SET enabled=0 WHERE platform='github'` | ⚠️ 缓解(github embedding 96% 失败) |
| `zhipu/glm-4-flash` 固化 | `ensure-main-model.py`（key_id + size_label='User'） | ⚠️ 缓解(catalog-sync 删除主模型) |
| `probe_logs` 数据 | `free-model-audit.ts` 探测写入 | ✅ 优化（可观测性） |

**建议**：把可复现的 DB 默认值（is_high_value、github 禁用、rpd 上限）写进某迁移 `up()`，使全新环境可复现（当前仅运行库有，源码不含）。

---

## 6. ⚠️ 改出问题的 & 风险点（根因 + 处置，按时间/严重度）

### 6.1 catalog-sync 误删主模型 glm-4-flash（⚠️→已缓解）
- 根因：`catalog-sync.ts` 删除逻辑把"注册在 catalog 平台且 `key_id` 为空"的模型当"上游已下架"删除。主模型 glm-4-flash 因此**两次消失**（2026-07-01、07-09）。
- 处置：`ensure-main-model.py` 绑健康智谱 key 使 `key_id` 非空 + `size_label='User'` 双重豁免。✅ 运行 `python ensure-main-model.py` 即恢复。

### 6.2 catalog-sync 覆盖本地 rpd 上限（⚠️→已修 P2-b）
- 根因：applyCatalog 的 UPDATE 带 `rpd_limit`，上游对 nvidia/cloudflare 等给 `null`，清掉 P0 设的本地每日上限。
- 处置：§3.8 从 UPDATE 排除 `rpd_limit`。✅ 已修。

### 6.3 OpenRouter 健康状态虚高（⚠️→已修）
- 根因：`validateUrl=/models` 是公开端点，垃圾 key 也返 200，健康永远"绿"，实际补全 401 数周无人知。
- 处置：§3.6 改 `validateUrl=/api/v1/key`（需鉴权）。✅ 已修。

### 6.4 无上限免费 provider 24h 死亡冷却级联（⚠️→已修）
- 根因：cloudflare 等无文档日限额 provider 突发 RPM 抖动狂返 429，原启发式把它们抬进 24h 冷却并级联到高流量消费者（distill_card 批处理场景实测 ollama 1h 内 130×429 全 90s 冷却）。
- 处置：§3.9 `NO_LIMIT_COOLDOWN_CAP_MS=10min` 封顶。✅ 已修。

### 6.5 proxyAuth 时序泄露（⚠️→已修）
- 根因：原 `timingSafeStringEqual` 长度不齐走 `Buffer.alloc`，仍有长度分支时序泄露。
- 处置：§3.5 HMAC 固定长度摘要。✅ 已修。

### 6.6 github 上游硬限 413/400（⚠️→已缓解）
- 根因：github 输入≤8000 token（超限 413）、max_tokens 受限（400），模型本身活着，故原样转发必错。
- 处置：§3.11 `truncateMessagesForGithub` 发前截断 + 封顶；embedding 侧直接禁用（§5）。✅ 已缓解。

### 6.7 迁移幂等陷阱：往已 applied 的 baseline 加列无效（⚠️→已修，本会话）
- 根因：迁移 runner 用 `migrations` 表跟踪，baseline 已 applied 重启被跳过；往里塞 `ensure*` 列对新库无效。
- 处置：还原 baseline，改新建独立迁移文件（§4.3）+ 注册。✅ 已修。

### 6.8 ✅ 未注册迁移 `20260701_*`（已解决 2026-08-02）
- 见 §4.1/§4.2。两文件已注册进 `DEFAULT_MIGRATIONS` 并加 PRAGMA 幂等守卫。全新 clone 现在会正确建 `category`/`last_verified_at`/`probe_status` 列 + `probe_logs` 表；live DB 重跑因 PRAGMA 守卫跳过 ALTER，不报错。风险消除。

### 6.9 ✅ 重启脚本解析失败（真根因=编码，已修复 2026-08-02）
- 见 §4.7。原 `restart-freellmapi.ps1` 反复"调用失败"的真根因**不是启动机制**，而是 **UTF-8 无 BOM + 中文内容被 PowerShell 5.1 当 GBK 读取 → 解析期 `ParserError`**（脚本从未执行，故零副作用）。已改为**纯 ASCII + UTF-8 BOM**，`Start-Process node.exe` 直拉启动，本环境**实跑全链路通过**（杀旧→拉新→3001 监听→HTTP 200/401）。`cmd.exe` 链路与 `-UseNewEnvironment` 均证实本环境不可用。

---

## 7. 漂移检测汇总（同步上游后逐项跑，空输出=被覆盖）

```bash
cd C:/Users/coffcoe/freellmapi
grep -n "QUOTA_GUARD_COLUMNS"            server/src/db/migrate/defaults.ts
grep -n "filterExhaustedQuota\|filterHighValueIfLarge" server/src/services/router.ts
grep -n "clientAborted\|truncateMessagesForGithub"     server/src/routes/proxy.ts
grep -n "rpd_limit 治本"                  server/src/services/catalog-sync.ts
grep -n "NO_LIMIT_COOLDOWN_CAP_MS"       server/src/services/ratelimit.ts
grep -n "createHmac"                     server/src/middleware/proxyAuth.ts
grep -n "api/v1/key\|agnes-ai.cn"       server/src/providers/index.ts
grep -n "notifyTracker\|clientTag"       server/src/lib/request-log.ts
grep -n "CLIENT_TEMPLATES"               server/src/routes/config.ts
grep -n "modelscope"                     shared/types.ts
# DB 数据存活
python - <<'PY'
import sqlite3
db=sqlite3.connect(r'C:/Users/coffcoe/freellmapi/server/data/freeapi.db')
print("is_high_value=1:", db.execute("SELECT COUNT(*) FROM models WHERE is_high_value=1").fetchone()[0])
print("github emb disabled:", db.execute("SELECT COUNT(*) FROM embedding_models WHERE platform='github' AND enabled=0").fetchone()[0])
print("rpd capped platforms:", len(db.execute("SELECT DISTINCT platform FROM models WHERE rpd_limit IS NOT NULL").fetchall()))
print("glm-4-flash key_id:", db.execute("SELECT key_id FROM models WHERE platform='zhipu' AND model_id='glm-4-flash'").fetchone())
PY
```

---

## 8. 其他核心 skill 台账（扩展位）

本台账目前仅覆盖 freellmapi。web2kb / credential-vault / secure-credential-channel 等核心 skill 的自定义改动，复制下模板追加章节：

```
### N.N [skill名] <改动简述>  [✅/⚠️/🔴]
- 日期：YYYY-MM-DD
- 文件：<相对路径>
- 标记：<grep 关键字>
- 作用：<为什么>
- 好/坏：<标签 + 根因（若坏）>
- 回滚：<命令>
- 漂移检测：<命令>
```

## 9. 添加条目模板（复制即用）
```
### <编号> [代码/数据/迁移] <一句话>  [✅/⚠️/🔴]
- 日期：YYYY-MM-DD
- 文件：<path>
- 标记：<grep 关键字>
- 作用：<为什么>
- 好/坏：<标签 + 根因>
- 回滚：<命令>
- 漂移检测：<命令>
```

---

## 4.13 健康检查错误分级协议（hard:/soft:）+ 评分健康降权（B-1）· T1 · 2026-09-07

- 文件：server/src/services/health.ts（3 处）+ server/src/services/router.ts（4 处）
- 作用：
  1. health.ts 写 last_health_error 统一加严重度前缀协议：
     - hard: = 永真错误（provider not registered / 确认 401-403）→ 可降权
     - soft: = 瞬时网络错误（DNS/timeout/TLS）→ 仅提示不降权
     - 三处：provider=null 分支（行 ~88）、validateKey 无效分支（行 ~116，null 保护）、transport catch（行 ~151）
  2. router.ts 新增 platformHealthFactors(db)（行 ~483）：一次查询预聚合 platform→health factor（hard→0.9 / soft→0.98 / 无信号→1）
  3. scoreChainEntry 新增 healthFactors 参数，reliability 乘 healthFactor（并入 reliability 轴，combineScore 保持 2 乘法阻尼不变）
- 好/坏：坏=旧裸文本错误无法区分严重度，评分无法感知"永真不可用平台"；好=分级协议让健康信号可被评分消费，语义正确
- 回滚：Copy-Item dist.bak-20260907-t1\* dist\ -Recurse -Force + 还原 src（git 或手工）
- 漂移检测：Select-String health.ts 'hard:|soft:'（应 3 处）；Select-String router.ts 'platformHealthFactors'（应 3 处引用）
- 状态：Windows 侧已落地验证（xunfei/sense nova hard 落库、测试 12+59 绿、auto 无破坏）；**待 macOS 侧同步**（health.ts + router.ts + tsc + 重启）


### §4.14 B-1 测试补全 + T0-2 执行器（2026-09-07）

- **测试**：server/src/__tests__/services/router.test.ts +2（platformHealthFactors 单测：hard 0.9/soft 0.98/hard 优先/无信号中性；bandit 集成：hard 平台被压）。router 测试 12→14，全绿。
- **导出**：platformHealthFactors 加 export（router.ts 行 483），dist 已重编译。
- **工具**：scripts/platform-quality-audit.py（质量矩阵+无效模型+门禁）；scripts/apply-invalid-models.py v3（key级/模型级分层处置，dry-run 默认）。
- **关键结论**：cloudflare 26 模型全 key 级问题（key id=39 无冒号），模型保留禁 key；7 个真无效模型待清（--apply）。
- **状态**：未 apply（待用户确认）；未 commit（cb-2102 裁决前）。

### §4.15 推演深挖（2026-09-07）

- **catalog 根因**：静态清单无端点验证（catalog-sync.ts applyCatalog 信任 m.enabled）；防回潮=user tombstone（isCatalogModelTombstoned）。
- **评分矛盾**：平台聚合榜 ≠ 模型级路由；openrouter rank2 强模型是 auto 首选真因。
- **僵尸平台**：14 平台 0 key / 126 模型在链——执行器 v4 新增 C 部分（摘链，配 key 可加回）。
- **强模型**：nvidia minimax-m3（rank2/76%）需模型级保护，勿平台级禁用。
- **工具**：apply-invalid-models.py v4（A key 级 + B 模型级 + C 僵尸平台）。
- **状态**：dry-run 完成，--apply 待用户确认；未 commit。

### §4.16 T0 方案 A 推翻（2026-09-07）

- **链头**：profile 1 链头 = glm-4-flash（rank45，priority=1，被置顶）；切 priority 会固定到弱模型。
- **auto 实际**：24h 分布已多样化（agnes 12x/modelscope 多成功）——"死选 openrouter"为瞬时快照。
- **结论**：T0 方案 A 不建议；推荐 T0-2 v4（清无效）+ 评分信任 + 巡检定时化。

### §4.17 推演收尾（2026-09-07）

- **修正**：/api/health/* 鉴权 = requireAuth（dashboard session），非 unified key。
- **验证**：服务重启后 .env 检查 9→1 unrecognised（死键治理生效）；3001 = PID 15792 正常。
- **定时任务**：豆包 cron「freellmapi平台质量周巡检」（每周一 10:30）→ platform-quality-audit.py --gate。
- **待确认**：T0-2 v4 --apply。

### §4.18 cloudflare key 过期确认（2026-09-07）

- **确认**：cloudflare key 月度轮换（约 1 个月），已过期 → 26 模型休眠非无效，换 key 全部恢复。
- **处置**：T0-2 A 部分改等待；巡检脚本已加"key 过期"提示（platform-quality-audit.py）。
- **换 key 方式**：替换 api_keys id=39 的 encrypted_key/iv/auth_tag（encrypt() 生成）。

### §4.19 免费模型生命周期管理（2026-09-07）

- **历史**：灰狐 F004 政策监控（7 平台半月检）+ 探活周检 #15 + 蓝图 v2.2 §308。
- **整合**：三层闭环（政策预警 → catalog 同步 → 运行时 audit 确认清理）。
- **对齐建议**：audit 脚本与灰狐 #15 统一，防双轨漂移（待讨论区）。
- **真无效模型** = 平台免费模型下架（openrouter unavailable for free 等）→ 运行时 404 是事实确认信号。

### §4.20 免费模型下架治理洞：source='user' 三层全跳过（2026-09-07 · 关键发现）

- **实证**：nvidia 8+ EOL 模型（下架 1~6 周）仍在链，7 天 410 失败 400+ 次；上游 catalog 已移除，本地未删。
- **根因**：source='user' + key_id 非空 → applyCatalog removed / model-retirement / user tombstone **三层全排除**。
- **规模**：user 模型 71 个，7 天失败 ≥2 的 34 条。
- **修复**：A 代码（user 410 → disable-only 不删行）/ B 执行器 v5 D 类 / C 巡检单列。
- **附带**：NSSM 只配 err 日志（运行时盲区）；JSON 解析错误 5 次待定位。

### §4.21 codegraph 支撑推演：根因链闭合（2026-09-07）

- **codegraph 索引修复**：unresolved_refs 缺失 → index 重建（9634 节点/35164 边）。
- **爆炸半径**：isCatalogManagedModel 2 调用方 / retire 12 符号 / 410 接线 fallback-loop:288——A 级修复低风险。
- **根因链**：declarative 配置注册 user 模型 → 配置源 free-channels-20260824.json 已清空（2B）→ 71 个孤儿残留 → EOL 三层跳过 → 410 循环。
- **设计缺口**：declarative-config 无配置移除→DB 清理路径。
- **修复**：D1 清残留 / D2 user 410 disable-only / D3 移除清理路径（讨论）/ D4 监控。
- **JSON 错误**：errorHandler:85 请求级，建议加 path+脱敏 body。

### §4.22 人工免费渠道清单跟踪（2026-09-07）

- **free-channels-20260824.json**：8/29 清空后未更新（2B，停滞 9 天）。
- **free-model-audit.ts**：Y: 盘输出已修 F:（2 处）；探活审计工具，未调度。
- **free-tier-reference.md**：数据 7/15 过时，待更新。
- **定时任务**：清单跟踪（周一/四 9:00）。
- **待对齐**：三个探活审计工具统一。

### §4.23 free-model-audit 探活首跑（2026-09-07）

- **执行**：node dist/scripts/free-model-audit.js --report（Y:→F: 已修）。
- **结果**：🟢62 / 🟡100 / 🔴91；报告 F:/KnowledgeBase-V2/freellmapi-audit-2026-09-07.md。
- **死亡分类**：cloudflare key 过期 ~34（等换）/ no_provider 平台 ~15（摘链）/ aihorde 406 ~8（清理）/ custom 3 / nvidia 410。
- **建议**：audit 月度全量 + quality 周度轻量错峰；T0-2 清单按探活修订。

### §4.24 no_provider 深挖（2026-09-07）

- **xunfei/xfyun 漂移**：providers=xfyun，models/api_keys=xunfei → no_provider（B-1 hard: 真相）。修复=注册别名。
- **未实现平台**：coze 10 / sense nova 2（补注册或摘链）。
- **Unverified**：no_key 僵尸为主（huggingface/mistral/cohere/google/groq/ollama）。

### §4.25 xunfei/xfyun 修复 + 清理清单修订（2026-09-07）

- **修复**：数据对齐类型（models/api_keys 3+1 行 xunfei→xfyun）；tsc 0 + 重启 3001。
- **清理清单五层**：A 无 provider 12 摘链 / B 下架 ~27 / C 429 观察 4 / D cloudflare 等 key 26 / E 僵尸平台保留 ~60。真清 ≈39。
- **新下架**：openrouter qwen3-coder:free（历史 rank2 滞后揭穿）。

### §4.26 catalog 127 skipped 根因 + NSSM 误判修正（2026-09-07）

- **NSSM**：out.log 存在且活跃（误判修正，console.log 全落盘）。
- **catalog 09.07**：127 skipped = navy 104 + requesty 8 + sealion 5 + aion 4 + nara 3（本地无 provider）。
- **navy**：GPT-5.x Frontier 免费通道（~1M-3.5M tok/month），补 provider 解锁；需先验证。

### §4.27 验证 + 清理执行完成（2026-09-07）

- **xfyun 验证**：3 模型 spark-4.0-ultra/3.5/lite available=True；canonicalId=slug 非 model_id；**DB 时间戳=UTC（+8h 比对）**。
- **清理 40 模型**：A 12（coze/sense nova）+ B 28（nvidia 8/aihorde 5/modelscope 1/openrouter 14）；tombstone 5；fallback 43。
- **navy**：api.navy OpenAI 兼容，号池风险待评估。

### §4.28 推演续：B-1 测试确认 + cloudflare 预演 + 补清 4 EOL（2026-09-07）

- B-1 测试已存在（router.test.ts 281/303）。
- cloudflare 26 全 Could not route（key 过期，换 key 全复活）。
- 补清 4：glm-5.1/gpt-oss-120b/kimi-k2.6 + github gpt-4.1（enabled 212→208）。
- 教训：清理清单合并探活+requests 410 双源。

### §4.29 双源清理固化 v5（2026-09-07）

- apply-invalid-models.py v5：MODEL_EOL_PATTERNS 增加 410/end of life/retirement——修复"410 不在模式导致 EOL 漏网"（glm-5.1 案例）。
- 执行部分增加 fallback_config 同步 disabled（此前仅手动）。
- 幂等保护：enabled=0 模型跳过（防重复 tombstone/摘链）。
- ⚠️ 人工决策点：cloudflare key 39 在 dry-run 显示"禁 key"建议——**用户要换 key 复活，执行时排除**。

### §4.30 双源清理 v5 + B-1 验证 + 三方一致性巡检（2026-09-07）

- apply-invalid-models v5：+410/EOL + fallback 同步 + 幂等。
- B-1 验证：429 33→4；minimax-m3 保留正确；xfyun 端到端路由成功。
- platform-consistency-audit.py v1：4 种注册写法，0 漂移；sense nova key 12 已禁。

### §4.31 catalog 缺口闭环 + 新平台评估（2026-09-07）

- catalog-sync skipped 明细日志（bumpSkipped 4 处 + counts 类型 + 日志排序）。
- catalog-gap-audit.py v1：缺口 124/5 平台。
- 周巡检升级：quality+consistency+gap 三串联。
- 接入评估：requesty/sealion/aion/nara 可接入；navy 观察。

### §4.32 交叉验证（2026-09-07）

- dist 产物核对 ✅；缺口三源一致 ✅；端点实测 4 真 1 疑。
- navy 风险实锤：无认证 + gpt-6-astra + metadata unknown = 中转站特征 → 不接入。

### §4.33 清理后一致性 + 路由质量（2026-09-07）

- 摘链 39 个 disabled（链内=enabled=208 完美一致）。
- fallback 0 残留；cloudflare 差异=媒体模型；kimi-k2.6 用户手加。
- glm-4-flash（zhipu）87% 主流量健康；agnes/openrouter 主力。

### §4.34 GLM 免费核查 + 无 key 僵尸清理（2026-09-07）

- glm-4-flash 仍可用；GLM-5.3-Flash 收费（5 折至 9/9）；免费 GLM 最新 4.7-Flash。
- 回滚误插入 glm-5.3-flash（收费）。
- 无 key 僵尸清理 99 个（enabled 208→109，链内 109 一致，僵尸 0）；aihorde keyless 保留。
- platform-consistency-audit.py v1.1：加 ④ 无 key 僵尸检查（keyless 白名单+探活动态）。

### §4.35 GLM 免费解 + 不可达平台矩阵（2026-09-07）

- modelscope GLM-5.2 免费旗舰入池（实测 200）。
- GLM-5.3-Flash 收费实锤（429 请充值）；魔搭仅权重（empty completion）；GLM-7 不存在。
- 俄罗斯 GLM-Free-API：可达但强制 SSE → custom 502；SSE 转发修复列入待办（key 53 保留）。
- 矩阵：A 国内替代落地 / B 国内 provider 待 key / C 俄罗斯待修 / D 代理软件待决策。
- disabled 5 个（5.3-Flash + GLM-Free-API 4），池 109=109。

> 📌 **代码层修改日志**：自 2026-09-07 起，代码修改（文件/函数/原因/验证）统一记入 DEV-LOG.md（本台账专注数据/操作层）。git 工作区改动在 cb-2102 裁决前不 commit，DEV-LOG 为权威留痕。

### §4.36 cloudflare 探活盲区 + 换 key 复活（2026-09-08）

- validateKey 只验 token 活性（/user/tokens/verify）→ 旧 key 39 假阳性 healthy（实际 404）；新 key 54 真健康。
- 处置：key 39 disabled；kimi-k2.6 + llama-3.2-11b-vision 403 disabled；26 模型 24 复活。
- 池 107=107；修复建议：validateKey 加账户服务探测（待评审）。
