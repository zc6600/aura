"""
Subagent Tool — Main Entry Point
Delegates utility functions to scripts/ package.
"""
import os
import json
import subprocess
import sys
import datetime

# Import all helpers from the scripts package
from scripts import (
    AtomicWriter,
    sanitize_name,
    truncate_text,
    extract_report,
    resolve_subagent_id,
    build_subagent_paths,
    find_aura_executable,
    load_persona,
    check_subagent_status,
    export_trajectory,
    build_async_wrapper_script,
)

def run_subagent(goal, subagent_id=None, max_steps=None, timeout=None, name=None, async_mode=False, persona=None, max_depth=None):
    if goal is None:
        goal = ""
    
    # Persona logic
    if persona:
        persona_data = load_persona(persona)
        if persona_data:
            role_instr = persona_data.get("instructions", "")
            if role_instr:
                goal = f"[ROLE: {persona.upper()}] {role_instr}\n\nTask: {goal}"
            else:
                goal = f"[ROLE: {persona.upper()}] {goal}"
    
    if str(goal).strip() == "":
        return {"status": "failed", "error": "Missing 'goal' or 'persona' with instructions"}
    
    # Recursion Guard with dynamic max_depth
    current_depth = int(os.environ.get("AURA_SUBAGENT_DEPTH", "0"))
    resolved_max_depth = 2
    if max_depth is not None:
        try:
            resolved_max_depth = int(max_depth)
        except ValueError:
            pass
    else:
        env_max_depth = os.environ.get("AURA_SUBAGENT_MAX_DEPTH")
        if env_max_depth:
            try:
                resolved_max_depth = int(env_max_depth)
            except ValueError:
                pass

    if current_depth >= resolved_max_depth:
        return {
            "status": "failed", 
            "error": f"Maximum subagent depth ({resolved_max_depth}) reached. Prevented potential infinite loop."
        }

    sid = resolve_subagent_id(subagent_id, name=name)
    paths = build_subagent_paths(sid)
    
    aura_bin = find_aura_executable()
    cmd = [aura_bin, "kernel", "loop", ".", "-g", str(goal)]
    
    if max_steps is not None:
        try:
            cmd += ["-m", str(int(max_steps))]
        except Exception:
            pass
            
    env = os.environ.copy()
    env["AURA_STATE_DB_PATH"] = paths["db_path"]
    env["AURA_TOOL_CONTEXTS_PATH"] = paths["contexts_path"]
    env["AURA_SUBAGENT_DEPTH"] = str(current_depth + 1)
    env["AURA_SUBAGENT_ID"] = sid
    env["AURA_SUBAGENT_MAX_DEPTH"] = str(resolved_max_depth)
    if "AURA_AGENT_ID" in os.environ:
        env["AURA_PARENT_AGENT_ID"] = os.environ["AURA_AGENT_ID"]
    
    initial_status = {
        "job_id": sid,
        "status": "running",
        "start_time": datetime.datetime.now().isoformat(),
        "goal": goal
    }
    AtomicWriter.write(paths["status_path"], initial_status)

    if async_mode:
        try:
            wrapper_script = build_async_wrapper_script(cmd, paths)
            subprocess.Popen(
                [sys.executable, "-c", wrapper_script],
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True
            )
            return {
                "status": "success",
                "mode": "async",
                "job_id": sid,
                "state_dir": paths["state_dir"],
                "message": f"Subagent {sid} started in background."
            }
        except Exception as e:
            err_res = {"status": "failed", "error": f"Failed to start async subagent: {str(e)}"}
            AtomicWriter.write(paths["status_path"], err_res)
            return err_res

    # Synchronous execution
    error_msg = None
    proc = None
    
    try:
        proc = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        error_msg = f"Subagent execution timed out after {timeout}s"
    except Exception as e:
        error_msg = f"Execution failed: {str(e)}"

    # Export trajectory regardless of success/failure
    trajectory_file = export_trajectory(paths["db_path"], paths["trajectory_path"])
    
    result = {
        "subagent_id": sid,
        "db_path": paths["db_path"]
    }
    if trajectory_file:
        result["trajectory_path"] = trajectory_file
        
    if error_msg:
        result["status"] = "failed"
        result["error"] = error_msg
        if proc and proc.stdout:
             result["stdout_partial"] = proc.stdout[:500]
        AtomicWriter.write(paths["status_path"], result)
        return result
        
    if proc.returncode != 0:
        result["status"] = "failed"
        result["error"] = f"Subagent process exited with code {proc.returncode}"
        result["stderr"] = proc.stderr[:500] if proc.stderr else ""
        AtomicWriter.write(paths["status_path"], result)
        return result
        
    # Parse output
    try:
        output_json = json.loads(proc.stdout)
        result["status"] = "success"
        result["report"] = extract_report(output_json)
        
        if "final" in output_json and isinstance(output_json["final"], dict):
             if "summary" in output_json["final"]:
                  result["summary"] = output_json["final"]["summary"]
        
        if "final" in output_json:
            result["final"] = output_json["final"]
            
    except json.JSONDecodeError:
        result["status"] = "failed"
        result["error"] = "Failed to parse subagent JSON output"
        result["raw_output"] = proc.stdout[:500]
        
    AtomicWriter.write(paths["status_path"], result)
    return result

if __name__ == "__main__":
    try:
        args = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
        action = args.get("action", "run")
        
        if action == "status":
            job_id = args.get("job_id") or args.get("subagent_id")
            result = check_subagent_status(job_id)
        else:
            goal = args.get("goal")
            subagent_id = args.get("subagent_id")
            name = args.get("name")
            max_steps = args.get("max_steps")
            timeout = args.get("timeout")
            async_mode = args.get("async_mode", False)
            persona = args.get("persona")
            max_depth = args.get("max_depth")
            result = run_subagent(
                goal, 
                subagent_id=subagent_id, 
                max_steps=max_steps, 
                timeout=timeout, 
                name=name, 
                async_mode=async_mode, 
                persona=persona,
                max_depth=max_depth
            )
            
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"status": "failed", "error": f"Kernel communication error: {str(e)}"}))
