import os
import json
import sys
import time
import tempfile
import datetime

def resolve_bus_dir():
    # Resolve active session name to isolate blackboard key-value bus!
    session_name = os.environ.get("AURA_SESSION_NAME")
    base_dir = os.getcwd()
    state_root = os.path.join(base_dir, ".aura", "state") if os.path.exists(os.path.join(base_dir, ".aura")) else os.path.join(base_dir, "state")
    
    if not session_name:
        active_txt = os.path.join(state_root, "active_session.txt")
        if os.path.exists(active_txt):
            try:
                with open(active_txt, "r") as f:
                    session_name = f.read().strip()
            except:
                pass
    if not session_name:
        session_name = "default"
    
    bus_dir = os.path.join(state_root, "sessions", session_name, "bus")
    os.makedirs(bus_dir, exist_ok=True)
    return bus_dir

def blackboard_write(key, data):
    bus_dir = resolve_bus_dir()
    target_path = os.path.join(bus_dir, f"{key}.json")
    
    # Wrap with metadata
    payload = {
        "metadata": {
            "timestamp": datetime.datetime.now().isoformat(),
            "sender_id": os.environ.get("AURA_AGENT_ID", "unknown")
        },
        "data": data
    }
    
    # Atomic write: write to tmp then rename
    fd, tmp_path = tempfile.mkstemp(dir=bus_dir, suffix=".tmp")
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(payload, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        
        os.replace(tmp_path, target_path)
        return {"status": "success", "key": key, "path": target_path}
    except Exception as e:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        return {"status": "failed", "error": f"Write failed: {str(e)}"}

def blackboard_read(key):
    bus_dir = resolve_bus_dir()
    target_path = os.path.join(bus_dir, f"{key}.json")
    
    if not os.path.exists(target_path):
        return {"status": "failed", "error": f"Key '{key}' not found on blackboard."}
    
    try:
        with open(target_path, "r", encoding="utf-8") as f:
            content = f.read()
            try:
                data = json.loads(content)
                # Standardize return format
                if isinstance(data, dict) and "data" in data and "metadata" in data:
                    return {"status": "success", "content": data["data"], "payload": data["data"], "metadata": data["metadata"]}
                return {"status": "success", "content": data, "payload": data}
            except json.JSONDecodeError:
                return {"status": "success", "content": content, "payload": content}
    except Exception as e:
        return {"status": "failed", "error": f"Read failed: {str(e)}"}

def blackboard_lock(key, action="lock", timeout=10):
    bus_dir = resolve_bus_dir()
    lock_path = os.path.join(bus_dir, f"{key}.lock")
    
    if action == "lock":
        start_time = time.time()
        while time.time() - start_time < timeout:
            try:
                # Use x mode for exclusive creation
                with open(lock_path, "x") as f:
                    f.write(str(os.getpid()))
                return {"status": "success", "lock": "acquired", "message": f"Lock '{key}' acquired."}
            except FileExistsError:
                time.sleep(0.5)
        return {"status": "failed", "error": f"Timeout acquiring lock '{key}'."}
    
    elif action == "release":
        if os.path.exists(lock_path):
            os.remove(lock_path)
            return {"status": "success", "lock": "released", "message": f"Lock '{key}' released."}
        else:
            return {"status": "success", "lock": "released", "message": f"Lock '{key}' was not held."}
    
    return {"status": "failed", "error": f"Invalid lock action: {action}"}

def blackboard_list():
    bus_dir = resolve_bus_dir()
    if not os.path.exists(bus_dir):
        return {"status": "success", "keys": []}
    
    keys = []
    for f in sorted(os.listdir(bus_dir)):
        if f.endswith(".json") and not f.endswith(".tmp"):
            key = f[:-5]  # strip .json
            keys.append(key)
    return {"status": "success", "keys": keys}

def blackboard_delete(key):
    bus_dir = resolve_bus_dir()
    target_path = os.path.join(bus_dir, f"{key}.json")
    lock_path = os.path.join(bus_dir, f"{key}.lock")
    
    if not os.path.exists(target_path):
        return {"status": "failed", "error": f"Key '{key}' not found on blackboard."}
    
    try:
        os.remove(target_path)
        if os.path.exists(lock_path):
            os.remove(lock_path)
        return {"status": "success", "action": "deleted", "message": f"Key '{key}' deleted."}
    except Exception as e:
        return {"status": "failed", "error": f"Delete failed: {str(e)}"}

def main():
    try:
        if len(sys.argv) > 1 and sys.argv[1].strip():
            args = json.loads(sys.argv[1])
        else:
            args = json.loads(sys.stdin.read())
        action = args.get("action")
        key = args.get("key")
        
        if action != "list" and not key:
            print(json.dumps({"status": "failed", "error": "Missing 'key' argument"}))
            return
 
        if action == "write":
            content = args.get("content")
            if content is None:
                print(json.dumps({"status": "failed", "error": "Missing 'content' for write action"}))
                return
            result = blackboard_write(key, content)
        elif action == "read":
            result = blackboard_read(key)
        elif action in ["lock", "release"]:
            timeout = args.get("timeout", 10)
            result = blackboard_lock(key, action, timeout)
        elif action == "list":
            result = blackboard_list()
        elif action == "delete":
            result = blackboard_delete(key)
        else:
            result = {"status": "failed", "error": f"Unknown action: {action}"}
            
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"status": "failed", "error": f"Unexpected error: {str(e)}"}))

if __name__ == "__main__":
    main()
