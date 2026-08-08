# 02 · 与 router / catalog-sync 的集成点

## 总体原则

CodeGraph 是 **旁路（sidecar）**，不进入 `routeRequest()` 的热路径，不改变路由决策。与 router/catalog-sync 的"集成"体现在：

1. 复用网关已有的 **启动编排模式**（`scheduler` + `settings` 表 + env 开关）；
2. 复用 catalog-sync 的 **受控后台任务形态**（boot delay + interval + 可禁用开关）；
3. 利用 router 的 **公开导出** 做跨源校准（只读，不改逻辑）；
4. 与网关 `/mcp` 端点**并存不合并**（见 01 架构边界）。

## 1) 网关侧：可选的只读状态钩子

Phase B 在网关侧**不加任何运行时依赖**；仅当需要"仪表盘能看到 CodeGraph 状态"时，才加一个只读服务 `server/src/services/codegraph-status.ts`：

```ts
// server/src/services/codegraph-status.ts（Phase B 可选）
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { getDefaultDbPath } from '../db/index.js';

// 默认取仓库根的 .codegraph/codegraph.db，紧跟主库 data 目录旁
const DEFAULT_ROOT = path.resolve(path.dirname(getDefaultDbPath()), '../..');
export function codegraphDbPath(): string {
  return process.env.CODEGRAPH_DB_PATH?.trim()
    || path.join(DEFAULT_ROOT, '.codegraph', 'codegraph.db');
}
export function codegraphStatus(): { indexed: boolean; dbPath: string; lastIndexedAt?: number } {
  const dbPath = codegraphDbPath();
  if (!existsSync(dbPath)) return { indexed: false, dbPath };
  const stat = readFileSync(dbPath); // 仅作存在性/新鲜度探测，不解析 SQLite
  return { indexed: true, dbPath, lastIndexedAt: Date.now() };
}
```

- 启动挂载点与 catalog-sync 相同的约定：`server/src/index.ts` 的 `onReady` 内
  `if (process.env.CODEGRAPH_ENABLED !== '0') startCodegraphWatchdog(scheduler);`。
- 守护逻辑：`scheduler.after(BOOT_DELAY_MS)` 检查 DB 是否存在且新鲜；若缺失则打一条警告日志并提示运行 `codegraph index`，**绝不自动拉起重型索引进程**（网关容器内禁跑 rust 索引）。

## 2) catalog-sync 的复用点（模式参照，不共享代码）

`services/catalog-sync.ts` 提供了值得照搬的三件套形态：

| catalog-sync 模式 | CodeGraph 对应 | 说明 |
|---|---|---|
| `startCatalogSync(scheduler)` 在 `onReady` 内调用 | `startCodegraphWatchdog(scheduler)` | 同启动时机、同 boot delay 理念 |
| `CATALOG_SYNC_DISABLED=1` 开关 | `CODEGRAPH_DISABLED=1` | 同 env 开关约定 |
| settings 表持久化状态（`catalog_applied_version` 等） | `.codegraph/codegraph.db` 的 `meta` 表存 `last_indexed_commit` | CodeGraph 状态不入 settings 表（DB 隔离原则），存自己库内 |

不需要：不修改 `catalog-sync.ts` 本身；`startCatalogSync` 的间隔、签名校验等与代码图谱无关。

## 3) router 的只读校准点（可选，跨源验证）

- 目标：`services/router.ts` 的公开导出（不改源码）：
  - `getRoutingScores()` → 当前可用模型列表；
  - `routeRequest()` / `resolveRoutingChain()` → 链路解析结果；
  - `getModelGroups()`（`services/model-groups.ts`）。
- 用途：
  - 把"当前路由策略/可用模型"作为检索上下文喂给 CodeGraph 查询（例如检索某平台 provider 实现时附带路由分数）；
  - 交叉验证 `code_stats` 与 `getRoutingScores` 的模型名是否一致（见 04 验证）。
- 形式：可选的 npm 脚本 `codegraph:sync-router-context`（读取 router 导出写入 `.codegraph/context/router.json`），**不进生产热路径**。

## 4) 与网关 /mcp 并存

| 维度 | 网关 `/mcp`（routes/mcp.ts） | CodeGraph MCP |
|---|---|---|
| 定位 | 路由器运行时内省（模型/健康/用量/策略） | 代码库知识图谱（符号/FTS/引用） |
| 传输 | POST /mcp，统一 API Key Bearer | stdio（本地进程） |
| 数据 | 读 `freeapi.db` + 内存路由状态 | 读 `.codegraph/codegraph.db` |
| 改代码 | 灰狐可扩展 | Phase B 只读 |
| 冲突 | 无：工具名空间彼此独立（`list_models` vs `search_code`） | — |

- 客户端可同时挂两个 MCP server（freellmapi-gateway + freellmapi-codegraph），互不干扰。
- 若未来希望网关内嵌 CodeGraph 工具，需灰狐确认路由/鉴权/依赖策略，Phase B 不实施。

## 5) 环境变量汇总

| 变量 | 默认 | 说明 |
|---|---|---|
| `CODEGRAPH_ENABLED` | `1` | 网关 watchdog 开关（`0` 关闭） |
| `CODEGRAPH_DB_PATH` | `<repo>/.codegraph/codegraph.db` | 覆盖库路径（CI 临时目录用） |
| `CODEGRAPH_BIN` | `<repo>/.codegraph/bin/codegraph` | 覆盖二进制路径 |
| `CODEGRAPH_INDEX_WATCH` | `0` | 网关内禁开（容器无源码树）；本地手动 `codegraph index --watch` |
| `CATALOG_SYNC_DISABLED` | — | 既有变量，与 CodeGraph 无关，文档仅提示二者互不影响 |

> 以上变量需写入 `.env.example`（Phase B 落地时），现仓库 `.env.example` 已有 catalog/embedding 分段，CodeGraph 新增独立 `# CodeGraph (local code knowledge graph)` 段。

## 6) 边界重申（灰狐专管）

- 不修改 `routes/proxy.ts`、`routes/anthropic.ts`、`lib/scene.ts`。
- 不向 `freeapi.db` 写入任何 CodeGraph 相关表/行；状态只存 `.codegraph/codegraph.db`。
- 不修改 `services/catalog-sync.ts` 与 `services/router.ts` 的既有逻辑（只读引用）。
