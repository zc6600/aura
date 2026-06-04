#!/usr/bin/env python3
import sys
import json
import sqlite3
import os
import datetime

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
    base_dir = os.getcwd()
    state_root = os.path.join(base_dir, ".aura", "state") if os.path.exists(os.path.join(base_dir, ".aura")) else os.path.join(base_dir, "state")
    db_dir = state_root
    preferred = os.path.join(db_dir, "aura.db")
    fallback = os.path.join(db_dir, "aura_state.db")
    return preferred if os.path.exists(preferred) else fallback

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

def generate_task_markdown(tasks, completed, in_progress, run_id):
    lines = []
    lines.append(f"# Task Progress Checklist - Run {run_id}")
    lines.append(f"\nLast Updated: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
    
    comp_set = set(completed)
    ip_set = set(in_progress)
    
    for idx, t in enumerate(tasks):
        status = "[ ]"
        if idx in comp_set:
            status = "[x]"
        elif idx in ip_set:
            status = "[/]"
        lines.append(f"- {status} {t}")
        
    return "\n".join(lines)

def set_plan(plan_content):
    db_path = resolve_db_path()
    try:
        conn = get_db_connection(db_path)
        set_variable(conn, "plan", plan_content)
        
        # Write default task.md for backwards compatibility
        state_dir = os.path.dirname(db_path)
        run_id = get_variable(conn, "active_run_id") or "default"
        run_dir = os.path.join(state_dir, "runs", run_id)
        os.makedirs(run_dir, exist_ok=True)
        md_path = os.path.join(run_dir, "task.md")
        with open(md_path, "w", encoding="utf-8") as f:
            f.write(f"# Plan - Run {run_id}\n\n{plan_content}\n")
            
        conn.close()
        return {"status": "ok", "content": "Plan updated successfully"}
    except Exception as e:
        return {"error": str(e), "status": "failed", "code": "io_error"}

def main():
    try:
        if len(sys.argv) > 1 and sys.argv[1].strip():
            args = json.loads(sys.argv[1])
        else:
            args = json.loads(sys.stdin.read())
    except Exception as e:
        print(json.dumps({"error": f"Failed to parse input: {str(e)}", "status": "failed", "code": "bad_request"}))
        return

    # Check for direct 'plan' update (backwards compatibility)
    plan_content = args.get("plan")
    if plan_content is not None:
        res = set_plan(plan_content)
        print(json.dumps(res))
        return

    action = args.get("action", "update")
    db_path = resolve_db_path()
    state_dir = os.path.dirname(db_path)
    
    try:
        conn = get_db_connection(db_path)
    except Exception as e:
        print(json.dumps({"error": f"Database connection failed: {str(e)}", "status": "failed", "code": "db_error"}))
        return

    run_id = args.get("run_id") or get_variable(conn, "active_run_id")
    if not run_id:
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        run_id = f"run_{ts}"
        set_variable(conn, "active_run_id", run_id)

    run_dir = os.path.join(state_dir, "runs", run_id)
    os.makedirs(run_dir, exist_ok=True)
    json_path = os.path.join(run_dir, "task.json")
    md_path = os.path.join(run_dir, "task.md")

    if action == "create":
        tasks = args.get("tasks") or []
        completed = args.get("completed_indices") or []
        in_progress = args.get("in_progress_indices") or []
        
        # Save to DB
        set_variable(conn, f"tasks_list_{run_id}", json.dumps(tasks))
        set_variable(conn, f"tasks_completed_{run_id}", json.dumps(completed))
        set_variable(conn, f"tasks_in_progress_{run_id}", json.dumps(in_progress))
        
        markdown = generate_task_markdown(tasks, completed, in_progress, run_id)
        
        # Save files
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump({"tasks": tasks, "completed": completed, "in_progress": in_progress}, f, indent=2)
        with open(md_path, "w", encoding="utf-8") as f:
            f.write(markdown)
        # Mirror to workspace root for context discovery
        try:
            with open(os.path.join(os.getcwd(), "task.md"), "w", encoding="utf-8") as f:
                f.write(markdown)
        except Exception:
            pass
            
        rel_md_path = os.path.relpath(md_path, os.getcwd())
        print(json.dumps({
            "status": "success",
            "run_id": run_id,
            "tasks": tasks,
            "completed_indices": completed,
            "in_progress_indices": in_progress,
            "task_path": rel_md_path,
            "content": markdown
        }))
        
    elif action == "update":
        # Load existing tasks from DB
        raw_tasks = get_variable(conn, f"tasks_list_{run_id}")
        tasks = json.loads(raw_tasks) if raw_tasks else []
        
        # Override tasks if passed
        if args.get("tasks") is not None:
            tasks = args.get("tasks")
            
        completed = args.get("completed_indices")
        if completed is None:
            raw_comp = get_variable(conn, f"tasks_completed_{run_id}")
            completed = json.loads(raw_comp) if raw_comp else []
            
        in_progress = args.get("in_progress_indices")
        if in_progress is None:
            raw_ip = get_variable(conn, f"tasks_in_progress_{run_id}")
            in_progress = json.loads(raw_ip) if raw_ip else []

        # Save back to DB
        set_variable(conn, f"tasks_list_{run_id}", json.dumps(tasks))
        set_variable(conn, f"tasks_completed_{run_id}", json.dumps(completed))
        set_variable(conn, f"tasks_in_progress_{run_id}", json.dumps(in_progress))
        
        markdown = generate_task_markdown(tasks, completed, in_progress, run_id)
        
        # Save files
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump({"tasks": tasks, "completed": completed, "in_progress": in_progress}, f, indent=2)
        with open(md_path, "w", encoding="utf-8") as f:
            f.write(markdown)
        # Mirror to workspace root for context discovery
        try:
            with open(os.path.join(os.getcwd(), "task.md"), "w", encoding="utf-8") as f:
                f.write(markdown)
        except Exception:
            pass
            
        rel_md_path = os.path.relpath(md_path, os.getcwd())
        print(json.dumps({
            "status": "success",
            "run_id": run_id,
            "tasks": tasks,
            "completed_indices": completed,
            "in_progress_indices": in_progress,
            "task_path": rel_md_path,
            "content": markdown
        }))
        
    elif action == "get":
        raw_tasks = get_variable(conn, f"tasks_list_{run_id}")
        tasks = json.loads(raw_tasks) if raw_tasks else []
        
        raw_comp = get_variable(conn, f"tasks_completed_{run_id}")
        completed = json.loads(raw_comp) if raw_comp else []
        
        raw_ip = get_variable(conn, f"tasks_in_progress_{run_id}")
        in_progress = json.loads(raw_ip) if raw_ip else []
        
        markdown = generate_task_markdown(tasks, completed, in_progress, run_id)
        rel_md_path = os.path.relpath(md_path, os.getcwd())
        
        print(json.dumps({
            "status": "success",
            "run_id": run_id,
            "tasks": tasks,
            "completed_indices": completed,
            "in_progress_indices": in_progress,
            "task_path": rel_md_path,
            "content": markdown
        }))
    else:
        print(json.dumps({"error": f"Unknown action: {action}", "status": "failed", "code": "invalid_action"}))

    conn.close()

if __name__ == "__main__":
    main()
