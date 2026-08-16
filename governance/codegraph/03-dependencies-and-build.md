# 03 · 依赖与构建步骤

## 依赖清单

### Rust 工具链

| 依赖 | 版本建议 | 用途 |
|---|---|---|
| rustc / cargo | 1.80+（稳定版） | 编译 |
| [rusqlite](https://crates.io/crates/rusqlite) | 0.31+，开启 `bundled` | SQLite 内嵌（避免系统 libsqlite 版本差异） |
| rusqlite FTS5 | 随 `bundled` 默认开启（SQLite ≥3.42） | FTS5 全文索引 |
| [tree-sitter](https://crates.io/crates/tree-sitter) | 0.24+ | 通用解析框架 |
| [tree-sitter-typescript](https://crates.io/crates/tree-sitter-typescript) | 0.23+ | TS/TSX 语法 |
| [rayon](https://crates.io/crates/rayon) | 1.10+ | 多文件并行解析 |
| [walkdir](https://crates.io/crates/walkdir) | 2.5+ | 目录遍历（含忽略规则） |
| [ignore](https://crates.io/crates/ignore) | 0.4+ | .gitignore 语义 + 自定义忽略 |
| [clap](https://crates.io/crates/clap) | 4.5+ | CLI（index/serve/status/verify） |
| [serde_json](https://crates.io/crates/serde_json) | 1.0+ | JSON-RPC 编解码 |
| [notify](https://crates.io/crates/notify) | 7+（可选，`--watch`） | 文件监听增量索引 |

### FTS5 前提

- `bundled` 特性编译的 SQLite 自带 FTS5 模块，无需系统包。
- 若走系统 SQLite：Debian/Ubuntu 需 `libsqlite3-dev`（≥3.42，FTS5 默认开）；旧发行版需编译参数 `-DSQLITE_ENABLE_FTS5`。
- 自检：`codegraph verify --fts5` 应输出 `fts5: enabled`。

### Node 侧（零新增运行时依赖）

- 不新增任何 npm 运行时依赖。
- 仅当启用"仪表盘状态"钩子时，复用 Node 内置 `fs`/`path`（见 02）。

## 构建步骤

### 1. 准备 Rust 工具链

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
export PATH="$HOME/.cargo/bin:$PATH"
rustc --version && cargo --version
```

### 2. 创建 crate（仓库内 `codegraph/`，或独立仓库）

```bash
mkdir -p codegraph/src && cd codegraph
cat > Cargo.toml <<'EOF'
[package]
name = "freellmapi-codegraph"
version = "0.1.0"
edition = "2021"

[dependencies]
rusqlite = { version = "0.31", features = ["bundled"] }
tree-sitter = "0.24"
tree-sitter-typescript = "0.23"
rayon = "1.10"
walkdir = "2.5"
ignore = "0.4"
clap = { version = "4.5", features = ["derive"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
notify = "7"

[profile.release]
lto = "thin"
strip = true
EOF
```

### 3. release 构建

```bash
cargo build --release
ls -lh target/release/freellmapi-codegraph   # 单二进制，预计 3–8 MB
```

### 4. 安装到工作区约定位置

```bash
mkdir -p .codegraph/bin
cp target/release/freellmapi-codegraph .codegraph/bin/codegraph
chmod +x .codegraph/bin/codegraph
.codegraph/bin/codegraph --help
```

### 5. 全量索引（首次）

```bash
# 从仓库根执行；--include 用 glob 覆盖全部 TS 源码
.codegraph/bin/codegraph index --root . \
  --db .codegraph/codegraph.db \
  --include 'server/src/**/*.ts' \
  --include 'shared/**/*.ts' \
  --include 'client/src/**/*.ts' \
  --include 'desktop/**/*.ts' \
  --exclude '**/node_modules/**' --exclude '**/dist/**'
```

预期输出：`indexed 295 files, 2,438 symbols, 4,102 refs in 4.1s`（数字为示意）。

### 6. 增量/监听（开发时）

```bash
.codegraph/bin/codegraph index --watch --root . --db .codegraph/codegraph.db
```

### 7. 启动 MCP 服务（stdio）

```bash
.codegraph/bin/codegraph serve --db .codegraph/codegraph.db
```

### 8. 客户端注册样例

**Claude Desktop**（`~/Library/Application Support/Claude/claude_desktop_config.json` 或 `%APPDATA%\Claude\`）：

```json
{
  "mcpServers": {
    "freellmapi-codegraph": {
      "command": "/abs/path/to/freellmapi/.codegraph/bin/codegraph",
      "args": ["serve", "--db", "/abs/path/to/freellmapi/.codegraph/codegraph.db"]
    }
  }
}
```

**Cursor / Cline**：MCP 配置里 `type: stdio`，同上 command/args。

## CI 注意事项

- 网关镜像（`Dockerfile`，Node 20-22）**不需要**装 Rust；索引在本地/独立 job 完成。
- 若在 CNB 流水线加索引 job：`cnbcool/rust:latest` 或 `rust:1.80` 镜像 + `cargo build --release`，产物缓存 `target/`。
- `.codegraph/` 与 `codegraph/target/` 不入库（见 .gitignore 变更项）。

## .gitignore 追加

```gitignore
# CodeGraph local knowledge graph (Phase B)
.codegraph/
codegraph/target/
*.codegraph.db
*.codegraph.db-*
```
