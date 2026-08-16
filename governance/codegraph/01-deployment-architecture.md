# 01 · 部署架构

## 总体形态

```
┌────────────────────────── 开发机 / 部署机 ──────────────────────────┐
│                                                                    │
│  freellmapi 工作区                                                 │
│   ├── server/src/*.ts  client/src/*.ts  shared/*.ts  desktop/*.ts  │
│   ├── .codegraph/bin/codegraph        ← release 二进制（不进 git） │
│   └── .codegraph/codegraph.db         ← SQLite + FTS5（不进 git）  │
│                                                                    │
│   ┌──────────────┐    stdio JSON-RPC (MCP)    ┌────────────────┐  │
│   │ codegraph    │◄──────────────────────────►│ Claude/Cursor/ │  │
│   │ serve --db   │                            │ Cline/CodeBuddy│  │
│   └──────┬───────┘                            └────────────────┘  │
│          │ 只读索引                                          │
│   ┌──────▼─────────┐         ┌───────────────────────────────┐   │
│   │ SQLite(FTS5)   │         │ freellmapi 网关 (Node/Express)│   │
│   │ code_fts/symbol│ 独立文件 │  /mcp(路由内省) /v1(推理)      │   │
│   │ /refs /files   │         │  freeapi.db(catalog/models)   │   │
│   └────────────────┘         └───────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
```

- **CodeGraph 独立运行**：与网关进程无共享内存、无端口依赖（stdio 模式），网关挂掉不影响代码检索，反之亦然。
- **数据文件独立**：`.codegraph/codegraph.db` 与主库 `server/data/freeapi.db` 完全隔离。

## 两种运行模式

### A. MCP stdio（推荐，默认）
- 子命令：`codegraph serve --db .codegraph/codegraph.db`
- 在 MCP 客户端配置中注册：`command: /path/to/.codegraph/bin/codegraph`，`args: ["serve", "--db", ".codegraph/codegraph.db"]`。
- 无网络监听、无鉴权面，天然本地安全。

### B. HTTP/SSE（调试/远程）
- 子命令：`codegraph serve --db ... --transport http --port 4318`
- 仅用于临时调试或 CI 内自检；不纳入 Phase B 生产路径。

## 索引流水线

```
源码树 ──► tree-sitter-typescript 解析 ──► 符号/引用/文件三张表 ──► FTS5 外链索引 ──► 增量写库
（git 事件 / 手动 / watch 模式触发）
```

- **全量索引**：`codegraph index --root . --db .codegraph/codegraph.db`（`--include 'server/src/**/*.ts'` 等）。
- **增量/监听**：`codegraph index --watch`（notify crate），按文件 mtime + git HEAD 快照判断变更。
- **重索引时机**：大 merge（如本仓库 MERGE-REFACTOR-PLAN 系列）后必须全量重建；日常小改动走增量。

## Schema（目标）

```sql
-- files：文件清单（路径、语言、行数、mtime、git blob/commit）
CREATE TABLE files (
  id INTEGER PRIMARY KEY, path TEXT UNIQUE, lang TEXT,
  lines INTEGER, mtime_ms INTEGER, git_commit TEXT
);

-- symbols：函数/类/接口/类型/导出/常量
CREATE TABLE symbols (
  id INTEGER PRIMARY KEY, file_id INTEGER REFERENCES files(id),
  kind TEXT, name TEXT, scope TEXT, line INTEGER, col INTEGER,
  signature TEXT, doc TEXT
);

-- refs：import/调用点/类型引用边（知识图谱的边）
CREATE TABLE refs (
  id INTEGER PRIMARY KEY, src_symbol INTEGER REFERENCES symbols(id),
  dst_symbol INTEGER REFERENCES symbols(id), kind TEXT, line INTEGER
);

-- FTS5 外部内容表：全文检索 symbols.name + signature + doc（BM25）
CREATE VIRTUAL TABLE code_fts USING fts5(
  name, signature, doc,
  content='symbols', content_rowid='id',
  tokenize='unicode61'
);
-- 配套 AFTER INSERT/UPDATE/DELETE 触发器同步 FTS 表
```

## 工具集（MCP tools，Phase B）

| tool | 输入 | 输出 |
|---|---|---|
| `search_code` | `query`, `limit` | FTS5 BM25 命中的符号/文件+片段 |
| `get_symbol` | `name` | 符号定义：签名、位置、doc、文件 |
| `get_references` | `name` | 全部引用点（调用边/导入边） |
| `get_file` | `path` | 文件全文（分页） |
| `list_files` | `prefix`, `limit` | 文件清单 |
| `graph_query` | `name`, `depth` | 调用者/被调用者图谱（广度优先） |
| `code_stats` | — | 文件数/符号数/FTS 行数/最后索引 commit |

## 边界与红线

- 只读网关代码，**不修改** `routes/proxy.ts`、`routes/anthropic.ts`、`lib/scene.ts`（灰狐专管）。
- 不向 `freeapi.db` 写任何表；CodeGraph 全部数据在 `.codegraph/codegraph.db`。
- 索引忽略：`.env*`、`.encryption-key`、`server/data/`、`node_modules/`、`dist/`、`*.db*`、`*.log`。
- 不提供"改代码"类工具（Phase B）；仅检索/图谱，后续再评估 `apply_patch` 类工具。
