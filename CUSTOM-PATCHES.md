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

> **v0.7.0 合入后复核（2026-08-13 灰狐，审计 round 2）**：以下清单已按 v0.7.0 现状更新——
> ✅ 存活项标记改名/上游化（等价物已列）；❌ 丢失项为 v0.7.0 重写融入未保留，详见 `shared/discussions/agent-grey-fox/2026-08-13-freellmapi-v070-audit-round2.md` §四。

```bash
cd D:/Users/Yin/freellmapi
# ✅ 存活（等价物）
grep -n "QUOTA_GUARD_COLUMNS"                     server/src/db/migrate/defaults.ts
grep -n "summarizeExhaustion\|usableKeyCountsByPlatform" server/src/services/router.ts   # 原 filterExhaustedQuota
grep -n "clientAbort\|clientGone"                 server/src/routes/proxy.ts               # 原 clientAborted
grep -n "rpd_limit 治本"                          server/src/services/catalog-sync.ts
grep -n "NO_LIMIT_COOLDOWN_CAP_MS"               server/src/services/ratelimit.ts
grep -n "createHmac"                              server/src/middleware/proxyAuth.ts
grep -n "agnes-ai.cn"                            server/src/providers/index.ts
grep -n "client_agent"                            server/src/lib/request-log.ts              # 原 clientTag
grep -n "detectCategoryScene\|SCENE_BIAS_UNIT"    server/src/lib/scene.ts server/src/services/router.ts
grep -n "CLIENT_TEMPLATES"                        server/src/routes/config.ts
grep -n "modelscope"                              shared/types.ts
# ❌ 丢失（v0.7.0 未保留，待领航员裁决是否重写）
grep -n "filterHighValueIfLarge\|is_high_value"  server/src/services/router.ts  # 预期空（is_high_value 仅迁移列残留）
grep -n "truncateMessagesForGithub"              server/src/routes/proxy.ts     # 预期空
grep -n "notifyTracker\|3003"                    server/src/lib/request-log.ts  # 预期空
# DB 数据存活
python - <<'PY'
import sqlite3
db=sqlite3.connect(r'D:/Users/Yin/freellmapi/server/data/freeapi.db')
print("is_high_value=1:", db.execute("SELECT COUNT(*) FROM models WHERE is_high_value=1").fetchone()[0])
print("github emb disabled:", db.execute("SELECT COUNT(*) FROM embedding_models WHERE platform='github' AND enabled=0").fetchone()[0])
print("rpd capped platforms:", len(db.execute("SELECT DISTINCT platform FROM models WHERE rpd_limit IS NOT NULL").fetchall()))
print("glm-4-flash key_id:", db.execute("SELECT key_id FROM models WHERE platform='zhipu' AND model_id='glm-4-flash'").fetchone())
PY
```

---

## 7·5. 🔴 并发会话操作纪律（2026-08-14 灰狐 · .git 健康排查固化）

> **背景**：2026-08-13/14 多次异常（`git rm` 单文件删整目录 180→0、`update-ref` 后 refs 实时消失、`merge --abort` 后 392 个 D 标记）经 `git fsck --full` 排查：**.git 对象库健康（0 错误、0 损坏）**，根因 = **多个 WorkBuddy 会话并发操作同一仓库**（多 git 进程竞争同一 index/refs，git 为单进程写模型）。详见 `shared/discussions/agent-grey-fox/2026-08-14-git-health-check-report.md`。

**写操作前探并发（必做）**：
```bash
tasklist | grep -i WorkBuddy          # 多进程 = 可能多会话
ls -dt /d/Users/Yin/WorkBuddy/*/      # 近 2 小时新建会话目录 = 有活跃会话
```

**防护纪律**：
1. 探测到 >2 个近期会话时，写操作（merge/rm/checkout/reset/commit/push）前与领航员确认会话归属，避免双 git 进程同仓操作
2. `update-ref` 后立即 `git rev-parse` 回读；refs 丢失时用对象 hash 操作（对象库完整不受 refs 影响）
3. merge 预演/abort 后出现大量 D 标记 → `git checkout HEAD -- <dir>` 恢复（对象完整无损，数据零丢失）
4. 服务器端状态以 `git ls-remote cnb main` / `cnb pulls get-pull` 为准（本地 refs 可能被并发污染）

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
