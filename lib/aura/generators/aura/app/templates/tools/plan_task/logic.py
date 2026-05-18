import sys
import json
import sqlite3
import os

def resolve_db_path():
    env_db = os.environ.get("AURA_STATE_DB_PATH")
    if env_db is not None and str(env_db).strip() != "":
        raw = str(env_db).strip()
        if os.path.isabs(raw):
            return raw
        return os.path.abspath(os.path.join(os.getcwd(), raw))
    cfg_path = os.path.join(os.getcwd(), "config", "config.yml")
    if os.path.exists(cfg_path):
        try:
            with open(cfg_path, "r") as f:
                in_state = False
                for raw in f.readlines():
                    line = raw.rstrip("\n")
                    if line.strip() == "state_management:":
                        in_state = True
                        continue
                    if in_state and line.strip().endswith(":") and not line.lstrip().startswith("db_path:"):
                        in_state = False
                    if in_state and line.lstrip().startswith("db_path:"):
                        val = line.split(":", 1)[1].strip().strip("\"'")
                        if val:
                            return os.path.abspath(os.path.join(os.getcwd(), val))
        except Exception:
            pass
    db_dir = os.path.join(os.getcwd(), "state")
    preferred = os.path.join(db_dir, "aura.db")
    fallback = os.path.join(db_dir, "aura_state.db")
    return preferred if os.path.exists(preferred) else fallback

def set_plan(plan_content):
    db_path = resolve_db_path()
    if not os.path.exists(db_path):
        return {"error": f"State database not found at {db_path}", "status": "failed", "code": "state_db_missing"}
    
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        # Variables table schema: key TEXT PRIMARY KEY, value TEXT
        cursor.execute("INSERT OR REPLACE INTO variables (key, value) VALUES (?, ?)", ("plan", plan_content))
        conn.commit()
        conn.close()
        return {"status": "ok", "content": "Plan updated successfully"}
    except Exception as e:
        return {"error": str(e), "status": "failed", "code": "io_error"}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"status": "failed", "error": "No arguments provided", "code": "bad_request"}))
        sys.exit(0)
        
    try:
        args = json.loads(sys.argv[1])
        plan = args.get("plan")
        if plan is None:
            print(json.dumps({"status": "failed", "error": "Missing 'plan' argument", "code": "bad_request"}))
        else:
            res = set_plan(plan)
            print(json.dumps(res))
    except Exception as e:
        print(json.dumps({"status": "failed", "error": f"Logic error: {str(e)}", "code": "bad_request"}))
