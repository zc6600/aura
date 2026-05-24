#!/usr/bin/env python3
import sys
import json
import os
import sqlite3
import time
import datetime

def resolve_db_path():
    env_db = os.environ.get("AURA_STATE_DB_PATH")
    if env_db is not None and str(env_db).strip() != "":
        raw = str(env_db).strip()
        if os.path.isabs(raw):
            return raw
        return os.path.abspath(os.path.join(os.getcwd(), raw))
    return os.path.abspath(os.path.join(os.getcwd(), "state", "aura.db"))

def get_db_connection(db_path):
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE IF NOT EXISTS variables (key TEXT PRIMARY KEY, value TEXT)")
    conn.commit()
    return conn

def get_variable(conn, key):
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM variables WHERE key=?", (key,))
    row = cursor.fetchone()
    return row[0] if row else None

def set_variable(conn, key, value):
    conn.execute("INSERT OR REPLACE INTO variables (key, value) VALUES (?, ?)", (key, str(value)))
    conn.commit()

def generate_markdown(goal, steps, files, verifications, run_id):
    lines = []
    lines.append(f"# Implementation Plan - Run {run_id}")
    lines.append(f"\n**Goal:** {goal or 'No goal specified'}\n")
    
    lines.append("## Proposed Steps")
    if steps:
        for s in steps:
            lines.append(f"- [ ] {s}")
    else:
        lines.append("- (No steps proposed)")
        
    lines.append("\n## Files to Modify")
    if files:
        for f in files:
            lines.append(f"- `{f}`")
    else:
        lines.append("- (No files specified)")
        
    lines.append("\n## Verification Plan")
    if verifications:
        for v in verifications:
            lines.append(f"- `{v}`")
    else:
        lines.append("- (No verification commands specified)")
    
    return "\n".join(lines)

def main():
    try:
        if len(sys.argv) > 1 and sys.argv[1].strip():
            args = json.loads(sys.argv[1])
        else:
            args = json.loads(sys.stdin.read())
    except Exception as e:
        print(json.dumps({"error": f"Failed to parse input: {str(e)}", "status": "failed", "code": "bad_request"}))
        return

    action = args.get("action", "create")
    db_path = resolve_db_path()
    state_dir = os.path.dirname(db_path)
    
    try:
        conn = get_db_connection(db_path)
    except Exception as e:
        print(json.dumps({"error": f"Database connection failed: {str(e)}", "status": "failed", "code": "db_error"}))
        return

    if action == "create":
        # Resolve run_id
        run_id = args.get("run_id")
        if not run_id:
            run_id = get_variable(conn, "active_run_id")
        if not run_id:
            ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            run_id = f"run_{ts}"
            
        set_variable(conn, "active_run_id", run_id)
        set_variable(conn, f"plan_status_{run_id}", "proposed")
        
        goal = args.get("goal")
        steps = args.get("steps") or []
        files = args.get("files_to_modify") or []
        verifications = args.get("verification_commands") or []
        
        # Save plan data to run isolated directory
        run_dir = os.path.join(state_dir, "runs", run_id)
        os.makedirs(run_dir, exist_ok=True)
        
        plan_data = {
            "goal": goal,
            "steps": steps,
            "files_to_modify": files,
            "verification_commands": verifications,
            "run_id": run_id,
            "timestamp": int(time.time())
        }
        
        # Write json and markdown files
        json_path = os.path.join(run_dir, "plan.json")
        md_path = os.path.join(run_dir, "plan.md")
        
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(plan_data, f, indent=2)
            
        markdown = generate_markdown(goal, steps, files, verifications, run_id)
        with open(md_path, "w", encoding="utf-8") as f:
            f.write(markdown)
            
        rel_json_path = os.path.relpath(json_path, os.getcwd())
        rel_md_path = os.path.relpath(md_path, os.getcwd())
        
        res = {
            "status": "proposed",
            "run_id": run_id,
            "plan_path": rel_md_path,
            "plan_json_path": rel_json_path,
            "content": markdown
        }
        print(json.dumps(res))
        
    elif action == "approve":
        run_id = args.get("run_id") or get_variable(conn, "active_run_id")
        if not run_id:
            print(json.dumps({"error": "No active run_id found to approve", "status": "failed", "code": "not_found"}))
            return
            
        set_variable(conn, f"plan_status_{run_id}", "approved")
        print(json.dumps({
            "status": "approved",
            "run_id": run_id
        }))
        
    elif action == "get":
        run_id = args.get("run_id") or get_variable(conn, "active_run_id")
        if not run_id:
            print(json.dumps({"error": "No active run_id found", "status": "failed", "code": "not_found"}))
            return
            
        status = get_variable(conn, f"plan_status_{run_id}") or "unknown"
        run_dir = os.path.join(state_dir, "runs", run_id)
        json_path = os.path.join(run_dir, "plan.json")
        
        plan_data = {}
        if os.path.exists(json_path):
            try:
                with open(json_path, "r", encoding="utf-8") as f:
                    plan_data = json.load(f)
            except Exception:
                pass
                
        print(json.dumps({
            "status": status,
            "run_id": run_id,
            "plan": plan_data
        }))
        
    else:
        print(json.dumps({"error": f"Unknown action: {action}", "status": "failed", "code": "invalid_action"}))

    conn.close()

if __name__ == "__main__":
    main()
