#!/usr/bin/env python3
import sys
import json
import os
import sqlite3
import subprocess
import time
import datetime

def resolve_db_path():
    env_db = os.environ.get("AURA_STATE_DB_PATH")
    if env_db is not None and str(env_db).strip() != "":
        raw = str(env_db).strip()
        if os.path.isabs(raw):
            return raw
        return os.path.abspath(os.path.join(os.getcwd(), raw))
    base_dir = os.getcwd()
    state_root = os.path.join(base_dir, ".aura", "state") if os.path.exists(os.path.join(base_dir, ".aura")) else os.path.join(base_dir, "state")
    return os.path.abspath(os.path.join(state_root, "aura.db"))

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

def get_modified_files(conn):
    modified_files = set()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='events'")
        if cursor.fetchone()[0] == 0:
            return []
            
        cursor.execute("SELECT id, phase, tool, payload FROM events ORDER BY id ASC")
        rows = cursor.fetchall()
        
        last_write_args = None
        for row_id, phase, tool, payload_json in rows:
            try:
                payload = json.loads(payload_json)
            except Exception:
                continue
                
            if phase == "plan" and tool == "write_file":
                last_write_args = payload.get("args") or {}
            elif phase == "execution" and tool == "write_file":
                result = payload.get("result") or {}
                if result.get("status") == "ok":
                    res_modified = result.get("modified_files")
                    if res_modified and isinstance(res_modified, list):
                        for f in res_modified:
                            modified_files.add(os.path.normpath(f))
                    elif last_write_args:
                        file_path = last_write_args.get("file_path")
                        if file_path:
                            # Normalize path relative to workspace
                            norm_path = os.path.normpath(file_path)
                            modified_files.add(norm_path)
    except Exception:
        pass
    return sorted(list(modified_files))

def get_file_diff(file_path):
    if not os.path.exists(file_path):
        return f"File does not exist: {file_path}"
        
    try:
        # Check if file is tracked in git
        p_ls = subprocess.run(["git", "ls-files", "--error-unmatch", file_path], capture_output=True, text=True)
        if p_ls.returncode == 0:
            # Tracked file: get diff against HEAD
            p_diff = subprocess.run(["git", "diff", "HEAD", "--", file_path], capture_output=True, text=True)
            return p_diff.stdout.strip()
        else:
            # Untracked file: diff against devnull
            p_diff = subprocess.run(["git", "diff", "--no-index", os.devnull, file_path], capture_output=True, text=True)
            return p_diff.stdout.strip()
    except Exception as e:
        return f"Failed to execute git diff for {file_path}: {str(e)}"

def compile_walkthrough(summary, modified_files, diffs, run_id):
    lines = []
    lines.append(f"# Task Walkthrough - Run {run_id}")
    lines.append(f"\n**Summary of Accomplishments:**\n{summary}\n")
    
    lines.append("## Files Modified")
    if modified_files:
        for f in modified_files:
            lines.append(f"- `{f}`")
    else:
        lines.append("- (No files modified)")
        
    lines.append("\n## Precise Code Diffs")
    if diffs:
        for f, diff_content in diffs.items():
            if diff_content.strip():
                lines.append(f"### Diffs for `{f}`")
                lines.append("```diff")
                lines.append(diff_content)
                lines.append("```\n")
    else:
        lines.append("- (No diffs compiled)")
        
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

    summary = args.get("summary")
    if not summary:
        print(json.dumps({"error": "Missing required parameter 'summary'", "status": "failed", "code": "bad_request"}))
        return

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

    modified_files = get_modified_files(conn)
    diffs = {}
    for f in modified_files:
        diff_content = get_file_diff(f)
        if diff_content:
            diffs[f] = diff_content

    markdown = compile_walkthrough(summary, modified_files, diffs, run_id)
    
    # Save walkthrough report to run isolated directory
    run_dir = os.path.join(state_dir, "runs", run_id)
    os.makedirs(run_dir, exist_ok=True)
    
    json_path = os.path.join(run_dir, "walkthrough.json")
    md_path = os.path.join(run_dir, "walkthrough.md")
    
    walkthrough_data = {
        "summary": summary,
        "modified_files": modified_files,
        "diffs": diffs,
        "run_id": run_id,
        "timestamp": int(time.time())
    }
    
    try:
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(walkthrough_data, f, indent=2)
        with open(md_path, "w", encoding="utf-8") as f:
            f.write(markdown)
    except Exception as e:
        print(json.dumps({"error": f"Failed to save walkthrough files: {str(e)}", "status": "failed", "code": "io_error"}))
        conn.close()
        return

    rel_json_path = os.path.relpath(json_path, os.getcwd())
    rel_md_path = os.path.relpath(md_path, os.getcwd())
    
    # Safely truncate diff content returned to context
    truncated_diffs = {}
    for f, diff_content in diffs.items():
        if len(diff_content) > 3000:
            truncated_diffs[f] = diff_content[:3000] + "\n...[diff truncated for context safety]..."
        else:
            truncated_diffs[f] = diff_content

    truncated_markdown = compile_walkthrough(summary, modified_files, truncated_diffs, run_id)

    res = {
        "status": "success",
        "run_id": run_id,
        "walkthrough_path": rel_md_path,
        "walkthrough_json_path": rel_json_path,
        "modified_files": modified_files,
        "content": truncated_markdown
    }
    print(json.dumps(res))
    conn.close()

if __name__ == "__main__":
    main()
