"""
Cluster B 清理：修复 auto 回退链。
- 把 glm-4-flash 加入 profile 1 ('Default', active_profile_id=1) 并置顶 (priority=1)
  → auto 第一顺位命中可靠的免费智谱模型，秒回。
- 把死平台模型 (coze: key 全 disabled / github: key invalid) 降级到底部 (priority=9000+)
  → 不再占优先位、不再参与 early failover。
幂等 + 可逆（执行前备份 DB）。绝不打印 key 明文。
"""
import sqlite3, os, shutil, datetime

DB = os.path.join("server", "data", "freeapi.db")
BAK = DB + f".bak-{datetime.datetime.now():%Y%m%d-%H%M%S}-clusterB"
shutil.copy2(DB, BAK)
print(f"[backup] {BAK}")

c = sqlite3.connect(DB); q = c.cursor()

# 确认 active profile
row = q.execute("SELECT value FROM settings WHERE key='active_profile_id'").fetchone()
PID = int(row[0]) if row and row[0] else 1
print(f"[profile] active_profile_id = {PID}")

# 取 glm-4-flash 的 model db id
g = q.execute("SELECT id, enabled, key_id FROM models WHERE platform='zhipu' AND model_id='glm-4-flash'").fetchone()
if not g:
    raise SystemExit("ERROR: glm-4-flash 不在 models 表，先跑 ensure-main-model.py")
GID, GEN, GKEY = g
print(f"[glm-4-flash] model.id={GID} enabled={GEN} key_id={GKEY}")

# 当前是否已在 profile
existing = q.execute("SELECT priority FROM profile_models WHERE profile_id=? AND model_db_id=?", (PID, GID)).fetchone()
if existing:
    if existing[0] != 1:
        q.execute("UPDATE profile_models SET priority=1 WHERE profile_id=? AND model_db_id=?", (PID, GID))
        print(f"[glm-4-flash] profile 内 priority {existing[0]} -> 1 (置顶)")
    else:
        print("[glm-4-flash] 已在 profile 内且 priority=1，无需改动")
else:
    q.execute("INSERT INTO profile_models (profile_id, model_db_id, priority, enabled) VALUES (?,?,1,1)", (PID, GID))
    print("[glm-4-flash] 新增到 profile 1，priority=1 (置顶)")

# 死平台降级: coze (key enabled=0) + github (key invalid)
# 取当前最大 priority，死平台放到 9000+ 确保垫底（不影响其它模型相对顺序）
dead_platforms = ('coze', 'github')
rows = q.execute(f"""SELECT pm.id, m.platform, m.model_id, pm.priority
   FROM profile_models pm JOIN models m ON m.id=pm.model_db_id
   WHERE pm.profile_id=? AND m.platform IN ({','.join('?'*len(dead_platforms))})""",
   (PID, *dead_platforms)).fetchall()
print(f"\n[降级] 死平台模型数={len(rows)}")
new_pri = 9000
for rid, plat, mid, old in rows:
    q.execute("UPDATE profile_models SET priority=? WHERE id=?", (new_pri, rid))
    print(f"  {plat}/{mid}: priority {old} -> {new_pri}")
    new_pri += 1

c.commit()

# 报告新链首 5 + 尾 5
print("\n=== 清理后 profile 1 链首/链尾 ===")
allrows = q.execute("""SELECT pm.priority, m.platform, m.model_id,
   (SELECT status FROM api_keys WHERE id=m.key_id) ks
   FROM profile_models pm JOIN models m ON m.id=pm.model_db_id
   WHERE pm.profile_id=? ORDER BY pm.priority ASC""", (PID,)).fetchall()
print("  链首:")
for r in allrows[:5]:
    print(f"   pri={r[0]:<6} {r[1]:<11}/{r[2]:<28} kstatus={str(r[3])}")
print("  链尾:")
for r in allrows[-5:]:
    print(f"   pri={r[0]:<6} {r[1]:<11}/{r[2]:<28} kstatus={str(r[3])}")
print(f"\n  profile 内模型总数={len(allrows)}")

# 校验: glm-4-flash 是否为链首
first = allrows[0]
ok = (first[1]=='zhipu' and first[2]=='glm-4-flash')
print(f"\n[校验] glm-4-flash 是否为 auto 第一顺位: {'✅ 是' if ok else '❌ 否 (首位是 '+str(first)+')'}")
c.close()
