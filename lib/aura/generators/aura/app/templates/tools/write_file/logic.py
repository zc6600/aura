import sys
import json
import os

DEFAULT_FORBIDDEN = [".env", ".key", ".db-journal"]
DEFAULT_READ_ONLY = ["system_tools", "core_protocols"]

def _is_within_base(base_dir, target_path):
    try:
        return os.path.commonpath([base_dir, target_path]) == base_dir
    except Exception:
        return False

def write_file(file_path, content, allowed_paths=None, forbidden_ext=None, read_only_dirs=None, strict_mode=None):
    base_dir = os.path.abspath(os.getcwd())
    target_path = os.path.abspath(os.path.join(base_dir, file_path or ""))

    if not _is_within_base(base_dir, target_path):
        return {"error": "Security Error: Attempted to write outside of workspace.", "status": "failed", "code": "security_violation"}

    forbidden_ext = forbidden_ext or DEFAULT_FORBIDDEN
    read_only_dirs = read_only_dirs or DEFAULT_READ_ONLY

    # extension guard
    for ext in forbidden_ext:
        if target_path.endswith(ext):
            return {"error": f"Permission Denied: Writing files with extension '{ext}' is forbidden.", "status": "failed", "code": "permission_denied"}

    # read-only directories guard
    for ro in read_only_dirs:
        ro_abs = os.path.abspath(os.path.join(base_dir, ro))
        if _is_within_base(ro_abs, target_path):
            return {"error": f"Permission Denied: Directory '{ro}' is read-only.", "status": "failed", "code": "permission_denied"}

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

    try:
        # ensure directory exists
        os.makedirs(os.path.dirname(target_path), exist_ok=True)
        with open(target_path, 'w', encoding='utf-8') as f:
            f.write(content)
        return {"status": "ok", "content": content}
    except Exception as e:
        return {"error": str(e), "status": "failed", "code": "io_error"}

if __name__ == "__main__":
    try:
        args = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
        path = args.get("file_path")
        content = args.get("content", "")
        perms = args.get("context_permissions")
        forb = args.get("forbidden_extensions", DEFAULT_FORBIDDEN)
        ro_dirs = args.get("read_only_directories", DEFAULT_READ_ONLY)
        strict_mode = args.get("strict_mode")
        result = write_file(path, content, perms, forb, ro_dirs, strict_mode)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"status": "failed", "error": f"Kernel communication error: {str(e)}", "code": "bad_request"}))
