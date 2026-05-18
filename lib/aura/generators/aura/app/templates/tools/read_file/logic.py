import sys
import json
import os

def _is_within_base(base_dir, target_path):
    try:
        return os.path.commonpath([base_dir, target_path]) == base_dir
    except Exception:
        return False

def read_file(file_path, allowed_paths=None, strict_mode=None):
    base_dir = os.path.abspath(os.getcwd())
    target_path = os.path.abspath(os.path.join(base_dir, file_path or ""))

    if not _is_within_base(base_dir, target_path):
        return {"error": "Security Error: Attempted to access file outside of workspace.", "status": "failed", "code": "security_violation"}

    if strict_mode is None:
        strict_mode = allowed_paths is not None

    if strict_mode:
        allowed_paths = allowed_paths or ["./knowledge", "./tools"]
        authorized = any(
            _is_within_base(os.path.abspath(os.path.join(base_dir, p)), target_path)
            for p in allowed_paths
        )
        if not authorized:
            return {"error": f"Permission Denied: Path '{file_path}' not allowed. Allowed: {allowed_paths}", "status": "failed", "code": "permission_denied"}

    if not os.path.exists(target_path):
        return {"error": f"File not found: {file_path}", "status": "failed", "code": "not_found"}

    try:
        with open(target_path, 'r', encoding='utf-8') as f:
            content = f.read()
            return {"content": content, "status": "ok"}
    except Exception as e:
        return {"error": str(e), "status": "failed", "code": "io_error"}

if __name__ == "__main__":
    try:
        args = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
        path = args.get("file_path")
        perms = args.get("context_permissions")
        strict_mode = args.get("strict_mode")
        result = read_file(path, perms, strict_mode)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"status": "failed", "error": f"Kernel communication error: {str(e)}", "code": "bad_request"}))
