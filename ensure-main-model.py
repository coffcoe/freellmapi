"""
ensure-main-model.py — 主轨道模型守护脚本（幂等，可重复运行）

背景：catalog-sync 每次重启会重放月级目录，把"注册在 catalog 平台且 key_id 为空"
的模型当作"上游已下架"删除。主轨道 glm-4-flash 曾因此消失（2026-07-01 / 07-09 两次）。

治本机制（无需改源码）：给 glm-4-flash 绑定既有健康的智谱 key → key_id 非空
→ 命中 catalog-sync.ts 删除逻辑的豁免条件（要求 key_id IS NULL 才删）→ 永久保留。
size_label='User' 为第二重豁免。

用法：cd freellmapi && python ensure-main-model.py
若将来主模型再次消失，运行本脚本一条命令即恢复。不打印任何密钥明文。
"""
import sqlite3, os

DB = os.path.join(os.path.dirname(__file__), "server", "data", "freeapi.db")
PLATFORM, MODEL_ID = "zhipu", "glm-4-flash"

def pick_zhipu_key(q):
    """选一把 healthy+enabled 的智谱 key（优先 zhipu_A）。"""
    r = q.execute("""SELECT id FROM api_keys WHERE platform='zhipu' AND enabled=1
                     AND status='healthy' ORDER BY id LIMIT 1""").fetchone()
    return r[0] if r else None

def main():
    c = sqlite3.connect(DB); q = c.cursor()
    key_id = pick_zhipu_key(q)
    if not key_id:
        print("[FAIL] 无可用的 healthy 智谱 key，无法固化主模型。请先在面板添加 zhipu key。")
        return
    fields = dict(display_name="GLM-4-Flash", intelligence_rank=45, speed_rank=92,
                  size_label="User", monthly_token_budget="Free", context_window=128000,
                  enabled=1, supports_vision=0, supports_tools=1, key_id=key_id,
                  paid_input_per_m=None, paid_output_per_m=None, category="chat")
    with c:
        row = q.execute("SELECT id FROM models WHERE platform=? AND model_id=?", (PLATFORM, MODEL_ID)).fetchone()
        if row:
            mid = row[0]
            q.execute("""UPDATE models SET size_label='User', enabled=1, key_id=:key_id,
                         paid_input_per_m=NULL, paid_output_per_m=NULL WHERE id=:id""",
                      {"key_id": key_id, "id": mid})
            print(f"[OK] 主模型已存在 (id={mid})，已确保 key_id={key_id}, enabled=1, size_label='User'")
        else:
            cur = q.execute("""INSERT INTO models
                (platform, model_id, display_name, intelligence_rank, speed_rank, size_label,
                 monthly_token_budget, context_window, enabled, supports_vision, supports_tools,
                 key_id, paid_input_per_m, paid_output_per_m, category)
                VALUES (:platform,:model_id,:display_name,:intelligence_rank,:speed_rank,:size_label,
                 :monthly_token_budget,:context_window,:enabled,:supports_vision,:supports_tools,
                 :key_id,:paid_input_per_m,:paid_output_per_m,:category)""",
                {**fields, "platform": PLATFORM, "model_id": MODEL_ID})
            mid = cur.lastrowid
            print(f"[OK] 主模型已重建 (id={mid}, key_id={key_id})")
        fb = q.execute("SELECT id FROM fallback_config WHERE model_db_id=?", (mid,)).fetchone()
        if fb:
            q.execute("UPDATE fallback_config SET enabled=1 WHERE id=?", (fb[0],))
        else:
            q.execute("INSERT INTO fallback_config (model_db_id, priority, enabled) VALUES (?, 1, 1)", (mid,))
    # 豁免自检
    hit = q.execute("""SELECT 1 FROM models WHERE platform=? AND model_id=?
                       AND platform!='custom' AND key_id IS NULL
                       AND size_label NOT IN ('User','Custom')""", (PLATFORM, MODEL_ID)).fetchone()
    print(f"[VERIFY] catalog-sync 删除豁免: {'FAIL(会被删)' if hit else 'PASS(永久保留)'}")
    c.close()

if __name__ == "__main__":
    main()
