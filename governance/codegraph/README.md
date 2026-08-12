# CodeGraph 部署方案（Phase B）

> 状态：规划完成，待实施 · 分支：`npc/codegraph-phase-b`
> 范围：仅治理文档；不触碰灰狐专管文件（`server/src/routes/proxy.ts`、`server/src/routes/anthropic.ts`、`server/src/lib/scene.ts`）。

## 一句话

CodeGraph 是一个 **Rust + SQLite FTS5 的本地代码知识图谱 MCP**：用 tree-sitter 解析 TS 源码，把符号/引用/文件关系落进本地 SQLite（FTS5 全文索引），以 MCP（stdio）形式暴露给 Claude Desktop / Cursor / Cline / CodeBuddy 等代理，用于 freellmapi 代码库的语义检索与图谱查询。

## 规模假设

| 项 | 值 |
|---|---|
| 目标规模 | ~1000 TS 文件（用户口径） |
| 实测现状 | 295 个 TS 源文件（server 265 / client 19 / desktop 10 / shared 1，不含 node_modules） |
| 索引耗时预算 | <10s（release + rayon 并行），单线程 <30s |
| 查询耗时预算 | FTS5 BM25 <10ms；符号/引用点查 <5ms |
| 库体积预算 | 20–80 MB |

## 文档目录

| 文件 | 内容 |
|---|---|
| [01-deployment-architecture.md](./01-deployment-architecture.md) | 部署架构：本地二进制 + SQLite 库 + MCP stdio；与网关 /mcp 的边界 |
| [02-integration-points.md](./02-integration-points.md) | 与 router / catalog-sync 的集成点（复用 settings/scheduler/env 模式，不改运行时路由） |
| [03-dependencies-and-build.md](./03-dependencies-and-build.md) | Rust/rusqlite(FTS5)/tree-sitter 依赖清单、构建与索引步骤 |
| [04-verification.md](./04-verification.md) | 验证方法：索引完整性、FTS5 检索、MCP 握手、回归 |

## 关键决策（ADR 摘要）

1. **本地二进制 + 独立 SQLite 库**，不嵌入 freellmapi 网关进程。网关 `/mcp` 仍是"路由器运行时内省"，CodeGraph 是"代码库知识"，两者职责分离，互不阻塞。
2. **独立 DB 文件**（`.codegraph/codegraph.db`），绝不写入主库 `server/data/freeapi.db`——避免与 better-sqlite3/WAL 写锁竞争，schema 与生命周期完全解耦。
3. **零新增 npm 运行时依赖**：索引与查询全在 Rust 侧；Node 侧仅新增可选的状态只读钩子（Phase B 甚至可不加）。
4. **tree-sitter-typescript 作为解析器**：对 JSX/TSX/装饰器等 TS 语法稳健，优于正则/TS compiler API 的健壮性/性能权衡。
5. **忽略规则优先**：`.env*`、key 文件、`server/data/`、`node_modules/`、`dist/` 永不进索引，规避密钥与噪声。
6. **对灰狐专管文件只读**：索引器可读 `routes/proxy.ts` 等文件用于图谱，但任何代码变更禁止触及。

## 实施清单（Phase B 交付物）

- [ ] 新建 Rust crate（建议 `codegraph/` 或独立仓库 `freellmapi-codegraph`），实现 `index` / `serve` / `status` / `verify` 四个子命令
- [ ] FTS5 外部内容表 + 触发器 schema（含迁移版本号）
- [ ] `.codegraph/` 与 `*.codegraph.db` 写入 `.gitignore`
- [ ] `.env.example` 增加 `CODEGRAPH_*` 配置项（见 02）
- [ ] 本地 MCP 客户端注册样例（Claude Desktop / Cursor / Cline）
- [ ] 按 04 验证清单逐项过检
