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

def inspect_tool(tool_name):
    safe_name = os.path.basename(tool_name)
    base = os.path.join("tools", safe_name)
    result = {"tool": safe_name, "status": "unknown"}
    if not os.path.isdir(base):
        return {"error": f"Tool '{safe_name}' not found in /tools"}
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
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
