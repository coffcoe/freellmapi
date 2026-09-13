#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
platform-consistency-audit.py — 平台三方一致性巡检（2026-09-07 豆包固化 · v1）

来源：xfyun/xunfei 命名漂移事件（providers 注册 'xfyun' 而 models/api_keys 用 'xunfei'，
      导致讯飞 3 模型 no_provider 永久不可路由）+ 三方扫描误报教训。

检查：providers 代码注册 vs models 表 vs api_keys 表 三方一致性。
覆盖两种注册写法：
  1. 构造字段：  platform: 'xxx'          （OpenAICompatProvider 等）
  2. 类属性：    readonly platform = 'xxx' as const   （CloudflareProvider 等）

用法：
  python scripts/platform-consistency-audit.py            # 报告
  python scripts/platform-consistency-audit.py --gate     # 有漂移 exit 1（供巡检）
"""
import re
import sys
import argparse
import sqlite3
from pathlib import Path

SRC = Path(r"D:\Users\Yin\freellmapi\server\src")
DB = r"D:\Users\Yin\freellmapi\server\data\freeapi.db"


def load_registered_providers(src: Path) -> set[str]:
    """从 providers 目录提取全部注册平台名（两种写法）。"""
    found: set[str] = set()
    # 写法 1: platform: 'x' / platform: "x"（构造字段）
    pat1 = re.compile(r"""platform:\s*['"]([^'"]+)['"]""")
    # 写法 2: platform = 'x' as const（类属性）
    pat2 = re.compile(r"""platform\s*=\s*['"]([^'"]+)['"]\s*as\s+const""")
    # 写法 3: platform = 'x'（类属性无 as const）
    pat3 = re.compile(r"""platform\s*=\s*['"]([^'"]+)['"]""")
    # 写法 4: platform: Platform = 'x'（带类型注解的类属性赋值，aihorde.ts 即此写法）
    pat4 = re.compile(r"""platform\s*:\s*[\w.]+\s*=\s*['"]([^'"]+)['"]""")
    for f in (src / "providers").glob("*.ts"):
        text = f.read_text(encoding="utf-8")
        found.update(pat1.findall(text))
        found.update(pat2.findall(text))
        found.update(pat3.findall(text))
        found.update(pat4.findall(text))
    return found


def main() -> int:
    ap = argparse.ArgumentParser(description="平台三方一致性巡检")
    ap.add_argument("--src", default=str(SRC))
    ap.add_argument("--db", default=DB)
    ap.add_argument("--gate", action="store_true", help="有漂移时 exit 1")
    args = ap.parse_args()

    provs = load_registered_providers(Path(args.src))
    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    models_p = set(r[0] for r in cur.execute("SELECT DISTINCT platform FROM models WHERE enabled=1"))
    keys_p = set(r[0] for r in cur.execute("SELECT DISTINCT platform FROM api_keys WHERE enabled=1"))

    drift: list[str] = []

    print(f"=== 平台三方一致性巡检（providers {len(provs)} 个注册）===")
    print()

    # ① models enabled=1 但 provider 未注册（= xfyun 事件）
    print("① models 有 enabled=1 模型但 provider 未注册:")
    n1 = 0
    for p in sorted(models_p - provs):
        n = cur.execute("SELECT COUNT(*) FROM models WHERE platform=? AND enabled=1", (p,)).fetchone()[0]
        k = cur.execute("SELECT COUNT(*) FROM api_keys WHERE platform=? AND enabled=1", (p,)).fetchone()[0]
        print(f"  ❌ {p:<12} 模型 {n} 个 | key {k} 个")
        drift.append(f"models-orphan: {p} ({n} models, {k} keys)")
        n1 += 1
    if n1 == 0:
        print("  ✅ 无")

    # ② api_keys enabled=1 但 provider 未注册
    print("\n② api_keys 有 enabled=1 key 但 provider 未注册:")
    n2 = 0
    for p in sorted(keys_p - provs):
        n = cur.execute("SELECT COUNT(*) FROM api_keys WHERE platform=? AND enabled=1", (p,)).fetchone()[0]
        print(f"  ❌ {p:<12} key {n} 个")
        drift.append(f"keys-orphan: {p} ({n} keys)")
        n2 += 1
    if n2 == 0:
        print("  ✅ 无")

    # ③ provider 注册但无 enabled 模型（空 provider，仅提示）
    print("\n③ provider 注册但无 enabled=1 模型（仅提示，非漂移）:")
    n3 = 0
    for p in sorted(provs - models_p):
        print(f"  ℹ️  {p}")
        n3 += 1
    if n3 == 0:
        print("  ✅ 无")

    # ④ enabled=1 但平台无 enabled key（无 key 僵尸，2026-09-07 新增——清理 99 个后固化）
    #    排除 keyless 匿名平台（aihorde——AIHordeProvider registered keyless，匿名可用）。
    #    动态判断：白名单 OR 平台最近探活有成功记录（可匿名路由）。
    print("\n④ enabled=1 模型但平台无 enabled key（无 key 僵尸检查）:")
    KEYLESS_PLATFORMS = {"aihorde"}  # 已确认匿名平台（providers/aihorde.ts registered keyless）
    keyless_proven = set(r[0] for r in cur.execute(
        """SELECT DISTINCT m.platform FROM probe_logs p JOIN models m ON m.id = p.model_id
           WHERE p.success = 1 AND p.probed_at > datetime('now', '-30 days')
           AND NOT EXISTS (SELECT 1 FROM api_keys k WHERE k.platform = m.platform AND k.enabled = 1)"""
    ))
    n4 = 0
    for p in sorted(models_p - keys_p):
        n = cur.execute("SELECT COUNT(*) FROM models WHERE platform=? AND enabled=1", (p,)).fetchone()[0]
        if p in KEYLESS_PLATFORMS or p in keyless_proven:
            print(f"  ℹ️  {p:<12} 模型 {n} 个（keyless 匿名可用，正常）")
        else:
            print(f"  ❌ {p:<12} 模型 {n} 个（无 enabled key 且无探活成功记录——僵尸，应 disabled）")
            drift.append(f"no-key-zombie: {p} ({n} models)")
            n4 += 1
    if n4 == 0:
        print("  ✅ 无")

    conn.close()

    print(f"\n=== 结论: {'❌ ' + str(len(drift)) + ' 处漂移' if drift else '✅ 三方一致'} ===")
    if drift:
        for d in drift:
            print(f"  - {d}")
    if args.gate and drift:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
