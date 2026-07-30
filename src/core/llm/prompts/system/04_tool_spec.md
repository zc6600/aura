# TOOL SPEC
- Tool directory: `/tools/<name>/` (`manifest.json` + `logic.py`).
- Input: JSON string in `sys.argv[1]`.
- Output: Single JSON object (`{"status": "ok", ...}` or `{"status": "failed", "error": "..."}`).
