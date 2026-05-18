import json
import os
import sys

def extract_magic_hints(filepath):
    hints = []
    if not os.path.exists(filepath):
        return hints
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            for _ in range(15):
                line = f.readline()
                if not line:
                    break
                if "@aura-hint:" in line:
                    hints.append(line.split("@aura-hint:")[1].strip())
    except Exception:
        pass
    return hints

def build_tree(base, max_entries=1000, max_depth=3):
    lines = []
    count = 0
    for root, dirs, files in os.walk(base):
        rel = os.path.relpath(root, base)
        depth = 0 if rel == "." else len(rel.split(os.sep))
        if depth > max_depth:
            continue
        indent = "  " * depth
        lines.append(f"{indent}{os.path.basename(root)}/")
        for d in sorted(dirs):
            if count >= max_entries:
                lines.append("... (truncated)")
                return lines
            lines.append(f"{indent}  {d}/")
            count += 1
        for f in sorted(files):
            if count >= max_entries:
                lines.append("... (truncated)")
                return lines
            lines.append(f"{indent}  {f}")
            count += 1
    return lines

def inspect_tool(tool_name):
    safe_name = os.path.basename(tool_name)
    base = os.path.join("tools", safe_name)
    result = {"tool": safe_name, "status": "unknown"}
    if not os.path.isdir(base):
        return {"error": f"Tool '{safe_name}' not found in /tools", "status": "failed", "code": "not_found"}
    manifest_path = os.path.join(base, "manifest.json")
    manifest = {}
    if os.path.exists(manifest_path):
        try:
            with open(manifest_path, "r", encoding="utf-8") as fh:
                manifest = json.load(fh)
        except Exception as e:
            manifest = {"error": f"Failed to parse manifest: {str(e)}"}
    files = os.listdir(base)
    all_magic_hints = []
    hint_content = None
    for f in files:
        full_f = os.path.join(base, f)
        if f.endswith(".hint"):
            try:
                with open(full_f, "r", encoding="utf-8") as hf:
                    hint_content = hf.read().strip()
            except Exception:
                pass
        if f.startswith("logic.") or f.startswith("test."):
            all_magic_hints.extend(extract_magic_hints(full_f))
    result.update({
        "manifest": manifest,
        "files": files,
        "hint": hint_content,
        "magic_hints": all_magic_hints,
        "tree": build_tree(base),
        "status": "ok"
    })
    return result

if __name__ == "__main__":
    try:
        input_data = json.loads(sys.argv[1])
        name = input_data.get("tool_name")
        if not name:
            raise ValueError("Field 'tool_name' is required.")
        print(json.dumps(inspect_tool(name)))
    except Exception as e:
        print(json.dumps({"error": str(e), "status": "failed", "code": "execution_error"}))
        sys.exit(1)
