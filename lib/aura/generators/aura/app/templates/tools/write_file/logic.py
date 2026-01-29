import sys
import json
import os

DEFAULT_FORBIDDEN = [".env", ".key", ".db-journal"]
DEFAULT_READ_ONLY = ["system_tools", "core_protocols"]

def write_file(file_path, content, allowed_paths=None, forbidden_ext=None, read_only_dirs=None, strict_mode=True):
    base_dir = os.getcwd()
    target_path = os.path.abspath(os.path.join(base_dir, file_path or ""))

    if not target_path.startswith(base_dir):
        return {"error": "Security Error: Attempted to write outside of workspace."}

    forbidden_ext = forbidden_ext or DEFAULT_FORBIDDEN
    read_only_dirs = read_only_dirs or DEFAULT_READ_ONLY

    # extension guard
    for ext in forbidden_ext:
        if target_path.endswith(ext):
            return {"error": f"Permission Denied: Writing files with extension '{ext}' is forbidden."}

    # read-only directories guard
    for ro in read_only_dirs:
        ro_abs = os.path.abspath(os.path.join(base_dir, ro))
        if target_path.startswith(ro_abs):
            return {"error": f"Permission Denied: Directory '{ro}' is read-only."}

    if strict_mode:
        allowed_paths = allowed_paths or []
        authorized = any(
            target_path.startswith(os.path.abspath(os.path.join(base_dir, p)))
            for p in allowed_paths
        )
        if not authorized:
            return {"error": f"Permission Denied: Path '{file_path}' not allowed. Allowed: {allowed_paths}"}

    try:
        # ensure directory exists
        os.makedirs(os.path.dirname(target_path), exist_ok=True)
        with open(target_path, 'w', encoding='utf-8') as f:
            f.write(content)
        return {"status": "success"}
    except Exception as e:
        return {"error": str(e), "status": "failed"}

if __name__ == "__main__":
    try:
        args = json.loads(sys.argv[1])
        path = args.get("file_path")
        content = args.get("content", "")
        perms = args.get("context_permissions", [])
        forb = args.get("forbidden_extensions", DEFAULT_FORBIDDEN)
        ro_dirs = args.get("read_only_directories", DEFAULT_READ_ONLY)
        result = write_file(path, content, perms, forb, ro_dirs, True)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": f"Kernel communication error: {str(e)}"}))

