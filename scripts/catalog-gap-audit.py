#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
catalog-gap-audit.py — catalog 缺口巡检（2026-09-07 豆包固化 · v1）

来源：catalog-sync 127 skipped (unknown platform) 只有计数、无明细（navy 104/requesty 8/
      sealion 5/aion 4/nara 3 全靠手工从代码推断）；且明细日志只在 catalog 版本更新时输出，
      平时不可见。

方案：直接从本地缓存（settings.catalog_applied_json）扫描 catalog 模型平台分布，
      对比 providers 注册（复用 platform-consistency-audit.load_registered_providers），
      输出"catalog 有模型但本地 provider 未注册"的缺口明细。

用法：
  python scripts/catalog-gap-audit.py                # 报告
  python scripts/catalog-gap-audit.py --gate         # 有缺口 exit 1（供周巡检）
"""
import sys
import re
import json
import argparse
import sqlite3
from collections import Counter
from pathlib import Path

DB = r"D:\Users\Yin\freellmapi\server\data\freeapi.db"
SRC = Path(r"D:\Users\Yin\freellmapi\server\src")
SETTING_KEY = "catalog_applied_json"


def load_registered_providers(src: Path) -> set[str]:
    """从 providers 目录提取全部注册平台名（覆盖 4 种写法，与
    platform-consistency-audit.py 一致；文件名带连字符无法 import，故内联）。"""
    found: set[str] = set()
    pat1 = re.compile(r"""platform:\s*['"]([^'"]+)['"]""")
    pat2 = re.compile(r"""platform\s*=\s*['"]([^'"]+)['"]\s*as\s+const""")
    pat3 = re.compile(r"""platform\s*=\s*['"]([^'"]+)['"]""")
    pat4 = re.compile(r"""platform\s*:\s*[\w.]+\s*=\s*['"]([^'"]+)['"]""")
    for f in (src / "providers").glob("*.ts"):
        text = f.read_text(encoding="utf-8")
        found.update(pat1.findall(text))
        found.update(pat2.findall(text))
        found.update(pat3.findall(text))
        found.update(pat4.findall(text))
    return found


def main() -> int:
    ap = argparse.ArgumentParser(description="catalog 缺口巡检")
    ap.add_argument("--db", default=DB)
    ap.add_argument("--src", default=str(SRC))
    ap.add_argument("--gate", action="store_true", help="有缺口时 exit 1")
    args = ap.parse_args()

    conn = sqlite3.connect(args.db)
    row = conn.execute("SELECT value FROM settings WHERE key=?", (SETTING_KEY,)).fetchone()
    conn.close()
    if not row:
        print("❌ 无 catalog 缓存（settings.catalog_applied_json 不存在）——先跑一次 catalog 同步")
        return 2
    cat = json.loads(row[0])

    provs = load_registered_providers(Path(args.src))
    models = cat.get("models", [])
    by_platform: Counter = Counter(m.get("platform", "?") for m in models)
    gaps = {p: n for p, n in by_platform.items() if p not in provs}

    print(f"=== catalog 缺口巡检（缓存 v{cat.get('version')} / {cat.get('tier')}）===")
    print(f"catalog 模型总数: {len(models)}  |  providers 注册: {len(provs)}")
    print()
    print("① 缺口平台（catalog 有模型但 provider 未注册）:")
    if not gaps:
        print("  ✅ 无缺口")
    for p, n in sorted(gaps.items(), key=lambda x: -x[1]):
        sample = [m.get("modelId") for m in models if m.get("platform") == p][:3]
        print(f"  ❌ {p:<12} {n} 个模型  例: {', '.join(sample)}")
    print()
    print("② 已覆盖平台（catalog + provider 均就绪）:")
    covered = sorted((p, n) for p, n in by_platform.items() if p in provs)
    for p, n in covered:
        print(f"  ✅ {p:<12} {n}")
    print()
    total_gap = sum(gaps.values())
    print(f"=== 结论: {'❌ 缺口 ' + str(total_gap) + ' 个模型（' + str(len(gaps)) + ' 平台）' if gaps else '✅ 无缺口'} ===")
    if args.gate and gaps:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
