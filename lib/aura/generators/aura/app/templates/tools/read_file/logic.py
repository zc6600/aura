import sys
import json
import os

def read_file(file_path, allowed_paths=None, strict_mode=True):
    base_dir = os.getcwd()
    target_path = os.path.abspath(os.path.join(base_dir, file_path or ""))

    if not target_path.startswith(base_dir):
        return {"error": "Security Error: Attempted to access file outside of workspace."}

    if strict_mode:
        allowed_paths = allowed_paths or ["./knowledge"]
        authorized = any(
            target_path.startswith(os.path.abspath(os.path.join(base_dir, p)))
            for p in allowed_paths
        )
        if not authorized:
            return {"error": f"Permission Denied: Path '{file_path}' not allowed. Allowed: {allowed_paths}"}

    if not os.path.exists(target_path):
        return {"error": f"File not found: {file_path}"}

    try:
        with open(target_path, 'r', encoding='utf-8') as f:
            content = f.read()
            return {"content": content, "status": "success"}
    except Exception as e:
        return {"error": str(e), "status": "failed"}

if __name__ == "__main__":
    try:
        args = json.loads(sys.argv[1])
        path = args.get("file_path")
        perms = args.get("context_permissions", ["./knowledge"])
        result = read_file(path, perms, True)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": f"Kernel communication error: {str(e)}"}))
