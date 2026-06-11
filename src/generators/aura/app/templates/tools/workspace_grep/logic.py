#!/usr/bin/env python3
import sys
import json
import os
import re
import fnmatch

def matches_pattern(filename, pattern):
    if not pattern:
        return True
    return fnmatch.fnmatch(filename, pattern)

def main():
    try:
        raw_args = sys.stdin.read().strip()
        args = json.loads(raw_args) if raw_args else {}
    except Exception as e:
        print(json.dumps({"error": f"Failed to parse input: {str(e)}", "status": "error"}))
        return

    query = args.get("query")
    if not query:
        print(json.dumps({"error": "Missing required parameter 'query'", "status": "error"}))
        return

    is_regex = args.get("is_regex", False)
    file_pattern = args.get("file_pattern")

    # Exclude directories
    exclude_dirs = {".git", ".aura", ".aura-workspace", "node_modules", "vendor", "tmp", "log", "state"}

    results = []
    max_results = 50

    try:
        if is_regex:
            pattern = re.compile(query)
        else:
            pattern = None
    except Exception as e:
        print(json.dumps({"error": f"Invalid regex pattern: {str(e)}", "status": "error"}))
        return

    cwd = os.getcwd()
    for root, dirs, files in os.walk(cwd):
        # In-place modify dirs to skip excluded ones
        dirs[:] = [d for d in dirs if d not in exclude_dirs]

        for file in files:
            rel_path = os.path.relpath(os.path.join(root, file), cwd)
            if not matches_pattern(file, file_pattern) and not matches_pattern(rel_path, file_pattern):
                continue

            full_path = os.path.join(root, file)
            # Skip binary files or extremely large files
            if os.path.getsize(full_path) > 1024 * 1024:  # 1MB limit
                continue

            try:
                with open(full_path, "r", encoding="utf-8", errors="ignore") as f:
                    for i, line in enumerate(f, 1):
                        matched = False
                        if is_regex:
                            if pattern.search(line):
                                matched = True
                        else:
                            if query in line:
                                matched = True

                        if matched:
                            results.append({
                                "file": rel_path,
                                "line": i,
                                "content": line.strip()
                            })
                            if len(results) >= max_results:
                                break
            except Exception:
                pass

            if len(results) >= max_results:
                break
        if len(results) >= max_results:
            break

    print(json.dumps({
        "status": "ok",
        "results": results,
        "count": len(results),
        "truncated": len(results) >= max_results
    }))

if __name__ == "__main__":
    main()
