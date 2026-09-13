#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
apply-invalid-models.py — T0-2 无效模型/无效 key 禁用执行器（2026-09-07 豆包推演落地 · v2）

输入：platform-quality-audit.py 识别的失败模式，按层级精确处置：
  A. key 级问题（错误含 'Could not route'/'no provider support'/'No endpoints found'，
     且平台该模式占比≥90%）→ 禁 api_keys（模型保留，key 重配后一开即恢复）
     · 实测：cloudflare 36x 全 key 级 → 禁 key id=39，26 个 @cf/* 模型全部保留
  B. 模型级问题（0 成功 + 端点类错误）→ models.enabled=0 + user tombstone
     （catalog 同步 keep-deleted，防回潮）+ 从 profile 1 链摘除
     · 实测：openrouter 'unavailable for free' 11 个、modelscope DeepSeek-V4-Flash、
       nvidia kimi-k2.6 等

用法：
  python scripts/apply-invalid-models.py                 # dry-run
  python scripts/apply-invalid-models.py --apply         # 执行
  python scripts/apply-invalid-models.py --min-fails 2   # 最小失败次数（默认 2）

安全：
  - 不删任何行（只 enabled=0 / 摘链 / 写 tombstone / key 禁用）
  - --apply 前完整清单打印；执行后回读验证
"""
import sqlite3
import sys
import argparse
from datetime import datetime, timedelta

KEY_LEVEL_PATTERNS = ('Could not route', 'no provider support', 'No endpoints found')
MODEL_LEVEL_PATTERNS = ('Not found', 'unavailable for free', 'has no provider')
# v5 (2026-09-07 豆包固化)：410 EOL/下架模式 —— 此前缺失导致
#   glm-5.1（EOL 07-02）、gpt-oss-120b（EOL 09-03）、github gpt-4.1（410 retirement）漏网。
#   410 证据源 = requests 7 天失败，与探活（8h 窗口）合并成双源清理。
MODEL_EOL_PATTERNS = ('410', 'end of life', 'reached its end of life', 'retirement')


def classify_platform(conn, platform: str, since: str):
    """判定平台失败层级。返回 (key_ratio, model_ratio, total_fails)。"""
    row = conn.execute("""
        SELECT COUNT(*) as tot,
          SUM(CASE WHEN error LIKE '%Could not route%' OR error LIKE '%no provider support%'
                   OR error LIKE '%No endpoints found%' THEN 1 ELSE 0 END) as key_n,
          SUM(CASE WHEN error LIKE '%Not found%' OR error LIKE '%unavailable for free%'
                   OR error LIKE '%has no provider%' THEN 1 ELSE 0 END) as model_n
        FROM requests WHERE platform=? AND created_at>=? AND status!='success'
    """, (platform, since)).fetchone()
    tot = row['tot'] or 0
    key_n = row['key_n'] or 0
    model_n = row['model_n'] or 0
    if tot == 0:
        return 0, 0, 0
    return key_n / tot, model_n / tot, tot


def key_level_targets(conn, since: str, min_fails: int):
    """key 级主导平台 → 禁用的 api_keys 清单。"""
    targets = []
    for platform in conn.execute(
            "SELECT DISTINCT platform FROM api_keys WHERE enabled=1").fetchall():
        p = platform['platform']
        key_ratio, model_ratio, tot = classify_platform(conn, p, since)
        # 纯 key 级：key 级主导 且 无模型级失败
        if tot >= min_fails and key_ratio >= 0.5 and model_ratio == 0:
            keys = conn.execute(
                "SELECT id, label, status FROM api_keys WHERE platform=? AND enabled=1",
                (p,)).fetchall()
            targets.append((p, key_ratio, tot, keys))
    return targets


def model_level_targets(conn, since: str, min_fails: int):
    """模型级无效（0 成功 + 端点类错误），排除纯 key 级平台（其模型保留）。"""
    # 纯 key 级平台（模型级=0）：其模型不动
    key_only = []
    for platform in conn.execute(
            "SELECT DISTINCT platform FROM api_keys WHERE enabled=1").fetchall():
        p = platform['platform']
        _, model_ratio, tot = classify_platform(conn, p, since)
        if tot >= min_fails and model_ratio == 0:
            key_only.append(p)
    ph = ",".join("?" * len(key_only)) if key_only else "''"
    eol_clause = " OR ".join(f"error LIKE ?" for _ in MODEL_EOL_PATTERNS)
    # 双源清理：探活 404/Not found + requests 410/EOL（v5 固化）
    return conn.execute(f"""
        SELECT platform, model_id, COUNT(*) as n, substr(MAX(error),1,80) as sample
        FROM requests
        WHERE created_at >= ? AND status != 'success'
          AND ((error LIKE '%Not found%' OR error LIKE '%unavailable for free%'
               OR error LIKE '%has no provider%' OR error LIKE '%404%')
               OR ({eol_clause}))
          AND platform NOT IN ({ph})
        GROUP BY platform, model_id
        HAVING SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) = 0
          AND COUNT(*) >= ?
        ORDER BY n DESC
    """, (*[since], *[f"%{p}%" for p in MODEL_EOL_PATTERNS], *key_only, min_fails)).fetchall()


def zombie_platform_targets(conn):
    """C. 僵尸平台：0 个 enabled key 但链内有模型（无 key 不可路由，摘链减污染）。"""
    targets = []
    for platform in conn.execute(
            "SELECT DISTINCT platform FROM profile_models pm JOIN models m ON m.id=pm.model_db_id "
            "WHERE pm.profile_id=1").fetchall():
        p = platform['platform']
        keys = conn.execute("SELECT COUNT(*) n FROM api_keys WHERE platform=? AND enabled=1",
                            (p,)).fetchone()['n']
        if keys > 0:
            continue
        models = conn.execute("""
            SELECT m.id, m.model_id, m.enabled FROM profile_models pm
            JOIN models m ON m.id=pm.model_db_id
            WHERE pm.profile_id=1 AND m.platform=? ORDER BY m.intelligence_rank
        """, (p,)).fetchall()
        if models:
            targets.append((p, models))
    return targets


def main():
    ap = argparse.ArgumentParser(description='T0-2 无效模型/key 禁用执行器')
    ap.add_argument('--db', default=r'D:\Users\Yin\freellmapi\server\data\freeapi.db')
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--min-fails', type=int, default=2)
    args = ap.parse_args()

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    since = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d %H:%M:%S')
    mode = 'DRY-RUN' if not args.apply else 'APPLY'

    # A. key 级
    key_targets = key_level_targets(conn, since, args.min_fails)
    print(f"=== {mode} · A. key 级问题平台（禁 key，模型保留）===")
    if not key_targets:
        print("  （无）")
    for p, ratio, tot, keys in key_targets:
        print(f"  [{p}] key 级占比 {ratio:.0%}（{tot} 次失败）→ 禁 {len(keys)} 个 key:")
        for k in keys:
            print(f"      key id={k['id']} label={k['label']} status={k['status']}")

    # C. 僵尸平台
    zombie_targets = zombie_platform_targets(conn)
    print(f"=== {mode} · C. 僵尸平台（0 key，链内模型摘除）===")
    if not zombie_targets:
        print("  （无）")
    total_z = 0
    for p, models in zombie_targets:
        print(f"  [{p}] {len(models)} 个模型（无 key，不可路由）:")
        total_z += len(models)
        for m in models[:4]:
            print(f"      id={m['id']} {m['model_id']} (enabled={m['enabled']})")
        if len(models) > 4:
            print(f"      … 等 {len(models)} 个")
    if zombie_targets:
        print(f"  → 共 {total_z} 个模型建议摘链（配 key 后可重新加入）")

    # B. 模型级
    model_targets = model_level_targets(conn, since, args.min_fails)
    print(f"\n=== {mode} · B. 模型级无效（禁用 + tombstone + 摘链）===")
    if not model_targets:
        print("  （无）")
    for r in model_targets:
        m = conn.execute("SELECT id, enabled FROM models WHERE platform=? AND model_id=?",
                         (r['platform'], r['model_id'])).fetchone()
        if m is None:
            print(f"  [{r['platform']}] {r['model_id']}: {r['n']}x —— 不在 models 表")
            continue
        in_chain = conn.execute(
            "SELECT COUNT(*) c FROM profile_models pm JOIN models m2 ON m2.id=pm.model_db_id "
            "WHERE pm.profile_id=1 AND m2.platform=? AND m2.model_id=?",
            (r['platform'], r['model_id'])).fetchone()['c']
        print(f"  [{r['platform']}] {r['model_id']}: {r['n']}x (models.id={m['id']}, "
              f"enabled={m['enabled']}, 链内={in_chain})")
        print(f"      样例: {r['sample']}")

    if not args.apply:
        print(f"\n[DRY-RUN] 未修改。确认后加 --apply。")
        conn.close()
        return 0

    # 执行
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    applied = 0
    # C: 僵尸平台摘链
    for p, models in zombie_targets:
        for m in models:
            conn.execute("DELETE FROM profile_models WHERE profile_id=1 AND model_db_id=?", (m['id'],))
            applied += 1
        print(f"  [摘链] {p}: {len(models)} 个模型已从链摘除（models 行保留，配 key 可加回）")
    # A: 禁 key
    for p, _, _, keys in key_targets:
        for k in keys:
            conn.execute("UPDATE api_keys SET enabled=0 WHERE id=?", (k['id'],))
            applied += 1
        print(f"  [key] {p}: {len(keys)} 个 key 已禁用（模型保留，重配 key 可恢复）")
    # B: 模型禁用 + tombstone + 摘链
    for r in model_targets:
        m = conn.execute("SELECT id, enabled FROM models WHERE platform=? AND model_id=?",
                         (r['platform'], r['model_id'])).fetchone()
        if m is None:
            continue
        if m['enabled'] == 0:
            # 幂等保护（v5）：已 disabled 的模型跳过，避免重复 tombstone/摘链
            continue
        conn.execute("UPDATE models SET enabled=0 WHERE id=?", (m['id'],))
        conn.execute("""
            INSERT INTO catalog_model_tombstones (kind, platform, model_id, created_at, source, reason)
            VALUES ('chat', ?, ?, ?, 'user', ?)
            ON CONFLICT(kind, platform, model_id)
            DO UPDATE SET created_at=excluded.created_at, source='user', reason=excluded.reason
        """, (r['platform'], r['model_id'], now,
              f"audit-{now[:10]}: {r['n']}x 模型级失败，0 成功"))
        conn.execute("DELETE FROM profile_models WHERE profile_id=1 AND model_db_id=?", (m['id'],))
        # v5 固化：fallback_config 同步 disabled（此前仅手动同步，脚本内缺失）
        n_fb = conn.execute("UPDATE fallback_config SET enabled=0 WHERE model_db_id=?", (m['id'],)).rowcount
        if n_fb:
            print(f"      [fallback] {r['platform']} {r['model_id']}: {n_fb} 条已同步 disabled")
        applied += 1
    conn.commit()

    # 回读
    print(f"\n=== 执行完成：{applied} 项 ===")
    keys_off = conn.execute("SELECT platform, COUNT(*) n FROM api_keys WHERE enabled=0 "
                            "AND label='test'").fetchall() if False else conn.execute(
        "SELECT platform, COUNT(*) n FROM api_keys WHERE enabled=0").fetchall()
    for r in keys_off:
        print(f"  [key 已禁用] {r['platform']}: {r['n']}")
    tombs = conn.execute("SELECT platform, model_id FROM catalog_model_tombstones "
                         "WHERE source='user'").fetchall()
    print(f"  [user tombstone 总数] {len(tombs)}")
    for r in tombs:
        print(f"      {r['platform']} {r['model_id']}")
    conn.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
