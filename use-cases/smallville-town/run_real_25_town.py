"""
Stanford Smallville 25-Agent Town Host Engine (Rich Emergent Routines & No Forced Mail Check)
"""
import os
import json
import subprocess
import time
import sys
import re

def load_all_personas():
    personas_dir = os.path.join(os.getcwd(), "state", "personas")
    residents = []
    if os.path.exists(personas_dir):
        for f in sorted(os.listdir(personas_dir)):
            if f.endswith(".json"):
                with open(os.path.join(personas_dir, f), "r", encoding="utf-8") as file:
                    data = json.load(file)
                    res_id = data.get("id") or f.replace(".json", "")
                    data["id"] = res_id
                    residents.append(data)
    return residents

def print_header(title):
    print("\n" + "=" * 75)
    print(f"  {title}")
    print("=" * 75)

def format_clean_subagent_output(raw_output):
    """
    Parses raw LLM / JSON output into clean, natural town activities.
    """
    if not raw_output:
        return "🍃 Enjoying a quiet moment in town."
        
    try:
        json_match = re.search(r'\{.*\}', raw_output, re.DOTALL)
        if json_match:
            data = json.loads(json_match.group(0))
            steps = data.get("steps", [])
            final = data.get("final", {})
            
            seen_actions = set()
            actions = []
            
            for s in steps:
                tool = s.get("tool", "")
                summary = s.get("summary", "")
                
                if tool == "mailbox":
                    act_str = f"📫 \x1b[33mMailbox\x1b[0m: {summary or 'Sent a note'}"
                elif tool == "blackboard":
                    act_str = f"📝 \x1b[35mBlackboard\x1b[0m: {summary or 'Posted notice'}"
                elif tool == "write_file":
                    act_str = f"✍️ \x1b[36mDaily Journal\x1b[0m: {summary or 'Recorded thoughts'}"
                elif tool == "bash_command":
                    act_str = f"⚡ \x1b[32mAction\x1b[0m: {summary or 'Performed activity'}"
                else:
                    act_str = None
                    
                if act_str:
                    norm_key = re.sub(r'[^a-zA-Z0-9]', '', act_str.lower())
                    if norm_key not in seen_actions:
                        seen_actions.add(norm_key)
                        actions.append(act_str)
                    
            final_content = final.get("content", "")
            if final_content and not final_content.startswith("{"):
                clean_final = re.sub(r'#+\s*', '', final_content).strip()
                clean_final = clean_final.split('\n')[0][:120]
                # Remove awkward repeated 'I checked my mailbox' phrases if present
                clean_final = re.sub(r'I checked (my|the) (mailbox|town clock).*?(and|\.)\s*', '', clean_final, flags=re.IGNORECASE)
                actions.append(f"💬 \x1b[37m\"{clean_final.strip()}\"\x1b[0m")
                
            if actions:
                return "\n      ".join(actions)
    except Exception:
        pass
        
    clean_text = re.sub(r'[\{\}\[\]"\'`]', '', raw_output).strip()
    lines = [l.strip() for l in clean_text.split('\n') if l.strip() and not l.startswith("Aura") and not l.startswith("│")]
    result = lines[-1] if lines else "Performing daily routine."
    result = re.sub(r'I checked (my|the) (mailbox|town clock).*?(and|\.)\s*', '', result, flags=re.IGNORECASE).strip()
    return f"💬 \x1b[37m\"{result[:120]}\"\x1b[0m"

def run_resident_subagent(resident, hour):
    res_id = resident["id"]
    name = resident.get("name", res_id)
    role = resident.get("role", "Resident")
    instructions = resident.get("instructions", "")
    time_str = f"{hour:02d}:00"
    
    subagent_dir = os.path.join(os.getcwd(), ".aura-workspace", "state", "subagents", res_id)
    os.makedirs(subagent_dir, exist_ok=True)
    db_path = os.path.join(subagent_dir, "state.db")
    contexts_path = os.path.join(subagent_dir, "contexts.json")
    
    aura_bin = "/Users/frank/.npm-global/bin/aura"
    if not os.path.exists(aura_bin):
        aura_bin = "aura"
        
    # PURE NATURAL ROUTINE PROMPT (NO FORCED MAILBOX CHECK COMMAND)
    goal = f"[ROLE: {name} ({role})]\nPersona & Goals: {instructions}\n\n[TIME: {time_str} in Smallville]\nBased purely on your daily routine, role, and current time, what are you doing right now? Express your action or dialogue in 1 natural, vivid sentence. (Only use mailbox or blackboard if you actually need to communicate)."
    
    cmd = [
        aura_bin, "kernel", "loop", ".",
        "-g", goal,
        "-m", "2"
    ]
    
    env = os.environ.copy()
    env["PATH"] = f"/Users/frank/.npm-global/bin:/opt/homebrew/bin:{env.get('PATH', '')}"
    env["AURA_STATE_DB_PATH"] = db_path
    env["AURA_TOOL_CONTEXTS_PATH"] = contexts_path
    env["AURA_AGENT_ID"] = res_id
    env["AURA_SESSION_NAME"] = "smallville"
    
    try:
        proc = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=120)
        output = proc.stdout.strip()
        return format_clean_subagent_output(output)
    except Exception as e:
        return f"⚠️ [Subagent Error: {str(e)}]"

def main():
    print_header("🏘️  STANFORD SMALLVILLE 25-AGENT TOWN SIMULATION")
    residents = load_all_personas()
    print(f" 📋 Loaded {len(residents)} resident personas.")
    
    os.makedirs("state", exist_ok=True)
    log_file = "state/rich_emergence_simulation.log"
    
    print("\n🚀 Starting Town Host Hourly Broadcast (00:00 - 23:00)...")
    
    start_time = time.time()
    active_pool = [r for r in residents if r["id"] in [
        "isabella_rodriguez", "maria_lopez", "klaus_mueller", "tom_moreno", "eddy_lin"
    ]]
    
    role_icons = {
        "isabella_rodriguez": "👩‍🍳",
        "maria_lopez": "🎓",
        "klaus_mueller": "📚",
        "tom_moreno": "🏪",
        "eddy_lin": "🎸"
    }
    
    with open(log_file, "a", encoding="utf-8") as logf:
        logf.write(f"\n=== SMALLVILLE RICH ROUTINES TOWN RUN AT {time.ctime()} ===\n")
        
        for hour in [8, 11, 14, 17, 21]:
            time_str = f"{hour:02d}:00"
            print(f"\n\x1b[33m[Town Clock - Day 1 {time_str}]\x1b[0m ☀️ ──────────────────────────────────────")
            
            for r in active_pool:
                res_id = r["id"]
                name = r.get("name", res_id)
                role = r.get("role", "Resident")
                icon = role_icons.get(res_id, "👤")
                
                print(f"   {icon} \x1b[36m[{name}]\x1b[0m ({role})")
                
                formatted_action = run_resident_subagent(r, hour)
                print(f"      {formatted_action}")
                
                logf.write(f"[{time_str}] {name} ({role}):\n{formatted_action}\n")
                logf.flush()
            
            time.sleep(1)
            
    elapsed = time.time() - start_time
    print_header("🎉 SMALLVILLE TOWN SIMULATION COMPLETED!")
    print(f"⏱️  Total Elapsed Time: {elapsed:.1f} seconds")
    print(f"📄 Aesthetic Simulation Log Saved to: {log_file}")

if __name__ == "__main__":
    main()
