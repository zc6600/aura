import sys
import json
import os

def _is_within_base(base_dir, target_path):
    try:
        real_base = os.path.realpath(base_dir)
        real_target = os.path.realpath(target_path)
        return os.path.commonpath([real_base, real_target]) == real_base
    except Exception:
        return False

def read_file(file_path, allowed_paths=None, strict_mode=None, start_line=None, end_line=None):
    base_dir = os.path.realpath(os.getcwd())
    target_path = os.path.realpath(os.path.join(base_dir, file_path or ""))

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
        lines = []
        total_lines = 0
        
        s_line = int(start_line) if start_line is not None else None
        e_line = int(end_line) if end_line is not None else None

        with open(target_path, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                total_lines += 1
                if s_line is not None or e_line is not None:
                    bound_start = s_line if s_line is not None else 1
                    bound_end = e_line if e_line is not None else float('inf')
                    if bound_start <= total_lines <= bound_end:
                        lines.append(line)
                else:
                    if total_lines <= 1000:
                        lines.append(line)

        content = "".join(lines)
        is_truncated = False

        if s_line is not None or e_line is not None:
            bound_end = e_line if e_line is not None else float('inf')
            if total_lines > bound_end:
                is_truncated = True
        else:
            if total_lines > 1000:
                is_truncated = True
                content += f"\n\n... [File truncated. Showing lines 1-1000 of {total_lines}. Use start_line and end_line parameters to read specific sections of the file.]\n"

        return {
            "content": content,
            "status": "ok",
            "total_lines": total_lines,
            "is_truncated": is_truncated
        }
    except Exception as e:
        return {"error": str(e), "status": "failed", "code": "io_error"}

if __name__ == "__main__":
    try:
        if len(sys.argv) > 1 and sys.argv[1].strip():
            args = json.loads(sys.argv[1])
        else:
            args = json.loads(sys.stdin.read())
        path = args.get("file_path")
        perms = args.get("context_permissions")
        strict_mode = args.get("strict_mode")
        start_line = args.get("start_line")
        end_line = args.get("end_line")
        result = read_file(path, perms, strict_mode, start_line, end_line)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"status": "failed", "error": f"Kernel communication error: {str(e)}", "code": "bad_request"}))
