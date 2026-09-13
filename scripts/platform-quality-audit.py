#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
platform-quality-audit.py — FreeLLMAPI 免费池平台质量巡检（2026-09-07 豆包推演落地）

输出全平台质量矩阵 + 无效模型 ID 清单 + 门禁模式（发现劣平台 exit 1）。
数据源：requests 表 7 天成败 + profile 链模型数 + api_keys 健康信号。

用法：
  python scripts/platform-quality-audit.py                       # 报告模式（stdout）
  python scripts/platform-quality-audit.py --db <path>           # 指定 DB
  python scripts/platform-quality-audit.py --gate                # 门禁：存在劣平台(0%且≥N请求) → exit 1
  python scripts/platform-quality-audit.py --min-reqs 5          # 门禁最小请求阈值（默认 5）

分级规则（对齐 cb-1051 §十一 质量矩阵）：
  优质  ≥80% 成功率
  良好  ≥60%
  差    ≥30%
  劣    0%（且有请求记录）
  无请求 无 7 天请求
"""
import sqlite3
import sys
import argparse
from datetime import datetime, timedelta


def audit(db_path: str, min_reqs: int, gate: bool) -> int:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    since = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d %H:%M:%S')

    rows = conn.execute("""
        SELECT p.platform,
               COALESCE(r.t, 0) as reqs, COALESCE(r.s, 0) as succ,
               COALESCE(ROUND(100.0*r.s/NULLIF(r.t,0),1), -1) as pct,
               (SELECT COUNT(*) FROM profile_models pm JOIN models m ON m.id=pm.model_db_id
                WHERE pm.profile_id=1 AND m.platform=p.platform) as chain_n,
               (SELECT COUNT(*) FROM api_keys k WHERE k.platform=p.platform AND k.enabled=1
                AND k.status='healthy') as healthy_keys,
               (SELECT COUNT(*) FROM api_keys k WHERE k.platform=p.platform AND k.enabled=1
                AND k.last_health_error IS NOT NULL AND k.last_health_error != '') as err_keys
        FROM (SELECT DISTINCT platform FROM api_keys WHERE enabled=1) p
        LEFT JOIN (SELECT platform, COUNT(*) as t,
                          SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) as s
                   FROM requests WHERE created_at >= ? GROUP BY platform) r
          ON r.platform = p.platform
        ORDER BY pct DESC
    """, (since,)).fetchall()

    print(f"=== 平台质量矩阵（7 天窗口至 {since}）===")
    print(f"{'平台':14s} {'请求':>5s} {'成功':>5s} {'成功率':>7s} {'分级':>6s} {'链模型':>5s} {'健康key':>6s} {'errKey':>5s}")
    tiers = {}
    for r in rows:
        pct = r['pct']
        if pct < 0:
            tier = '无请求'
        elif pct >= 80:
            tier = '优质'
        elif pct >= 60:
            tier = '良好'
        elif pct >= 30:
            tier = '差'
        else:
            tier = '劣'
        tiers.setdefault(tier, []).append(r['platform'])
        pct_s = f"{pct}%" if pct >= 0 else "  -"
        print(f"{r['platform']:14s} {r['reqs']:5d} {r['succ']:5d} {pct_s:>7s} {tier:>6s} "
              f"{r['chain_n']:5d} {r['healthy_keys']:6d} {r['err_keys']:5d}")

    # 无效模型 ID 清单（0 成功且错误含 no provider support / 404 / not found）
    print()
    print("=== 疑似无效模型 ID（0 成功 + 端点类错误）===")
    bad = conn.execute("""
        SELECT platform, model_id, COUNT(*) as n
        FROM requests
        WHERE created_at >= ? AND status != 'success'
          AND (error LIKE '%no provider support%' OR error LIKE '%404%'
               OR error LIKE '%No endpoints found%' OR error LIKE '%Could not route%'
               OR error LIKE '%not found%')
        GROUP BY platform, model_id
        HAVING SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) = 0
        ORDER BY n DESC
    """, (since,)).fetchall()
    if bad:
        for b in bad:
            print(f"  {b['platform']:14s} {b['model_id']}: {b['n']}x 端点类失败")
    else:
        print("  （无）")

    # 门禁判定（0% 平台优先怀疑 key 过期：cloudflare 等月度轮换 key）
    bad_platforms = [r['platform'] for r in rows if r['pct'] == 0 and r['reqs'] >= min_reqs]
    if bad_platforms:
        print()
        print("=== ⚠️ 0% 平台提示：优先排查 key 过期（月度轮换规律）===")
        print("  cloudflare 等平台 key 有效期约 1 个月——404 'Could not route' 多为 key 过期，")
        print("  模型本身有效（@cf/* 为 Workers AI 标准模型），换新 key 即恢复，勿误删模型。")
        print("  其他平台 0% 且错误为 'Not found'/'unavailable for free' 则为模型级无效，走 apply 清理。")
    if gate and bad_platforms:
        print(f"\n[GATE] 劣平台（0% 且 ≥{min_reqs} 请求）: {', '.join(bad_platforms)} → exit 1")
        return 1
    if gate:
        print(f"\n[GATE] 无劣平台 → exit 0")
    conn.close()
    return 0


def main():
    ap = argparse.ArgumentParser(description='FreeLLMAPI 平台质量巡检')
    ap.add_argument('--db', default=r'D:\Users\Yin\freellmapi\server\data\freeapi.db')
    ap.add_argument('--min-reqs', type=int, default=5)
    ap.add_argument('--gate', action='store_true')
    args = ap.parse_args()
    sys.exit(audit(args.db, args.min_reqs, args.gate))


if __name__ == '__main__':
    main()
