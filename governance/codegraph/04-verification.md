# 04 · 验证方法

## 验证分层

| 层 | 手段 | 通过标准 |
|---|---|---|
| L1 构建 | `cargo build --release` / 现有 `npm run test` | 0 error，现有测试不回归 |
| L2 索引完整性 | `codegraph verify`（内部自检） | 符号/引用/FTS 计数与源文件一致 |
| L3 检索质量 | FTS5 查询抽查（下方样例） | 预期命中、排序合理 |
| L4 MCP 协议 | 握手 + tools/list + tools/call | JSON-RPC 全通过 |
| L5 集成回归 | 与 router/catalog-sync 交叉核对 | 网关不受影响、状态一致 |
| L6 性能 | 计时/体积 | 索引 <10s、查询 <10ms、库 20–80MB |

## L1 · 构建验证

```bash
cargo build --release
.codegraph/bin/codegraph --version          # 应输出版本号
# 现有网关回归（不新增依赖）：
npm run test -w server    # 或 npm test，确认无回归
```

## L2 · 索引完整性验证

```bash
# 自检命令：对库做完整性 + 计数 + FTS 一致性检查
.codegraph/bin/codegraph verify --db .codegraph/codegraph.db

# 输出应形如：
#   files:       295   (expected from source walk)
#   symbols:     N
#   refs:        N
#   fts rows:    N   (=== symbols count，外链表触发器同步)
#   integrity_check: ok
#   fts5: enabled
```

人工对照（与 `find` 结果一致）：

```bash
find server/src shared client/src desktop -name '*.ts' | wc -l   # 295
.codegraph/bin/codegraph status --db .codegraph/codegraph.db     # indexed_files 应一致
```

关键点：**FTS 行数 == symbols 数**，证明 AFTER INSERT/DELETE 触发器工作正常（常见坑：外链表不同步）。

## L3 · 检索质量验证（FTS5 + 图谱）

针对 freellmapi 真实符号抽查：

```bash
# 1) 路由核心：应命中 services/router.ts 的 routeRequest / resolveRoutingChain
.codegraph/bin/codegraph search 'routeRequest' --db .codegraph/codegraph.db

# 2) catalog 同步：应命中 services/catalog-sync.ts 的 syncCatalog / applyCatalog
.codegraph/bin/codegraph search 'catalog sync' --db .codegraph/codegraph.db

# 3) MCP 网关：应命中 routes/mcp.ts 的 tools/list 相关实现
.codegraph/bin/codegraph search 'mcp tools' --db .codegraph/codegraph.db

# 4) 引用图谱：routeRequest 的调用方应含 routes/proxy.ts / routes/responses.ts / routes/fallback.ts
.codegraph/bin/codegraph graph 'routeRequest' --depth 1 --db .codegraph/codegraph.db
```

通过标准：
- 每项查询 top 命中文件与人工预期一致；
- `get_references routeRequest` 能列出来自 `routes/proxy.ts`、`routes/responses.ts`、`routes/fallback.ts` 等调用点；
- `search 'gr`ay fox'` 不命中（说明忽略规则未漏掉敏感/无关内容，且对灰狐文档不建索引）。

## L4 · MCP 协议验证

```bash
# 手工 JSON-RPC 握手（stdio 模式）
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"verify","version":"1.0"}}}\n' \
  | .codegraph/bin/codegraph serve --db .codegraph/codegraph.db
```

期望响应：`result.serverInfo.name == "freellmapi-codegraph"`，`capabilities.tools` 存在。

```bash
# tools/list 与 tools/call 抽查
printf '{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_code","arguments":{"query":"routeRequest"}}}\n' \
  | .codegraph/bin/codegraph serve --db .codegraph/codegraph.db
```

通过标准：`tools/list` 含 7 个 Phase B 工具；`tools/call` 返回 `content[0].type=="text"` 且无 `isError`。

客户端联调（任选其一）：
- Claude Desktop：MCP 面板显示 `freellmapi-codegraph` 已连接、工具可调用；
- Cursor：`@MCP` 下拉出现 `search_code / get_symbol / get_references / graph_query`。

## L5 · 集成回归（router / catalog-sync 交叉核对）

```bash
# 1) 网关健康不受影响（CodeGraph 旁路，不共享进程/端口）
curl -s http://127.0.0.1:PORT/health | jq .          # 200 且状态正常

# 2) 网关 MCP 仍可用
curl -s -H "Authorization: Bearer $UNIFIED_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  http://127.0.0.1:PORT/mcp | jq '.result.tools | length'   # 与改动前一致（6 个）

# 3) catalog-sync 不受影响
curl -s -H "Authorization: Bearer $UNIFIED_KEY" http://127.0.0.1:PORT/v1/models | jq '.data | length'

# 4) 状态一致性（可选钩子）：网关 /v1/models 列出的模型名，与
#    codegraph search '<provider 名>' 的命中可互相解释
```

通过标准：网关 /mcp 工具数量与基线一致；`/v1/models` 正常；`startCatalogSync` 日志照常出现；`codegraph.db` 与 `freeapi.db` 互不写对方文件（`lsof`/`fuser` 可查）。

## L6 · 性能与体积

```bash
/usr/bin/time -v .codegraph/bin/codegraph index --root . --db /tmp/cg.db 2>&1 | grep -E 'Elapsed|Maximum resident'
ls -lh .codegraph/codegraph.db
```

| 指标 | 目标 |
|---|---|
| 全量索引（295 文件，release + rayon） | <10s |
| FTS5 查询（`search_code`） | p95 <10ms |
| 符号/引用点查（`get_symbol`/`get_references`） | <5ms |
| 库体积 | 20–80 MB |

## 验收清单（Phase B 门禁）

- [ ] `cargo build --release` 无 error；`npm test -w server` 无回归
- [ ] `codegraph verify`：integrity_check ok、fts5 enabled、fts rows == symbols
- [ ] 295 个 TS 文件全部入索引，无 `.env`/key/`server/data` 泄漏（grep 抽查）
- [ ] `routeRequest`/`catalog sync`/`mcp tools` 三项检索命中预期文件
- [ ] initialize/tools/list/tools/call 三层 JSON-RPC 全过
- [ ] 网关 `/mcp` 工具数、`/v1/models`、`/health` 与基线一致
- [ ] 性能指标达标（L6 表）
- [ ] 未触碰 `routes/proxy.ts`、`routes/anthropic.ts`、`lib/scene.ts`（git diff 复核）
