"""
Subagent-specific helper functions.
Handles ID resolution, path management, persona loading, trajectory export, and async wrapper.
"""
import os
import json
import time
import random
import string
import sqlite3
import datetime
import shutil
import sys

from .utils import sanitize_name, AtomicWriter, truncate_text


def resolve_subagent_id(subagent_id, name=None):
    """Generate a unique subagent ID from explicit ID, name alias, or auto-generate."""
    target = subagent_id or name
    if target:
        cleaned = sanitize_name(str(target))
        if cleaned:
            suffix = ''.join(random.choices(string.ascii_lowercase + string.digits, k=4))
            return f"{cleaned}_{suffix}"
    
    suffix = ''.join(random.choices(string.ascii_lowercase + string.digits, k=4))
    return f"subagent_{int(time.time())}_{os.getpid()}"


def build_subagent_paths(subagent_id, base_dir=None):
    """Build the hierarchical directory structure for a subagent's isolated state."""
    if base_dir is None:
        base_dir = os.getcwd()
    
    parent_id = os.environ.get("AURA_SUBAGENT_ID", "root")
    state_dir = os.path.join(base_dir, "state", "subagents", parent_id, subagent_id)
    bus_dir = os.path.join(base_dir, "state", "bus")
    
    if not os.path.exists(state_dir):
        os.makedirs(state_dir, exist_ok=True)
    if not os.path.exists(bus_dir):
        os.makedirs(bus_dir, exist_ok=True)
    
    return {
        "state_dir": state_dir,
        "bus_dir": bus_dir,
        "db_path": os.path.join(state_dir, "aura.db"),
        "contexts_path": os.path.join(state_dir, "tool_contexts.json"),
        "trajectory_path": os.path.join(state_dir, "trajectory.txt"),
        "status_path": os.path.join(state_dir, "status.json"),
        "report_path": os.path.join(state_dir, "report.md")
    }


def find_aura_executable():
    """Locate the aura CLI binary through multiple search strategies."""
    if os.path.isfile("./bin/aura"):
        return "./bin/aura"
    path_aura = shutil.which("aura")
    if path_aura:
        return path_aura

    for p in ["/usr/local/bin/aura", "/opt/homebrew/bin/aura", os.path.expanduser("~/.local/bin/aura")]:
        if os.path.isfile(p):
            return p

    script_dir = os.path.dirname(os.path.abspath(__file__))
    potential_bins = [
        os.path.join(script_dir, "../../../../../../../../bin/aura"),
        os.path.join(os.getcwd(), "bin/aura"),
        os.path.join(os.getcwd(), "../../bin/aura")
    ]
    for p in potential_bins:
        if os.path.isfile(p):
            return p
        
    return "aura"


def load_persona(persona_name, base_dir=None):
    """Load persona instructions from state/personas/{name}.json."""
    if base_dir is None:
        base_dir = os.getcwd()
    
    persona_path = os.path.join(base_dir, "state", "personas", f"{persona_name}.json")
    if not os.path.exists(persona_path):
        return None
    
    try:
        with open(persona_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except:
        return None


def check_subagent_status(job_id, base_dir=None):
    """Check the execution status of a subagent by its job_id."""
    if not job_id:
         return {"status": "failed", "error": "Missing 'job_id' argument"}
    
    if base_dir is None:
        base_dir = os.getcwd()
    
    subagents_root = os.path.join(base_dir, "state", "subagents")
    
    if not os.path.exists(subagents_root):
        return {"status": "failed", "error": "No subagents have been started yet."}
    
    status_file = None
    
    direct_path = os.path.join(subagents_root, "root", job_id, "status.json")
    if os.path.exists(direct_path):
        status_file = direct_path
    else:
        for root_entry in os.scandir(subagents_root):
            if root_entry.is_dir():
                potential = os.path.join(root_entry.path, job_id, "status.json")
                if os.path.exists(potential):
                    status_file = potential
                    break
    
    if not status_file:
        return {"status": "failed", "error": f"Job ID {job_id} not found."}
    
    try:
        with open(status_file, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        return {"status": "failed", "error": f"Failed to read status: {str(e)}"}


def export_trajectory(db_path, output_path):
    """Export a subagent's event log from SQLite DB to a human-readable trajectory file."""
    if not os.path.isfile(db_path):
        return None
    
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        cursor.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='events'")
        if cursor.fetchone()[0] == 0:
            conn.close()
            return None
            
        cursor.execute("SELECT timestamp, phase, tool, payload FROM events ORDER BY id ASC")
        rows = cursor.fetchall()
        
        lines = []
        lines.append("=" * 80)
        lines.append(f"SUBAGENT TRAJECTORY EXPORT - {datetime.datetime.now().isoformat()}")
        lines.append("=" * 80 + "\n")
        
        for ts, phase, tool, payload_json in rows:
            try:
                time_str = datetime.datetime.fromtimestamp(ts).strftime("%H:%M:%S")
            except:
                time_str = str(ts)
                
            try:
                payload = json.loads(payload_json)
            except:
                payload = {}
                
            phase_str = (phase or "unknown").upper()
            tool_str = tool or "-"
            
            detail = ""
            if phase == "plan":
                p = payload.get("plan") or {}
                raw_summary = str(p.get('summary') or p.get('tool') or "")
                detail = f"Task: {truncate_text(raw_summary)}"
            elif phase == "execution":
                res = payload.get("result") or {}
                status = res.get("status") or "ok"
                output = str(res.get("output") or "")
                output_trunc = truncate_text(output.replace("\n", " "), limit=1000)
                detail = f"Result: {status.upper()} | {output_trunc}"
            elif phase == "interception":
                raw_advice = str(payload.get('advice') or "")
                detail = f"Advice: {truncate_text(raw_advice)}"
            elif phase == "user":
                raw_input = str(payload)
                detail = f"Input: {truncate_text(raw_input)}"
            else:
                raw_payload = str(payload)
                detail = truncate_text(raw_payload)
                
            lines.append(f"[{time_str}] {phase_str:<10} | {tool_str:<15} | {detail}")
            
        conn.close()
        
        if not lines:
            return None
            
        with open(output_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
            
        return output_path
        
    except Exception as e:
        return None


def build_async_wrapper_script(cmd, paths):
    """Generate an inline Python script that runs the subagent command and updates status.json on completion."""
    cmd_json = json.dumps(cmd)
    status_path = json.dumps(paths["status_path"])
    db_path = json.dumps(paths["db_path"])
    trajectory_path = json.dumps(paths["trajectory_path"])
    report_path = json.dumps(paths.get("report_path", ""))
    
    return f'''
import subprocess, json, os, time, datetime, sqlite3

cmd = {cmd_json}
status_path = {status_path}
db_path = {db_path}
trajectory_path = {trajectory_path}
report_path = {report_path}

def atomic_write(file_path, data):
    tmp_path = f"{{file_path}}.{{int(time.time() * 1000)}}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.rename(tmp_path, file_path)

def truncate_text(text, limit=1000):
    if not text:
        return ""
    if len(text) <= limit:
        return text
    half = limit // 2
    return text[:half] + "\\n...[truncated]...\\n" + text[-half:]

try:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    result = {{"job_id": os.path.basename(os.path.dirname(status_path))}}
    
    if proc.returncode == 0:
        try:
            output_json = json.loads(proc.stdout)
            result["status"] = "success"
            
            # Extract full report
            report_text = ""
            if "final" in output_json:
                final = output_json["final"]
                if isinstance(final, dict):
                    report_text = final.get("content", str(final))
                    summary_val = final.get("summary")
                else:
                    report_text = str(final)
                    summary_val = None
            else:
                report_text = output_json.get("result", "")
                summary_val = None

            # Write full report to file
            if report_path:
                try:
                    os.makedirs(os.path.dirname(report_path), exist_ok=True)
                    with open(report_path, "w", encoding="utf-8") as rf:
                        rf.write(str(report_text))
                    result["report_path"] = os.path.relpath(report_path, os.getcwd())
                except Exception as re_err:
                    result["report_write_error"] = str(re_err)

            # Construct summary
            if summary_val:
                result["summary"] = summary_val
            else:
                clean_rep = str(report_text).strip()
                result["summary"] = clean_rep[:500] + " ... [truncated] ..." if len(clean_rep) > 500 else clean_rep

            # Truncated report for status (using safe limit of 30000)
            result["report"] = truncate_text(str(report_text), 30000)
            if "final" in output_json:
                result["final"] = output_json["final"]

        except json.JSONDecodeError:
            result["status"] = "failed"
            result["error"] = "Failed to parse subagent JSON output"
            result["raw_output"] = proc.stdout[:500]
    else:
        result["status"] = "failed"
        result["error"] = f"Subagent process exited with code {{proc.returncode}}"
        result["stderr"] = proc.stderr[:500] if proc.stderr else ""
    
    result["end_time"] = datetime.datetime.now().isoformat()
    atomic_write(status_path, result)
    
except Exception as e:
    atomic_write(status_path, {{
        "status": "failed",
        "error": f"Async wrapper error: {{str(e)}}",
        "end_time": datetime.datetime.now().isoformat()
    }})
'''
